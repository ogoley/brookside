import { useState, useMemo } from 'react'
import { get, ref } from 'firebase/database'
import { db, auth } from '../firebase'
import { HomeButton } from '../components/HomeButton'
import { AuthStatus } from '../components/AuthStatus'
import { useGames } from '../hooks/useGames'
import { useTeams } from '../hooks/useTeams'
import { usePlayers } from '../hooks/usePlayers'
import { computeGameStats } from '../scoring/engine'
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

interface PlayerLine {
  name: string
  team: 'away' | 'home'
  // Hitting (only present if the player batted)
  ab?: number
  h?: number
  doubles?: number
  triples?: number
  hr?: number
  bb?: number
  k?: number
  rbi?: number
  r?: number
  avg?: number
  obp?: number
  slg?: number
  ops?: number
  // Pitching (only present if the player pitched)
  ip?: number
  pitchK?: number
  pitchBb?: number
  runsAllowed?: number
  era?: number
}

interface GameData {
  awayTeam: string
  homeTeam: string
  awayScore: number
  homeScore: number
  atBats: AtBatEntry[]
  playerLines: PlayerLine[]
}

interface SummaryPayload {
  date: string
  games: GameData[]
  prompt: string
}

// ── Component ──────────────────────────────────────────────────────────────

const FUNCTION_URL = '/api/generateSummary'

const VENUES = [
  { id: 'soccer_city', label: 'Soccer City (indoor)' },
  { id: 'bittersweet', label: 'Bittersweet Park (outdoor)' },
] as const

type VenueId = typeof VENUES[number]['id']

