import { useState, useEffect, useRef } from 'react'
import { ref, update, set, get, remove } from 'firebase/database'
// TODO: hrPlayerName is a temporary text input. Replace with playerId resolved from /players once the player roster feature is built out.
import { Link } from 'react-router-dom'
import { HomeButton } from '../components/HomeButton'
import { AuthStatus } from '../components/AuthStatus'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { useMatchup } from '../hooks/useMatchup'
import { useGames } from '../hooks/useGames'
import { InteractiveScoreboard } from '../components/InteractiveScoreboard'
import type { SceneName, TimerState, AtBatRecord } from '../types'
import { computeFinalization } from '../scoring/finalization'

const SCENES: { id: SceneName; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'statCard', label: 'Team Stats' },
  { id: 'matchup', label: 'Matchup' },
  { id: 'standings', label: 'Standings' },
  { id: 'leaderboard', label: 'Leaders' },
  { id: 'idle', label: 'Idle' },
]


export function ControllerRoute() {
  const { game } = useGameData()
  const { teams } = useTeams()
  const { overlay } = useOverlayState()
  const { players } = usePlayers()
  const { matchup } = useMatchup()
  const { games } = useGames()

  const [dismissDelay, setDismissDelay] = useState(20000)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [confirmCancelGame, setConfirmCancelGame] = useState(false)
  const [confirmDevReset, setConfirmDevReset] = useState(false)
  const [confirmSeasonReset, setConfirmSeasonReset] = useState(false)
  const [devResetting, setDevResetting] = useState(false)
  const [forceInning, setForceInning] = useState(1)
  const [forceIsTop, setForceIsTop] = useState(true)
  const [insightsModalOpen, setInsightsModalOpen] = useState(false)
  const [insightsExpanded, setInsightsExpanded] = useState(false)
  const [insightsTitle, setInsightsTitle] = useState('')
  const [insightsPoints, setInsightsPoints] = useState(['', '', '', ''])

  // Stat reminder — nudge the broadcaster if a batter has been set for 30s without showing stats
  const [statReminderBatterId, setStatReminderBatterId] = useState<string | null>(null)
  const statReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks whether stats were shown for the CURRENT at-bat only — cleared when batter changes
  const statsShownThisAtBatRef = useRef<boolean>(false)

  // Overlay dismiss timers. The controller is the only writer, so dismiss
  // scheduling lives here — the /overlay route is strictly read-only.
  const statDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const homerunDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleStatDismiss = (ms: number) => {
    if (statDismissRef.current) clearTimeout(statDismissRef.current)
    if (ms <= 0) return
    statDismissRef.current = setTimeout(() => {
      update(ref(db, 'overlay/statOverlay'), { visible: false })
    }, ms)
  }

  const scheduleHomerunDismiss = (ms: number) => {
    if (homerunDismissRef.current) clearTimeout(homerunDismissRef.current)
    homerunDismissRef.current = setTimeout(() => {
      update(ref(db, 'overlay/homerun'), { active: false })
    }, ms)
  }

  useEffect(() => () => {
    if (statDismissRef.current) clearTimeout(statDismissRef.current)
    if (homerunDismissRef.current) clearTimeout(homerunDismissRef.current)
  }, [])

  useEffect(() => {
    // New batter — reset the shown flag and clear any pending reminder
    if (statReminderTimerRef.current) clearTimeout(statReminderTimerRef.current)
    setStatReminderBatterId(null)
    statsShownThisAtBatRef.current = false

    if (!matchup.batterId) return
    // If stats were already shown this at-bat, don't start the timer
    if (statsShownThisAtBatRef.current) return

    const id = matchup.batterId
    statReminderTimerRef.current = setTimeout(() => {
      if (!statsShownThisAtBatRef.current) setStatReminderBatterId(id)
    }, 30000)
    return () => { if (statReminderTimerRef.current) clearTimeout(statReminderTimerRef.current) }
  }, [matchup.batterId])

  useEffect(() => {
    // Stats shown for this at-bat — cancel the reminder for the rest of this at-bat only
    if (overlay.statOverlay.visible && overlay.statOverlay.playerId === matchup.batterId) {
      statsShownThisAtBatRef.current = true
      if (statReminderTimerRef.current) clearTimeout(statReminderTimerRef.current)
      setStatReminderBatterId(null)
    }
  }, [overlay.statOverlay.visible, overlay.statOverlay.playerId])

  // Auto-clear batter notch when bases or outs change.
  // Skip when a scorekeeper game is linked — the scorekeeper owns batter state in that case
  // and will set the next batter itself after each play.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    if (game.currentGameId) return  // scorekeeper is driving — don't interfere
    if (matchup.batterId) update(ref(db, 'game/matchup'), { batterId: null })
  }, [game.outs, game.bases.first, game.bases.second, game.bases.third])

  const setOuts = (outs: number) => {
    update(ref(db, 'game/meta'), { outs })
  }

  const toggleBase = (base: 'first' | 'second' | 'third') => {
    update(ref(db, 'game/meta/bases'), { [base]: !game.bases[base] })
  }

  const setTeam = (side: 'home' | 'away', teamId: string) => {
    const key = side === 'home' ? 'homeTeamId' : 'awayTeamId'
    update(ref(db, 'game/meta'), { [key]: teamId })
  }

  const selectLiveGame = async (newGameId: string | null) => {
    const prevGameId = game.currentGameId ?? null

    // Flip isStreamed flags
    const flagUpdates: Record<string, unknown> = {
      'game/meta/currentGameId': newGameId,
    }
    if (prevGameId && prevGameId !== newGameId) {
      flagUpdates[`games/${prevGameId}/isStreamed`] = false
    }
    if (newGameId) {
      flagUpdates[`games/${newGameId}/isStreamed`] = true
    }
    await update(ref(db), flagUpdates)

    // Immediately sync new game's state to /game/meta so scorebug reflects it
    if (newGameId) {
      const [gameSnap, runnersSnap] = await Promise.all([
        get(ref(db, `games/${newGameId}`)),
        get(ref(db, `liveRunners/${newGameId}`)),
      ])
      if (gameSnap.exists()) {
        const g = gameSnap.val()
        const runners = runnersSnap.exists() ? runnersSnap.val() : { first: null, second: null, third: null }
        await update(ref(db, 'game/meta'), {
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          homeScore: g.homeScore ?? 0,
          awayScore: g.awayScore ?? 0,
          inning: g.inning ?? 1,
          isTopInning: g.isTopInning ?? true,
          outs: g.outs ?? 0,
          isActive: true,
        })
        await update(ref(db, 'game/meta/bases'), {
          first: !!runners.first,
          second: !!runners.second,
          third: !!runners.third,
        })
      }
    }
  }

  const advanceHalfInning = () => {
    if (game.isTopInning) {
      // Top → bottom: home now bats, away now fields
      update(ref(db, 'game/meta'), { isTopInning: false, outs: 0 })
      update(ref(db, 'game/matchup'), { batterId: null, pitcherId: matchup.lastPitcherAway ?? null })
    } else {
      // Bottom → top: away now bats, home now fields
      update(ref(db, 'game/meta'), { isTopInning: true, inning: game.inning + 1, outs: 0 })
      update(ref(db, 'game/matchup'), { batterId: null, pitcherId: matchup.lastPitcherHome ?? null })
    }
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
  }

  const rewindHalfInning = () => {
    if (!game.isTopInning) {
      update(ref(db, 'game/meta'), { isTopInning: true, outs: 0 })
    } else {
      update(ref(db, 'game/meta'), { isTopInning: false, inning: Math.max(1, game.inning - 1), outs: 0 })
    }
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
  }


  const finalizeGame = async () => {
    const gameId = game.currentGameId
    if (!gameId) return
    setFinalizing(true)
    try {
      // Read game metadata to find previously-finalized games
      const gamesSnap = await get(ref(db, 'games'))
      const allGames: Record<string, { finalized: boolean; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; inning: number; isTopInning: boolean; outs: number; date: string; isStreamed: boolean; startedAt: number }> = gamesSnap.exists() ? gamesSnap.val() : {}
      const thisGame = allGames[gameId]
      if (!thisGame) return

      // Read at-bats from all previously-finalized games
      const prevGameEntries = Object.entries(allGames)
        .filter(([id, g]) => g.finalized && id !== gameId)

      const previousGames: Record<string, typeof thisGame & { finalized: boolean }> = {}
      const previousAtBats: Array<AtBatRecord & { gameId: string }> = []
      for (const [gId, gRecord] of prevGameEntries) {
        previousGames[gId] = gRecord
        const snap = await get(ref(db, `gameStats/${gId}`))
        if (snap.exists()) {
          const records = snap.val() as Record<string, AtBatRecord>
          for (const ab of Object.values(records)) {
            previousAtBats.push({ ...ab, gameId: gId })
          }
        }
      }

      // Read current game at-bats
      const currentSnap = await get(ref(db, `gameStats/${gameId}`))
      const currentGameAtBats: AtBatRecord[] = currentSnap.exists()
        ? Object.values(currentSnap.val() as Record<string, AtBatRecord>)
        : []

      // Compute stats
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

      await update(ref(db), updates)
    } finally {
      setFinalizing(false)
      setConfirmFinalize(false)
    }
  }

  // ── Dev actions ──────────────────────────────────────────────────────────
  const devCancelGame = async () => {
    const gameId = game.currentGameId
    if (!gameId) return
    await Promise.all([
      remove(ref(db, `games/${gameId}`)),
      remove(ref(db, `gameStats/${gameId}`)),
      remove(ref(db, `liveRunners/${gameId}`)),
      update(ref(db, 'game/meta'), { currentGameId: null }),
    ])
    setConfirmCancelGame(false)
  }

  const devClearAtBats = async () => {
    const gameId = game.currentGameId
    if (!gameId) return
    await remove(ref(db, `gameStats/${gameId}`))
  }

  const devResetRunners = async () => {
    const gameId = game.currentGameId
    if (!gameId) return
    await set(ref(db, `liveRunners/${gameId}`), { first: null, second: null, third: null })
  }

  const resetSeasonStats = async () => {
    const snap = await get(ref(db, 'players'))
    if (!snap.exists()) return
    const updates: Record<string, null> = {}
    const playerIds = Object.keys(snap.val() as Record<string, unknown>)
    for (const id of playerIds) {
      updates[`players/${id}/stats`] = null
    }
    await update(ref(db), updates)
    setConfirmSeasonReset(false)
  }

  const devFullReset = async () => {
    setDevResetting(true)
    try {
      const mod = await import('../../firebase-snapshot.json')
      await set(ref(db, '/'), mod.default)
      setConfirmDevReset(false)
    } catch {
      alert('firebase-snapshot.json not found. Run "npm run snapshot" from the terminal first.')
    } finally {
      setDevResetting(false)
    }
  }

  const devForceInning = () => {
    update(ref(db, 'game/meta'), { inning: forceInning, isTopInning: forceIsTop, outs: 0 })
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
  }

  const triggerHomerun = () => {
    if (!matchup.batterId) return
    const battingTeam = game.isTopInning ? 'away' : 'home'
    const runsScored = 1
      + (game.bases.first ? 1 : 0)
      + (game.bases.second ? 1 : 0)
      + (game.bases.third ? 1 : 0)

    const scoreKey = game.isTopInning ? 'awayScore' : 'homeScore'
    const currentScore = game.isTopInning ? game.awayScore : game.homeScore
    update(ref(db, 'game/meta'), { [scoreKey]: currentScore + runsScored })
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })

    set(ref(db, 'overlay/homerun'), {
      active: true,
      teamSide: battingTeam,
      playerId: matchup.batterId,
      logoUrl: battingTeamObj?.logoUrl ?? '',
      runsScored,
      triggeredAt: Date.now(),
    })
    scheduleHomerunDismiss(10_000)
  }

  const timerPreset = (ms: number) => {
    set(ref(db, 'overlay/timer'), { durationMs: ms, startedAt: null, running: false })
  }

  const timerStart = () => {
    update(ref(db, 'overlay/timer'), { startedAt: Date.now(), running: true })
  }

  const timerStop = () => {
    // Freeze remaining time so display stays where it stopped
    const t = overlay.timer
    const elapsed = t.startedAt != null ? Date.now() - t.startedAt : 0
    const remaining = Math.max(0, t.durationMs - elapsed)
    set(ref(db, 'overlay/timer'), { durationMs: remaining, startedAt: null, running: false })
  }

  const timerReset = () => {
    set(ref(db, 'overlay/timer'), { durationMs: 0, startedAt: null, running: false })
  }

  const setScene = (scene: SceneName) => {
    update(ref(db, 'overlay'), { activeScene: scene })
  }

  const showBatterStats = () => {
    if (!matchup.batterId) return
    set(ref(db, 'overlay/statOverlay'), { visible: true, type: 'hitter', playerId: matchup.batterId, dismissAfterMs: dismissDelay })
    scheduleStatDismiss(dismissDelay)
  }

  const showPitcherStats = () => {
    if (!matchup.pitcherId) return
    set(ref(db, 'overlay/statOverlay'), { visible: true, type: 'pitcher', playerId: matchup.pitcherId, dismissAfterMs: dismissDelay })
    scheduleStatDismiss(dismissDelay)
  }

  const dismissStatOverlay = () => {
    if (statDismissRef.current) clearTimeout(statDismissRef.current)
    update(ref(db, 'overlay/statOverlay'), { visible: false })
  }

  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const battingTeamId = game.isTopInning ? game.awayTeamId : game.homeTeamId
  const battingTeamObj = game.isTopInning ? awayTeam : homeTeam

  const fieldingTeamId = game.isTopInning ? game.homeTeamId : game.awayTeamId

  const matchupBatterPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === battingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const matchupPitcherPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === fieldingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const selectBatter = (playerId: string) => {
    if (!playerId) {
      update(ref(db, 'game/matchup'), { batterId: null })
      return
    }
    update(ref(db, 'game/matchup'), { batterId: playerId })
    set(ref(db, 'overlay/statOverlay'), { visible: true, type: 'hitter', playerId, dismissAfterMs: 20000 })
    scheduleStatDismiss(20000)
  }

  const selectPitcher = (playerId: string) => {
    if (!playerId) {
      update(ref(db, 'game/matchup'), { pitcherId: null })
      return
    }
    const pitcher = players[playerId]
    const isHome = pitcher?.teamId === game.homeTeamId
    update(ref(db, 'game/matchup'), {
      pitcherId: playerId,
      ...(isHome ? { lastPitcherHome: playerId } : { lastPitcherAway: playerId }),
    })
  }

  return (
    <div
      className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HomeButton />
          <h1
            className="text-white text-2xl font-black uppercase tracking-widest truncate"
            style={{ fontFamily: 'var(--font-score)' }}
          >
            Broadcast Control
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/config"
            className="text-sm font-semibold transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-ui)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
          >
            ⚙ Teams
          </Link>
          <AuthStatus />
        </div>
      </div>

      {/* ── INTERACTIVE SCOREBOARD (full width, top) ── */}
      <div className="mb-4">
        <InteractiveScoreboard
          game={game}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teams={teams}
          onSetOuts={setOuts}
          onToggleBase={toggleBase}
          onAdvanceHalfInning={advanceHalfInning}
          onRewindHalfInning={rewindHalfInning}
          onSetTeam={setTeam}
          readOnly={!!game.currentGameId}
        />
      </div>

      {/* ── BROADCAST CONTROLS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">

        {/* ── LEFT COLUMN ── */}
        <div className="flex flex-col gap-4">

          {/* SCENE SWITCHER */}
          <Section title="Scene">
            <div className="grid grid-cols-2 gap-3">
              {SCENES.map((s) => (
                <TouchBtn
                  key={s.id}
                  onClick={() => { setScene(s.id); setInsightsExpanded(false) }}
                  active={overlay.activeScene === s.id}
                  className="h-16 text-base font-bold"
                >
                  {s.label}
                </TouchBtn>
              ))}
              {/* Insights — toggles staging panel instead of switching scene directly */}
              <TouchBtn
                onClick={() => setInsightsExpanded(prev => !prev)}
                active={insightsExpanded || overlay.activeScene === 'insights'}
                className="h-16 text-base font-bold"
              >
                Insights
              </TouchBtn>
            </div>

            {/* Insights staging panel */}
            {insightsExpanded && (() => {
              const isLive = overlay.activeScene === 'insights'
              const totalPoints = [overlay.insights?.point1, overlay.insights?.point2, overlay.insights?.point3, overlay.insights?.point4]
                .filter(p => p && p.trim() !== '').length
              const shown = overlay.insights?.visibleCount ?? 0
              return (
                <div
                  className="rounded-xl p-3 flex flex-col gap-3 mt-1"
                  style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)' }}
                >
                  {/* Show / Hide */}
                  <div className="flex gap-2">
                    {!isLive ? (
                      <button
                        onClick={() => {
                          update(ref(db, 'overlay/insights'), { visibleCount: 0 })
                          update(ref(db, 'overlay'), { activeScene: 'insights' })
                        }}
                        className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider"
                        style={{ background: '#16a34a', color: '#fff' }}
                      >
                        Show Insights
                      </button>
                    ) : (
                      <button
                        onClick={() => update(ref(db, 'overlay'), { activeScene: 'game' })}
                        className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider"
                        style={{ background: '#b91c1c', color: '#fff' }}
                      >
                        Hide Insights
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setInsightsTitle(overlay.insights?.title ?? 'Game Insights')
                        setInsightsPoints([
                          overlay.insights?.point1 ?? '',
                          overlay.insights?.point2 ?? '',
                          overlay.insights?.point3 ?? '',
                          overlay.insights?.point4 ?? '',
                        ])
                        setInsightsModalOpen(true)
                      }}
                      className="h-12 px-4 rounded-xl font-semibold text-sm uppercase tracking-wider"
                      style={{ background: 'rgba(96,165,250,0.15)', color: 'rgba(96,165,250,0.9)', border: '1px solid rgba(96,165,250,0.3)' }}
                    >
                      Edit
                    </button>
                  </div>

                  {/* Point controls — only when live */}
                  {isLive && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => update(ref(db, 'overlay/insights'), { visibleCount: Math.min(shown + 1, totalPoints) })}
                        disabled={shown >= totalPoints}
                        className="flex-1 h-11 rounded-xl font-bold text-sm uppercase tracking-wider"
                        style={{
                          background: shown < totalPoints ? '#1d4ed8' : '#1c2333',
                          color: shown < totalPoints ? '#fff' : 'rgba(255,255,255,0.3)',
                          cursor: shown < totalPoints ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Next Point ({shown}/{totalPoints})
                      </button>
                      <button
                        onClick={() => update(ref(db, 'overlay/insights'), { visibleCount: 0 })}
                        className="h-11 px-4 rounded-xl font-bold text-sm uppercase tracking-wider"
                        style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
                      >
                        Reset
                      </button>
                    </div>
                  )}

                  {isLive && (
                    <p className="text-green-400 text-xs text-center" style={{ fontFamily: 'var(--font-ui)' }}>
                      Insights scene is live
                    </p>
                  )}
                </div>
              )
            })()}
          </Section>

          {/* AT BAT */}
          <Section title="At Bat">
            <div className="flex flex-col gap-3">

              {game.currentGameId ? (
                /* Scorekeeper-managed mode — batter + pitcher are read-only */
                <>
                  <p className="text-white/30 text-xs text-center uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                    Managed by scorekeeper
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg px-3 py-2 flex flex-col gap-0.5" style={{ background: '#1c2333', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Batter</span>
                      <span className="text-white font-semibold text-sm truncate">
                        {matchup.batterId ? (players[matchup.batterId]?.name ?? matchup.batterId) : '—'}
                      </span>
                    </div>
                    <div className="rounded-lg px-3 py-2 flex flex-col gap-0.5" style={{ background: '#1c2333', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Pitcher</span>
                      <span className="text-white font-semibold text-sm truncate">
                        {matchup.pitcherId ? (players[matchup.pitcherId]?.name ?? matchup.pitcherId) : '—'}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                /* Manual mode — dropdowns for non-scorekeeper games */
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                      🏏 Batter — {battingTeamObj?.shortName ?? '...'}
                    </span>
                    <select
                      value={matchup.batterId ?? ''}
                      onChange={e => selectBatter(e.target.value)}
                      className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                      style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                    >
                      <option value="">— Select batter —</option>
                      {matchupBatterPlayers.map(([id, p]) => (
                        <option key={id} value={id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                      ⚾ Pitcher — {(game.isTopInning ? homeTeam : awayTeam)?.shortName ?? '...'}
                    </span>
                    <select
                      value={matchup.pitcherId ?? ''}
                      onChange={e => selectPitcher(e.target.value)}
                      className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                      style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                    >
                      <option value="">— Select pitcher —</option>
                      {matchupPitcherPlayers.map(([id, p]) => (
                        <option key={id} value={id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Home Run button — only shown when no scorekeeper is managing the game.
                  When a scorekeeper is linked, home runs are triggered automatically on submit. */}
              {!game.currentGameId && (
                <button
                  onClick={triggerHomerun}
                  disabled={!matchup.batterId}
                  className="w-full h-14 rounded-xl font-black text-base uppercase tracking-widest transition-all"
                  style={{
                    background: matchup.batterId ? 'linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)' : '#1c2333',
                    color: matchup.batterId ? '#fff' : 'rgba(255,255,255,0.3)',
                    border: matchup.batterId ? '2px solid #ef4444' : '2px solid transparent',
                    boxShadow: matchup.batterId ? '0 0 24px rgba(239,68,68,0.35)' : 'none',
                    fontFamily: 'var(--font-score)',
                    letterSpacing: '0.12em',
                    cursor: matchup.batterId ? 'pointer' : 'not-allowed',
                  }}
                  onMouseEnter={e => { if (matchup.batterId) e.currentTarget.style.boxShadow = '0 0 36px rgba(239,68,68,0.6)' }}
                  onMouseLeave={e => { if (matchup.batterId) e.currentTarget.style.boxShadow = '0 0 24px rgba(239,68,68,0.35)' }}
                >
                  ⚾ HOME RUN
                </button>
              )}

              <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

              <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

              {/* Stat reminder nudge */}
              {statReminderBatterId && statReminderBatterId === matchup.batterId && (
                <div
                  className="stat-reminder-flash rounded-xl px-3 py-2.5 flex items-center justify-between gap-3"
                  style={{ border: '1px solid' }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 16 }}>📺</span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-score)', color: '#000' }}>
                        Stats not shown yet
                      </p>
                      <p className="text-xs font-semibold" style={{ color: 'rgba(0,0,0,0.7)' }}>
                        {players[statReminderBatterId]?.name ?? 'Batter'} is up — show their stats?
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setStatReminderBatterId(null)}
                    style={{ color: 'rgba(0,0,0,0.5)', fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Stat overlay controls */}
              <div className="flex items-center gap-2">
                <span className="text-white/40 text-xs uppercase tracking-widest shrink-0" style={{ fontFamily: 'var(--font-score)' }}>Dismiss after</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={dismissDelay / 1000}
                  onChange={e => setDismissDelay(Math.max(1, Number(e.target.value)) * 1000)}
                  className="w-16 h-9 rounded-lg px-2 text-center text-sm font-bold"
                  style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                />
                <span className="text-white/40 text-xs shrink-0">sec</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={showBatterStats}
                  disabled={!matchup.batterId}
                  className={`flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider transition-all ${statReminderBatterId === matchup.batterId ? 'stat-reminder-flash' : ''}`}
                  style={{
                    background: statReminderBatterId === matchup.batterId ? undefined : matchup.batterId ? '#1d4ed8' : '#1c2333',
                    color: matchup.batterId ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: matchup.batterId ? 'pointer' : 'not-allowed',
                    border: statReminderBatterId === matchup.batterId ? undefined : '1px solid transparent',
                  }}
                >
                  Batter Stats
                </button>
                <button
                  onClick={showPitcherStats}
                  disabled={!matchup.pitcherId}
                  className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider transition-all"
                  style={{
                    background: matchup.pitcherId ? '#1d4ed8' : '#1c2333',
                    color: matchup.pitcherId ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: matchup.pitcherId ? 'pointer' : 'not-allowed',
                  }}
                >
                  Pitcher Stats
                </button>
                <button
                  onClick={dismissStatOverlay}
                  className="h-12 px-4 rounded-xl font-bold text-sm uppercase tracking-wider transition-all"
                  style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
                >
                  Dismiss
                </button>
              </div>
              {overlay.statOverlay.visible && (
                <p className="text-green-400 text-xs text-center" style={{ fontFamily: 'var(--font-ui)' }}>
                  Stat overlay is live
                </p>
              )}

            </div>
          </Section>

        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="flex flex-col gap-4">

          {/* GAME */}
          <Section title="Game">
            <div className="flex flex-col gap-3">

              {/* Live game selector */}
              <div className="flex flex-col gap-1">
                <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                  Live Game (scorebug)
                </span>
                <select
                  value={game.currentGameId ?? ''}
                  onChange={e => selectLiveGame(e.target.value || null)}
                  className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                  style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                >
                  <option value="">— None —</option>
                  {games.filter(({ game: g }) => !g.finalized).map(({ gameId, game: g }) => {
                    const home = teams[g.homeTeamId]?.shortName ?? g.homeTeamId
                    const away = teams[g.awayTeamId]?.shortName ?? g.awayTeamId
                    return (
                      <option key={gameId} value={gameId}>
                        {away} @ {home}{g.isStreamed ? ' 📡' : ''}
                      </option>
                    )
                  })}
                </select>
                {game.currentGameId && (
                  <p className="text-green-400 text-xs font-semibold">{game.currentGameId}</p>
                )}
              </div>

              {!confirmFinalize ? (
                <TouchBtn
                  onClick={() => setConfirmFinalize(true)}
                  className="h-11 text-sm font-bold"
                  disabled={!game.currentGameId}
                >
                  Finalize Game &amp; Update Stats
                </TouchBtn>
              ) : (
                <div
                  className="rounded-xl px-3 py-3 flex flex-col gap-2"
                  style={{ background: '#1c1010', border: '1px solid #7f1d1d' }}
                >
                  <p className="text-red-300 text-xs font-semibold text-center">
                    This overwrites all player season stats. Are you sure?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={finalizeGame}
                      disabled={finalizing}
                      className="flex-1 h-10 rounded-lg font-bold text-sm uppercase tracking-wider"
                      style={{ background: '#b91c1c', color: '#fff' }}
                    >
                      {finalizing ? 'Computing…' : 'Finalize'}
                    </button>
                    <button
                      onClick={() => setConfirmFinalize(false)}
                      disabled={finalizing}
                      className="flex-1 h-10 rounded-lg font-semibold text-sm"
                      style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* TIMER */}
          <Section title="Countdown Timer">
            <TimerControl
              timer={overlay.timer}
              onPreset={timerPreset}
              onStart={timerStart}
              onStop={timerStop}
              onReset={timerReset}
            />
          </Section>

          {/* DEV — SCOREBUG CONTROLS (temporary) */}
          <CollapsibleSection title="⚙️ Dev: Scorebug">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>Pill border</span>
                <button
                  onClick={() => update(ref(db, 'overlay'), { scoreboardBorder: !overlay.scoreboardBorder })}
                  className="px-5 h-10 rounded-lg font-semibold text-sm"
                  style={{
                    background: overlay.scoreboardBorder ? '#16a34a' : '#374151',
                    color: '#fff',
                  }}
                >
                  {overlay.scoreboardBorder ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <span style={{ fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>Size scale</span>
                  <span style={{ fontFamily: 'var(--font-ui)', color: '#fff', fontSize: 14 }}>{overlay.scoreboardScale.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={overlay.scoreboardScale}
                  onChange={(e) => update(ref(db, 'overlay'), { scoreboardScale: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* DEV TOOLS */}
          {import.meta.env.DEV && (
            <CollapsibleSection title="⚠️ Dev Tools">
              <div className="flex flex-col gap-2">

                {/* Full Firebase reset from snapshot */}
                {!confirmDevReset ? (
                  <button
                    onClick={() => setConfirmDevReset(true)}
                    className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(127,29,29,0.5)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
                  >
                    Reset Firebase to Snapshot
                  </button>
                ) : (
                  <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #7f1d1d' }}>
                    <p className="text-red-300 text-xs text-center font-semibold">
                      Wipes ALL Firebase data and restores clean snapshot. Cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={devFullReset}
                        disabled={devResetting}
                        className="flex-1 h-9 rounded-lg text-xs font-bold uppercase"
                        style={{ background: '#b91c1c', color: '#fff' }}
                      >
                        {devResetting ? 'Resetting…' : 'Reset Everything'}
                      </button>
                      <button
                        onClick={() => setConfirmDevReset(false)}
                        disabled={devResetting}
                        className="flex-1 h-9 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Clear at-bat log */}
                <button
                  onClick={devClearAtBats}
                  disabled={!game.currentGameId}
                  className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Clear at-bat log
                </button>

                {/* Reset live runners */}
                <button
                  onClick={devResetRunners}
                  disabled={!game.currentGameId}
                  className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Reset live runners
                </button>

                {/* Force set inning */}
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    max={9}
                    value={forceInning}
                    onChange={e => setForceInning(Number(e.target.value))}
                    className="w-16 h-10 rounded-xl text-center text-sm font-bold"
                    style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                  />
                  <button
                    onClick={() => setForceIsTop(t => !t)}
                    className="h-10 px-3 rounded-xl text-xs font-bold"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)', minWidth: 48 }}
                  >
                    {forceIsTop ? '▲ Top' : '▼ Bot'}
                  </button>
                  <button
                    onClick={devForceInning}
                    className="flex-1 h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    Force Set Inning
                  </button>
                </div>

                {/* Cancel game */}
                {!confirmCancelGame ? (
                  <button
                    onClick={() => setConfirmCancelGame(true)}
                    disabled={!game.currentGameId}
                    className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(127,29,29,0.3)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    Cancel Game
                  </button>
                ) : (
                  <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #7f1d1d' }}>
                    <p className="text-red-300 text-xs text-center font-semibold">
                      Delete game record + all logs. No stats written.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={devCancelGame}
                        className="flex-1 h-9 rounded-lg text-xs font-bold uppercase"
                        style={{ background: '#b91c1c', color: '#fff' }}
                      >
                        Cancel Game
                      </button>
                      <button
                        onClick={() => setConfirmCancelGame(false)}
                        className="flex-1 h-9 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {/* Season stats reset */}
                {!confirmSeasonReset ? (
                  <button
                    onClick={() => setConfirmSeasonReset(true)}
                    className="w-full h-10 rounded-xl text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(127,29,29,0.5)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
                  >
                    Wipe Season Stats
                  </button>
                ) : (
                  <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid #7f1d1d' }}>
                    <p className="text-red-300 text-xs text-center font-semibold">
                      Clears /players/*/stats for ALL players. At-bat records are preserved. Cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={resetSeasonStats}
                        className="flex-1 h-9 rounded-lg text-xs font-bold uppercase"
                        style={{ background: '#b91c1c', color: '#fff' }}
                      >
                        Wipe Stats
                      </button>
                      <button
                        onClick={() => setConfirmSeasonReset(false)}
                        className="flex-1 h-9 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </CollapsibleSection>
          )}

          {/* END GAME */}
          <button
            onClick={() => update(ref(db, 'game/meta'), { isActive: false })}
            className="w-full h-12 rounded-xl text-sm font-semibold uppercase tracking-wider"
            style={{ background: '#1c2333', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            End Game
          </button>

        </div>
      </div>

      {/* ── RESET GAME ── */}
      <div className="mt-4">
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full h-11 rounded-xl text-sm font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Reset Game
          </button>
        ) : (
          <div
            className="rounded-2xl px-4 py-3 flex flex-col gap-3"
            style={{ background: '#1c1010', border: '1px solid #7f1d1d' }}
          >
            <p className="text-red-300 text-sm font-semibold text-center" style={{ fontFamily: 'var(--font-ui)' }}>
              This will clear all scores, inning, outs, and bases. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  update(ref(db, 'game/meta'), { homeScore: 0, awayScore: 0, inning: 1, isTopInning: true, outs: 0 })
                  update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
                  setConfirmReset(false)
                }}
                className="flex-1 h-11 rounded-xl font-bold text-sm uppercase tracking-wider"
                style={{ background: '#b91c1c', color: '#fff', border: '1px solid #ef4444' }}
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="flex-1 h-11 rounded-xl font-semibold text-sm uppercase tracking-wider"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── INSIGHTS MODAL ── */}
      {insightsModalOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setInsightsModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2
              className="text-white text-sm font-bold uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-score)' }}
            >
              Edit Insights
            </h2>

            <div className="flex flex-col gap-1">
              <label className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                Title
              </label>
              <input
                type="text"
                value={insightsTitle}
                onChange={e => setInsightsTitle(e.target.value)}
                placeholder="Game Insights"
                className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              />
            </div>

            {insightsPoints.map((point, i) => (
              <div key={i} className="flex flex-col gap-1">
                <label className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                  Point {i + 1}
                </label>
                <input
                  type="text"
                  value={point}
                  onChange={e => {
                    const next = [...insightsPoints]
                    next[i] = e.target.value
                    setInsightsPoints(next)
                  }}
                  placeholder={`Bullet point ${i + 1}`}
                  className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                  style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                />
              </div>
            ))}

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  update(ref(db, 'overlay/insights'), {
                    title: insightsTitle,
                    point1: insightsPoints[0],
                    point2: insightsPoints[1],
                    point3: insightsPoints[2],
                    point4: insightsPoints[3],
                  })
                  setInsightsModalOpen(false)
                }}
                className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider"
                style={{ background: '#1d4ed8', color: '#fff' }}
              >
                Save
              </button>
              <button
                onClick={() => setInsightsModalOpen(false)}
                className="flex-1 h-12 rounded-xl font-semibold text-sm uppercase tracking-wider"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

/* ── Sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <h2 className="text-white/50 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/5"
      >
        <h2 className="text-white/40 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
          {title}
        </h2>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  )
}

interface TouchBtnProps {
  onClick: () => void
  active?: boolean
  className?: string
  children: React.ReactNode
  disabled?: boolean
}

interface TimerControlProps {
  timer: TimerState
  onPreset: (ms: number) => void
  onStart: () => void
  onStop: () => void
  onReset: () => void
}

function TimerControl({ timer, onPreset, onStart, onStop, onReset }: TimerControlProps) {
  const [, setTick] = useState(0)
  const [customMins, setCustomMins] = useState('60')

  useEffect(() => {
    if (!timer.running) return
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [timer.running])

  const elapsed = timer.running && timer.startedAt != null ? Date.now() - timer.startedAt : 0
  const remaining = Math.max(0, timer.durationMs - elapsed)
  const totalSecs = Math.ceil(remaining / 1000)
  const displayMins = Math.floor(totalSecs / 60)
  const displaySecs = totalSecs % 60
  const display = `${displayMins}:${displaySecs.toString().padStart(2, '0')}`

  const handleCustomSet = () => {
    const mins = parseFloat(customMins)
    if (!isNaN(mins) && mins > 0) onPreset(Math.round(mins * 60_000))
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="number"
        min="1"
        step="0.5"
        value={customMins}
        onChange={e => setCustomMins(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleCustomSet()}
        className="h-11 rounded-lg px-3 text-base font-semibold text-center shrink-0"
        style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', width: 72 }}
      />
      <span className="text-white/40 text-sm shrink-0" style={{ fontFamily: 'var(--font-ui)' }}>min</span>
      <button
        onClick={handleCustomSet}
        className="h-11 px-3 rounded-lg font-semibold text-sm uppercase tracking-wider shrink-0"
        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        Set
      </button>
      <span
        className="text-white font-black tabular-nums flex-1 text-center"
        style={{ fontFamily: 'var(--font-score)', fontSize: 22 }}
      >
        {display}
      </span>
      {!timer.running ? (
        <button
          onClick={onStart}
          className="h-11 px-4 rounded-xl font-bold text-sm uppercase tracking-wider shrink-0"
          style={{ background: '#16a34a', color: '#fff' }}
        >
          Start
        </button>
      ) : (
        <button
          onClick={onStop}
          className="h-11 px-4 rounded-xl font-bold text-sm uppercase tracking-wider shrink-0"
          style={{ background: '#b45309', color: '#fff' }}
        >
          Pause
        </button>
      )}
      <button
        onClick={onReset}
        className="h-11 px-3 rounded-xl font-bold text-sm uppercase tracking-wider shrink-0"
        style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
      >
        Reset
      </button>
    </div>
  )
}

function TouchBtn({ onClick, active, className = '', children, disabled }: TouchBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl font-semibold transition-all select-none ${className}`}
      style={{
        background: active ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.07)',
        color: active ? '#fff' : 'rgba(255,255,255,0.75)',
        border: active ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
        minHeight: 48,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

