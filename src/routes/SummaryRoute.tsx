import { useState, useMemo } from 'react'
import { get, ref } from 'firebase/database'
import { db, auth } from '../firebase'
import { HomeButton } from '../components/HomeButton'
import { AuthStatus } from '../components/AuthStatus'
import { useGames } from '../hooks/useGames'
import { useTeams } from '../hooks/useTeams'
import { usePlayers } from '../hooks/usePlayers'
import type { AtBatRecord } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────

interface AtBatEntry {
  batter: string
  pitcher: string
  result: string
  inning: number
  half: 'top' | 'bot'
  rbi: number
  outsOnPlay: number
  batterAdvancedTo: string | null
  runnersScored: string[]
}

interface GameData {
  awayTeam: string
  homeTeam: string
  awayScore: number
  homeScore: number
  atBats: AtBatEntry[]
}

interface SummaryPayload {
  date: string
  games: GameData[]
  prompt: string
}

// ── Component ──────────────────────────────────────────────────────────────

const FUNCTION_URL = '/api/generateSummary'

export function SummaryRoute() {
  const { games, loading: gamesLoading } = useGames()
  const { teams } = useTeams()
  const { players } = usePlayers()

  const [selectedDate, setSelectedDate] = useState<string>('')
  const [promptText, setPromptText] = useState<string>('')
  const [summary, setSummary] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const availableDates = useMemo(() => {
    const dates = new Set(games.map(e => e.game.date).filter(Boolean))
    return Array.from(dates).sort((a, b) => b.localeCompare(a))
  }, [games])

  const gamesOnDate = useMemo(
    () => games.filter(e => e.game.date === selectedDate),
    [games, selectedDate]
  )

  function buildDefaultPrompt(date: string, gamesForDate: typeof gamesOnDate): string {
    const dayOfWeek = date
      ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
      : ''
    const matchups = gamesForDate.map(({ game }) => {
      const away = teams[game.awayTeamId]?.name ?? game.awayTeamId
      const home = teams[game.homeTeamId]?.name ?? game.homeTeamId
      return `${away} vs ${home}`
    }).join(', ')

    return `You are writing a game day recap for the Brookside Wiffle Ball League — a recreational adult wiffle ball league. Write like a witty local sports reporter who genuinely enjoys covering this league and isn't afraid to give the losing team a hard time. Use dry humor, playful jabs at players who had rough nights, and the occasional colorful line about a big play. Don't force a joke into every sentence — let the humor come from the voice — but don't hold back when the material is there. Use player names constantly. For big moments — home runs, big RBI hits, dominant pitching — be specific about what happened and who did it. No bullet lists, no hashtags, no emojis.

${dayOfWeek} night at Soccer City. ${date}. Games played: ${matchups}.

Structure — follow this exactly:
1. Opening paragraph: set the scene for the night with a couple of sentences highlighting the biggest storylines.
2. For each game, write ONE standalone line formatted exactly like this:
   [Away Team] [Away Score] — [Home Team] [Home Score]
   Then immediately follow it with 3–4 sentences covering the key plays and performances from both teams. Mention at least 3–4 players by name per game — both offensive standouts and the pitchers. Be specific: say what they did, not just that they did well. Do NOT say "Game 1" or "Game 2" or number the games in any way. Do NOT use "vs" in the score line — use an em dash.
3. Closing: a sentence or two wrapping up the night and giving a nod to any standout individual performances.

Write the recap now.`
  }

  function resolveName(id: string): string {
    return players[id]?.name ?? id
  }

  function resolveAtBat(ab: AtBatRecord): AtBatEntry {
    return {
      batter: resolveName(ab.batterId),
      pitcher: resolveName(ab.pitcherId),
      result: ab.result,
      inning: ab.inning,
      half: ab.isTopInning ? 'top' : 'bot',
      rbi: ab.rbiCount ?? 0,
      outsOnPlay: ab.outsOnPlay ?? 0,
      batterAdvancedTo: ab.batterAdvancedTo ?? null,
      runnersScored: (ab.runnersScored ?? []).map(resolveName),
    }
  }

  async function generate() {
    if (!selectedDate || gamesOnDate.length === 0) return
    setGenerating(true)
    setError('')
    setSummary('')

    try {
      const gameDatas: GameData[] = []

      for (const { gameId, game } of gamesOnDate) {
        const snap = await get(ref(db, `gameStats/${gameId}`))
        const raw: Record<string, AtBatRecord> = snap.exists() ? snap.val() : {}
        const atBats = Object.values(raw)
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(resolveAtBat)

        gameDatas.push({
          awayTeam: teams[game.awayTeamId]?.name ?? game.awayTeamId,
          homeTeam: teams[game.homeTeamId]?.name ?? game.homeTeamId,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          atBats,
        })
      }

      const payload: SummaryPayload = { date: selectedDate, games: gameDatas, prompt: promptText }

      const idToken = await auth.currentUser?.getIdToken()
      if (!idToken) throw new Error('Not signed in.')

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Server error ${response.status}`)
      }
      const data = await response.json() as { summary: string }
      setSummary(data.summary)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setGenerating(false)
    }
  }

  function copyToClipboard() {
    if (!summary) return
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ fontFamily: 'var(--font-ui)', maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <HomeButton />
      <AuthStatus />
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Game Day Summary</h1>
      <p style={{ color: '#888', marginBottom: 32 }}>
        Pick a date to generate an AI-written recap of all games played that day.
      </p>

      {gamesLoading ? (
        <p style={{ color: '#888' }}>Loading games…</p>
      ) : availableDates.length === 0 ? (
        <p style={{ color: '#888' }}>No games found.</p>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Select a date
            </label>
            <select
              value={selectedDate}
              onChange={e => {
                const d = e.target.value
                setSelectedDate(d)
                setSummary('')
                setError('')
                const gamesForDate = games.filter(g => g.game.date === d)
                setPromptText(buildDefaultPrompt(d, gamesForDate))
              }}
              style={{
                padding: '10px 14px',
                fontSize: 16,
                borderRadius: 8,
                border: '1px solid #333',
                background: '#111',
                color: '#fff',
                minWidth: 200,
              }}
            >
              <option value="">— choose a date —</option>
              {availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {selectedDate && gamesOnDate.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>Games on {selectedDate}:</p>
              <ul style={{ margin: 0, padding: '0 0 0 20px', color: '#ccc' }}>
                {gamesOnDate.map(({ gameId, game }) => (
                  <li key={gameId}>
                    {teams[game.awayTeamId]?.name ?? game.awayTeamId} {game.awayScore} &nbsp;@&nbsp;
                    {teams[game.homeTeamId]?.name ?? game.homeTeamId} {game.homeScore}
                    {game.finalized && <span style={{ color: '#4ade80', marginLeft: 8, fontSize: 13 }}>✓ finalized</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {promptText && (
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                Prompt <span style={{ fontWeight: 400, color: '#888', fontSize: 13 }}>(edit before generating)</span>
              </label>
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                rows={10}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  borderRadius: 8,
                  border: '1px solid #333',
                  background: '#0a0a0a',
                  color: '#ccc',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  lineHeight: 1.6,
                }}
              />
            </div>
          )}

          <button
            onClick={generate}
            disabled={!selectedDate || gamesOnDate.length === 0 || generating}
            style={{
              padding: '12px 28px',
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 8,
              border: 'none',
              background: generating ? '#444' : '#2563eb',
              color: '#fff',
              cursor: generating ? 'not-allowed' : 'pointer',
              marginBottom: 32,
            }}
          >
            {generating ? 'Generating…' : 'Generate Summary'}
          </button>

          {error && (
            <p style={{ color: '#f87171', marginBottom: 24 }}>{error}</p>
          )}

          {summary && (
            <div>
              <div style={{
                background: '#111',
                border: '1px solid #333',
                borderRadius: 12,
                padding: '24px 28px',
                marginBottom: 16,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                fontSize: 16,
                color: '#e5e5e5',
              }}>
                {summary}
              </div>
              <button
                onClick={copyToClipboard}
                style={{
                  padding: '10px 22px',
                  fontSize: 15,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: copied ? '#166534' : '#1a1a1a',
                  color: copied ? '#4ade80' : '#fff',
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