export function SummaryRoute() {
  const { games, loading: gamesLoading } = useGames()
  const { teams } = useTeams()
  const { players } = usePlayers()

  const [selectedVenue, setSelectedVenue] = useState<VenueId>('soccer_city')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [promptText, setPromptText] = useState<string>('')
  const [summary, setSummary] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState(false)
  // Cache of raw at-bats per game for the currently-selected date, keyed by gameId.
  // Populated when the date changes; reused by generate() so we don't refetch.
  const [atBatsByGameId, setAtBatsByGameId] = useState<Record<string, AtBatRecord[]>>({})

  const availableDates = useMemo(() => {
    const dates = new Set(games.map(e => e.game.date).filter(Boolean))
    return Array.from(dates).sort((a, b) => b.localeCompare(a))
  }, [games])

  const gamesOnDate = useMemo(
    () => games.filter(e => e.game.date === selectedDate),
    [games, selectedDate]
  )

  // Compute authoritative per-player batting/pitching lines for a single game.
  // The model uses these verbatim for X-for-Y, BB, AVG/OBP/SLG/OPS so it doesn't
  // have to count plate appearances vs at-bats itself (which is where it errs).
  function computePlayerLines(
    atBats: AtBatRecord[],
    homeTeamId: string,
  ): PlayerLine[] {
    const playerIds = new Set<string>()
    for (const ab of atBats) {
      if (ab.batterId) playerIds.add(ab.batterId)
      if (ab.pitcherId) playerIds.add(ab.pitcherId)
    }

    const lines: PlayerLine[] = []
    for (const pid of playerIds) {
      const stats = computeGameStats(atBats, pid)
      const player = players[pid]
      const teamId = player?.teamId
      const team: 'away' | 'home' = teamId === homeTeamId ? 'home' : 'away'
      const name = player?.name ?? pid

      const line: PlayerLine = { name, team }
      if (stats.hitting) {
        const h = stats.hitting
        line.ab = h.ab
        line.h = h.h
        line.doubles = h.doubles
        line.triples = h.triples
        line.hr = h.hr
        line.bb = h.bb
        line.k = h.k
        line.rbi = h.rbi
        line.r = h.r
        line.avg = h.avg
        line.obp = h.obp
        line.slg = h.slg
        line.ops = h.ops
      }
      if (stats.pitching) {
        const p = stats.pitching
        line.ip = p.inningsPitched
        line.pitchK = p.k
        line.pitchBb = p.bb
        line.runsAllowed = p.runsAllowed
        line.era = p.era
      }
      lines.push(line)
    }
    return lines
  }

  function formatStatBlock(g: GameData): string {
    const batters = g.playerLines
      .filter(l => l.ab !== undefined || (l.bb ?? 0) > 0)
      .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))
    const pitchers = g.playerLines.filter(l => l.ip !== undefined && l.ip > 0)

    const teamLabel = (t: 'away' | 'home') => t === 'away' ? g.awayTeam : g.homeTeam

    const batterRows = batters.map(b => {
      const xbh: string[] = []
      if (b.doubles) xbh.push(`${b.doubles} 2B`)
      if (b.triples) xbh.push(`${b.triples} 3B`)
      if (b.hr) xbh.push(`${b.hr} HR`)
      const xbhStr = xbh.length ? `, ${xbh.join(', ')}` : ''
      const bbStr = b.bb ? `, ${b.bb} BB` : ''
      const kStr = b.k ? `, ${b.k} K` : ''
      const rbiStr = b.rbi ? `, ${b.rbi} RBI` : ''
      const rStr = b.r ? `, ${b.r} R` : ''
      return `  - ${b.name} (${teamLabel(b.team)}): ${b.h ?? 0}-for-${b.ab ?? 0}${bbStr}${xbhStr}${rbiStr}${rStr}${kStr} | AVG ${(b.avg ?? 0).toFixed(3)} OBP ${(b.obp ?? 0).toFixed(3)} SLG ${(b.slg ?? 0).toFixed(3)} OPS ${(b.ops ?? 0).toFixed(3)}`
    })

    const pitcherRows = pitchers.map(p => (
      `  - ${p.name} (${teamLabel(p.team)}): ${(p.ip ?? 0).toFixed(2)} IP, ${p.pitchK ?? 0} K, ${p.pitchBb ?? 0} BB, ${p.runsAllowed ?? 0} R | ERA ${(p.era ?? 0).toFixed(2)}`
    ))

    return `=== ${g.awayTeam} ${g.awayScore} — ${g.homeTeam} ${g.homeScore} ===
Batter lines (authoritative — quote verbatim, do not recompute):
${batterRows.join('\n') || '  (none)'}

Pitcher lines (authoritative — quote verbatim, do not recompute):
${pitcherRows.join('\n') || '  (none)'}`
  }

  function formatPlayByPlay(g: GameData): string {
    const rows = g.atBats.map(ab => {
      const half = ab.half === 'top' ? 'T' : 'B'
      const adv = ab.batterAdvancedTo ? ` → ${ab.batterAdvancedTo}` : ''
      const rbi = ab.rbi ? `, ${ab.rbi} RBI` : ''
      const outs = ab.outsOnPlay ? `, ${ab.outsOnPlay} out${ab.outsOnPlay > 1 ? 's' : ''}` : ''
      const scored = ab.runnersScored.length ? `, scored: ${ab.runnersScored.join(', ')}` : ''
      return `  ${half}${ab.inning}: ${ab.batter} vs ${ab.pitcher} — ${ab.result}${adv}${rbi}${outs}${scored}`
    })
    return `Play-by-play (use for dramatic moments — leverage, big-spot HRs, comebacks):
${rows.join('\n') || '  (none)'}`
  }

  function buildDefaultPrompt(
    date: string,
    gamesForDate: typeof gamesOnDate,
    venueId: VenueId,
    gameBlocks: { matchup: string; statBlock: string; playByPlay: string }[],
  ): string {
    const dayOfWeek = date
      ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
      : ''
    const matchups = gamesForDate.map(({ game }) => {
      const away = teams[game.awayTeamId]?.name ?? game.awayTeamId
      const home = teams[game.homeTeamId]?.name ?? game.homeTeamId
      return `${away} vs ${home}`
    }).join(', ')
    const venueLabel = VENUES.find(v => v.id === venueId)?.label ?? 'Soccer City (indoor)'

    const gamesSection = gameBlocks.map(b => `${b.statBlock}\n\n${b.playByPlay}`).join('\n\n')

    return `You are writing a game day recap for the Brookside Wiffle Ball League — a recreational adult wiffle ball league. Write like a witty local sports reporter who genuinely enjoys covering this league and isn't afraid to give the losing team a hard time. Use dry humor, playful jabs at players who had rough nights, and the occasional colorful line about a big play. Don't force a joke into every sentence — let the humor come from the voice — but don't hold back when the material is there. Use player names constantly. For big moments — home runs, big RBI hits, dominant pitching — be specific about what happened and who did it. No bullet lists, no hashtags, no emojis.

${dayOfWeek} night at ${venueLabel}. ${date}. Games played: ${matchups}.

Structure — follow this exactly:
1. Opening paragraph: set the scene for the night with a couple of sentences highlighting the biggest storylines.
2. For each game, write ONE standalone line formatted exactly like this:
   [Away Team] [Away Score] — [Home Team] [Home Score]
   Then immediately follow it with 3–4 sentences covering the key plays and performances from both teams. Mention at least 3–4 players by name per game — both offensive standouts and the pitchers. Be specific: say what they did, not just that they did well. Do NOT say "Game 1" or "Game 2" or number the games in any way. Do NOT use "vs" in the score line — use an em dash.
3. Closing: a sentence or two wrapping up the night and giving a nod to any standout individual performances.

Data sources and how to use them — read carefully:
- The "Batter lines" and "Pitcher lines" blocks below are AUTHORITATIVE summary stats. When you reference a player's night line (X-for-Y, walks, AVG, OPS, IP, ERA), quote those numbers VERBATIM. Do not recount from the play-by-play and do not invent numbers — walks are not at-bats, and miscounting that is the most common mistake. If the stat block says "5-for-6, 4 BB", you write "5-for-6 with four walks", never "5-for-5".
- The "Play-by-play" block is for dramatic context: late-inning home runs, two-out RBIs, grand slams, comebacks, dominant innings. Use it to find the most write-up-worthy moments — a two-out grand slam that puts a team ahead is exactly the kind of moment that should anchor a game's paragraph. Cross-reference with batter lines to describe the player accurately.

Stat-based standouts — before writing, scan the batter lines for anyone with a high AVG or OPS, even if they didn't have a single highlight-reel play. A guy who quietly went 3-for-3 with a walk, or 2-for-2 with a double, deserves a shout-out by name and stat line just as much as the home run hitters. Do not let silently great performances go unmentioned.

Shutouts — if any game ended with one team held to zero runs, explicitly call it out and give the winning pitcher credit by name. A shutout is a notable accomplishment in this league and should not be glossed over.

${gamesSection}

Write the recap now.`
  }

  // Fetch raw at-bats for every game on the given date, cache them, then build
  // a prompt with embedded stat blocks + play-by-play. Called on date change
  // and on venue change so the user always sees the live prompt before generating.
  async function buildPromptForDate(date: string, venueId: VenueId) {
    if (!date) {
      setPromptText('')
      setAtBatsByGameId({})
      return
    }
    const gamesForDate = games.filter(g => g.game.date === date)
    if (gamesForDate.length === 0) {
      setPromptText('')
      setAtBatsByGameId({})
      return
    }
    setLoadingStats(true)
    try {
      const cache: Record<string, AtBatRecord[]> = {}
      const gameBlocks: { matchup: string; statBlock: string; playByPlay: string }[] = []
      for (const { gameId, game } of gamesForDate) {
        const snap = await get(ref(db, `gameStats/${gameId}`))
        const raw: Record<string, AtBatRecord> = snap.exists() ? snap.val() : {}
        const atBats = Object.values(raw).sort((a, b) => a.timestamp - b.timestamp)
        cache[gameId] = atBats

        const awayTeam = teams[game.awayTeamId]?.name ?? game.awayTeamId
        const homeTeam = teams[game.homeTeamId]?.name ?? game.homeTeamId
        const playerLines = computePlayerLines(atBats, game.homeTeamId)
        const g: GameData = {
          awayTeam, homeTeam,
          awayScore: game.awayScore, homeScore: game.homeScore,
          atBats: atBats.map(resolveAtBat),
          playerLines,
        }
        gameBlocks.push({
          matchup: `${awayTeam} @ ${homeTeam}`,
          statBlock: formatStatBlock(g),
          playByPlay: formatPlayByPlay(g),
        })
      }
      setAtBatsByGameId(cache)
      setPromptText(buildDefaultPrompt(date, gamesForDate, venueId, gameBlocks))
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to load stats for that date.')
    } finally {
      setLoadingStats(false)
    }
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
        // Reuse the cached at-bats from buildPromptForDate; fall back to a
        // refetch only if the cache is somehow empty (e.g. a refresh edge case).
        let atBats = atBatsByGameId[gameId]
        if (!atBats) {
          const snap = await get(ref(db, `gameStats/${gameId}`))
          const raw: Record<string, AtBatRecord> = snap.exists() ? snap.val() : {}
          atBats = Object.values(raw).sort((a, b) => a.timestamp - b.timestamp)
        }
        const playerLines = computePlayerLines(atBats, game.homeTeamId)

        gameDatas.push({
          awayTeam: teams[game.awayTeamId]?.name ?? game.awayTeamId,
          homeTeam: teams[game.homeTeamId]?.name ?? game.homeTeamId,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          atBats: atBats.map(resolveAtBat),
          playerLines,
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <HomeButton />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Game Day Summary</h1>
        </div>
        <AuthStatus />
      </div>
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
              Venue
            </label>
            <select
              value={selectedVenue}
              onChange={e => {
                const v = e.target.value as VenueId
                setSelectedVenue(v)
                if (selectedDate) {
                  void buildPromptForDate(selectedDate, v)
                }
              }}
              style={{
                padding: '10px 14px',
                fontSize: 16,
                borderRadius: 8,
                border: '1px solid #333',
                background: '#111',
                color: '#fff',
                minWidth: 240,
              }}
            >
              {VENUES.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>

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
                void buildPromptForDate(d, selectedVenue)
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

          {loadingStats && (
            <p style={{ color: '#888', marginBottom: 16 }}>Loading game stats…</p>
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
