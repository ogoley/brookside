import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { GameMeta, Team, TimerState, MatchupState, PlayersMap } from '../types'
import { BaseDiamond } from './BaseDiamond'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
  timer?: TimerState
  showBorder?: boolean
  matchup?: MatchupState
  players?: PlayersMap
  statOverlayVisible?: boolean
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

function WiffleBall() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="10" fill="white" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      <circle cx="8"  cy="9"  r="1.8" fill="rgba(0,0,0,0.18)" />
      <circle cx="14" cy="9"  r="1.8" fill="rgba(0,0,0,0.18)" />
      <circle cx="11" cy="14" r="1.8" fill="rgba(0,0,0,0.18)" />
    </svg>
  )
}

function WiffleBat() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* barrel */}
      <rect x="9" y="1" width="5" height="12" rx="2.5" fill="#facc15" />
      {/* handle taper */}
      <rect x="10" y="12" width="3" height="6" rx="1.5" fill="#facc15" />
      {/* knob */}
      <ellipse cx="11" cy="19" rx="3" ry="2" fill="#facc15" />
    </svg>
  )
}

function PlayerNotch({
  name,
  type,
  primaryColor,
  id,
}: {
  name: string
  type: 'batter' | 'pitcher'
  primaryColor: string
  id: string
}) {
  const lastName = name.trim().split(' ').slice(1).join(' ') || name.trim()
  return (
    <div className="absolute left-0 right-0 flex justify-center" style={{ top: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={id}
          initial={{ y: '-100%', scaleX: 0.4, opacity: 0 }}
          animate={{ y: 0, scaleX: 1, opacity: 1 }}
          exit={{ y: '-100%', scaleX: 0.4, opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } }}
          transition={{
            y:       { type: 'spring', damping: 10, stiffness: 300 },
            scaleX:  { type: 'spring', damping: 12, stiffness: 260 },
            opacity: { duration: 0.12 },
          }}
          style={{
            background: primaryColor,
            borderRadius: '0 0 12px 12px',
            paddingTop: 40,
            paddingBottom: 6,
            paddingLeft: 18,
            paddingRight: 18,
            marginTop: -36,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
            transformOrigin: 'top center',
            originY: 0,
          }}
        >
          <span style={{ lineHeight: 1 }}>
            {type === 'batter' ? <WiffleBat /> : <WiffleBall />}
          </span>
          <span style={{
            fontFamily: 'var(--font-score)',
            color: '#fff',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}>
            {lastName}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function Scoreboard({ game, homeTeam, awayTeam, timer, showBorder = true, matchup, players, statOverlayVisible }: Props) {
  const countdown = useCountdown(timer)

  const awayPrimary = 'var(--team-away-primary)'
  const awaySecondary = 'var(--team-away-secondary)'
  const homePrimary = 'var(--team-home-primary)'
  const homeSecondary = 'var(--team-home-secondary)'

  // Derive batter/pitcher notch visibility
  const battingTeamId  = game.isTopInning ? game.awayTeamId : game.homeTeamId
  const fieldingTeamId = game.isTopInning ? game.homeTeamId : game.awayTeamId

  const batter  = matchup?.batterId  ? players?.[matchup.batterId]  : undefined
  const pitcher = matchup?.pitcherId ? players?.[matchup.pitcherId] : undefined

  // Batter notch: only show after stat overlay dismisses
  const showBatterNotch = !!batter && !statOverlayVisible && batter.teamId === battingTeamId
  // Pitcher notch: only show if pitcher is on the fielding team
  const showPitcherNotch = !!pitcher && pitcher.teamId === fieldingTeamId

  const awayIsBatting = game.isTopInning
  const awayNotch = awayIsBatting
    ? (showBatterNotch  ? { type: 'batter'  as const, name: batter!.name,  color: awayPrimary, id: matchup!.batterId! } : null)
    : (showPitcherNotch ? { type: 'pitcher' as const, name: pitcher!.name, color: awayPrimary, id: matchup!.pitcherId! } : null)
  const homeNotch = awayIsBatting
    ? (showPitcherNotch ? { type: 'pitcher' as const, name: pitcher!.name, color: homePrimary, id: matchup!.pitcherId! } : null)
    : (showBatterNotch  ? { type: 'batter'  as const, name: batter!.name,  color: homePrimary, id: matchup!.batterId! } : null)

  return (
    <div className="inline-flex items-stretch" style={{ height: 140 }}>

      {/* ── Away pill (left) ── */}
      <div className="relative" style={{ flexShrink: 0 }}>
        <div
          className="flex items-center justify-between gap-2 pl-6 pr-4 rounded-l-full h-full"
          style={{ background: awayPrimary, width: 320, position: 'relative', zIndex: 1 }}
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
        <AnimatePresence>
          {awayNotch && <PlayerNotch key={awayNotch.id} name={awayNotch.name} type={awayNotch.type} primaryColor={awayNotch.color} id={awayNotch.id} />}
        </AnimatePresence>
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

        {/* Timer notch */}
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

      {/* ── Home pill (right) ── */}
      <div className="relative" style={{ flexShrink: 0 }}>
        <div
          className="flex items-center justify-between gap-2 pr-6 pl-4 rounded-r-full h-full"
          style={{ background: homePrimary, width: 320, position: 'relative', zIndex: 1 }}
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
        <AnimatePresence>
          {homeNotch && <PlayerNotch key={homeNotch.id} name={homeNotch.name} type={homeNotch.type} primaryColor={homeNotch.color} id={homeNotch.id} />}
        </AnimatePresence>
      </div>

    </div>
  )
}
