import { useState, useEffect } from 'react'
import type { GameMeta, Team, TimerState } from '../types'
import { BaseDiamond } from './BaseDiamond'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
  timer?: TimerState
  showBorder?: boolean
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

export function Scoreboard({ game, homeTeam, awayTeam, timer, showBorder = true }: Props) {
  const countdown = useCountdown(timer)

  const awayPrimary = 'var(--team-away-primary)'
  const awaySecondary = 'var(--team-away-secondary)'
  const homePrimary = 'var(--team-home-primary)'
  const homeSecondary = 'var(--team-home-secondary)'

  return (
    // No outer background — pills and center each own their own bg
    <div className="inline-flex items-stretch" style={{ height: 140 }}>

      {/* ── Away pill (left) — SCORE | LOGO | NAME ── */}
      <div
        className="flex items-center justify-between gap-2 pl-6 pr-4 rounded-l-full"
        style={{ background: awayPrimary, width: 320, flexShrink: 0 }}
      >
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 76, ...(showBorder && { WebkitTextStroke: '1.5px #ffffff' }) }}
        >
          {game.awayScore}
        </span>
        {awayTeam?.logoUrl && (
          <img src={awayTeam.logoUrl} alt="" style={{ height: 112, width: 112, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 44, opacity: 0.85, ...(showBorder && { WebkitTextStroke: '1.5px #ffffff' }) }}
        >
          {awayTeam?.shortName ?? '---'}
        </span>
      </div>

      {/* ── Center neutral ── */}
      <div className="relative">
        <div
          className="flex items-stretch h-full"
          style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
        >
          {/* Inning */}
          <div className="flex items-center justify-center gap-2" style={{ width: 150, flexShrink: 0, fontFamily: 'var(--font-score)', lineHeight: 1 }}>
            <span style={{ fontSize: 64, fontWeight: 800, color: '#fff' }}>{game.inning}</span>
            <span style={{ fontSize: 34, color: '#facc15', lineHeight: 1 }}>
              {game.isTopInning ? '▲' : '▼'}
            </span>
          </div>

          <div className="w-px bg-white/15 my-3" />

          {/* Bases */}
          <div className="flex items-center justify-center" style={{ width: 150, flexShrink: 0 }}>
            <BaseDiamond bases={game.bases} size={80} />
          </div>

          <div className="w-px bg-white/15 my-3" />

          {/* Outs */}
          <div className="flex items-center justify-center" style={{ width: 150, flexShrink: 0 }}>
            <div className="flex items-center gap-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 46, height: 46, borderRadius: '50%',
                    border: '4px solid',
                    borderColor: i < game.outs ? '#facc15' : '#ffffff',
                    background: i < game.outs ? '#facc15' : 'transparent',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Timer — notch below the center pill, same background */}
        <div className="absolute left-0 right-0 flex justify-center" style={{ top: '100%' }}>
          <div style={{
            background: 'rgba(0,0,0,0.82)',
            backdropFilter: 'blur(4px)',
            borderRadius: '0 0 8px 8px',
            padding: '3px 14px',
          }}>
            <span
              className="tabular-nums"
              style={{ fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.6)', fontSize: 20, fontWeight: 700, letterSpacing: '0.05em' }}
            >
              {countdown}
            </span>
          </div>
        </div>
      </div>

      {/* ── Home pill (right) — NAME | LOGO | SCORE ── */}
      <div
        className="flex items-center justify-between gap-2 pr-6 pl-4 rounded-r-full"
        style={{ background: homePrimary, width: 320, flexShrink: 0 }}
      >
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 44, opacity: 0.85, ...(showBorder && { WebkitTextStroke: '1.5px #ffffff' }) }}
        >
          {homeTeam?.shortName ?? '---'}
        </span>
        {homeTeam?.logoUrl && (
          <img src={homeTeam.logoUrl} alt="" style={{ height: 112, width: 112, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 76, ...(showBorder && { WebkitTextStroke: '1.5px #ffffff' }) }}
        >
          {game.homeScore}
        </span>
      </div>

    </div>
  )
}
