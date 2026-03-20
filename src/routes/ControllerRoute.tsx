import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, update, set } from 'firebase/database'
// TODO: hrPlayerName is a temporary text input. Replace with playerId resolved from /players once the player roster feature is built out.
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { useMatchup } from '../hooks/useMatchup'
import { InteractiveScoreboard } from '../components/InteractiveScoreboard'
import type { SceneName, TimerState } from '../types'

const SCENES: { id: SceneName; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'statCard', label: 'Stat Card' },
  { id: 'matchup', label: 'Matchup' },
  { id: 'idle', label: 'Idle' },
]

const DELAY_OPTIONS = [3000, 5000, 8000, 10000, 15000]

export function ControllerRoute() {
  const { game } = useGameData()
  const { teams } = useTeams()
  const { overlay } = useOverlayState()
  const { players } = usePlayers()
  const { matchup } = useMatchup()

  const [dismissDelay, setDismissDelay] = useState(5000)
  const [confirmReset, setConfirmReset] = useState(false)

  // Auto-clear batter notch when bases or outs change
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    if (matchup.batterId) update(ref(db, 'game/matchup'), { batterId: null })
  }, [game.outs, game.bases.first, game.bases.second, game.bases.third])

  const adjustScore = useCallback((side: 'home' | 'away', delta: number) => {
    const key = side === 'home' ? 'homeScore' : 'awayScore'
    const current = side === 'home' ? game.homeScore : game.awayScore
    const next = Math.max(0, current + delta)
    update(ref(db, 'game/meta'), { [key]: next })
  }, [game.homeScore, game.awayScore])

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

  const newGame = () => {
    update(ref(db, 'game/meta'), {
      homeScore: 0, awayScore: 0,
      inning: 1, isTopInning: true, outs: 0,
    })
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
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
  }

  const showPitcherStats = () => {
    if (!matchup.pitcherId) return
    set(ref(db, 'overlay/statOverlay'), { visible: true, type: 'pitcher', playerId: matchup.pitcherId, dismissAfterMs: dismissDelay })
  }

  const dismissStatOverlay = () => {
    update(ref(db, 'overlay/statOverlay'), { visible: false })
  }

  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const battingTeamId = game.isTopInning ? game.awayTeamId : game.homeTeamId
  const battingTeamObj = game.isTopInning ? awayTeam : homeTeam

  const fieldingTeamId = game.isTopInning ? game.homeTeamId : game.awayTeamId

  const matchupBatterPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === battingTeamId && (p.position === 'hitter' || p.position === 'both'))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const matchupPitcherPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === fieldingTeamId && (p.position === 'pitcher' || p.position === 'both'))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const selectBatter = (playerId: string) => {
    if (!playerId) {
      update(ref(db, 'game/matchup'), { batterId: null })
      return
    }
    update(ref(db, 'game/matchup'), { batterId: playerId })
    set(ref(db, 'overlay/statOverlay'), { visible: true, type: 'hitter', playerId, dismissAfterMs: 20000 })
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
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-white text-2xl font-black uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          Broadcast Control
        </h1>
        <Link
          to="/config"
          className="text-sm font-semibold transition-colors"
          style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-ui)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
        >
          ⚙ Teams
        </Link>
      </div>

      {/* ── INTERACTIVE SCOREBOARD (full width, top) ── */}
      <div className="mb-4">
        <InteractiveScoreboard
          game={game}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teams={teams}
          onScoreChange={adjustScore}
          onSetOuts={setOuts}
          onToggleBase={toggleBase}
          onAdvanceHalfInning={advanceHalfInning}
          onRewindHalfInning={rewindHalfInning}
          onSetTeam={setTeam}
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
                  onClick={() => setScene(s.id)}
                  active={overlay.activeScene === s.id}
                  className="h-16 text-base font-bold"
                >
                  {s.label}
                </TouchBtn>
              ))}
            </div>
          </Section>

          {/* AT BAT */}
          <Section title="At Bat">
            <div className="flex flex-col gap-3">

              {/* Batter */}
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

              {/* Home Run button */}
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

              <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

              {/* Pitcher */}
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

              <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

              {/* Stat overlay controls */}
              <div className="flex gap-2 flex-wrap">
                {DELAY_OPTIONS.map((ms) => (
                  <TouchBtn
                    key={ms}
                    onClick={() => setDismissDelay(ms)}
                    active={dismissDelay === ms}
                    className="flex-1 h-10 text-sm font-semibold min-w-[48px]"
                  >
                    {ms / 1000}s
                  </TouchBtn>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={showBatterStats}
                  disabled={!matchup.batterId}
                  className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider transition-all"
                  style={{
                    background: matchup.batterId ? '#1d4ed8' : '#1c2333',
                    color: matchup.batterId ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: matchup.batterId ? 'pointer' : 'not-allowed',
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
          <Section title="⚙️ Dev: Scorebug">
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
          </Section>

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
                onClick={() => { newGame(); setConfirmReset(false) }}
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

