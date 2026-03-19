import { useRef } from 'react'
import type { GameMeta, Team } from '../types'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
  onScoreChange: (side: 'home' | 'away', delta: number) => void
  onSetOuts: (outs: number) => void
  onToggleBase: (base: 'first' | 'second' | 'third') => void
  onReset: () => void
  onAdvanceHalfInning: () => void
  onRewindHalfInning: () => void
}

export function InteractiveScoreboard({
  game, homeTeam, awayTeam,
  onScoreChange, onSetOuts, onToggleBase,
  onReset, onAdvanceHalfInning, onRewindHalfInning,
}: Props) {
  const longPressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startLongPress = (side: 'home' | 'away', delta: number) => {
    if (longPressRef.current) return
    longPressRef.current = setInterval(() => onScoreChange(side, delta), 150)
  }
  const stopLongPress = () => {
    if (longPressRef.current) {
      clearInterval(longPressRef.current)
      longPressRef.current = null
    }
  }

  const homePrimary = 'var(--team-home-primary)'
  const homeSecondary = 'var(--team-home-secondary)'
  const awayPrimary = 'var(--team-away-primary)'
  const awaySecondary = 'var(--team-away-secondary)'

  return (
    <div
      className="rounded-2xl overflow-hidden w-full"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
    >
      {/* Single row on sm+, stacked on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-stretch">

        {/* ── AWAY ── */}
        <TeamScorePanel
          team={awayTeam}
          score={game.awayScore}
          primary={awayPrimary}
          secondary={awaySecondary}
          side="away"
          onScoreChange={onScoreChange}
          onLongStart={startLongPress}
          onLongEnd={stopLongPress}
        />

        {/* ── CENTER: inning / bases / outs ── */}
        <div className="flex items-center justify-center gap-4 sm:gap-5 px-4 py-3 sm:flex-1">

          {/* Inning — two half-inning step buttons flanking the display */}
          <div className="flex items-center gap-2">
            <HalfInningBtn onClick={onRewindHalfInning} direction="back" />
            <div
              className="flex flex-col items-center w-10 select-none"
              style={{ fontFamily: 'var(--font-score)' }}
            >
              <span style={{ fontSize: 10, color: game.isTopInning ? '#facc15' : 'rgba(255,255,255,0.22)', lineHeight: 1 }}>▲</span>
              <span className="text-white text-2xl font-bold leading-tight">{game.inning}</span>
              <span style={{ fontSize: 10, color: !game.isTopInning ? '#facc15' : 'rgba(255,255,255,0.22)', lineHeight: 1 }}>▼</span>
            </div>
            <HalfInningBtn onClick={onAdvanceHalfInning} direction="forward" />
          </div>

          <Divider />

          {/* Bases diamond */}
          <div
            className="flex flex-col items-center gap-0.5"
            style={{ width: 64, height: 64 }}
          >
            <div className="flex justify-center">
              <TapBase active={game.bases.second} onClick={() => onToggleBase('second')} />
            </div>
            <div className="flex justify-between w-full">
              <TapBase active={game.bases.third} onClick={() => onToggleBase('third')} />
              <TapBase active={game.bases.first} onClick={() => onToggleBase('first')} />
            </div>
          </div>

          <Divider />

          {/* Outs + reset */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  onClick={() => onSetOuts(game.outs === i + 1 ? i : i + 1)}
                  className="w-9 h-9 flex items-center justify-center rounded-full select-none"
                  style={{ background: 'transparent', border: 'none' }}
                >
                  <div
                    className="w-5 h-5 rounded-full border-2 transition-colors duration-150 pointer-events-none"
                    style={{
                      background: i < game.outs ? '#facc15' : 'transparent',
                      borderColor: i < game.outs ? '#facc15' : 'rgba(255,255,255,0.45)',
                    }}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={onReset}
              className="uppercase tracking-widest transition-colors hover:text-white/70"
              style={{ fontFamily: 'var(--font-score)', fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1 }}
            >
              Reset
            </button>
          </div>

        </div>

        {/* ── HOME ── */}
        <TeamScorePanel
          team={homeTeam}
          score={game.homeScore}
          primary={homePrimary}
          secondary={homeSecondary}
          side="home"
          mirrored
          onScoreChange={onScoreChange}
          onLongStart={startLongPress}
          onLongEnd={stopLongPress}
        />

      </div>
    </div>
  )
}

/* ── Sub-components ── */

interface TeamScorePanelProps {
  team?: Team
  score: number
  primary: string
  secondary: string
  side: 'home' | 'away'
  mirrored?: boolean
  onScoreChange: (side: 'home' | 'away', delta: number) => void
  onLongStart: (side: 'home' | 'away', delta: number) => void
  onLongEnd: () => void
}

function TeamScorePanel({ team, score, primary, secondary, side, mirrored, onScoreChange, onLongStart, onLongEnd }: TeamScorePanelProps) {
  const colorBlock = (
    <div className="w-12 shrink-0 flex items-center justify-center self-stretch" style={{ background: primary }}>
      {team?.logoUrl ? (
        <img src={team.logoUrl} alt="" className="w-8 h-8 object-contain" />
      ) : (
        <span className="text-base font-bold" style={{ fontFamily: 'var(--font-score)', color: secondary }}>
          {team?.shortName?.slice(0, 1) ?? '?'}
        </span>
      )}
    </div>
  )

  const nameBlock = (
    <div className="px-3 flex items-center self-stretch" style={{ background: primary }}>
      <span className="text-xl font-bold tracking-wide" style={{ fontFamily: 'var(--font-score)', color: secondary }}>
        {team?.shortName ?? '---'}
      </span>
    </div>
  )

  const scoreBlock = (
    <div className="flex items-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <ScoreBtn
        label={mirrored ? '+' : '−'}
        onClick={() => onScoreChange(side, mirrored ? 1 : -1)}
        onLongStart={() => onLongStart(side, mirrored ? 1 : -1)}
        onLongEnd={onLongEnd}
      />
      <span className="text-white text-4xl font-black w-14 text-center select-none" style={{ fontFamily: 'var(--font-score)' }}>
        {score}
      </span>
      <ScoreBtn
        label={mirrored ? '−' : '+'}
        onClick={() => onScoreChange(side, mirrored ? -1 : 1)}
        onLongStart={() => onLongStart(side, mirrored ? -1 : 1)}
        onLongEnd={onLongEnd}
      />
    </div>
  )

  return (
    <div className={`flex items-stretch ${mirrored ? 'flex-row-reverse' : ''}`}>
      {colorBlock}
      {nameBlock}
      {scoreBlock}
    </div>
  )
}

function ScoreBtn({
  label, onClick, onLongStart, onLongEnd,
}: {
  label: string
  onClick: () => void
  onLongStart: () => void
  onLongEnd: () => void
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onLongStart}
      onMouseUp={onLongEnd}
      onMouseLeave={onLongEnd}
      onTouchStart={onLongStart}
      onTouchEnd={onLongEnd}
      className="w-10 h-full min-h-[56px] flex items-center justify-center text-white/50 hover:text-white text-2xl font-bold transition-colors select-none"
    >
      {label}
    </button>
  )
}

function TapBase({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center select-none"
      style={{ background: 'transparent', border: 'none' }}
    >
      <div
        className="w-5 h-5 rotate-45 border-2 transition-colors duration-150 pointer-events-none"
        style={{
          background: active ? '#facc15' : 'transparent',
          borderColor: active ? '#facc15' : 'rgba(255,255,255,0.45)',
        }}
      />
    </button>
  )
}

function HalfInningBtn({ onClick, direction }: { onClick: () => void; direction: 'forward' | 'back' }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center w-10 h-10 rounded-xl select-none transition-colors hover:text-white"
      style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-score)', lineHeight: 1 }}
    >
      <span style={{ fontSize: 13 }}>{direction === 'forward' ? '▶' : '◀'}</span>
      <span style={{ fontSize: 9 }}>½</span>
    </button>
  )
}

function Divider() {
  return <div className="w-px self-stretch bg-white/10" />
}
