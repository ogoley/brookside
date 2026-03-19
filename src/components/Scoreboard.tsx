import { useState, useEffect } from 'react'
import type { GameMeta, Team, TimerState } from '../types'
import { OutIndicator } from './OutIndicator'
import { BaseDiamond } from './BaseDiamond'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
  timer?: TimerState
}

function useCountdown(timer?: TimerState): string {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!timer?.running) return
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [timer?.running])

  const elapsed = timer?.running && timer.startedAt != null
    ? Date.now() - timer.startedAt
    : 0
  const remaining = Math.max(0, (timer?.durationMs ?? 0) - elapsed)
  const totalSecs = Math.ceil(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function Scoreboard({ game, homeTeam, awayTeam, timer }: Props) {
  const countdown = useCountdown(timer)

  const awayPrimary = 'var(--team-away-primary)'
  const awaySecondary = 'var(--team-away-secondary)'
  const homePrimary = 'var(--team-home-primary)'
  const homeSecondary = 'var(--team-home-secondary)'

  return (
    // No outer background — pills and center each own their own bg
    <div className="flex items-stretch" style={{ height: 52 }}>

      {/* ── Away pill (left) ── */}
      <div
        className="flex items-center justify-between gap-2 pl-4 pr-3 rounded-l-full shrink-0"
        style={{ background: awayPrimary, minWidth: 156 }}
      >
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 14 }}
        >
          {awayTeam?.shortName ?? '---'}
        </span>
        {awayTeam?.logoUrl && (
          <img src={awayTeam.logoUrl} alt="" style={{ height: 44, width: 44, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 26 }}
        >
          {game.awayScore}
        </span>
      </div>

      {/* ── Center neutral ── */}
      <div
        className="flex items-stretch flex-1"
        style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
      >
        {/* Inning ▲/▼ — flex-1 cell */}
        <div className="flex-1 flex flex-col items-center justify-center" style={{ fontFamily: 'var(--font-score)', lineHeight: 1 }}>
          <span style={{ fontSize: 10, color: game.isTopInning ? '#facc15' : 'rgba(255,255,255,0.18)' }}>▲</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{game.inning}</span>
          <span style={{ fontSize: 10, color: !game.isTopInning ? '#facc15' : 'rgba(255,255,255,0.18)' }}>▼</span>
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Timer — flex-1 cell, always visible */}
        <div className="flex-1 flex items-center justify-center">
          <span
            className="tabular-nums"
            style={{ fontFamily: 'var(--font-score)', color: '#fff', fontSize: 15, fontWeight: 700 }}
          >
            {countdown}
          </span>
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Bases — flex-1 cell */}
        <div className="flex-1 flex items-center justify-center">
          <BaseDiamond bases={game.bases} />
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Outs — flex-1 cell, circles scaled up to match */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid',
                  borderColor: i < game.outs ? '#facc15' : 'rgba(255,255,255,0.5)',
                  background: i < game.outs ? '#facc15' : 'transparent',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Home pill (right) ── */}
      <div
        className="flex items-center justify-between gap-2 pr-4 pl-3 rounded-r-full shrink-0"
        style={{ background: homePrimary, minWidth: 156 }}
      >
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 26 }}
        >
          {game.homeScore}
        </span>
        {homeTeam?.logoUrl && (
          <img src={homeTeam.logoUrl} alt="" style={{ height: 44, width: 44, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 14 }}
        >
          {homeTeam?.shortName ?? '---'}
        </span>
      </div>

    </div>
  )
}
