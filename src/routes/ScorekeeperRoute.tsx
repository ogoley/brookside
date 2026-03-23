import { useState, useEffect } from 'react'
import { ref, push, set, update, remove, onValue } from 'firebase/database'
import { db } from '../firebase'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import { useGameStats } from '../hooks/useGameStats'
import { useLiveRunners } from '../hooks/useLiveRunners'
import { useGames } from '../hooks/useGames'
import { useGameRecord } from '../hooks/useGameRecord'
import { useGameLineup } from '../hooks/useGameLineup'
import { applyAtBat, replayHalfInning, type PlayLogEntry } from '../scoring/engine'
import { generateGameId, getEasternDateString } from '../scoring/gameId'
import { RunnerDiamond } from '../components/RunnerDiamond'
import type {
  AtBatResult, AtBatRecord, RunnersState, RunnerOutcomes,
  PlayersMap, LineupEntry, GameLineup, TeamsMap,
} from '../types'

// ── Constants ──────────────────────────────────────────────────────────────

type WizardStep = 'batter' | 'result' | 'runner_outcomes' | 'confirm' | 'inning_end'
type NewGameStep = 'teams' | 'home_lineup' | 'away_lineup' | 'confirm'

// Legacy values (flyout, hbp, sacrifice_fly, sacrifice_bunt, fielders_choice, pitchers_poison)
// are kept here only so historical records render correctly. They are not selectable.
const RESULT_LABELS: Record<AtBatResult, string> = {
  single: 'Single', double: 'Double', triple: 'Triple', home_run: 'Home Run',
  walk: 'Walk', strikeout: 'Strikeout (K)', strikeout_looking: 'Strikeout (ꓘ)',
  groundout: 'Ground / Tag Out', popout: 'Pop Out',
  flyout: 'Fly Out', hbp: 'Hit By Pitch', sacrifice_fly: 'Sac Fly',
  sacrifice_bunt: 'Sac Bunt', fielders_choice: "Fielder's Choice", pitchers_poison: "Pitcher's Poison",
}

const RESULTS: AtBatResult[] = [
  'single', 'double', 'triple', 'home_run',
  'walk', 'strikeout', 'strikeout_looking',
  'groundout', 'popout',
]

// What base the batter auto-advances to for each result (null = scorer decides)
// Note: groundout with a connected chain overrides the batter advance to 'first' in handleSelectResult.
const AUTO_BATTER_ADVANCE: Partial<Record<AtBatResult, AtBatRecord['batterAdvancedTo']>> = {
  single: 'first', double: 'second', triple: 'third', home_run: 'home',
  walk: 'first',
  strikeout: 'out', strikeout_looking: 'out',
  groundout: 'out', popout: 'out',
}

function lastName(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1]
}

/**
 * Chain rule (ground out / tag out only — NOT pop outs):
 * When a batter is put out on a ground ball or tag play AND there is a connected
 * chain of runners starting at first base, the lead runner of that chain leaves
 * the bases (takes the out) while the batter stays on 1st. Only 1 out is recorded.
 *
 * A "connected chain" means runners on consecutive bases with no gap:
 *   1st only → lead is 1st
 *   1st + 2nd → lead is 2nd
 *   1st + 2nd + 3rd → lead is 3rd
 *   1st + 3rd (gap at 2nd) → no chain, rule does not apply
 *
 * Pop outs are exempt: runners may tag up and advance freely, no chain rule.
 *
 * Returns the bases in the chain from first toward third, or [] if no chain.
 */
function getConnectedChain(runners: RunnersState): Array<'first' | 'second' | 'third'> {
  const chain: Array<'first' | 'second' | 'third'> = []
  if (runners.first) {
    chain.push('first')
    if (runners.second) {
      chain.push('second')
      if (runners.third) chain.push('third')
    }
  }
  return chain
}

// ── Main component ──────────────────────────────────────────────────────────

export function ScorekeeperRoute() {
  const { players } = usePlayers()
  const { teams } = useTeams()
  const { games, loading: gamesLoading } = useGames()

  // Top-level screen
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [showNewGameModal, setShowNewGameModal] = useState(false)
  const [showLineupEditor, setShowLineupEditor] = useState(false)

  const playerName = (id: string) => players[id]?.name ?? id

  if (activeGameId && showLineupEditor) {
    return (
      <LineupEditScreen
        gameId={activeGameId}
        players={players}
        teams={teams}
        onBack={() => setShowLineupEditor(false)}
      />
    )
  }

  if (activeGameId) {
    return (
      <GameWizard
        gameId={activeGameId}
        players={players}
        teams={teams}
        playerName={playerName}
        onBack={() => setActiveGameId(null)}
        onEditLineup={() => setShowLineupEditor(true)}
      />
    )
  }

  return (
    <GameSelectorScreen
      games={games}
      loading={gamesLoading}
      teams={teams}
      onSelectGame={setActiveGameId}
      onNewGame={() => setShowNewGameModal(true)}
      showNewGameModal={showNewGameModal}
      onCloseNewGameModal={() => setShowNewGameModal(false)}
      onGameCreated={(id) => { setShowNewGameModal(false); setActiveGameId(id) }}
      players={players}
    />
  )
}

// ── Game Selector Screen ────────────────────────────────────────────────────

function GameSelectorScreen({
  games, loading, teams, players,
  onSelectGame, onNewGame, showNewGameModal, onCloseNewGameModal, onGameCreated,
}: {
  games: ReturnType<typeof useGames>['games']
  loading: boolean
  teams: TeamsMap
  players: PlayersMap
  onSelectGame: (id: string) => void
  onNewGame: () => void
  showNewGameModal: boolean
  onCloseNewGameModal: () => void
  onGameCreated: (id: string) => void
}) {
  const today = getEasternDateString()
  const todaysGames = games.filter(({ game }) => game.date === today)
  const otherGames = games.filter(({ game }) => game.date !== today && !game.finalized)

  return (
    <div className="min-h-screen px-4 py-4" style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-2xl font-black uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
          Scorekeeper
        </h1>
        <button
          onClick={onNewGame}
          className="h-10 px-4 rounded-xl font-bold text-sm uppercase tracking-wider"
          style={{ background: '#2563eb', color: '#fff', border: '1px solid rgba(96,165,250,0.4)' }}
        >
          + New Game
        </button>
      </div>

      {loading ? (
        <p className="text-white/30 text-sm text-center py-12">Loading games…</p>
      ) : todaysGames.length === 0 && otherGames.length === 0 ? (
        <div className="rounded-2xl px-6 py-10 text-center" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-white/40 text-sm mb-1">No games today</p>
          <p className="text-white/25 text-xs">Tap + New Game to get started</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {todaysGames.length > 0 && (
            <Section label={`Today — ${today}`}>
              {todaysGames.map(({ gameId, game }) => (
                <GameRow
                  key={gameId}
                  gameId={gameId}
                  game={game}
                  teams={teams}
                  onSelect={onSelectGame}
                />
              ))}
            </Section>
          )}
          {otherGames.length > 0 && (
            <Section label="In Progress">
              {otherGames.map(({ gameId, game }) => (
                <GameRow
                  key={gameId}
                  gameId={gameId}
                  game={game}
                  teams={teams}
                  onSelect={onSelectGame}
                />
              ))}
            </Section>
          )}
        </div>
      )}

      {showNewGameModal && (
        <NewGameModal
          teams={teams}
          players={players}
          onClose={onCloseNewGameModal}
          onCreated={onGameCreated}
        />
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-white/30 text-xs uppercase tracking-widest px-1" style={{ fontFamily: 'var(--font-score)' }}>
        {label}
      </p>
      {children}
    </div>
  )
}

function GameRow({ gameId, game, teams, onSelect }: {
  gameId: string
  game: ReturnType<typeof useGames>['games'][number]['game']
  teams: TeamsMap
  onSelect: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const home = teams[game.homeTeamId]
  const away = teams[game.awayTeamId]
  const statusColor = game.finalized ? 'rgba(255,255,255,0.25)' : '#4ade80'
  const statusLabel = game.finalized ? 'Final' : `${game.isTopInning ? '▲' : '▼'}${game.inning ?? 1} · ${game.outs ?? 0} out${(game.outs ?? 0) !== 1 ? 's' : ''}`

  const deleteGame = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await Promise.all([
      remove(ref(db, `games/${gameId}`)),
      remove(ref(db, `gameStats/${gameId}`)),
      remove(ref(db, `liveRunners/${gameId}`)),
    ])
    // Clear from /game/meta if this was the active streamed game
    await update(ref(db, 'game/meta'), { currentGameId: null })
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
      <button
        onClick={() => onSelect(gameId)}
        className="w-full px-4 py-4 flex items-center justify-between text-left"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-base">{away?.shortName ?? game.awayTeamId}</span>
            <span className="text-white/30 text-sm">@</span>
            <span className="text-white font-bold text-base">{home?.shortName ?? game.homeTeamId}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/50 text-sm font-semibold" style={{ fontFamily: 'var(--font-score)' }}>
              {game.awayScore ?? 0} – {game.homeScore ?? 0}
            </span>
            <span className="text-xs font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </span>
            {game.isStreamed && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                LIVE
              </span>
            )}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 18 }}>›</span>
      </button>

      <div className="px-4 pb-3 flex justify-end">
          {!confirmDelete ? (
            <button
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
              className="text-xs font-semibold px-3 h-7 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}
            >
              Delete game
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-xs">Delete everything?</span>
              <button
                onClick={deleteGame}
                className="text-xs font-bold px-3 h-7 rounded-lg"
                style={{ background: '#b91c1c', color: '#fff' }}
              >
                Yes, delete
              </button>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(false) }}
                className="text-xs font-semibold px-3 h-7 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
    </div>
  )
}

