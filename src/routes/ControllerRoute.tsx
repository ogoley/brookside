import { useState, useRef, useCallback } from 'react'
import { ref, update, set } from 'firebase/database'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import type { SceneName } from '../types'

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

  const longPressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const adjustScore = useCallback((side: 'home' | 'away', delta: number) => {
    const key = side === 'home' ? 'homeScore' : 'awayScore'
    const current = side === 'home' ? game.homeScore : game.awayScore
    const next = Math.max(0, current + delta)
    update(ref(db, 'game/meta'), { [key]: next })
  }, [game.homeScore, game.awayScore])

  const startLongPress = (side: 'home' | 'away', delta: number) => {
    if (longPressRef.current) return
    longPressRef.current = setInterval(() => adjustScore(side, delta), 150)
  }
  const stopLongPress = () => {
    if (longPressRef.current) {
      clearInterval(longPressRef.current)
      longPressRef.current = null
    }
  }

  const setInning = (delta: number) => {
    const next = Math.max(1, game.inning + delta)
    update(ref(db, 'game/meta'), { inning: next })
  }

  const setOuts = (outs: number) => {
    update(ref(db, 'game/meta'), { outs })
  }

  const toggleBase = (base: 'first' | 'second' | 'third') => {
    update(ref(db, 'game/meta/bases'), { [base]: !game.bases[base] })
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

  const filteredPlayers = Object.entries(players).filter(([, p]) => {
    if (statType === 'pitcher') return p.position === 'pitcher' || p.position === 'both'
    return p.position === 'hitter' || p.position === 'both'
  })

  return (
    <div
      className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
      <h1
        className="text-white text-2xl font-black uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        Broadcast Control
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* ── LEFT COLUMN: game state ── */}
        <div className="flex flex-col gap-4">

          {/* SCORE */}
          <Section title="Score">
            <ScoreControl
              label={awayTeam?.name ?? 'Away'}
              score={game.awayScore}
              onIncrement={() => adjustScore('away', 1)}
              onDecrement={() => adjustScore('away', -1)}
              onLongStart={(d) => startLongPress('away', d)}
              onLongEnd={stopLongPress}
            />
            <ScoreControl
              label={homeTeam?.name ?? 'Home'}
              score={game.homeScore}
              onIncrement={() => adjustScore('home', 1)}
              onDecrement={() => adjustScore('home', -1)}
              onLongStart={(d) => startLongPress('home', d)}
              onLongEnd={stopLongPress}
            />
          </Section>

          {/* INNING */}
          <Section title="Inning">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <TouchBtn onClick={() => setInning(-1)} className="w-14 h-14 text-2xl">◀</TouchBtn>
                <span className="text-white text-3xl font-bold w-24 text-center" style={{ fontFamily: 'var(--font-score)' }}>
                  {game.isTopInning ? 'Top' : 'Bot'} {game.inning}
                </span>
                <TouchBtn onClick={() => setInning(1)} className="w-14 h-14 text-2xl">▶</TouchBtn>
              </div>
              <div className="flex gap-3">
                <TouchBtn
                  onClick={() => update(ref(db, 'game/meta'), { isTopInning: true })}
                  active={game.isTopInning}
                  className="px-5 h-14 text-sm font-semibold"
                >
                  Top
                </TouchBtn>
                <TouchBtn
                  onClick={() => update(ref(db, 'game/meta'), { isTopInning: false })}
                  active={!game.isTopInning}
                  className="px-5 h-14 text-sm font-semibold"
                >
                  Bot
                </TouchBtn>
              </div>
            </div>
          </Section>

          {/* OUTS + BASES side by side on wider screens */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Outs">
              <div className="flex gap-3">
                {[0, 1, 2].map((n) => (
                  <TouchBtn
                    key={n}
                    onClick={() => setOuts(n)}
                    active={game.outs === n}
                    className="flex-1 h-14 text-xl font-bold"
                  >
                    {n}
                  </TouchBtn>
                ))}
              </div>
            </Section>

            <Section title="Bases">
              <div className="flex gap-2 flex-wrap">
                {(['first', 'second', 'third'] as const).map((base) => (
                  <TouchBtn
                    key={base}
                    onClick={() => toggleBase(base)}
                    active={game.bases[base]}
                    className="flex-1 h-14 text-sm font-semibold"
                  >
                    {base === 'first' ? '1B' : base === 'second' ? '2B' : '3B'}
                  </TouchBtn>
                ))}
                <TouchBtn
                  onClick={() => update(ref(db, 'game/meta/bases'), { first: false, second: false, third: false })}
                  className="flex-1 h-14 text-sm font-semibold"
                >
                  Clr
                </TouchBtn>
              </div>
            </Section>
          </div>

        </div>

        {/* ── RIGHT COLUMN: broadcast controls ── */}
        <div className="flex flex-col gap-4">

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

interface ScoreControlProps {
  label: string
  score: number
  onIncrement: () => void
  onDecrement: () => void
  onLongStart: (delta: number) => void
  onLongEnd: () => void
}

function ScoreControl({ label, score, onIncrement, onDecrement, onLongStart, onLongEnd }: ScoreControlProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-white font-semibold text-base flex-1 min-w-0 truncate" style={{ fontFamily: 'var(--font-ui)' }}>
        {label}
      </span>
      <div className="flex items-center gap-4 shrink-0">
        <button
          onClick={onDecrement}
          onMouseDown={() => onLongStart(-1)}
          onMouseUp={onLongEnd}
          onMouseLeave={onLongEnd}
          onTouchStart={() => onLongStart(-1)}
          onTouchEnd={onLongEnd}
          className="w-14 h-14 rounded-xl text-2xl font-bold select-none"
          style={{ background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          −
        </button>
        <span
          className="text-white text-4xl font-black w-14 text-center"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          {score}
        </span>
        <button
          onClick={onIncrement}
          onMouseDown={() => onLongStart(1)}
          onMouseUp={onLongEnd}
          onMouseLeave={onLongEnd}
          onTouchStart={() => onLongStart(1)}
          onTouchEnd={onLongEnd}
          className="w-14 h-14 rounded-xl text-2xl font-bold select-none"
          style={{ background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          +
        </button>
      </div>
    </div>
  )
}
