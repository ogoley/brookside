import { useState, useEffect, useCallback } from 'react'
import { ref, update, set } from 'firebase/database'
// TODO: hrPlayerName is a temporary text input. Replace with playerId resolved from /players once the player roster feature is built out.
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { InteractiveScoreboard } from '../components/InteractiveScoreboard'
import { TeamPillPreview } from '../components/TeamPillPreview'
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

  const [statType, setStatType] = useState<'hitter' | 'pitcher'>('hitter')
  const [selectedPlayer, setSelectedPlayer] = useState('')
  const [dismissDelay, setDismissDelay] = useState(5000)
  const [hrPlayerId, setHrPlayerId] = useState('')

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

  const resetInning = () => {
    update(ref(db, 'game/meta'), { outs: 0 })
    update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })
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
      update(ref(db, 'game/meta'), { isTopInning: false, outs: 0 })
    } else {
      update(ref(db, 'game/meta'), { isTopInning: true, inning: game.inning + 1, outs: 0 })
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
    if (!hrPlayerId) return
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
      playerId: hrPlayerId,
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

  const showStatOverlay = () => {
    if (!selectedPlayer) return
    set(ref(db, 'overlay/statOverlay'), {
      visible: true,
      type: statType,
      playerId: selectedPlayer,
      dismissAfterMs: dismissDelay,
    })
  }

  const dismissStatOverlay = () => {
    update(ref(db, 'overlay/statOverlay'), { visible: false })
  }

  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const battingTeamId = game.isTopInning ? game.awayTeamId : game.homeTeamId
  const battingTeamObj = game.isTopInning ? awayTeam : homeTeam
  const battingPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === battingTeamId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  // Reset HR player selection when batting team changes
  useEffect(() => { setHrPlayerId('') }, [battingTeamId])

  const filteredPlayers = Object.entries(players).filter(([, p]) => {
    if (statType === 'pitcher') return p.position === 'pitcher' || p.position === 'both'
    return p.position === 'hitter' || p.position === 'both'
  })

  return (
    <div
      className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
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

      {/* ── MATCH SETUP ── */}
      <Section title="Match">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Away */}
          <div className="flex flex-col gap-2">
            <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Away</span>
            <select
              value={game.awayTeamId}
              onChange={e => setTeam('away', e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm font-medium"
              style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <option value="">— Select team —</option>
              {Object.entries(teams).map(([id, t]) => (
                <option key={id} value={id}>{t.name}</option>
              ))}
            </select>
            {awayTeam && <TeamPillPreview team={awayTeam} score={game.awayScore} />}
          </div>

          {/* Home */}
          <div className="flex flex-col gap-2">
            <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Home</span>
            <select
              value={game.homeTeamId}
              onChange={e => setTeam('home', e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm font-medium"
              style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <option value="">— Select team —</option>
              {Object.entries(teams).map(([id, t]) => (
                <option key={id} value={id}>{t.name}</option>
              ))}
            </select>
            {homeTeam && <TeamPillPreview team={homeTeam} score={game.homeScore} />}
          </div>
        </div>

        <button
          onClick={newGame}
          className="w-full h-11 rounded-xl font-bold text-sm uppercase tracking-wider mt-1"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          New Game — Reset Score, Inning &amp; Bases
        </button>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* ── LEFT COLUMN: interactive scoreboard ── */}
        <div className="flex flex-col gap-4">
          <InteractiveScoreboard
            game={game}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            onScoreChange={adjustScore}
            onSetOuts={setOuts}
            onToggleBase={toggleBase}
            onReset={resetInning}
            onAdvanceHalfInning={advanceHalfInning}
            onRewindHalfInning={rewindHalfInning}
          />
        </div>

        {/* ── RIGHT COLUMN: broadcast controls ── */}
        <div className="flex flex-col gap-4">

          {/* HOME RUN */}
          <Section title="Home Run">
            <div className="flex flex-col gap-3">
              <select
                value={hrPlayerId}
                onChange={e => setHrPlayerId(e.target.value)}
                className="w-full h-11 rounded-lg px-3 text-sm font-medium"
                style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select batter —</option>
                {battingPlayers.map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={triggerHomerun}
                disabled={!hrPlayerId}
                className="w-full h-16 rounded-xl font-black text-lg uppercase tracking-widest transition-all"
                style={{
                  background: hrPlayerId ? 'linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)' : '#1c2333',
                  color: hrPlayerId ? '#fff' : 'rgba(255,255,255,0.3)',
                  border: hrPlayerId ? '2px solid #ef4444' : '2px solid transparent',
                  boxShadow: hrPlayerId ? '0 0 24px rgba(239,68,68,0.35)' : 'none',
                  fontFamily: 'var(--font-score)',
                  letterSpacing: '0.12em',
                  cursor: hrPlayerId ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={e => { if (hrPlayerId) e.currentTarget.style.boxShadow = '0 0 36px rgba(239,68,68,0.6)' }}
                onMouseLeave={e => { if (hrPlayerId) e.currentTarget.style.boxShadow = '0 0 24px rgba(239,68,68,0.35)' }}
              >
                ⚾ HOME RUN
              </button>
              <p className="text-white/25 text-xs text-center" style={{ fontFamily: 'var(--font-ui)' }}>
                Filtered to batting team · auto-scores bases loaded · 10s overlay
              </p>
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

          {/* STAT OVERLAY */}
          <Section title="Stat Overlay">
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <TouchBtn
                  onClick={() => setStatType('hitter')}
                  active={statType === 'hitter'}
                  className="flex-1 h-12 text-sm font-semibold"
                >
                  Hitter
                </TouchBtn>
                <TouchBtn
                  onClick={() => setStatType('pitcher')}
                  active={statType === 'pitcher'}
                  className="flex-1 h-12 text-sm font-semibold"
                >
                  Pitcher
                </TouchBtn>
              </div>

              <select
                value={selectedPlayer}
                onChange={(e) => setSelectedPlayer(e.target.value)}
                className="w-full h-12 rounded-lg px-3 text-sm font-medium"
                style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select player —</option>
                {filteredPlayers.map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.name} ({teams[p.teamId]?.shortName ?? p.teamId})
                  </option>
                ))}
              </select>

              <div className="flex gap-2 flex-wrap">
                {DELAY_OPTIONS.map((ms) => (
                  <TouchBtn
                    key={ms}
                    onClick={() => setDismissDelay(ms)}
                    active={dismissDelay === ms}
                    className="flex-1 h-12 text-sm font-semibold min-w-[52px]"
                  >
                    {ms / 1000}s
                  </TouchBtn>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={showStatOverlay}
                  disabled={!selectedPlayer}
                  className="flex-1 h-14 rounded-xl text-white font-bold text-base uppercase tracking-wider transition-all"
                  style={{
                    background: selectedPlayer ? '#2563eb' : '#1c2333',
                    color: selectedPlayer ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: selectedPlayer ? 'pointer' : 'not-allowed',
                  }}
                >
                  ▶ Show Stats
                </button>
                <button
                  onClick={dismissStatOverlay}
                  className="h-14 px-6 rounded-xl font-bold text-sm uppercase tracking-wider transition-all"
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