// ── New Game Modal ──────────────────────────────────────────────────────────

function NewGameModal({ teams, players, onClose, onCreated }: {
  teams: TeamsMap
  players: PlayersMap
  onClose: () => void
  onCreated: (gameId: string) => void
}) {
  const [step, setStep] = useState<NewGameStep>('teams')
  const [homeTeamId, setHomeTeamId] = useState('')
  const [awayTeamId, setAwayTeamId] = useState('')
  const [isStreamed, setIsStreamed] = useState(false)
  const [homeLineup, setHomeLineup] = useState<LineupEntry[]>([])
  const [awayLineup, setAwayLineup] = useState<LineupEntry[]>([])
  const [creating, setCreating] = useState(false)

  const teamOptions = Object.entries(teams).sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const createGame = async () => {
    if (!homeTeamId || !awayTeamId) return
    setCreating(true)
    try {
      const gameId = await generateGameId(homeTeamId, awayTeamId)
      const now = Date.now()

      // Write the whole game node as one set() — avoids Firebase ancestor-path
      // conflict that occurs when a parent path and its children are in the same update()
      await set(ref(db, `games/${gameId}`), {
        homeTeamId,
        awayTeamId,
        date: getEasternDateString(),
        isStreamed,
        finalized: false,
        startedAt: now,
        inning: 1,
        isTopInning: true,
        outs: 0,
        homeScore: 0,
        awayScore: 0,
        lineups: {
          [homeTeamId]: homeLineup,
          [awayTeamId]: awayLineup,
        },
        lineupPosition: {
          [homeTeamId]: 0,
          [awayTeamId]: 0,
        },
      })

      // Write sibling paths separately
      await set(ref(db, `liveRunners/${gameId}`), { first: null, second: null, third: null })
      if (isStreamed) {
        await update(ref(db, 'game/meta'), { currentGameId: gameId })
      }
      onCreated(gameId)
    } catch (e) {
      console.error('Failed to create game:', e)
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-t-3xl flex flex-col max-h-[90vh]"
        style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-white font-black text-lg uppercase tracking-wider" style={{ fontFamily: 'var(--font-score)' }}>
            {step === 'teams' && 'New Game — Teams'}
            {step === 'home_lineup' && `${teams[homeTeamId]?.shortName ?? 'Home'} Lineup`}
            {step === 'away_lineup' && `${teams[awayTeamId]?.shortName ?? 'Away'} Lineup`}
            {step === 'confirm' && 'Confirm Game'}
          </h2>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-6 flex flex-col gap-4">
          {/* Step A — Teams */}
          {step === 'teams' && (
            <>
              <ModalField label="Home Team">
                <ModalSelect value={homeTeamId} onChange={setHomeTeamId} placeholder="— Select home team —">
                  {teamOptions.filter(([id]) => id !== awayTeamId).map(([id, t]) => (
                    <option key={id} value={id}>{t.name}</option>
                  ))}
                </ModalSelect>
              </ModalField>
              <ModalField label="Away Team">
                <ModalSelect value={awayTeamId} onChange={setAwayTeamId} placeholder="— Select away team —">
                  {teamOptions.filter(([id]) => id !== homeTeamId).map(([id, t]) => (
                    <option key={id} value={id}>{t.name}</option>
                  ))}
                </ModalSelect>
              </ModalField>
              <ModalField label="Broadcast">
                <button
                  onClick={() => setIsStreamed(v => !v)}
                  className="w-full h-14 rounded-xl px-4 flex items-center justify-between font-semibold text-sm"
                  style={{
                    background: isStreamed ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                    color: isStreamed ? '#f87171' : 'rgba(255,255,255,0.5)',
                    border: `1px solid ${isStreamed ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  }}
                >
                  <span>Streamed game (feeds scorebug)</span>
                  <span>{isStreamed ? '● ON' : '○ OFF'}</span>
                </button>
              </ModalField>
              <SkBtn onClick={() => setStep('home_lineup')} primary disabled={!homeTeamId || !awayTeamId}>
                Next — {teams[homeTeamId]?.shortName ?? 'Home'} Lineup →
              </SkBtn>
            </>
          )}

          {/* Step B — Home Lineup */}
          {step === 'home_lineup' && (
            <>
              <LineupBuilder
                teamId={homeTeamId}
                players={players}
                lineup={homeLineup}
                onChange={setHomeLineup}
              />
              <SkBtn onClick={() => setStep('away_lineup')} primary>
                Next — {teams[awayTeamId]?.shortName ?? 'Away'} Lineup →
              </SkBtn>
              <SkBtn onClick={() => setStep('teams')}>← Back</SkBtn>
            </>
          )}

          {/* Step C — Away Lineup */}
          {step === 'away_lineup' && (
            <>
              <LineupBuilder
                teamId={awayTeamId}
                players={players}
                lineup={awayLineup}
                onChange={setAwayLineup}
              />
              <SkBtn onClick={() => setStep('confirm')} primary>
                Next — Confirm →
              </SkBtn>
              <SkBtn onClick={() => setStep('home_lineup')}>← Back</SkBtn>
            </>
          )}

          {/* Step D — Confirm */}
          {step === 'confirm' && (
            <>
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-white font-bold text-base">{teams[awayTeamId]?.name}</span>
                  <span className="text-white/30 text-sm">@</span>
                  <span className="text-white font-bold text-base">{teams[homeTeamId]?.name}</span>
                </div>
                <div className="flex justify-center gap-3">
                  {isStreamed && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                      LIVE — feeds scorebug
                    </span>
                  )}
                </div>
                <LineupSummary label={`${teams[homeTeamId]?.shortName ?? 'Home'} lineup`} lineup={homeLineup} players={players} />
                <LineupSummary label={`${teams[awayTeamId]?.shortName ?? 'Away'} lineup`} lineup={awayLineup} players={players} />
              </div>
              <SkBtn onClick={createGame} primary disabled={creating}>
                {creating ? 'Creating…' : '✓ Create Game'}
              </SkBtn>
              <SkBtn onClick={() => setStep('away_lineup')}>← Back</SkBtn>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>{label}</span>
      {children}
    </div>
  )
}

function ModalSelect({ value, onChange, placeholder, children }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full h-14 rounded-xl px-3 text-base font-medium"
      style={{ background: '#1c2333', color: value ? '#fff' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.15)' }}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  )
}

function LineupBuilder({ teamId, players, lineup, onChange }: {
  teamId: string
  players: PlayersMap
  lineup: LineupEntry[]
  onChange: (lineup: LineupEntry[]) => void
}) {
  const teamPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === teamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const lineupIds = lineup.map(e => e.playerId)
  const available = teamPlayers.filter(([id]) => !lineupIds.includes(id))

  const addToLineup = (playerId: string, isSub = false) => {
    onChange([...lineup, { playerId, isSub }])
  }

  const remove = (playerId: string) => {
    onChange(lineup.filter(e => e.playerId !== playerId))
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const next = [...lineup]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange(next)
  }

  const moveDown = (index: number) => {
    if (index === lineup.length - 1) return
    const next = [...lineup]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Current lineup order */}
      {lineup.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            Batting order ({lineup.filter(e => !e.isSub).length} starters{lineup.filter(e => e.isSub).length > 0 ? `, ${lineup.filter(e => e.isSub).length} subs` : ''})
          </span>
          {lineup.map((entry, i) => (
            <div
              key={entry.playerId}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: entry.isSub ? 'rgba(255,255,255,0.03)' : 'rgba(37,99,235,0.1)', border: `1px solid ${entry.isSub ? 'rgba(255,255,255,0.06)' : 'rgba(96,165,250,0.2)'}` }}
            >
              <span className="text-white/30 text-xs font-bold w-5 text-center" style={{ fontFamily: 'var(--font-score)' }}>
                {entry.isSub ? 'S' : i + 1}
              </span>
              <span className="text-white text-sm font-semibold flex-1">
                {players[entry.playerId]?.name ?? entry.playerId}
              </span>
              <div className="flex items-center gap-1">
                {!entry.isSub && (
                  <>
                    <button onClick={() => moveUp(i)} className="w-7 h-7 rounded-lg text-xs flex items-center justify-center" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}>▲</button>
                    <button onClick={() => moveDown(i)} className="w-7 h-7 rounded-lg text-xs flex items-center justify-center" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}>▼</button>
                  </>
                )}
                <button onClick={() => remove(entry.playerId)} className="w-7 h-7 rounded-lg text-xs flex items-center justify-center" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available players */}
      {available.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            Add to lineup (tap to add in order)
          </span>
          {available.map(([id, player]) => (
            <div key={id} className="flex items-center gap-2">
              <button
                onClick={() => addToLineup(id, false)}
                className="flex-1 h-11 rounded-xl px-3 text-sm font-semibold text-left"
                style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {player.name}
              </button>
              <button
                onClick={() => addToLineup(id, true)}
                className="h-11 px-3 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                + Sub
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LineupSummary({ label, lineup, players }: { label: string; lineup: GameLineup; players: PlayersMap }) {
  if (lineup.length === 0) return (
    <div>
      <p className="text-white/30 text-xs mb-1">{label}</p>
      <p className="text-white/20 text-xs italic">No lineup set</p>
    </div>
  )
  return (
    <div>
      <p className="text-white/40 text-xs mb-1.5">{label}</p>
      <div className="flex flex-col gap-0.5">
        {lineup.map((entry, i) => (
          <p key={entry.playerId} className="text-white/70 text-xs">
            {entry.isSub ? 'S' : `${i + 1}.`} {players[entry.playerId]?.name ?? entry.playerId}
            {entry.isSub && <span className="text-white/30 ml-1">(sub)</span>}
          </p>
        ))}
      </div>
    </div>
  )
}

// ── Game Wizard ─────────────────────────────────────────────────────────────

function GameWizard({ gameId, players, teams, playerName, onBack, onEditLineup }: {
  gameId: string
  players: PlayersMap
  teams: TeamsMap
  playerName: (id: string) => string
  onBack: () => void
  onEditLineup: () => void
}) {
  const { game, loading: gameLoading } = useGameRecord(gameId)
  const { atBats } = useGameStats(gameId)
  const { liveRunners } = useLiveRunners(gameId)

  // Determine batting/fielding teams
  const inning = game?.inning ?? 1
  const isTopInning = game?.isTopInning ?? true
  const outs = game?.outs ?? 0
  const battingTeamId = isTopInning ? (game?.awayTeamId ?? '') : (game?.homeTeamId ?? '')
  const fieldingTeamId = isTopInning ? (game?.homeTeamId ?? '') : (game?.awayTeamId ?? '')

  const { lineup: battingLineup } = useGameLineup(gameId, battingTeamId)
  useGameLineup(gameId, fieldingTeamId)  // prefetch fielding lineup (used in inning-end pitcher picker)

  // Lineup position for batting team (persisted in Firebase)
  const [lineupPosition, setLineupPosition] = useState(0)
  useEffect(() => {
    if (!gameId || !battingTeamId) return
    const unsub = onValue(ref(db, `games/${gameId}/lineupPosition/${battingTeamId}`), snap => {
      setLineupPosition(snap.exists() ? snap.val() : 0)
    })
    return unsub
  }, [gameId, battingTeamId])

  // Wizard state
  const [step, setStep] = useState<WizardStep>('batter')
  const [batterId, setBatterId] = useState('')
  const [pitcherId, setPitcherId] = useState('')
  const [result, setResult] = useState<AtBatResult | null>(null)
  const [runnerOutcomes, setRunnerOutcomes] = useState<RunnerOutcomes>({})
  const [batterAdvancedTo, setBatterAdvancedTo] = useState<AtBatRecord['batterAdvancedTo']>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [nextPitcherId, setNextPitcherId] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showPlayLog, setShowPlayLog] = useState(false)
  const [showGameCompletePrompt, setShowGameCompletePrompt] = useState(false)
  const [gameCompleteReason, setGameCompleteReason] = useState<'innings' | 'time' | null>(null)

  // Game complete detection — 7 innings or 90 min
  // Uses sessionStorage to suppress after dismissal (survives page reload within same session)
  useEffect(() => {
    if (!game || game.finalized) return
    const storageKey = `game-complete-shown-${gameId}`
    if (sessionStorage.getItem(storageKey)) return
    const elapsed = Date.now() - (game.startedAt ?? Date.now())
    const over90min = elapsed >= 90 * 60 * 1000
    const over7innings = game.inning > 7 || (game.inning === 7 && !game.isTopInning && game.outs === 0)
    if (over7innings) { setGameCompleteReason('innings'); setShowGameCompletePrompt(true) }
    else if (over90min) { setGameCompleteReason('time'); setShowGameCompletePrompt(true) }
  }, [game?.inning, game?.isTopInning, game?.outs])

  // Dev play log (in-memory only)
  const [playLog, setPlayLog] = useState<PlayLogEntry[]>([])

  // Pre-fill pitcher from Firebase matchup on load/refresh
  useEffect(() => {
    if (!gameLoading && game?.matchup?.pitcherId && !pitcherId) {
      setPitcherId(game.matchup.pitcherId)
    }
  }, [gameLoading])

  // Persist pitcher selection to Firebase so it survives a page refresh.
  // advanceHalfInning also writes this, but only at inning boundaries — writing
  // here covers mid-inning refreshes (e.g. the very first inning before it ends).
  useEffect(() => {
    if (!gameId || !pitcherId) return
    update(ref(db), { [`games/${gameId}/matchup/pitcherId`]: pitcherId })
  }, [pitcherId, gameId])

  // Pre-fill batter from lineup position
  useEffect(() => {
    const regularLineup = battingLineup.filter(e => !e.isSub)
    if (regularLineup.length > 0) {
      const pos = lineupPosition % regularLineup.length
      setBatterId(regularLineup[pos]?.playerId ?? '')
    }
  }, [lineupPosition, battingLineup])

  // Sync current batter to game/matchup/batterId so the scorebug notch and controller
  // always reflect who is currently at the plate — not who came up after the last play.
  // Clears when the inning ends (step === 'inning_end').
  useEffect(() => {
    if (!gameId || !game?.isStreamed) return
    const nextBatterId = (step === 'inning_end' || !batterId) ? null : batterId
    update(ref(db), { 'game/matchup/batterId': nextBatterId })
  }, [batterId, step, gameId, game?.isStreamed])

  // If the page is refreshed mid-inning-end (outs >= 3), restore the interstitial.
  // isTopInning and the matchup fields are included in deps to avoid stale closure.
  useEffect(() => {
    if (outs >= 3 && step === 'batter' && !gameLoading) {
      setStep('inning_end')
      const lastPitcher = isTopInning
        ? game?.matchup?.lastPitcherAway
        : game?.matchup?.lastPitcherHome
      setNextPitcherId(lastPitcher ?? '')
    }
  }, [outs, gameLoading, isTopInning, game?.matchup?.lastPitcherAway, game?.matchup?.lastPitcherHome])

  const resetWizard = () => {
    setStep('batter')
    setResult(null)
    setRunnerOutcomes({})
    setBatterAdvancedTo(null)
  }

  // Runners as an array for easy rendering
  const currentRunners: Array<{ id: string; base: keyof RunnersState }> = (
    ['third', 'second', 'first'] as const
  ).flatMap(base => liveRunners[base] ? [{ id: liveRunners[base]!, base }] : [])

  const hasRunners = currentRunners.length > 0

  // ── Result selection ─────────────────────────────────────────────────────

  const handleSelectResult = (r: AtBatResult) => {
    setResult(r)

    // Auto-fill batter advance
    const autoAdv = AUTO_BATTER_ADVANCE[r] ?? null
    setBatterAdvancedTo(autoAdv)

    // Home run: all runners score
    if (r === 'home_run') {
      const allScored: RunnerOutcomes = {}
      if (liveRunners.first) allScored.first = 'scored'
      if (liveRunners.second) allScored.second = 'scored'
      if (liveRunners.third) allScored.third = 'scored'
      setRunnerOutcomes(allScored)
      setStep('confirm')
      return
    }

    // Strikeout: runners cannot advance — auto-fill all as 'stayed' and skip to confirm.
    if (r === 'strikeout' || r === 'strikeout_looking') {
      const allStayed: RunnerOutcomes = {}
      if (liveRunners.first)  allStayed.first  = 'stayed'
      if (liveRunners.second) allStayed.second = 'stayed'
      if (liveRunners.third)  allStayed.third  = 'stayed'
      setRunnerOutcomes(allStayed)
      setStep('confirm')
      return
    }

    // Ground / tag out: connected-chain rule applies.
    // With a chain: lead runner leaves the bases (out), batter stays on 1st — 1 out total.
    // Without a chain: batter is simply out (AUTO_BATTER_ADVANCE already set 'out' above).
    if (r === 'groundout') {
      const chain = getConnectedChain(liveRunners)
      if (chain.length > 0) {
        const leadBase = chain[chain.length - 1]
        const preFilledOutcomes: RunnerOutcomes = {}
        for (const base of chain) {
          preFilledOutcomes[base] = base === leadBase ? 'sits' : 'stayed'
        }
        setRunnerOutcomes(preFilledOutcomes)
        setBatterAdvancedTo('first')  // batter stays on 1st; lead runner takes the out
      } else {
        setRunnerOutcomes({})
      }
      setStep(hasRunners ? 'runner_outcomes' : 'confirm')
      return
    }

    // Walk: runners are forced to advance only when every base between them and home is occupied.
    // Batter takes 1st → runner on 1st forced to 2nd → runner on 2nd forced to 3rd (if 1st occupied)
    // → runner on 3rd forced to score (if 1st AND 2nd occupied). Unforced runners stay.
    if (r === 'walk') {
      const forced: RunnerOutcomes = {}
      if (liveRunners.first) {
        forced.first = 'second'
        if (liveRunners.second) {
          forced.second = 'third'
          if (liveRunners.third) {
            forced.third = 'scored'   // bases loaded — runner scores, batter gets RBI
          }
        }
      }
      // Runners not in the forced chain stay where they are
      if (liveRunners.first  && !forced.first)  forced.first  = 'stayed'
      if (liveRunners.second && !forced.second) forced.second = 'stayed'
      if (liveRunners.third  && !forced.third)  forced.third  = 'stayed'
      setRunnerOutcomes(forced)
      setStep('confirm')
      return
    }

    // All other results with runners: go to runner outcomes step
    if (hasRunners) {
      setRunnerOutcomes({})
      setStep('runner_outcomes')
    } else {
      setRunnerOutcomes({})
      setStep('confirm')
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!batterId || !result || !batterAdvancedTo) return

    // Validate all present runners have outcomes
    const bases: Array<keyof RunnersState> = ['first', 'second', 'third']
    for (const base of bases) {
      if (liveRunners[base] && !runnerOutcomes[base as keyof RunnerOutcomes]) {
        console.warn(`Runner on ${base} has no outcome set`)
        return
      }
    }

    // Determine isSub
    const regularEntry = battingLineup.find(e => e.playerId === batterId && !e.isSub)
    const isSub = !regularEntry

    // Compute derived fields
    const runnersScored = bases
      .filter(b => runnerOutcomes[b as keyof RunnerOutcomes] === 'scored')
      .map(b => liveRunners[b]!)
      .filter(Boolean)

    const batterIsOut = batterAdvancedTo === 'out'
    const runnersOut = bases.filter(b => runnerOutcomes[b as keyof RunnerOutcomes] === 'out' || runnerOutcomes[b as keyof RunnerOutcomes] === 'sits').length
    const outsOnPlay = (batterIsOut ? 1 : 0) + runnersOut

    const noRbiResults: AtBatResult[] = ['strikeout', 'strikeout_looking']
    const rawRbi = runnersScored.length + (result === 'home_run' ? 1 : 0)
    const rbiCount = noRbiResults.includes(result) ? 0 : rawRbi

    const record: AtBatRecord = {
      batterId,
      pitcherId,
      isSub,
      inning,
      isTopInning,
      timestamp: Date.now(),
      result,
      runnersOnBase: { ...liveRunners },
      runnerOutcomes: { ...runnerOutcomes },
      runnersScored,
      outsOnPlay,
      rbiCount,
      batterAdvancedTo,
    }

    // Run through engine for narrated log + next runner state
    const engineResult = applyAtBat({
      record,
      currentRunners: liveRunners,
      batterName: playerName(batterId),
      getPlayerName: playerName,
      homeScore: game?.homeScore ?? 0,
      awayScore: game?.awayScore ?? 0,
      isHomeTeamBatting: !isTopInning,
    })

    // Append to play log (dev only)
    setPlayLog(prev => [engineResult.logEntry, ...prev])

    // Compute new score
    const runsThisPlay = engineResult.runsScored
    const newHomeScore = !isTopInning ? (game?.homeScore ?? 0) + runsThisPlay : (game?.homeScore ?? 0)
    const newAwayScore = isTopInning ? (game?.awayScore ?? 0) + runsThisPlay : (game?.awayScore ?? 0)
    const newOuts = outs + outsOnPlay

    // Write to Firebase
    await push(ref(db, `gameStats/${gameId}`), record)

    const updates: Record<string, unknown> = {
      [`liveRunners/${gameId}`]: engineResult.nextRunners,
      [`games/${gameId}/outs`]: newOuts,  // intentionally not reset to 0 here — advanceHalfInning owns that
      [`games/${gameId}/homeScore`]: newHomeScore,
      [`games/${gameId}/awayScore`]: newAwayScore,
    }

    // Advance lineup position if not a sub
    if (!isSub) {
      const regularLineup = battingLineup.filter(e => !e.isSub)
      if (regularLineup.length > 0) {
        const nextPos = (lineupPosition + 1) % regularLineup.length
        updates[`games/${gameId}/lineupPosition/${battingTeamId}`] = nextPos
      }
    }

    // Mirror to /game/meta if streamed
    if (game?.isStreamed) {
      updates[`game/meta/outs`] = newOuts
      updates[`game/meta/homeScore`] = newHomeScore
      updates[`game/meta/awayScore`] = newAwayScore
      updates[`game/meta/bases`] = {
        first: !!engineResult.nextRunners.first,
        second: !!engineResult.nextRunners.second,
        third: !!engineResult.nextRunners.third,
      }
      if (pitcherId) {
        updates[`game/matchup/pitcherId`] = pitcherId
      }

      // Write the next batter directly so the notch updates atomically with the play.
      // Avoids the 3-hop delay: Firebase lineupPosition → listener → pre-fill effect → sync effect.
      if (newOuts < 3) {
        const regularLineup = battingLineup.filter(e => !e.isSub)
        if (regularLineup.length > 0) {
          const nextPos = isSub
            ? lineupPosition % regularLineup.length
            : (lineupPosition + 1) % regularLineup.length
          updates['game/matchup/batterId'] = regularLineup[nextPos]?.playerId ?? null
        }
      } else {
        updates['game/matchup/batterId'] = null  // inning ending — clear the notch
      }

      // Trigger home run overlay animation
      if (result === 'home_run') {
        const battingTeam = isTopInning ? 'away' : 'home'
        const battingTeamId = isTopInning ? game.awayTeamId : game.homeTeamId
        updates[`overlay/homerun`] = {
          active: true,
          teamSide: battingTeam,
          playerId: batterId,
          logoUrl: teams[battingTeamId]?.logoUrl ?? '',
          runsScored: engineResult.runsScored,
          triggeredAt: Date.now(),
        }
      }
    }

    await update(ref(db), updates)

    // If 3+ outs, flip to inning-end interstitial instead of resetting wizard
    if (newOuts >= 3) {
      setStep('inning_end')
      // Pre-fill the pitcher for the INCOMING half-inning.
      // isTopInning = current half that just ended.
      // If top just ended → bottom coming → away team fields → use lastPitcherAway.
      // If bottom just ended → top coming → home team fields → use lastPitcherHome.
      const lastPitcher = isTopInning
        ? game?.matchup?.lastPitcherAway
        : game?.matchup?.lastPitcherHome
      setNextPitcherId(lastPitcher ?? pitcherId ?? '')
    } else {
      resetWizard()
    }
  }

  // ── Half-inning advance ───────────────────────────────────────────────────

  const advanceHalfInning = async () => {
    if (!gameId || !game) return

    const nextIsTop = !isTopInning
    const nextInning = !isTopInning ? inning + 1 : inning  // increment inning after bottom half
    const updates: Record<string, unknown> = {
      [`games/${gameId}/inning`]: nextInning,
      [`games/${gameId}/isTopInning`]: nextIsTop,
      [`games/${gameId}/outs`]: 0,
      [`liveRunners/${gameId}`]: { first: null, second: null, third: null },
    }

    // Store the incoming pitcher under the correct side so we can pre-fill next time.
    // nextPitcherId is the pitcher who will pitch the INCOMING half:
    //   top just ended → away team pitches next → lastPitcherAway
    //   bottom just ended → home team pitches next → lastPitcherHome
    if (nextPitcherId) {
      const side = isTopInning ? 'lastPitcherAway' : 'lastPitcherHome'
      updates[`games/${gameId}/matchup/${side}`] = nextPitcherId
    }

    // Set next pitcher as current pitcher for the incoming half
    if (nextPitcherId) {
      updates[`games/${gameId}/matchup/pitcherId`] = nextPitcherId
      updates[`games/${gameId}/matchup/batterId`] = null
    }

    if (game.isStreamed) {
      updates[`game/meta/inning`] = nextInning
      updates[`game/meta/isTopInning`] = nextIsTop
      updates[`game/meta/outs`] = 0
      updates[`game/meta/bases`] = { first: false, second: false, third: false }
      if (nextPitcherId) updates[`game/matchup/pitcherId`] = nextPitcherId
      updates[`game/matchup/batterId`] = null
    }

    await update(ref(db), updates)
    setPitcherId(nextPitcherId)
    setNextPitcherId('')
    resetWizard()
  }

  // ── At-bat log helpers ───────────────────────────────────────────────────

  const sortedAtBats = Object.entries(atBats).sort(([, a], [, b]) => b.timestamp - a.timestamp)
  const lastAtBatId = sortedAtBats[0]?.[0] ?? null

  const deleteAtBat = async (atBatId: string) => {
    if (!gameId || !game) return
    if (atBatId !== lastAtBatId) return

    // Remove the record first
    await remove(ref(db, `gameStats/${gameId}/${atBatId}`))

    // Replay current half-inning to recompute liveRunners + outs
    const isHomeTeamBatting = !isTopInning
    const allAtBatList = Object.entries(atBats)
      .filter(([id]) => id !== atBatId)
      .map(([, ab]) => ab)
      .sort((a, b) => a.timestamp - b.timestamp)

    // Split into current half-inning vs everything else
    const currentHalfAbs = allAtBatList.filter(ab => ab.inning === inning && ab.isTopInning === isTopInning)
    const otherAbs = allAtBatList.filter(ab => !(ab.inning === inning && ab.isTopInning === isTopInning))

    // Compute score totals from all other half-innings
    let startHomeScore = 0, startAwayScore = 0
    for (const ab of otherAbs) {
      const isHomeBatting = !ab.isTopInning
      const runs = ab.runnersScored.length + (ab.batterAdvancedTo === 'home' ? 1 : 0)
      if (isHomeBatting) startHomeScore += runs
      else startAwayScore += runs
    }

    const replay = replayHalfInning(currentHalfAbs, playerName, isHomeTeamBatting, startHomeScore, startAwayScore)

    const newHomeScore = startHomeScore + (isHomeTeamBatting ? replay.totalRuns : 0)
    const newAwayScore = startAwayScore + (!isHomeTeamBatting ? replay.totalRuns : 0)

    const updates: Record<string, unknown> = {
      [`liveRunners/${gameId}`]: replay.finalRunners,
      [`games/${gameId}/outs`]: Math.min(replay.totalOuts, 2),
      [`games/${gameId}/homeScore`]: newHomeScore,
      [`games/${gameId}/awayScore`]: newAwayScore,
    }

    // Rewind lineup position if the deleted at-bat was not a sub
    const deletedAb = atBats[atBatId]
    if (deletedAb && !deletedAb.isSub) {
      const regularLineup = battingLineup.filter(e => !e.isSub)
      if (regularLineup.length > 0) {
        const prevPos = (lineupPosition - 1 + regularLineup.length) % regularLineup.length
        updates[`games/${gameId}/lineupPosition/${battingTeamId}`] = prevPos
      }
    }

    if (game.isStreamed) {
      updates['game/meta/outs'] = Math.min(replay.totalOuts, 2)
      updates['game/meta/homeScore'] = newHomeScore
      updates['game/meta/awayScore'] = newAwayScore
    }

    await update(ref(db), updates)

    // If we were showing the inning-end interstitial (outs >= 3) but after
    // deletion the outs drop back below 3, return to the batter step.
    if (step === 'inning_end' && replay.totalOuts < 3) {
      setStep('batter')
      setNextPitcherId('')
    }
  }

  const undoLastAtBat = async () => {
    if (!lastAtBatId) return
    const ab = atBats[lastAtBatId]
    if (!ab) return
    // Pre-fill wizard with the undone at-bat's data so they can correct and re-submit
    setBatterId(ab.batterId)
    setPitcherId(ab.pitcherId)
    setResult(ab.result)
    setRunnerOutcomes(ab.runnerOutcomes ?? {})
    setBatterAdvancedTo(ab.batterAdvancedTo)
    await deleteAtBat(lastAtBatId)
  }

  const startEdit = (atBatId: string) => {
    if (atBatId !== lastAtBatId) return  // only last at-bat is editable
    const ab = atBats[atBatId]
    if (!ab) return
    setBatterId(ab.batterId)
    setPitcherId(ab.pitcherId)
    setResult(ab.result)
    setRunnerOutcomes(ab.runnerOutcomes ?? {})
    setBatterAdvancedTo(ab.batterAdvancedTo)
    setStep('confirm')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Pitcher options ──────────────────────────────────────────────────────
  const pitcherOptions = Object.entries(players)
    .filter(([, p]) => p.teamId === fieldingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  // ── Batter options ───────────────────────────────────────────────────────
  const regularBatters = battingLineup.filter(e => !e.isSub).map(e => e.playerId)
  const subBatters = battingLineup.filter(e => e.isSub).map(e => e.playerId)
  const allTeamPlayers = Object.entries(players).filter(([, p]) => p.teamId === battingTeamId)
  const hasLineup = battingLineup.length > 0

  if (gameLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0d1117' }}>
        <p className="text-white/30 text-sm">Loading game…</p>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen px-4 py-4" style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}>

      {/* Game complete banner */}
      {showGameCompletePrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 text-center" style={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.12)' }}>
            <p className="text-3xl mb-2">🏁</p>
            <h2 className="text-white text-xl font-black mb-1">Game Over?</h2>
            <p className="text-white/50 text-sm mb-6">
              {gameCompleteReason === 'innings'
                ? '7 innings complete. Ready to finalize?'
                : '90 minutes have elapsed. Ready to finalize?'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  sessionStorage.setItem(`game-complete-shown-${gameId}`, '1')
                  setShowGameCompletePrompt(false)
                }}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}
              >
                Keep Playing
              </button>
              <button
                onClick={() => {
                  sessionStorage.setItem(`game-complete-shown-${gameId}`, '1')
                  setShowGameCompletePrompt(false)
                }}
                className="flex-1 py-3 rounded-xl font-black text-sm"
                style={{ background: '#22c55e', color: '#000' }}
              >
                Go to Controller to Finalize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} style={{ color: 'rgba(255,255,255,0.3)', fontSize: 20 }}>‹</button>
          <h1 className="text-white text-xl font-black uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            {teams[game?.awayTeamId ?? '']?.shortName ?? '?'} @ {teams[game?.homeTeamId ?? '']?.shortName ?? '?'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-white/40 text-sm">
            {isTopInning ? '▲' : '▼'}{inning} · {outs} out{outs !== 1 ? 's' : ''}
          </p>
          <button
            onClick={onEditLineup}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Lineup
          </button>
          <button
            onClick={resetWizard}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Score bar */}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between mb-4"
        style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            {teams[game?.awayTeamId ?? '']?.shortName}
          </span>
          <span className="text-white font-black text-xl" style={{ fontFamily: 'var(--font-score)' }}>
            {game?.awayScore ?? 0}
          </span>
        </div>
        <span className="text-white/20 text-sm">—</span>
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-xl" style={{ fontFamily: 'var(--font-score)' }}>
            {game?.homeScore ?? 0}
          </span>
          <span className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            {teams[game?.homeTeamId ?? '']?.shortName}
          </span>
        </div>
      </div>

      {/* Base diamond + outs */}
      <div className="flex items-center justify-between mb-4 px-1">
        <RunnerDiamond runners={liveRunners} getPlayerName={playerName} size={100} />
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/30 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Outs</span>
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  width: 14, height: 14,
                  background: i < outs ? '#facc15' : 'rgba(255,255,255,0.15)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Undo last play */}
      {step === 'batter' && lastAtBatId && (() => {
        const lastAb = atBats[lastAtBatId]
        if (!lastAb) return null
        return (
          <div className="flex items-center justify-between rounded-xl px-4 py-3 mb-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-white/40 text-sm">
              ↩ {players[lastAb.batterId]?.name ?? lastAb.batterId} — {RESULT_LABELS[lastAb.result] ?? lastAb.result}
            </span>
            <button
              onClick={undoLastAtBat}
              className="text-xs font-bold px-3 h-8 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              Undo
            </button>
          </div>
        )
      })()}

      {/* Wizard card */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Step 1 — Who's Up */}
        {step === 'batter' && (
          <div className="flex flex-col gap-4">
            <StepLabel step={1} label="Who's Up?" />

            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                🏏 Batter — {teams[battingTeamId]?.shortName ?? battingTeamId}
              </span>
              <select
                value={batterId}
                onChange={e => setBatterId(e.target.value)}
                className="w-full h-14 rounded-xl px-3 text-base font-medium"
                style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select batter —</option>
                {hasLineup ? (
                  <>
                    {regularBatters.length > 0 && (
                      <optgroup label="Lineup">
                        {regularBatters.map(id => (
                          <option key={id} value={id}>{players[id]?.name ?? id}</option>
                        ))}
                      </optgroup>
                    )}
                    {subBatters.length > 0 && (
                      <optgroup label="Subs">
                        {subBatters.map(id => (
                          <option key={id} value={id}>{players[id]?.name ?? id} (sub)</option>
                        ))}
                      </optgroup>
                    )}
                  </>
                ) : (
                  allTeamPlayers.map(([id, p]) => (
                    <option key={id} value={id}>{p.name}</option>
                  ))
                )}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                ⚾ Pitcher — {teams[fieldingTeamId]?.shortName ?? fieldingTeamId}
              </span>
              <select
                value={pitcherId}
                onChange={e => setPitcherId(e.target.value)}
                className="w-full h-14 rounded-xl px-3 text-base font-medium"
                style={{ background: '#1c2333', color: pitcherId ? '#fff' : 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select pitcher —</option>
                {pitcherOptions.map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
            </div>

            <SkBtn onClick={() => setStep('result')} disabled={!batterId || !pitcherId} primary>
              Next — What happened? →
            </SkBtn>
          </div>
        )}

        {/* Step 2 — What Happened */}
        {step === 'result' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={2} label="What Happened?" />
              <BackBtn onClick={() => setStep('batter')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => handleSelectResult(r)}
                  className="h-14 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: result === r ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.07)',
                    color: result === r ? '#fff' : 'rgba(255,255,255,0.8)',
                    border: result === r ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {RESULT_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Runner Outcomes */}
        {step === 'runner_outcomes' && result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={3} label="Runner Outcomes" />
              <BackBtn onClick={() => setStep('result')} />
            </div>

            {result === 'groundout' && getConnectedChain(liveRunners).length > 0 && (
              <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                <p className="text-yellow-400 font-semibold mb-1">Chain Rule</p>
                <p className="text-yellow-300/70 text-xs">
                  Connected chain — batter is out, lead runner sits down and leaves the bases as a result. Batter stays on 1st. 1 out total. Adjust below if needed.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {(['third', 'second', 'first'] as const).map(base => {
                const runnerId = liveRunners[base]
                if (!runnerId) return null
                const outcome = runnerOutcomes[base]
                const setOutcome = (v: RunnerOutcomes[typeof base]) => {
                  setRunnerOutcomes(prev => ({ ...prev, [base]: v }))
                }

                // Bases the batter is taking — runner cannot land there
                const batterTakes = new Set(
                  batterAdvancedTo && batterAdvancedTo !== 'out' && batterAdvancedTo !== 'home'
                    ? [batterAdvancedTo]
                    : []
                )

                // 'stayed' means the runner stays on their current base — invalid if batter is going there
                const stayedBlocked = batterTakes.has(base)

                const advanceOptions: Array<{ label: string; value: RunnerOutcomes[typeof base] }> =
                  base === 'first'
                    ? [
                        ...(!batterTakes.has('second') ? [{ label: '→ 2nd', value: 'second' as const }] : []),
                        ...(!batterTakes.has('third')  ? [{ label: '→ 3rd', value: 'third'  as const }] : []),
                      ]
                    : base === 'second'
                    ? [...(!batterTakes.has('third') ? [{ label: '→ 3rd', value: 'third' as const }] : [])]
                    : []

                const allOptions: Array<{ label: string; value: RunnerOutcomes[typeof base] }> = [
                  { label: 'Scored', value: 'scored' as const },
                  ...advanceOptions,
                  ...(!stayedBlocked ? [{ label: 'Stayed', value: 'stayed' as const }] : []),
                  { label: 'Out', value: 'out' as const },
                  { label: 'Sits', value: 'sits' as const },
                ]

                // If the currently selected outcome is now invalid (batter took that base), clear it
                const currentOutcomeBlocked =
                  (outcome === 'stayed' && stayedBlocked) ||
                  (outcome === 'second' && batterTakes.has('second')) ||
                  (outcome === 'third'  && batterTakes.has('third'))
                if (currentOutcomeBlocked) {
                  setOutcome(undefined)
                }

                return (
                  <div key={base} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p className="text-white font-semibold text-sm mb-2">
                      {playerName(runnerId)}
                      <span className="text-white/40 text-xs ml-2">{base === 'first' ? '1st' : base === 'second' ? '2nd' : '3rd'}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {allOptions.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setOutcome(opt.value)}
                          className="h-9 px-3 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            background: outcome === opt.value
                              ? opt.value === 'out' ? 'rgba(239,68,68,0.4)' : opt.value === 'sits' ? 'rgba(234,179,8,0.35)' : opt.value === 'scored' ? 'rgba(22,163,74,0.4)' : 'rgba(37,99,235,0.5)'
                              : 'rgba(255,255,255,0.08)',
                            color: outcome === opt.value ? '#fff' : 'rgba(255,255,255,0.6)',
                            border: outcome === opt.value ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <SkBtn
              onClick={() => setStep('confirm')}
              primary
              disabled={currentRunners.some(({ base }) => !runnerOutcomes[base])}
            >
              Next — Confirm →
            </SkBtn>
          </div>
        )}

        {/* Step 4 — Confirm */}
        {step === 'confirm' && result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={4} label="Confirm" />
              <BackBtn onClick={() => hasRunners && result !== 'home_run' ? setStep('runner_outcomes') : setStep('result')} />
            </div>

            <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="flex items-baseline gap-3">
                <span className="text-white font-bold text-lg">{playerName(batterId)}</span>
                <span className="text-white/60 text-sm font-semibold" style={{ fontFamily: 'var(--font-score)' }}>
                  {isTopInning ? '▲' : '▼'}{inning}
                </span>
              </div>
              <span className="text-blue-300 font-black text-xl uppercase" style={{ fontFamily: 'var(--font-score)' }}>
                {RESULT_LABELS[result]}
              </span>

              {/* Runner outcomes summary */}
              {Object.entries(runnerOutcomes).length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {(['first', 'second', 'third'] as const).map(base => {
                    const outcome = runnerOutcomes[base]
                    const runnerId = liveRunners[base]
                    if (!outcome || !runnerId) return null
                    const outcomeColors: Record<string, string> = {
                      scored: '#4ade80', out: '#f87171', sits: '#facc15',
                      stayed: 'rgba(255,255,255,0.4)',
                      second: '#93c5fd', third: '#93c5fd',
                    }
                    const outcomeLabels: Record<string, string> = {
                      scored: 'Scored ✓', out: 'Out', sits: 'Sits (chain)',
                      stayed: 'Stayed', second: '→ 2nd', third: '→ 3rd',
                    }
                    return (
                      <p key={base} className="text-sm" style={{ color: outcomeColors[outcome] ?? 'rgba(255,255,255,0.5)' }}>
                        {lastName(playerName(runnerId))} — {outcomeLabels[outcome] ?? outcome}
                      </p>
                    )
                  })}
                </div>
              )}

              {/* Batter placement */}
              {batterAdvancedTo && batterAdvancedTo !== 'out' && (
                <p className="text-white/50 text-sm">
                  {lastName(playerName(batterId))} → {batterAdvancedTo === 'home' ? 'scores' : batterAdvancedTo}
                </p>
              )}

              {/* Outs / RBI summary */}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {(() => {
                  const batterIsOut = batterAdvancedTo === 'out'
                  const runnersOut = (['first', 'second', 'third'] as const).filter(b => runnerOutcomes[b] === 'out' || runnerOutcomes[b] === 'sits').length
                  const outsThisPlay = (batterIsOut ? 1 : 0) + runnersOut
                  const runnersScored = (['first', 'second', 'third'] as const).filter(b => runnerOutcomes[b] === 'scored').length
                  const noRbi = ['strikeout', 'strikeout_looking'].includes(result)
                  const rbi = noRbi ? 0 : runnersScored + (result === 'home_run' ? 1 : 0)
                  return (
                    <>
                      {outsThisPlay > 0 && (
                        <span className="text-red-400 text-sm font-bold">{outsThisPlay} out{outsThisPlay !== 1 ? 's' : ''}</span>
                      )}
                      {rbi > 0 && (
                        <span className="text-green-400 font-bold text-sm px-2 py-0.5 rounded-full" style={{ background: 'rgba(22,163,74,0.15)' }}>
                          {rbi} RBI
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            <SkBtn onClick={submit} primary disabled={!batterId || !result || !batterAdvancedTo}>
              ✓ Log At-Bat
            </SkBtn>
          </div>
        )}

        {/* Inning-end interstitial */}
        {step === 'inning_end' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <span
                className="text-white/40 text-xs uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-score)' }}
              >
                {isTopInning ? '▲' : '▼'}{inning} is over
              </span>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-white/40 text-xs mb-0.5">{teams[game?.awayTeamId ?? '']?.shortName}</p>
                  <p className="text-white font-black text-3xl" style={{ fontFamily: 'var(--font-score)' }}>
                    {game?.awayScore ?? 0}
                  </p>
                </div>
                <span className="text-white/20 text-xl">–</span>
                <div className="text-center">
                  <p className="text-white/40 text-xs mb-0.5">{teams[game?.homeTeamId ?? '']?.shortName}</p>
                  <p className="text-white font-black text-3xl" style={{ fontFamily: 'var(--font-score)' }}>
                    {game?.homeScore ?? 0}
                  </p>
                </div>
              </div>
              <p className="text-white/30 text-xs">
                Up next: {isTopInning ? '▼' : '▲'}{isTopInning ? inning : inning + 1}
              </p>
            </div>

            {/* Next pitcher picker */}
            <div className="flex flex-col gap-1.5">
              <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                ⚾ Starting pitcher — {teams[isTopInning ? game?.awayTeamId ?? '' : game?.homeTeamId ?? '']?.shortName}
              </span>
              <select
                value={nextPitcherId}
                onChange={e => setNextPitcherId(e.target.value)}
                className="w-full h-14 rounded-xl px-3 text-base font-medium"
                style={{ background: '#1c2333', color: nextPitcherId ? '#fff' : 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select pitcher —</option>
                {Object.entries(players)
                  .filter(([, p]) => p.teamId === (isTopInning ? game?.awayTeamId : game?.homeTeamId))
                  .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                  .map(([id, p]) => (
                    <option key={id} value={id}>{p.name}</option>
                  ))
                }
              </select>
            </div>

            <SkBtn onClick={advanceHalfInning} primary disabled={!nextPitcherId}>
              Start {isTopInning ? '▼' : '▲'}{isTopInning ? inning : inning + 1} →
            </SkBtn>
          </div>
        )}
      </div>

      {/* At-bat log */}
      <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={() => setShowLog(v => !v)} className="w-full flex items-center justify-between px-4 py-3">
          <span className="text-white/40 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            At-Bat Log ({sortedAtBats.length})
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{showLog ? '▲' : '▼'}</span>
        </button>
        {showLog && (
          <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {sortedAtBats.length === 0 && (
              <p className="px-4 py-6 text-white/30 text-sm text-center">No at-bats logged yet</p>
            )}
            {sortedAtBats.map(([id, ab]) => (
              <AtBatRow
                key={id}
                atBatId={id}
                ab={ab}
                players={players}
                isEditable={id === lastAtBatId}
                onEdit={startEdit}
                onDelete={deleteAtBat}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live stats */}
      {(() => {
        // Tally per-batter stats from this game's at-bats
        const tally: Record<string, { ab: number; h: number; rbi: number; hr: number; o: number }> = {}
        for (const ab of Object.values(atBats)) {
          if (!tally[ab.batterId]) tally[ab.batterId] = { ab: 0, h: 0, rbi: 0, hr: 0, o: 0 }
          const s = tally[ab.batterId]
          if (!['walk', 'hbp', 'sacrifice_fly', 'sacrifice_bunt'].includes(ab.result)) s.ab++
          if (['single', 'double', 'triple', 'home_run'].includes(ab.result)) s.h++
          s.rbi += ab.rbiCount
          if (ab.result === 'home_run') s.hr++
          if (['strikeout', 'strikeout_looking', 'groundout', 'popout', 'flyout', 'sacrifice_fly', 'sacrifice_bunt'].includes(ab.result)) s.o++
        }

        const homeId = game?.homeTeamId ?? ''
        const awayId = game?.awayTeamId ?? ''
        const cols = ['AB', 'H', 'RBI', 'HR', 'O'] as const
        const statKeys: Array<keyof typeof tally[string]> = ['ab', 'h', 'rbi', 'hr', 'o']

        const renderSide = (teamId: string) => {
          const rows = Object.entries(tally)
            .filter(([id]) => players[id]?.teamId === teamId)
            .sort(([, a], [, b]) => b.ab - a.ab)
          if (rows.length === 0) return <p className="text-white/20 text-xs text-center py-2">No at-bats yet</p>
          return (
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="text-left pb-1 text-white/30 font-semibold" style={{ fontFamily: 'var(--font-score)' }}>
                    {teams[teamId]?.shortName ?? teamId}
                  </th>
                  {cols.map(c => (
                    <th key={c} className="pb-1 text-white/30 font-semibold text-right" style={{ fontFamily: 'var(--font-score)', paddingLeft: 6 }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, s]) => (
                  <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td className="py-1 text-white/70 truncate" style={{ maxWidth: 60 }}>{lastName(players[id]?.name ?? id)}</td>
                    {statKeys.map(k => (
                      <td key={k} className="py-1 text-right font-semibold" style={{ fontFamily: 'var(--font-score)', paddingLeft: 6, color: s[k] > 0 ? '#fff' : 'rgba(255,255,255,0.25)' }}>
                        {s[k]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }

        return (
          <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={() => setShowStats(v => !v)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-white/40 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                Game Stats
              </span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{showStats ? '▲' : '▼'}</span>
            </button>
            {showStats && (
              <div className="grid grid-cols-2 gap-px mb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-3 pt-3">{renderSide(awayId)}</div>
                <div className="px-3 pt-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>{renderSide(homeId)}</div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Dev play log */}
      {import.meta.env.DEV && (
        <div className="rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.04)' }}>
          <button onClick={() => setShowPlayLog(v => !v)} className="w-full flex items-center justify-between px-4 py-3">
            <span className="text-purple-400/70 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
              Play Log ({playLog.length})
            </span>
            <span style={{ color: 'rgba(139,92,246,0.5)', fontSize: 11 }}>{showPlayLog ? '▲' : '▼'}</span>
          </button>
          {showPlayLog && (
            <div className="px-4 pb-4 flex flex-col gap-3 max-h-96 overflow-y-auto">
              {playLog.length === 0 && (
                <p className="text-purple-300/30 text-xs text-center py-4">No plays logged yet this session</p>
              )}
              {playLog.map((entry, i) => (
                <div key={i} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {entry.lines.map((line, j) => (
                    <p key={j} className="text-xs leading-relaxed" style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.55)', whiteSpace: 'pre-wrap' }}>
                      {line}
                    </p>
                  ))}
                  {entry.warnings.map((w, j) => (
                    <p key={`w${j}`} className="text-xs leading-relaxed mt-1" style={{ fontFamily: 'monospace', color: '#fbbf24', whiteSpace: 'pre-wrap' }}>
                      {w}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dev Tools */}
      {import.meta.env.DEV && (
        <SkDevTools
          gameId={gameId}
          confirmAbandon={confirmAbandon}
          setConfirmAbandon={setConfirmAbandon}
          onAbandon={onBack}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StepLabel({ step, label }: { step?: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {step != null && (
        <span className="text-xs font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0" style={{ background: 'rgba(37,99,235,0.9)', color: '#fff', fontFamily: 'var(--font-score)' }}>
          {step}
        </span>
      )}
      <h2 className="text-white font-bold text-base uppercase tracking-wider" style={{ fontFamily: 'var(--font-score)' }}>
        {label}
      </h2>
    </div>
  )
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-white/40 text-sm font-semibold px-3 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}>
      ← Back
    </button>
  )
}

function SkBtn({ onClick, disabled, primary, children }: {
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-14 rounded-xl font-bold text-base uppercase tracking-wider transition-all"
      style={{
        background: disabled ? '#1c2333' : primary ? '#2563eb' : 'rgba(255,255,255,0.07)',
        color: disabled ? 'rgba(255,255,255,0.3)' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: primary && !disabled ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {children}
    </button>
  )
}

function AtBatRow({ atBatId, ab, players, isEditable, onEdit, onDelete }: {
  atBatId: string
  ab: AtBatRecord
  players: PlayersMap
  isEditable: boolean
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const batter = players[ab.batterId]
  const label = RESULT_LABELS[ab.result] ?? ab.result

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-white font-semibold text-sm truncate">{batter?.name ?? ab.batterId}</span>
          <span className="text-white/60 text-xs font-semibold shrink-0" style={{ fontFamily: 'var(--font-score)' }}>
            {ab.isTopInning ? '▲' : '▼'}{ab.inning}
          </span>
          {ab.isSub && <span className="text-white/30 text-xs">sub</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-xs font-bold" style={{ fontFamily: 'var(--font-score)' }}>{label}</span>
          {ab.rbiCount > 0 && <span className="text-green-400 text-xs font-semibold">{ab.rbiCount} RBI</span>}
          {ab.outsOnPlay > 1 && <span className="text-red-400 text-xs font-semibold">{ab.outsOnPlay === 2 ? 'DP' : 'TP'}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!isEditable ? (
          <span className="text-white/15 text-xs">locked</span>
        ) : confirming ? (
          <>
            <button onClick={() => { onDelete(atBatId); setConfirming(false) }} className="text-xs font-bold px-3 h-8 rounded-lg" style={{ background: '#b91c1c', color: '#fff' }}>
              Delete
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs font-semibold px-3 h-8 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onEdit(atBatId)} className="text-xs font-semibold px-3 h-8 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}>
              Edit
            </button>
            <button onClick={() => setConfirming(true)} className="text-xs font-semibold px-3 h-8 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SkDevTools({ gameId, confirmAbandon, setConfirmAbandon, onAbandon }: {
  gameId: string
  confirmAbandon: boolean
  setConfirmAbandon: (v: boolean) => void
  onAbandon: () => void
}) {
  const [open, setOpen] = useState(false)

  const clearAtBats = async () => { await remove(ref(db, `gameStats/${gameId}`)) }
  const resetRunners = async () => { await set(ref(db, `liveRunners/${gameId}`), { first: null, second: null, third: null }) }
  const abandonGame = async () => {
    // Clear from /game/meta in case it was a streamed game
    await update(ref(db, 'game/meta'), { currentGameId: null })
    setConfirmAbandon(false)
    onAbandon()  // navigate back to game selector
  }

  return (
    <div className="rounded-2xl overflow-hidden mt-4" style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.04)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="text-yellow-500/70 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Dev Tools</span>
        <span style={{ color: 'rgba(234,179,8,0.5)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          <DevBtn onClick={clearAtBats}>Clear at-bat log</DevBtn>
          <DevBtn onClick={resetRunners}>Reset live runners</DevBtn>
          {!confirmAbandon ? (
            <DevBtn onClick={() => setConfirmAbandon(true)} danger>Abandon game</DevBtn>
          ) : (
            <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #7f1d1d' }}>
              <p className="text-red-300 text-xs text-center font-semibold">Remove from active game? Logs preserved.</p>
              <div className="flex gap-2">
                <button onClick={abandonGame} className="flex-1 h-9 rounded-lg text-xs font-bold uppercase" style={{ background: '#b91c1c', color: '#fff' }}>Abandon</button>
                <button onClick={() => setConfirmAbandon(false)} className="flex-1 h-9 rounded-lg text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DevBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
      style={{
        background: danger ? 'rgba(127,29,29,0.3)' : 'rgba(255,255,255,0.06)',
        color: danger ? '#f87171' : 'rgba(255,255,255,0.5)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {children}
    </button>
  )
}

// ── Lineup Edit Screen ──────────────────────────────────────────────────────

function LineupEditScreen({ gameId, players, teams, onBack }: {
  gameId: string
  players: PlayersMap
  teams: TeamsMap
  onBack: () => void
}) {
  const { game } = useGameRecord(gameId)
  const homeTeamId = game?.homeTeamId ?? ''
  const awayTeamId = game?.awayTeamId ?? ''

  const { lineup: homeLineup } = useGameLineup(gameId, homeTeamId)
  const { lineup: awayLineup } = useGameLineup(gameId, awayTeamId)

  const [editingSide, setEditingSide] = useState<'home' | 'away'>('home')
  const [saving, setSaving] = useState(false)

  const teamId = editingSide === 'home' ? homeTeamId : awayTeamId
  const currentLineup = editingSide === 'home' ? homeLineup : awayLineup

  // Local copy for editing
  const [localLineup, setLocalLineup] = useState<GameLineup>([])
  useEffect(() => {
    setLocalLineup(currentLineup.length > 0 ? [...currentLineup] : [])
  }, [editingSide, homeLineup, awayLineup])

  const teamPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === teamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const inLineup = new Set(localLineup.map(e => e.playerId))

  const addPlayer = (playerId: string, isSub: boolean) => {
    if (inLineup.has(playerId)) return
    setLocalLineup(prev => [...prev, { playerId, isSub }])
  }

  const removePlayer = (playerId: string) => {
    setLocalLineup(prev => prev.filter(e => e.playerId !== playerId))
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    setLocalLineup(prev => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  const moveDown = (index: number) => {
    setLocalLineup(prev => {
      if (index >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await set(ref(db, `games/${gameId}/lineups/${teamId}`), localLineup)
      onBack()
    } finally {
      setSaving(false)
    }
  }

  const homeTeam = teams[homeTeamId]
  const awayTeam = teams[awayTeamId]

  return (
    <div className="min-h-screen px-4 py-4" style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} style={{ color: 'rgba(255,255,255,0.3)', fontSize: 20 }}>‹</button>
          <h1 className="text-white text-xl font-black uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            Lineup Editor
          </h1>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg font-bold text-sm"
          style={{ background: '#2563eb', color: '#fff' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Team tabs */}
      <div className="flex gap-2 mb-4">
        {(['away', 'home'] as const).map(side => {
          const t = side === 'home' ? homeTeam : awayTeam
          return (
            <button
              key={side}
              onClick={() => setEditingSide(side)}
              className="flex-1 py-2 rounded-xl font-bold text-sm uppercase tracking-wider"
              style={{
                background: editingSide === side ? '#2563eb' : 'rgba(255,255,255,0.06)',
                color: editingSide === side ? '#fff' : 'rgba(255,255,255,0.4)',
                border: editingSide === side ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {t?.shortName ?? side}
            </button>
          )
        })}
      </div>

      {/* Current batting order */}
      <div className="rounded-xl overflow-hidden mb-4" style={{ background: '#131821', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="px-4 py-2 border-b border-white/5">
          <p className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            Batting Order
          </p>
        </div>
        {localLineup.length === 0 && (
          <p className="px-4 py-4 text-white/20 text-sm">No lineup set — add players below</p>
        )}
        {localLineup.map((entry, i) => {
          const p = players[entry.playerId]
          return (
            <div key={entry.playerId} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
              <span className="text-white/30 text-sm font-black w-5 text-center" style={{ fontFamily: 'var(--font-score)' }}>{i + 1}</span>
              <span className="flex-1 text-white text-sm font-semibold">{p?.name ?? entry.playerId}</span>
              {entry.isSub && <span className="text-xs text-white/30 font-semibold">sub</span>}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="w-7 h-7 rounded-lg text-xs flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.06)', color: i === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)' }}
                >↑</button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === localLineup.length - 1}
                  className="w-7 h-7 rounded-lg text-xs flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.06)', color: i === localLineup.length - 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)' }}
                >↓</button>
                <button
                  onClick={() => removePlayer(entry.playerId)}
                  className="w-7 h-7 rounded-lg text-xs flex items-center justify-center"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
                >✕</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add players */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#131821', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="px-4 py-2 border-b border-white/5">
          <p className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            Add Player
          </p>
        </div>
        {teamPlayers.map(([id, p]) => {
          const already = inLineup.has(id)
          return (
            <div key={id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
              <span className="flex-1 text-sm font-semibold" style={{ color: already ? 'rgba(255,255,255,0.2)' : '#fff' }}>{p.name}</span>
              {!already && (
                <div className="flex gap-2">
                  <button
                    onClick={() => addPlayer(id, false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(37,99,235,0.2)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.3)' }}
                  >
                    + Lineup
                  </button>
                  <button
                    onClick={() => addPlayer(id, true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    + Sub
                  </button>
                </div>
              )}
              {already && <span className="text-xs text-white/20">in lineup</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
