import { motion } from 'framer-motion'
import type { DerbyTimerState } from '../types'
import { formatDerbyClock } from '../derby/logic'
import { useDerbyClock } from '../hooks/useDerbyTimer'
import { DERBY_CLOCK_TOP, DERBY_COL_X, DERBY_COL_W } from '../scenes/derby/layout'

interface Props {
  timer: DerbyTimerState
  /** Hitter the clock belongs to — shown above the number when known */
  playerName?: string
}

const GOLD = '#fbbf24'
const RED = '#f87171'
const SKY = '#38bdf8'

/**
 * Derby turn clock — the hitter's 90 seconds plus their one 30-second timeout.
 * Read-only like every other overlay graphic: the number is derived from
 * `startedAt`, and only the controller ever writes the state behind it.
 */
export function DerbyTurnClock({ timer: stored, playerName }: Props) {
  const { timer, remainingMs: remaining } = useDerbyClock(stored)
  const inTimeout = timer.phase === 'timeout'

  const phaseDuration = inTimeout ? timer.timeoutDurationMs : timer.durationMs
  const pct = phaseDuration > 0 ? Math.max(0, Math.min(1, remaining / phaseDuration)) : 0

  const expired = !inTimeout && remaining <= 0
  const low = !inTimeout && !expired && remaining <= 10_000
  // At 0:00 the hitter still has the money ball coming — that reads gold, not
  // red: the turn isn't over, the best pitch of it is on the way
  const moneyBallLive = expired && timer.moneyBallAt == null
  const accent = inTimeout ? SKY : moneyBallLive ? GOLD : expired || low ? RED : GOLD

  // The turn clock is frozen at `remainingMs` while the timeout runs — the
  // running segment belongs to the timeout, so this is the value as-is
  const frozenTurn = timer.remainingMs

  const moneyBallHit = timer.moneyBallAt != null

  const label = inTimeout
    ? 'Timeout'
    : expired
      ? moneyBallLive ? 'Final pitch' : "Time's up"
      : timer.running
        ? 'Time remaining'
        : 'Clock stopped'

  return (
    <motion.div
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -40, opacity: 0 }}
      transition={{ type: 'spring', damping: 26, stiffness: 240 }}
      style={{
        position: 'absolute', top: DERBY_CLOCK_TOP, left: DERBY_COL_X,
        width: DERBY_COL_W, boxSizing: 'border-box',
        background: 'rgba(8,13,24,0.95)',
        borderRadius: 14,
        borderLeft: `6px solid ${accent}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        padding: '14px 18px 12px',
        pointerEvents: 'none',
      }}
    >
      {/* Label + hitter */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
          letterSpacing: '0.2em', textTransform: 'uppercase', color: accent, lineHeight: 1,
        }}>
          {label}
        </span>
        {!timer.running && !expired && (
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)', lineHeight: 1,
          }}>
            Paused
          </span>
        )}
      </div>

      {playerName && (
        <div style={{
          fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 800,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.6)', lineHeight: 1.2, marginTop: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {playerName}
        </div>
      )}

      {/* The number. The last-10s pulse is a CSS class, not a JS animation:
          this card re-renders 10×/s, and a framer `animate` prop would be
          rebuilt on every one of those renders */}
      <div
        className={low && timer.running ? 'derby-clock-pulse' : undefined}
        style={{
          fontFamily: 'var(--font-score)', fontSize: 78, fontWeight: 900,
          lineHeight: 1, marginTop: 2, letterSpacing: '0.01em',
          color: expired || low || inTimeout ? accent : '#ffffff',
          textShadow: `0 4px 24px ${accent}55`,
          fontVariantNumeric: 'tabular-nums',
          transformOrigin: 'left center',
        }}
      >
        {formatDerbyClock(remaining)}
      </div>

      {/* Depleting bar — `scaleX`, never `width`. Width would force layout on
          every one of the ~10 ticks a second for the whole 90-second turn */}
      <div style={{
        height: 8, borderRadius: 4, marginTop: 8,
        background: 'rgba(255,255,255,0.10)', overflow: 'hidden',
      }}>
        <div
          style={{
            height: '100%', width: '100%', borderRadius: 4,
            background: `linear-gradient(90deg, ${accent}, ${accent}88)`,
            transform: `scaleX(${pct})`,
            transformOrigin: 'left center',
            transition: 'transform 0.12s linear',
            willChange: 'transform',
          }}
        />
      </div>

      {/* Footer: what the timeout is doing */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginTop: 10,
      }}>
        {moneyBallLive || moneyBallHit ? (
          <span
            className={moneyBallLive ? 'derby-clock-pulse' : undefined}
            style={{
              fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: GOLD, boxShadow: `0 0 10px ${GOLD}`,
            }} />
            {moneyBallHit ? 'Money ball +3' : 'Money ball in play'}
          </span>
        ) : inTimeout ? (
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
          }}>
            {formatDerbyClock(frozenTurn)} left after
          </span>
        ) : (
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: timer.timeoutUsed ? 'rgba(255,255,255,0.3)' : GOLD,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: timer.timeoutUsed ? 'rgba(255,255,255,0.25)' : GOLD,
              boxShadow: timer.timeoutUsed ? 'none' : `0 0 8px ${GOLD}`,
            }} />
            {timer.timeoutUsed ? 'Timeout used' : '30s timeout'}
          </span>
        )}
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800,
          letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)',
        }}>
          Derby
        </span>
      </div>
    </motion.div>
  )
}
