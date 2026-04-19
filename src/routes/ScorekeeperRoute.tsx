import { useState, useEffect, useMemo } from 'react'
import { ref, push, set, update, remove, onValue, get } from 'firebase/database'
import { db } from '../firebase'
import { HomeButton } from '../components/HomeButton'
import { AuthStatus } from '../components/AuthStatus'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import { useGameStats } from '../hooks/useGameStats'
import { useLiveRunners } from '../hooks/useLiveRunners'
import { useGames } from '../hooks/useGames'
import { useGameRecord } from '../hooks/useGameRecord'
import { useGameLineup } from '../hooks/useGameLineup'
import { applyAtBat, recomputeGameState, computeLineupPosition, type PlayLogEntry, type RecomputeGameResult } from '../scoring/engine'
import { computeFinalization } from '../scoring/finalization'
import { generateGameId, getEasternDateString } from '../scoring/gameId'
import { RunnerDiamond } from '../components/RunnerDiamond'
import type {
  AtBatResult, AtBatRecord, RunnersState, RunnerOutcomes,
  PlayersMap, LineupEntry, GameLineup, TeamsMap, GameSummary, GameRecord,
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

/**
 * Pure helper: given a result and the base state BEFORE the play, compute the
 * default runner outcomes and batter advance. Used by both the wizard
 * (live logging) and the at-bat editor (post-hoc corrections), so the chain
 * rule, walk-forcing, and strikeout-freeze logic stay in one place.
 */
function computeResultDefaults(
  result: AtBatResult,
  runners: RunnersState,
): { runnerOutcomes: RunnerOutcomes; batterAdvancedTo: AtBatRecord['batterAdvancedTo'] } {
  let batterAdvancedTo: AtBatRecord['batterAdvancedTo'] = AUTO_BATTER_ADVANCE[result] ?? null
  const runnerOutcomes: RunnerOutcomes = {}

  if (result === 'home_run') {
    if (runners.first)  runnerOutcomes.first  = 'scored'
    if (runners.second) runnerOutcomes.second = 'scored'
    if (runners.third)  runnerOutcomes.third  = 'scored'
    return { runnerOutcomes, batterAdvancedTo }
  }

  if (result === 'strikeout' || result === 'strikeout_looking') {
    if (runners.first)  runnerOutcomes.first  = 'stayed'
    if (runners.second) runnerOutcomes.second = 'stayed'
    if (runners.third)  runnerOutcomes.third  = 'stayed'
    return { runnerOutcomes, batterAdvancedTo }
  }

  if (result === 'groundout') {
    const chain = getConnectedChain(runners)
    if (chain.length > 0) {
      const leadBase = chain[chain.length - 1]
      for (const base of chain) {
        if (base === leadBase) {
          runnerOutcomes[base] = 'sits'
        } else if (base === 'first') {
          runnerOutcomes.first = 'second'
        } else if (base === 'second') {
          runnerOutcomes.second = 'third'
        }
      }
      batterAdvancedTo = 'first'  // chain rule — batter stays on 1st, lead runner sits
    }
    return { runnerOutcomes, batterAdvancedTo }
  }

  if (result === 'walk') {
    if (runners.first) {
      runnerOutcomes.first = 'second'
      if (runners.second) {
        runnerOutcomes.second = 'third'
        if (runners.third) runnerOutcomes.third = 'scored'
      }
    }
    if (runners.first  && !runnerOutcomes.first)  runnerOutcomes.first  = 'stayed'
    if (runners.second && !runnerOutcomes.second) runnerOutcomes.second = 'stayed'
    if (runners.third  && !runnerOutcomes.third)  runnerOutcomes.third  = 'stayed'
    return { runnerOutcomes, batterAdvancedTo }
  }

  // Other results (single/double/triple/popout/legacy): leave outcomes empty; scorer fills in.
  return { runnerOutcomes, batterAdvancedTo }
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

  const activeGameRecord = activeGameId ? games.find(g => g.gameId === activeGameId) : null

  if (activeGameId && activeGameRecord?.game.finalized) {
    return (
      <>
        <HomeButton />
        <AuthStatus />
        <GameSummaryView
          gameId={activeGameId}
          game={activeGameRecord.game}
          teams={teams}
          players={players}
          onBack={() => setActiveGameId(null)}
        />
      </>
    )
  }

  if (activeGameId && showLineupEditor) {
    return (
      <>
        <HomeButton />
        <AuthStatus />
        <LineupEditScreen
          gameId={activeGameId}
          players={players}
          teams={teams}
          onBack={() => setShowLineupEditor(false)}
        />
      </>
    )
  }

  if (activeGameId) {
    return (
      <>
        <HomeButton />
        <AuthStatus />
        <GameWizard
          gameId={activeGameId}
          players={players}
          teams={teams}
          onBack={() => setActiveGameId(null)}
          onEditLineup={() => setShowLineupEditor(true)}
        />
      </>
    )
  }

  return (
    <>
      <HomeButton />
      <AuthStatus />
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
    </>
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
  const liveGames = games.filter(({ game }) => !game.finalized)
  const completedGames = games.filter(({ game }) => game.finalized)

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
      ) : liveGames.length === 0 && completedGames.length === 0 ? (
        <div className="rounded-2xl px-6 py-10 text-center" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-white/40 text-sm mb-1">No games yet</p>
          <p className="text-white/25 text-xs">Tap + New Game to get started</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {liveGames.length > 0 && (
            <Section label="Live">
              {liveGames.map(({ gameId, game }) => (
                <GameRow key={gameId} gameId={gameId} game={game} teams={teams} onSelect={onSelectGame} />
              ))}
            </Section>
          )}
          {completedGames.length > 0 && (
            <Section label="Completed">
              {completedGames.map(({ gameId, game }) => (
                <CompletedGameRow key={gameId} gameId={gameId} game={game} teams={teams} onSelect={onSelectGame} />
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

// ── Completed game row (read-only, no delete) ────────────────────────────────

function CompletedGameRow({ gameId, game, teams, onSelect }: {
  gameId: string
  game: ReturnType<typeof useGames>['games'][number]['game']
  teams: TeamsMap
  onSelect: (id: string) => void
}) {
  const home = teams[game.homeTeamId]
  const away = teams[game.awayTeamId]
  const winner = game.homeScore > game.awayScore ? home : game.awayScore > game.homeScore ? away : null

  return (
    <button
      onClick={() => onSelect(gameId)}
      className="w-full rounded-2xl px-4 py-4 flex items-center justify-between text-left"
      style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-white/60 font-bold text-base">{away?.shortName ?? game.awayTeamId}</span>
          <span className="text-white/20 text-sm">@</span>
          <span className="text-white/60 font-bold text-base">{home?.shortName ?? game.homeTeamId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-black text-base" style={{ fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.5)' }}>
            {game.awayScore} – {game.homeScore}
          </span>
          {winner && (
            <span className="text-xs text-white/30">{winner.shortName} win</span>
          )}
          <span className="text-xs text-white/25">{game.date}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-black px-2 py-1 rounded uppercase tracking-widest"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-score)' }}>
          Final
        </span>
        <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 18 }}>›</span>
      </div>
    </button>
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
              <SkBtn onClick={() => setStep('away_lineup')} primary disabled={homeLineup.length < 4}>
                Next — {teams[awayTeamId]?.shortName ?? 'Away'} Lineup →
              </SkBtn>
              {homeLineup.length < 4 && (
                <p className="text-yellow-400/60 text-xs text-center">Need at least 4 batters</p>
              )}
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
              <SkBtn onClick={() => setStep('confirm')} primary disabled={awayLineup.length < 4}>
                Next — Confirm →
              </SkBtn>
              {awayLineup.length < 4 && (
                <p className="text-yellow-400/60 text-xs text-center">Need at least 4 batters</p>
              )}
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
  const [customSubName, setCustomSubName] = useState('')
  const [showCustomSub, setShowCustomSub] = useState(false)

  const teamPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === teamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const lineupIds = lineup.map(e => e.playerId)
  const available = teamPlayers.filter(([id]) => !lineupIds.includes(id))

  const addToLineup = (playerId: string, isSub = false) => {
    onChange([...lineup, { playerId, isSub }])
  }

  const addCustomSub = () => {
    const name = customSubName.trim()
    if (!name) return
    onChange([...lineup, { playerId: `sub_${Date.now()}`, isSub: true, subName: name }])
    setCustomSubName('')
    setShowCustomSub(false)
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
            Batting order ({lineup.length} batter{lineup.length !== 1 ? 's' : ''}{lineup.filter(e => e.isSub).length > 0 ? `, ${lineup.filter(e => e.isSub).length} sub${lineup.filter(e => e.isSub).length !== 1 ? 's' : ''}` : ''})
          </span>
          {lineup.map((entry, i) => (
            <div
              key={entry.playerId}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: entry.isSub ? 'rgba(255,255,255,0.03)' : 'rgba(37,99,235,0.1)', border: `1px solid ${entry.isSub ? 'rgba(255,255,255,0.06)' : 'rgba(96,165,250,0.2)'}` }}
            >
              <span className="text-white/30 text-xs font-bold w-5 text-center" style={{ fontFamily: 'var(--font-score)' }}>
                {i + 1}
              </span>
              <span className="text-white text-sm font-semibold flex-1">
                {entry.subName ?? players[entry.playerId]?.name ?? entry.playerId}
                {entry.isSub && <span className="text-white/30 text-xs font-normal ml-1.5">(sub)</span>}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => moveUp(i)} className="w-7 h-7 rounded-lg text-xs flex items-center justify-center" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}>▲</button>
                <button onClick={() => moveDown(i)} className="w-7 h-7 rounded-lg text-xs flex items-center justify-center" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}>▼</button>
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

      {/* Custom sub (someone not on the roster) */}
      {!showCustomSub ? (
        <button
          onClick={() => setShowCustomSub(true)}
          className="w-full h-11 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', border: '1px dashed rgba(255,255,255,0.12)' }}
        >
          + Custom Sub (not on roster)
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customSubName}
            onChange={e => setCustomSubName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomSub()}
            placeholder="Sub name…"
            autoFocus
            className="flex-1 h-11 rounded-xl px-3 text-sm font-semibold"
            style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <button
            onClick={addCustomSub}
            disabled={!customSubName.trim()}
            className="h-11 px-4 rounded-xl text-xs font-bold"
            style={{ background: customSubName.trim() ? '#2563eb' : '#1c2333', color: customSubName.trim() ? '#fff' : 'rgba(255,255,255,0.3)' }}
          >
            Add
          </button>
          <button
            onClick={() => { setShowCustomSub(false); setCustomSubName('') }}
            className="h-11 px-3 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
          >
            ✕
          </button>
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
            {i + 1}. {entry.subName ?? players[entry.playerId]?.name ?? entry.playerId}
            {entry.isSub && <span className="text-white/30 ml-1">(sub)</span>}
          </p>
        ))}
      </div>
    </div>
  )
}

// ── Game Wizard ─────────────────────────────────────────────────────────────

function GameWizard({ gameId, players, teams, onBack, onEditLineup }: {
  gameId: string
  players: PlayersMap
  teams: TeamsMap
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
  const { lineup: fieldingLineup } = useGameLineup(gameId, fieldingTeamId)

  // Resolve player name: checks real players first, then lineup subName entries
  const resolvePlayerName = (id: string) => {
    if (players[id]?.name) return players[id].name
    const entry = [...battingLineup, ...fieldingLineup].find(e => e.playerId === id)
    if (entry?.subName) return entry.subName
    return id
  }

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
  const [finalizing, setFinalizing] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)

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

  // Persist pitcher selection to Firebase so it survives a page refresh and
  // so the inning_end interstitial can pre-fill the pitcher for each side.
  // During top of inning the home team fields, during bottom the away team fields.
  useEffect(() => {
    if (!gameId || !pitcherId) return
    const side = isTopInning ? 'lastPitcherHome' : 'lastPitcherAway'
    update(ref(db), {
      [`games/${gameId}/matchup/pitcherId`]: pitcherId,
      [`games/${gameId}/matchup/${side}`]: pitcherId,
    })
  }, [pitcherId, gameId, isTopInning])

  // Pre-fill batter from lineup position. Subs are real slots in the order.
  useEffect(() => {
    if (battingLineup.length > 0) {
      const pos = lineupPosition % battingLineup.length
      setBatterId(battingLineup[pos]?.playerId ?? '')
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

  // ── Inning-ending detection ───────────────────────────────────────────────
  // When a play's locked-in outs (batter + chain rule) reach 3, runners can
  // only have scored or not — no additional outs are possible.

  function computeIsInningEnding(r: AtBatResult | null): boolean {
    if (!r) return false
    const defaults = computeResultDefaults(r, liveRunners)
    const defBatterOut = defaults.batterAdvancedTo === 'out' ? 1 : 0
    const defRunnerOuts = (['first', 'second', 'third'] as const).filter(b =>
      defaults.runnerOutcomes[b] === 'out' || defaults.runnerOutcomes[b] === 'sits'
    ).length
    return outs + defBatterOut + defRunnerOuts >= 3
  }

  const isInningEndingPlay = computeIsInningEnding(result)

  // ── Result selection ─────────────────────────────────────────────────────

  const handleSelectResult = (r: AtBatResult) => {
    setResult(r)

    const defaults = computeResultDefaults(r, liveRunners)
    setRunnerOutcomes(defaults.runnerOutcomes)
    setBatterAdvancedTo(defaults.batterAdvancedTo)

    // Step transitions depend on the result's flow — kept here so the wizard
    // and the edit modal (which needs no step transitions) share the pure part.
    if (r === 'home_run' || r === 'strikeout' || r === 'strikeout_looking' || r === 'walk') {
      setStep('confirm')
      return
    }

    if (!hasRunners) {
      setRunnerOutcomes({})
      setStep('confirm')
      return
    }

    // Detect if this play ends the inning (reaches 3 outs)
    const defBatterOut = defaults.batterAdvancedTo === 'out' ? 1 : 0
    const defRunnerOuts = (['first', 'second', 'third'] as const).filter(b =>
      defaults.runnerOutcomes[b] === 'out' || defaults.runnerOutcomes[b] === 'sits'
    ).length
    const isInningEnding = outs + defBatterOut + defRunnerOuts >= 3

    if (isInningEnding) {
      // Pre-fill non-out runners to 'stayed' (default: didn't score)
      const endOutcomes = { ...defaults.runnerOutcomes }
      let hasScorableRunners = false
      for (const base of ['first', 'second', 'third'] as const) {
        if (liveRunners[base] && endOutcomes[base] !== 'out' && endOutcomes[base] !== 'sits') {
          endOutcomes[base] = 'stayed'
          hasScorableRunners = true
        }
      }
      setRunnerOutcomes(endOutcomes)
      setStep(hasScorableRunners ? 'runner_outcomes' : 'confirm')
      return
    }

    if (r === 'groundout') {
      // Keep defaults (chain rule already set)
      setStep('runner_outcomes')
      return
    }

    // All other results with runners: clear for manual entry
    setRunnerOutcomes({})
    setStep('runner_outcomes')
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

    // Determine isSub + subName for anonymous subs
    const lineupEntry = battingLineup.find(e => e.playerId === batterId)
    const regularEntry = lineupEntry && !lineupEntry.isSub ? lineupEntry : null
    const isSub = !regularEntry
    const subName = lineupEntry?.subName

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
      ...(subName ? { subName } : {}),
    }

    // Run through engine for narrated log + next runner state
    const engineResult = applyAtBat({
      record,
      currentRunners: liveRunners,
      batterName: resolvePlayerName(batterId),
      getPlayerName: resolvePlayerName,
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
    const newOuts = Math.min(outs + outsOnPlay, 3)  // hard cap — never exceed 3 outs per half-inning

    // Write to Firebase
    await push(ref(db, `gameStats/${gameId}`), record)

    const updates: Record<string, unknown> = {
      [`liveRunners/${gameId}`]: engineResult.nextRunners,
      [`games/${gameId}/outs`]: newOuts,  // intentionally not reset to 0 here — advanceHalfInning owns that
      [`games/${gameId}/homeScore`]: newHomeScore,
      [`games/${gameId}/awayScore`]: newAwayScore,
    }

    // Advance lineup position from the ACTUAL batter's slot, not a stale
    // counter. Subs occupy slots in the rotation just like regulars — the
    // isSub flag is only a stat-exclusion tag — so we advance the pointer
    // regardless of isSub.
    const batterIdx = battingLineup.findIndex(e => e.playerId === batterId)
    if (batterIdx !== -1 && battingLineup.length > 0) {
      const nextPos = (batterIdx + 1) % battingLineup.length
      updates[`games/${gameId}/lineupPosition/${battingTeamId}`] = nextPos
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
        if (battingLineup.length > 0) {
          const nextPos = batterIdx !== -1
            ? (batterIdx + 1) % battingLineup.length
            : (lineupPosition + 1) % battingLineup.length
          const nextEntry = battingLineup[nextPos]
          // Custom subs have a fabricated playerId (sub_<timestamp>) not in /players;
          // their name comes from subName, so the scorebug notch can't render them.
          // In that case, clear the notch rather than pointing at a bogus ID.
          const nextBatterForNotch =
            nextEntry && !nextEntry.isSub ? nextEntry.playerId : null
          updates['game/matchup/batterId'] = nextBatterForNotch
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

  const finalizeGame = async () => {
    if (!gameId || !game) return
    setFinalizing(true)
    try {
      const gamesSnap = await get(ref(db, 'games'))
      const allGames: Record<string, { finalized: boolean; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; inning: number; isTopInning: boolean; outs: number; date: string; isStreamed: boolean; startedAt: number }> = gamesSnap.exists() ? gamesSnap.val() : {}
      const thisGame = allGames[gameId]
      if (!thisGame) return

      const prevGameEntries = Object.entries(allGames)
        .filter(([id, g]) => g.finalized && id !== gameId)

      const previousGames: Record<string, typeof thisGame & { finalized: boolean }> = {}
      const previousAtBats: Array<AtBatRecord & { gameId: string }> = []
      for (const [gId, gRecord] of prevGameEntries) {
        previousGames[gId] = gRecord
        const snap = await get(ref(db, `gameStats/${gId}`))
        if (snap.exists()) {
          for (const ab of Object.values(snap.val() as Record<string, AtBatRecord>)) {
            previousAtBats.push({ ...ab, gameId: gId })
          }
        }
      }

      const currentSnap = await get(ref(db, `gameStats/${gameId}`))
      const currentGameAtBats: AtBatRecord[] = currentSnap.exists()
        ? Object.values(currentSnap.val() as Record<string, AtBatRecord>)
        : []

      const { updates, summary } = computeFinalization({
        gameId,
        game: { ...thisGame, finalized: false, finalizedAt: undefined },
        currentGameAtBats,
        previousAtBats,
        previousGames: previousGames as Record<string, import('../types').GameRecord>,
        players,
      })

      if (import.meta.env.DEV) {
        console.group('[Finalization]')
        summary.forEach(line => console.log(line))
        console.groupEnd()
      }

      // If this was the active streamed game, disconnect it from the controller
      if (thisGame.isStreamed) updates['game/meta/currentGameId'] = null

      await update(ref(db), updates)
      setShowGameCompletePrompt(false)
      setConfirmFinalize(false)
      onBack()
    } finally {
      setFinalizing(false)
    }
  }

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

  // ── At-bat editing modal state ───────────────────────────────────────────
  const [editingAtBatId, setEditingAtBatId] = useState<string | null>(null)

  /**
   * Commit a recomputed game state to Firebase. Used by deleteAtBat and the
   * edit modal. Writes all recomputed at-bat records, game aggregates,
   * liveRunners, lineup positions, and mirrors to /game/meta if streamed.
   * Also flips wizard step between batter/inning_end if outs cross 3.
   */
  const applyRecompute = async (recompute: RecomputeGameResult, deletedIds: string[] = []) => {
    if (!gameId || !game) return

    const updates: Record<string, unknown> = {}

    // Delete removed records
    for (const id of deletedIds) {
      updates[`gameStats/${gameId}/${id}`] = null
    }
    // Write every recomputed at-bat record back to the same key
    for (const [id, rec] of Object.entries(recompute.recomputedAtBats)) {
      updates[`gameStats/${gameId}/${id}`] = rec
    }

    // Game aggregates
    updates[`games/${gameId}/homeScore`] = recompute.homeScore
    updates[`games/${gameId}/awayScore`] = recompute.awayScore
    updates[`games/${gameId}/outs`] = Math.min(recompute.currentHalfOuts, 3)  // hard cap
    updates[`liveRunners/${gameId}`] = recompute.currentHalfRunners

    // Recompute lineup positions for both teams from the full at-bat list.
    // Subs are real slots in the rotation, so we pass the full lineup orders.
    const allAtBatList = Object.values(recompute.recomputedAtBats)
    const playerTeamMap: Record<string, string> = {}
    for (const [id, p] of Object.entries(players)) playerTeamMap[id] = p.teamId
    const homeLineup = game.homeTeamId === battingTeamId ? battingLineup : fieldingLineup
    const awayLineup = game.awayTeamId === battingTeamId ? battingLineup : fieldingLineup
    const homeOrder = homeLineup.map(e => e.playerId)
    const awayOrder = awayLineup.map(e => e.playerId)
    if (homeOrder.length > 0 && game.homeTeamId) {
      updates[`games/${gameId}/lineupPosition/${game.homeTeamId}`] =
        computeLineupPosition(allAtBatList, game.homeTeamId, playerTeamMap, homeOrder)
    }
    if (awayOrder.length > 0 && game.awayTeamId) {
      updates[`games/${gameId}/lineupPosition/${game.awayTeamId}`] =
        computeLineupPosition(allAtBatList, game.awayTeamId, playerTeamMap, awayOrder)
    }

    // Mirror to /game/meta if streamed
    if (game.isStreamed) {
      updates['game/meta/outs'] = recompute.currentHalfOuts
      updates['game/meta/homeScore'] = recompute.homeScore
      updates['game/meta/awayScore'] = recompute.awayScore
      updates['game/meta/bases'] = {
        first: !!recompute.currentHalfRunners.first,
        second: !!recompute.currentHalfRunners.second,
        third: !!recompute.currentHalfRunners.third,
      }
    }

    await update(ref(db), updates)

    // Flip wizard step if outs crossed the 3-out threshold in either direction
    if (recompute.currentHalfOuts >= 3 && step !== 'inning_end') {
      setStep('inning_end')
      const lastPitcher = isTopInning
        ? game.matchup?.lastPitcherAway
        : game.matchup?.lastPitcherHome
      setNextPitcherId(lastPitcher ?? pitcherId ?? '')
    } else if (recompute.currentHalfOuts < 3 && step === 'inning_end') {
      setStep('batter')
      setNextPitcherId('')
    }
  }

  const deleteAtBat = async (atBatId: string) => {
    if (!gameId || !game) return
    if (!atBats[atBatId]) return

    const updatedAtBats = { ...atBats }
    delete updatedAtBats[atBatId]
    const recompute = recomputeGameState(updatedAtBats, resolvePlayerName, inning, isTopInning)
    await applyRecompute(recompute, [atBatId])
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

  const openEditModal = (atBatId: string) => {
    setEditingAtBatId(atBatId)
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

      {/* At-bat edit modal */}
      {editingAtBatId && atBats[editingAtBatId] && (
        <AtBatEditModal
          atBatId={editingAtBatId}
          ab={atBats[editingAtBatId]}
          allAtBats={atBats}
          players={players}
          teams={teams}
          game={game}
          gameId={gameId}
          battingLineup={battingLineup}
          fieldingLineup={fieldingLineup}
          resolvePlayerName={resolvePlayerName}
          currentInning={inning}
          currentIsTop={isTopInning}
          onClose={() => setEditingAtBatId(null)}
          applyRecompute={applyRecompute}
        />
      )}

      {/* Finalize confirmation modal — triggered by End Game button or auto game-complete prompt */}
      {(confirmFinalize || showGameCompletePrompt) && !game?.finalized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 text-center" style={{ background: '#1a1f2e', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-4xl mb-3">🏁</p>
            <h2 className="text-white text-2xl font-black mb-1 uppercase tracking-wide" style={{ fontFamily: 'var(--font-score)' }}>
              Finalize Game?
            </h2>
            <p className="text-white/50 text-sm mb-2">
              {showGameCompletePrompt && gameCompleteReason === 'innings' && '7 innings complete.'}
              {gameCompleteReason === 'time' && '90 minutes elapsed.'}
            </p>
            <p className="text-red-400/70 text-xs mb-6">
              This will lock the game and update season stats. It cannot be undone.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  sessionStorage.setItem(`game-complete-shown-${gameId}`, '1')
                  finalizeGame()
                }}
                disabled={finalizing}
                className="w-full py-4 rounded-xl font-black text-base uppercase tracking-wider"
                style={{ background: finalizing ? '#7f1d1d' : '#b91c1c', color: '#fff' }}
              >
                {finalizing ? 'Saving Stats…' : 'Yes, Finalize Game'}
              </button>
              <button
                onClick={() => {
                  sessionStorage.setItem(`game-complete-shown-${gameId}`, '1')
                  setShowGameCompletePrompt(false)
                  setConfirmFinalize(false)
                }}
                disabled={finalizing}
                className="w-full py-3 rounded-xl font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}
              >
                Keep Playing
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
          {game?.finalized ? (
            <span className="text-xs font-black px-3 py-1.5 rounded-lg uppercase tracking-widest"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)' }}>
              Final
            </span>
          ) : (
            <button
              onClick={() => setConfirmFinalize(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              End Game
            </button>
          )}
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
        <RunnerDiamond runners={liveRunners} getPlayerName={resolvePlayerName} size={100} />
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
              ↩ {lastAb.subName ?? players[lastAb.batterId]?.name ?? lastAb.batterId} — {RESULT_LABELS[lastAb.result] ?? lastAb.result}
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
                          <option key={id} value={id}>{resolvePlayerName(id)} (sub)</option>
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
              <StepLabel step={3} label={isInningEndingPlay ? 'Runners Score?' : 'Runner Outcomes'} />
              <BackBtn onClick={() => setStep('result')} />
            </div>

            {isInningEndingPlay ? (
              /* ── Simplified inning-ending UI: scored yes/no per runner ─── */
              <>
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-red-400 font-semibold text-sm">3rd Out</p>
                  <p className="text-red-300/70 text-xs">Inning over. Did anyone score before the out?</p>
                </div>

                <div className="flex flex-col gap-2">
                  {(['third', 'second', 'first'] as const).map(base => {
                    const runnerId = liveRunners[base]
                    if (!runnerId) return null
                    const outcome = runnerOutcomes[base]

                    // Chain-rule runners are locked
                    if (outcome === 'sits' || outcome === 'out') {
                      return (
                        <div key={base} className="flex items-center justify-between rounded-xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                          <span className="text-white/40 text-sm">
                            {resolvePlayerName(runnerId)}
                            <span className="text-white/25 text-xs ml-2">{base === 'first' ? '1st' : base === 'second' ? '2nd' : '3rd'}</span>
                          </span>
                          <span className="text-yellow-400/70 text-xs font-semibold">Sits (chain)</span>
                        </div>
                      )
                    }

                    const scored = outcome === 'scored'
                    return (
                      <div key={base} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="flex flex-col">
                          <span className="text-white text-sm font-semibold">
                            {resolvePlayerName(runnerId)}
                          </span>
                          <span className="text-white/30 text-xs">{base === 'first' ? '1st base' : base === 'second' ? '2nd base' : '3rd base'}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setRunnerOutcomes(prev => ({ ...prev, [base]: 'scored' }))}
                            className="h-9 w-16 rounded-lg text-xs font-semibold transition-all"
                            style={{
                              background: scored ? 'rgba(22,163,74,0.4)' : 'rgba(255,255,255,0.08)',
                              color: scored ? '#fff' : 'rgba(255,255,255,0.5)',
                              border: scored ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setRunnerOutcomes(prev => ({ ...prev, [base]: 'stayed' }))}
                            className="h-9 w-16 rounded-lg text-xs font-semibold transition-all"
                            style={{
                              background: !scored ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                              color: !scored ? '#fff' : 'rgba(255,255,255,0.5)',
                              border: !scored ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            No
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              /* ── Normal runner outcome UI ─────────────────────────────── */
              <>
                {result === 'groundout' && getConnectedChain(liveRunners).length > 0 && (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                    <p className="text-yellow-400 font-semibold mb-1">Chain Rule</p>
                    <p className="text-yellow-300/70 text-xs">
                      Connected chain — batter is recorded as out but stays on 1st. Lead runner sits down and leaves the bases. 1 out total. Adjust below if needed.
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

                    // Clamp: prevent outs from exceeding 3 per inning
                    const batterOut = batterAdvancedTo === 'out' ? 1 : 0
                    const otherRunnerOuts = (['first', 'second', 'third'] as const).filter(b =>
                      b !== base && (runnerOutcomes[b] === 'out' || runnerOutcomes[b] === 'sits')
                    ).length
                    const thisIsOut = outcome === 'out' || outcome === 'sits'
                    const canSelectOut = thisIsOut || (outs + batterOut + otherRunnerOuts + 1) <= 3

                    const allOptions: Array<{ label: string; value: RunnerOutcomes[typeof base] }> = [
                      { label: 'Scored', value: 'scored' as const },
                      ...advanceOptions,
                      ...(!stayedBlocked ? [{ label: 'Stayed', value: 'stayed' as const }] : []),
                      ...(canSelectOut ? [{ label: 'Out', value: 'out' as const }] : []),
                      ...(canSelectOut ? [{ label: 'Sits', value: 'sits' as const }] : []),
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
                          {resolvePlayerName(runnerId)}
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
              </>
            )}

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
                <span className="text-white font-bold text-lg">{resolvePlayerName(batterId)}</span>
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
                        {lastName(resolvePlayerName(runnerId))} — {outcomeLabels[outcome] ?? outcome}
                      </p>
                    )
                  })}
                </div>
              )}

              {/* Batter placement */}
              {batterAdvancedTo && batterAdvancedTo !== 'out' && (
                <p className="text-white/50 text-sm">
                  {lastName(resolvePlayerName(batterId))} → {batterAdvancedTo === 'home' ? 'scores' : batterAdvancedTo}
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
                onEdit={openEditModal}
                onDelete={deleteAtBat}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live stats */}
      {(() => {
        // Tally per-batter stats from this game's at-bats
        const tally: Record<string, { pa: number; h: number; bb: number; rbi: number; hr: number; r: number }> = {}
        const ensure = (id: string) => { if (!tally[id]) tally[id] = { pa: 0, h: 0, bb: 0, rbi: 0, hr: 0, r: 0 }; return tally[id] }
        for (const ab of Object.values(atBats)) {
          const s = ensure(ab.batterId)
          s.pa++
          if (['single', 'double', 'triple', 'home_run'].includes(ab.result)) s.h++
          if (ab.result === 'walk') s.bb++
          s.rbi += ab.rbiCount
          if (ab.result === 'home_run') s.hr++
          if (ab.batterAdvancedTo === 'home') s.r++
          for (const runnerId of (ab.runnersScored ?? [])) { ensure(runnerId).r++ }
        }

        const homeId = game?.homeTeamId ?? ''
        const awayId = game?.awayTeamId ?? ''
        const cols = ['PA', 'H', 'BB', 'RBI', 'HR', 'R'] as const
        const statKeys: Array<keyof typeof tally[string]> = ['pa', 'h', 'bb', 'rbi', 'hr', 'r']

        const renderSide = (teamId: string) => {
          const rows = Object.entries(tally)
            .filter(([id]) => players[id]?.teamId === teamId)
            .sort(([, a], [, b]) => b.pa - a.pa)
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
                    <td className="py-1 text-white/70 truncate" style={{ maxWidth: 60 }}>{lastName(resolvePlayerName(id))}</td>
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

function AtBatRow({ atBatId, ab, players, onEdit, onDelete }: {
  atBatId: string
  ab: AtBatRecord
  players: PlayersMap
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
          <span className="text-white font-semibold text-sm truncate">{ab.subName ?? batter?.name ?? ab.batterId}</span>
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
        {confirming ? (
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

function AtBatEditModal({
  atBatId, ab, allAtBats, players, teams, game, battingLineup, fieldingLineup,
  resolvePlayerName, currentInning, currentIsTop, onClose, applyRecompute,
}: {
  atBatId: string
  ab: AtBatRecord
  allAtBats: Record<string, AtBatRecord>
  players: PlayersMap
  teams: TeamsMap
  game: GameRecord | null
  gameId: string
  battingLineup: GameLineup
  fieldingLineup: GameLineup
  resolvePlayerName: (id: string) => string
  currentInning: number
  currentIsTop: boolean
  onClose: () => void
  applyRecompute: (recompute: RecomputeGameResult, deletedIds?: string[]) => Promise<void>
}) {
  const [batterId, setBatterId] = useState(ab.batterId)
  const [pitcherId, setPitcherId] = useState(ab.pitcherId)
  const [result, setResult] = useState<AtBatResult>(ab.result)
  const [runnerOutcomes, setRunnerOutcomes] = useState<RunnerOutcomes>(ab.runnerOutcomes ?? {})
  const [batterAdvancedTo, setBatterAdvancedTo] = useState<AtBatRecord['batterAdvancedTo']>(ab.batterAdvancedTo)
  const [saving, setSaving] = useState(false)

  // The base state AT the time of this at-bat, as stored on the record.
  // The scorekeeper edits this at-bat relative to its own snapshot, not
  // liveRunners (the current half may have moved on since). Firebase RTDB
  // strips objects whose fields are all null, so an at-bat that happened
  // with empty bases has runnersOnBase === undefined — fall back to empty.
  const runners: RunnersState = ab.runnersOnBase ?? { first: null, second: null, third: null }

  // Determine the at-bat's batting/fielding teams — may be different from
  // the current game state if editing a past half-inning.
  const abBattingTeamId = ab.isTopInning ? (game?.awayTeamId ?? '') : (game?.homeTeamId ?? '')
  const abFieldingTeamId = ab.isTopInning ? (game?.homeTeamId ?? '') : (game?.awayTeamId ?? '')
  const abLineup: GameLineup = ab.isTopInning === currentIsTop ? battingLineup : fieldingLineup

  const batterOptions = Object.entries(players)
    .filter(([, p]) => p.teamId === abBattingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
  const pitcherOptions = Object.entries(players)
    .filter(([, p]) => p.teamId === abFieldingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const handleSelectResult = (r: AtBatResult) => {
    setResult(r)
    const defaults = computeResultDefaults(r, runners)
    setRunnerOutcomes(defaults.runnerOutcomes)
    setBatterAdvancedTo(defaults.batterAdvancedTo)
  }

  // Construct the hypothetical updated record for cascade preview
  const updatedRecord: AtBatRecord = useMemo(() => {
    const entry = abLineup.find(e => e.playerId === batterId)
    const isSub = !entry || entry.isSub
    return {
      ...ab,
      batterId,
      pitcherId,
      result,
      runnersOnBase: runners, // normalized — Firebase may have stripped the stored one
      runnerOutcomes,
      batterAdvancedTo,
      isSub,
      ...(entry?.subName ? { subName: entry.subName } : {}),
    }
  }, [ab, batterId, pitcherId, result, runners, runnerOutcomes, batterAdvancedTo, abLineup])

  // Preview the full replay with this edit applied
  const preview = useMemo(() => {
    const hypotheticalMap = { ...allAtBats, [atBatId]: updatedRecord }
    return recomputeGameState(hypotheticalMap, resolvePlayerName, currentInning, currentIsTop)
  }, [allAtBats, atBatId, updatedRecord, resolvePlayerName, currentInning, currentIsTop])

  const oldHome = game?.homeScore ?? 0
  const oldAway = game?.awayScore ?? 0
  const oldOuts = game?.outs ?? 0

  const homeDelta = preview.homeScore - oldHome
  const awayDelta = preview.awayScore - oldAway
  const outsDelta = preview.currentHalfOuts - oldOuts

  const presentBases = (['third', 'second', 'first'] as const).filter(b => runners[b])
  const hasRunners = presentBases.length > 0

  // Compute outs in this half-inning BEFORE the at-bat being edited, so we
  // can clamp runner out/sits options to never exceed 3 total.
  const outsBeforeThisAb = useMemo(() => {
    const sorted = Object.entries(preview.recomputedAtBats)
      .filter(([, r]) => r.inning === ab.inning && r.isTopInning === ab.isTopInning)
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)
    let total = 0
    for (const [id, r] of sorted) {
      if (id === atBatId) break
      total += r.outsOnPlay
    }
    return total
  }, [preview.recomputedAtBats, ab.inning, ab.isTopInning, atBatId])

  const advanceOptions: Array<{ label: string; value: NonNullable<AtBatRecord['batterAdvancedTo']> }> = [
    { label: '1st', value: 'first' },
    { label: '2nd', value: 'second' },
    { label: '3rd', value: 'third' },
    { label: 'Home', value: 'home' },
    { label: 'Out', value: 'out' },
  ]

  const handleSave = async () => {
    if (!batterId || !result || !batterAdvancedTo) return
    setSaving(true)
    try {
      await applyRecompute(preview)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const renderDelta = (delta: number) => {
    if (delta === 0) return <span className="text-white/30">no change</span>
    const color = delta > 0 ? '#4ade80' : '#f87171'
    const sign = delta > 0 ? '+' : ''
    return <span style={{ color, fontWeight: 700 }}>{sign}{delta}</span>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div
        className="w-full max-w-md rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
        style={{ background: '#1a1f2e', border: '1px solid rgba(96,165,250,0.3)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl font-black uppercase tracking-wide" style={{ fontFamily: 'var(--font-score)' }}>
            Edit At-Bat
          </h2>
          <span className="text-white/50 text-sm font-semibold" style={{ fontFamily: 'var(--font-score)' }}>
            {ab.isTopInning ? '▲' : '▼'}{ab.inning}
          </span>
        </div>

        {/* Batter */}
        <div className="mb-3">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-score)' }}>
            🏏 Batter — {teams[abBattingTeamId]?.shortName ?? abBattingTeamId}
          </p>
          <select
            value={batterId}
            onChange={e => setBatterId(e.target.value)}
            className="w-full h-12 rounded-xl px-3 text-sm font-medium"
            style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {batterOptions.map(([id, p]) => (
              <option key={id} value={id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Pitcher */}
        <div className="mb-3">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-score)' }}>
            ⚾ Pitcher — {teams[abFieldingTeamId]?.shortName ?? abFieldingTeamId}
          </p>
          <select
            value={pitcherId}
            onChange={e => setPitcherId(e.target.value)}
            className="w-full h-12 rounded-xl px-3 text-sm font-medium"
            style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {pitcherOptions.map(([id, p]) => (
              <option key={id} value={id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Result */}
        <div className="mb-3">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-score)' }}>
            Result
          </p>
          <div className="grid grid-cols-2 gap-2">
            {RESULTS.map(r => (
              <button
                key={r}
                onClick={() => handleSelectResult(r)}
                className="h-10 rounded-lg text-xs font-semibold"
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

        {/* Runner outcomes — only for bases that had a runner at this play */}
        {hasRunners && (
          <div className="mb-3">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-score)' }}>
              Runners (at time of play)
            </p>
            <div className="flex flex-col gap-2">
              {presentBases.map(base => {
                const runnerId = runners[base]!
                const outcome = runnerOutcomes[base]

                // Clamp: prevent outs from exceeding 3 per half-inning
                const editBatterOut = batterAdvancedTo === 'out' ? 1 : 0
                const editOtherRunnerOuts = presentBases.filter(b =>
                  b !== base && (runnerOutcomes[b] === 'out' || runnerOutcomes[b] === 'sits')
                ).length
                const editThisIsOut = outcome === 'out' || outcome === 'sits'
                const editCanSelectOut = editThisIsOut || (outsBeforeThisAb + editBatterOut + editOtherRunnerOuts + 1) <= 3

                const allOptions: Array<{ label: string; value: NonNullable<RunnerOutcomes['first']> }> = [
                  { label: 'Scored', value: 'scored' },
                  ...(base === 'first' ? [{ label: '→ 2nd', value: 'second' as const }] : []),
                  ...(base !== 'third' ? [{ label: '→ 3rd', value: 'third' as const }] : []),
                  { label: 'Stayed', value: 'stayed' },
                  ...(editCanSelectOut ? [{ label: 'Out', value: 'out' as const }] : []),
                  ...(editCanSelectOut ? [{ label: 'Sits', value: 'sits' as const }] : []),
                ]
                const setOutcome = (v: NonNullable<RunnerOutcomes['first']>) => {
                  setRunnerOutcomes(prev => {
                    const next = { ...prev }
                    if (base === 'first') next.first = v as RunnerOutcomes['first']
                    else if (base === 'second') next.second = v as RunnerOutcomes['second']
                    else next.third = v as RunnerOutcomes['third']
                    return next
                  })
                }
                return (
                  <div key={base} className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p className="text-white font-semibold text-xs mb-1">
                      {resolvePlayerName(runnerId)}{' '}
                      <span className="text-white/40">· {base === 'first' ? '1st' : base === 'second' ? '2nd' : '3rd'}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {allOptions.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setOutcome(opt.value)}
                          className="h-7 px-2 rounded text-xs font-semibold"
                          style={{
                            background: outcome === opt.value
                              ? opt.value === 'out' ? 'rgba(239,68,68,0.4)'
                              : opt.value === 'sits' ? 'rgba(234,179,8,0.35)'
                              : opt.value === 'scored' ? 'rgba(22,163,74,0.4)'
                              : 'rgba(37,99,235,0.5)'
                              : 'rgba(255,255,255,0.08)',
                            color: outcome === opt.value ? '#fff' : 'rgba(255,255,255,0.6)',
                            border: '1px solid rgba(255,255,255,0.08)',
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
          </div>
        )}

        {/* Batter advance */}
        <div className="mb-4">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-score)' }}>
            Batter ends up
          </p>
          <div className="flex flex-wrap gap-2">
            {advanceOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setBatterAdvancedTo(opt.value)}
                className="h-9 px-3 rounded-lg text-xs font-semibold"
                style={{
                  background: batterAdvancedTo === opt.value ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.07)',
                  color: batterAdvancedTo === opt.value ? '#fff' : 'rgba(255,255,255,0.8)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cascade preview */}
        <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(96,165,250,0.25)' }}>
          <p className="text-blue-300 text-xs font-semibold uppercase tracking-widest mb-2" style={{ fontFamily: 'var(--font-score)' }}>
            Cascade Preview
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mb-1">
            <div>
              <span className="text-white/40">{teams[game?.awayTeamId ?? '']?.shortName ?? 'Away'}: </span>
              <span className="text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>{oldAway} → {preview.awayScore}</span>{' '}
              {renderDelta(awayDelta)}
            </div>
            <div>
              <span className="text-white/40">{teams[game?.homeTeamId ?? '']?.shortName ?? 'Home'}: </span>
              <span className="text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>{oldHome} → {preview.homeScore}</span>{' '}
              {renderDelta(homeDelta)}
            </div>
          </div>
          <div className="text-xs">
            <span className="text-white/40">
              Current half outs ({currentIsTop ? '▲' : '▼'}{currentInning}):{' '}
            </span>
            <span className="text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>
              {oldOuts} → {preview.currentHalfOuts}
            </span>{' '}
            {renderDelta(outsDelta)}
          </div>
          {preview.warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(234,179,8,0.25)' }}>
              <p className="text-yellow-400 text-xs font-semibold mb-1">⚠ {preview.warnings.length} warning(s)</p>
              <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {preview.warnings.slice(0, 8).map((w, i) => {
                  const wab = allAtBats[w.atBatId]
                  const half = wab ? `${wab.isTopInning ? 'Top' : 'Bot'} ${wab.inning}` : ''
                  const batterName = wab ? resolvePlayerName(wab.batterId) : ''
                  return (
                    <li key={i} className="text-yellow-300/70 text-xs leading-snug">
                      <span className="text-yellow-500/80 font-semibold">[{half} · {batterName}]</span>{' '}
                      {w.message}
                    </li>
                  )
                })}
                {preview.warnings.length > 8 && (
                  <li className="text-yellow-300/50 text-xs italic">…and {preview.warnings.length - 8} more</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-11 rounded-xl font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !batterId || !result || !batterAdvancedTo}
            className="flex-1 h-11 rounded-xl font-bold text-sm uppercase tracking-wider"
            style={{
              background: saving ? 'rgba(37,99,235,0.4)' : '#2563eb',
              color: '#fff',
              border: '1px solid rgba(96,165,250,0.5)',
              opacity: (!batterId || !result || !batterAdvancedTo) ? 0.4 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
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
  const { atBats } = useGameStats(gameId)

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
      // Recompute lineupPosition from history against the new lineup order
      // so removals/reorders immediately re-sync the pointer. Subs count
      // as real slots, so we pass the full order.
      const lineupOrder = localLineup.map(e => e.playerId)
      const playerTeamMap: Record<string, string> = {}
      for (const [id, p] of Object.entries(players)) playerTeamMap[id] = p.teamId
      const allAtBatList = Object.values(atBats)
      const nextPos = lineupOrder.length > 0
        ? computeLineupPosition(allAtBatList, teamId, playerTeamMap, lineupOrder)
        : 0

      const updates: Record<string, unknown> = {}
      updates[`games/${gameId}/lineups/${teamId}`] = localLineup
      updates[`games/${gameId}/lineupPosition/${teamId}`] = nextPos
      await update(ref(db), updates)
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

// ── Game Summary View (read-only, finalized games) ───────────────────────────

function GameSummaryView({ gameId, game, teams, players, onBack }: {
  gameId: string
  game: ReturnType<typeof useGames>['games'][number]['game']
  teams: TeamsMap
  players: PlayersMap
  onBack: () => void
}) {
  const [summaries, setSummaries] = useState<Record<string, GameSummary>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, `gameSummaries/${gameId}`), snap => {
      setSummaries(snap.exists() ? snap.val() : {})
      setLoading(false)
    })
    return () => unsub()
  }, [gameId])

  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const allStats = Object.values(summaries)
  const awayBatting = allStats
    .filter(s => s.teamId === game.awayTeamId && s.ab > 0)
    .sort((a, b) => (players[a.playerId]?.name ?? '').localeCompare(players[b.playerId]?.name ?? ''))
  const homeBatting = allStats
    .filter(s => s.teamId === game.homeTeamId && s.ab > 0)
    .sort((a, b) => (players[a.playerId]?.name ?? '').localeCompare(players[b.playerId]?.name ?? ''))
  const pitchers = allStats
    .filter(s => s.inningsPitched > 0)
    .sort((a, b) => b.inningsPitched - a.inningsPitched)

  return (
    <div className="min-h-screen px-4 py-4 pb-16" style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}>
      {/* Nav */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={onBack} className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <span style={{ fontSize: 22 }}>‹</span>
          <span className="text-sm font-semibold">Games</span>
        </button>
        <span
          className="text-xs font-black px-2.5 py-1 rounded-lg uppercase tracking-widest"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-score)' }}
        >
          Final
        </span>
      </div>

      {/* Score card */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-white/25 text-xs text-center mb-4 uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
          {game.date}
        </p>
        <div className="flex items-center justify-between px-4">
          <div className="flex flex-col items-center gap-2">
            {awayTeam?.logoUrl && <img src={awayTeam.logoUrl} style={{ width: 52, height: 52, objectFit: 'contain' }} alt="" />}
            <span className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
              {awayTeam?.shortName ?? game.awayTeamId}
            </span>
            <span className="font-black" style={{ fontFamily: 'var(--font-score)', fontSize: 52, lineHeight: 1, color: game.awayScore > game.homeScore ? '#ffffff' : 'rgba(255,255,255,0.4)' }}>
              {game.awayScore}
            </span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: 28 }}>—</span>
          <div className="flex flex-col items-center gap-2">
            {homeTeam?.logoUrl && <img src={homeTeam.logoUrl} style={{ width: 52, height: 52, objectFit: 'contain' }} alt="" />}
            <span className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
              {homeTeam?.shortName ?? game.homeTeamId}
            </span>
            <span className="font-black" style={{ fontFamily: 'var(--font-score)', fontSize: 52, lineHeight: 1, color: game.homeScore > game.awayScore ? '#ffffff' : 'rgba(255,255,255,0.4)' }}>
              {game.homeScore}
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-white/30 text-sm text-center py-8">Loading stats…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <BattingTable title={awayTeam?.name ?? 'Away'} rows={awayBatting} players={players} />
          <BattingTable title={homeTeam?.name ?? 'Home'} rows={homeBatting} players={players} />
          {pitchers.length > 0 && <PitchingTable rows={pitchers} players={players} teams={teams} />}
        </div>
      )}
    </div>
  )
}

function BattingTable({ title, rows, players }: {
  title: string
  rows: GameSummary[]
  players: PlayersMap
}) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="text-white/50 text-xs font-black uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
          {title} — Batting
        </span>
      </div>
      <div className="grid px-4 py-1.5" style={{ gridTemplateColumns: '1fr 38px 38px 38px 38px 38px 38px' }}>
        {['', 'AB', 'R', 'H', 'HR', 'RBI', 'BB'].map(h => (
          <span key={h} className="text-center text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-score)', letterSpacing: '0.1em' }}>{h}</span>
        ))}
      </div>
      {rows.map(s => (
        <div key={s.playerId} className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: '1fr 38px 38px 38px 38px 38px 38px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <span className="text-white/80 text-sm font-semibold truncate">{players[s.playerId]?.name ?? s.playerId}</span>
          {[s.ab, s.r, s.h, s.hr, s.rbi, s.bb].map((val, i) => (
            <span key={i} className="text-center text-sm font-bold tabular-nums" style={{ fontFamily: 'var(--font-score)', color: val > 0 ? '#ffffff' : 'rgba(255,255,255,0.2)' }}>
              {val}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function PitchingTable({ rows, players, teams }: {
  rows: GameSummary[]
  players: PlayersMap
  teams: TeamsMap
}) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="text-white/50 text-xs font-black uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Pitching</span>
      </div>
      <div className="grid px-4 py-1.5" style={{ gridTemplateColumns: '1fr 48px 52px 38px 38px' }}>
        {['', 'IP', 'ERA', 'K', 'BB'].map(h => (
          <span key={h} className="text-center text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-score)', letterSpacing: '0.1em' }}>{h}</span>
        ))}
      </div>
      {rows.map(s => {
        const ip = s.inningsPitched
        const era = ip > 0 ? Math.round(((s.runsAllowed ?? 0) / ip) * 7 * 100) / 100 : 0
        return (
          <div key={s.playerId} className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: '1fr 48px 52px 38px 38px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <span className="text-white/80 text-sm font-semibold">{players[s.playerId]?.name ?? s.playerId}</span>
              <span className="text-white/25 text-xs ml-2">{teams[players[s.playerId]?.teamId ?? '']?.shortName ?? ''}</span>
            </div>
            <span className="text-center text-sm font-bold tabular-nums" style={{ fontFamily: 'var(--font-score)', color: '#ffffff' }}>{Math.floor(ip)}</span>
            <span className="text-center text-sm font-bold tabular-nums" style={{ fontFamily: 'var(--font-score)', color: '#ffffff' }}>{era.toFixed(2)}</span>
            <span className="text-center text-sm font-bold tabular-nums" style={{ fontFamily: 'var(--font-score)', color: (s.pitchingK ?? 0) > 0 ? '#ffffff' : 'rgba(255,255,255,0.2)' }}>{s.pitchingK ?? 0}</span>
            <span className="text-center text-sm font-bold tabular-nums" style={{ fontFamily: 'var(--font-score)', color: (s.pitchingBb ?? 0) > 0 ? '#ffffff' : 'rgba(255,255,255,0.2)' }}>{s.pitchingBb ?? 0}</span>
          </div>
        )
      })}
    </div>
  )
}
