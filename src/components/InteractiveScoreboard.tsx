import { useRef } from 'react'
import type { GameMeta, Team, TeamsMap } from '../types'
import { TeamColorInjector } from './TeamColorInjector'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
  teams: TeamsMap
  onScoreChange: (side: 'home' | 'away', delta: number) => void
  onSetOuts: (outs: number) => void
  onToggleBase: (base: 'first' | 'second' | 'third') => void
  onReset: () => void
  onAdvanceHalfInning: () => void
  onRewindHalfInning: () => void
  onSetTeam: (side: 'home' | 'away', teamId: string) => void
}

export function InteractiveScoreboard({
  game, homeTeam, awayTeam, teams,
  onScoreChange, onSetOuts, onToggleBase,
  onReset, onAdvanceHalfInning, onRewindHalfInning, onSetTeam,
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
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />
      {/* Single row on sm+, stacked on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-stretch">

        {/* ── AWAY ── */}
        <TeamScorePanel
          team={awayTeam}
          teamId={game.awayTeamId}
          teams={teams}
          score={game.awayScore}
          primary={awayPrimary}
          secondary={awaySecondary}
          side="away"
          onScoreChange={onScoreChange}
          onLongStart={startLongPress}
          onLongEnd={stopLongPress}
          onSetTeam={onSetTeam}
        />

        {/* ── CENTER: inning / bases / outs ── */}
        <div className="flex items-center justify-center gap-4 sm:gap-5 px-4 py-3 sm:flex-1">

          {/* Inning — two half-inning step buttons flanking the display */}
          <div className="flex items-center gap-2">
            <HalfInningBtn onClick={onRewindHalfInning} direction="back" />
            <div className="flex items-center gap-1 select-none" style={{ fontFamily: 'var(--font-score)' }}>
              <span className="text-white font-black leading-none" style={{ fontSize: 36 }}>{game.inning}</span>
              <span style={{ fontSize: 20, color: '#facc15', lineHeight: 1 }}>
                {game.isTopInning ? '▲' : '▼'}
              </span>
            </div>
            <HalfInningBtn onClick={onAdvanceHalfInning} direction="forward" />
          </div>

          <Divider />

          {/* Bases diamond */}
          <div
            className="flex flex-col items-center gap-0.5 rounded-xl p-1"
            style={{ width: 72, height: 72, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.05)' }}
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
            <div
              className="flex items-center gap-1 rounded-xl px-2 py-2"
              style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.05)' }}
            >
              {[0, 1].map((i) => (
                <button
                  key={i}
                  onClick={() => onSetOuts(game.outs === i + 1 ? i : i + 1)}
                  className="w-9 h-9 flex items-center justify-center rounded-full select-none transition-colors hover:bg-white/10"
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
              onClick={onAdvanceHalfInning}
              className="uppercase tracking-widest transition-all hover:bg-white/10"
              style={{
                fontFamily: 'var(--font-score)', fontSize: 9,
                color: 'rgba(255,255,255,0.55)', lineHeight: 1,
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, padding: '4px 10px',
              }}
            >
              Advance
            </button>
          </div>

        </div>

        {/* ── HOME ── */}
        <TeamScorePanel
          team={homeTeam}
          teamId={game.homeTeamId}
          teams={teams}
          score={game.homeScore}
          primary={homePrimary}
          secondary={homeSecondary}
          side="home"
          mirrored
          onScoreChange={onScoreChange}
          onLongStart={startLongPress}
          onLongEnd={stopLongPress}
          onSetTeam={onSetTeam}
        />

      </div>
    </div>
  )
}

/* ── Sub-components ── */

interface TeamScorePanelProps {
  team?: Team
  teamId: string
  teams: TeamsMap
  score: number
  primary: string
  secondary: string
  side: 'home' | 'away'
  mirrored?: boolean
  onScoreChange: (side: 'home' | 'away', delta: number) => void
  onLongStart: (side: 'home' | 'away', delta: number) => void
  onLongEnd: () => void
  onSetTeam: (side: 'home' | 'away', teamId: string) => void
}

function TeamScorePanel({ team, teamId, teams, score, primary, secondary, side, mirrored, onScoreChange, onLongStart, onLongEnd, onSetTeam }: TeamScorePanelProps) {
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
    <div className="flex items-center self-stretch relative" style={{ background: primary }}>
      <select
        value={teamId}
        onChange={e => onSetTeam(side, e.target.value)}
        style={{
          background: 'rgba(0,0,0,0.2)',
          color: secondary,
          fontFamily: 'var(--font-score)',
          fontSize: 15,
          fontWeight: 700,
          border: 'none',
          borderBottom: `2px solid rgba(255,255,255,0.35)`,
          outline: 'none',
          paddingLeft: 10,
          paddingRight: 24,
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          width: '100%',
          margin: '0 6px',
          borderRadius: 4,
        }}
      >
        <option value="" style={{ background: '#1c2333', color: '#fff' }}>— Select —</option>
        {Object.entries(teams).map(([id, t]) => (
          <option key={id} value={id} style={{ background: '#1c2333', color: '#fff' }}>{t.shortName}</option>
        ))}
      </select>
      {/* Custom dropdown caret */}
      <span style={{ position: 'absolute', right: 14, color: secondary, opacity: 0.7, fontSize: 10, pointerEvents: 'none' }}>▾</span>
    </div>
  )

  const scoreBlock = (
    <div className="flex items-center" style={{ background: 'rgba(255,255,255,0.06)', borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
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
      className="w-10 h-full min-h-[56px] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 active:bg-white/20 text-2xl font-bold transition-colors select-none"
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
