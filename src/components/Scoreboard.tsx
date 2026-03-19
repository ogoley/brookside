import { useState, useEffect } from 'react'
import type { GameMeta, Team, TimerState } from '../types'
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
    <div className="inline-flex items-stretch" style={{ height: 70 }}>

      {/* ── Away pill (left) — SCORE | LOGO | NAME ── */}
      <div
        className="flex items-center justify-between gap-1 pl-3 pr-2 rounded-l-full"
        style={{ background: awayPrimary, width: 160, flexShrink: 0 }}
      >
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 38 }}
        >
          {game.awayScore}
        </span>
        {awayTeam?.logoUrl && (
          <img src={awayTeam.logoUrl} alt="" style={{ height: 46, width: 46, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: awaySecondary, fontSize: 17, opacity: 0.85 }}
        >
          {awayTeam?.shortName ?? '---'}
        </span>
      </div>

      {/* ── Center neutral ── */}
      <div
        className="flex items-stretch"
        style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
      >
        {/* Inning */}
        <div className="flex items-center justify-center gap-1 px-3" style={{ fontFamily: 'var(--font-score)', lineHeight: 1 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{game.inning}</span>
          <span style={{ fontSize: 14, color: '#facc15', lineHeight: 1 }}>
            {game.isTopInning ? '▲' : '▼'}
          </span>
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Timer */}
        <div className="flex items-center justify-center px-3">
          <span
            className="tabular-nums"
            style={{ fontFamily: 'var(--font-score)', color: '#fff', fontSize: 18, fontWeight: 700 }}
          >
            {countdown}
          </span>
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Bases */}
        <div className="flex items-center justify-center px-3">
          <BaseDiamond bases={game.bases} />
        </div>

        <div className="w-px bg-white/15 my-2" />

        {/* Outs */}
        <div className="flex items-center justify-center px-3">
          <div className="flex items-center gap-1.5">
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  width: 17, height: 17, borderRadius: '50%',
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

      {/* ── Home pill (right) — NAME | LOGO | SCORE ── */}
      <div
        className="flex items-center justify-between gap-1 pr-3 pl-2 rounded-r-full"
        style={{ background: homePrimary, width: 160, flexShrink: 0 }}
      >
        <span
          className="font-bold tracking-wide truncate leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 17, opacity: 0.85 }}
        >
          {homeTeam?.shortName ?? '---'}
        </span>
        {homeTeam?.logoUrl && (
          <img src={homeTeam.logoUrl} alt="" style={{ height: 46, width: 46, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span
          className="font-black leading-none shrink-0"
          style={{ fontFamily: 'var(--font-score)', color: homeSecondary, fontSize: 38 }}
        >
          {game.homeScore}
        </span>
      </div>

    </div>
  )
}
