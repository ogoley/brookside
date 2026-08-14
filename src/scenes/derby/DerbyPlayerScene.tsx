import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Team, DerbyRoundNum, DerbyRoundScores } from '../../types'
import { ROUND_KEY } from '../../derby/logic'
import { DERBY_COL_X } from './layout'

interface Props {
  name: string
  seasonHr: number
  team?: Team
  scores: DerbyRoundScores
  activeRound: DerbyRoundNum
  /** Timestamp of the hitter's money ball, if they took it — the +3 it scores
   *  belongs to the full-screen money-ball graphic, not the usual burst */
  moneyBallAt?: number | null
  /** Whoever is throwing to them. Omitted when the producer hasn't set one. */
  pitcher?: string
}

const ROUND_NUMS: DerbyRoundNum[] = [1, 2, 3]
const ROUND_BOX_LABEL: Record<DerbyRoundNum, string> = { 1: 'RD 1', 2: 'RD 2', 3: 'FINAL' }

// ── Home run burst ───────────────────────────────────────────────────────────
// Deterministic particle spread (angle spray around the slam text). Driven by
// the shared `derby-mb-*` CSS keyframes — transform/opacity only, so OBS runs
// the burst on the compositor. No filters, no per-particle glow: this fires on
// every home run of the night and must never cost a frame.
const BURST_PARTICLES = [
  { x: -240, y: -150, size: 13, color: '#fbbf24', delay: 0.00, spin: 0, round: true },
  { x: 220,  y: -170, size: 10, color: '#ffffff', delay: 0.02, spin: 260, round: true },
  { x: -160, y: -220, size: 15, color: '#fbbf24', delay: 0.04, spin: -240, round: false },
  { x: 260,  y: -60,  size: 12, color: '#c0392b', delay: 0.01, spin: 200, round: false },
  { x: -280, y: -20,  size: 11, color: '#ffffff', delay: 0.03, spin: 0, round: true },
  { x: 120,  y: -240, size: 12, color: '#fbbf24', delay: 0.05, spin: 0, round: true },
  { x: 300,  y: -130, size: 14, color: '#fbbf24', delay: 0.06, spin: 260, round: false },
  { x: -310, y: -100, size: 10, color: '#c0392b', delay: 0.05, spin: 0, round: true },
  { x: 40,   y: -290, size: 11, color: '#ffffff', delay: 0.07, spin: -220, round: false },
  { x: 180,  y: 60,   size: 10, color: '#fbbf24', delay: 0.04, spin: 0, round: true },
]

function HomeRunBurst() {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 24px)',
      display: 'flex', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{ position: 'relative' }}>
        {/* Shockwave rings */}
        {[
          { color: '#fbbf24', width: 5, to: 3.2, dur: 0.7, delay: 0.08 },
          { color: '#ffffff', width: 3, to: 2.4, dur: 0.85, delay: 0.18 },
        ].map((ring, i) => (
          <div
            key={`ring-${i}`}
            className="derby-mb-anim"
            style={{
              position: 'absolute', left: '50%', top: '50%', width: 180, height: 180,
              marginLeft: -90, marginTop: -90,
              border: `${ring.width}px solid ${ring.color}`, borderRadius: '50%',
              animation: `derby-mb-ring ${ring.dur}s ease-out ${ring.delay}s`,
              ['--mb-ring-to' as string]: String(ring.to),
            }}
          />
        ))}

        {/* Particles */}
        {BURST_PARTICLES.map((p, i) => (
          <div
            key={i}
            className="derby-mb-anim"
            style={{
              position: 'absolute', left: '50%', top: '55%',
              width: p.size, height: p.size, background: p.color,
              borderRadius: p.round ? '50%' : 3,
              animation: `derby-mb-spark 0.95s ease-out ${0.1 + p.delay}s`,
              ['--mb-x' as string]: `${p.x}px`,
              ['--mb-y' as string]: `${p.y}px`,
              ['--mb-spin' as string]: `${p.spin}deg`,
            }}
          />
        ))}

        {/* Slam text. Static tilt on the wrapper, translate-only animation on
            the type — scaling stroked glyphs re-rasters them every step */}
        <div style={{ transform: 'rotate(-3deg)' }}>
          <div
            className="derby-mb-anim"
            style={{
              fontFamily: 'var(--font-score)', fontSize: 92, fontWeight: 900, fontStyle: 'italic',
              color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em',
              lineHeight: 1, whiteSpace: 'nowrap', padding: '10px 24px',
              WebkitTextStroke: '2px #7c2d12',
              textShadow: '0 6px 0 rgba(124,45,18,0.55)',
              animation: 'derby-hr-slam 1.6s cubic-bezier(0.2, 1.05, 0.3, 1)',
            }}
          >
            Home Run!
          </div>
        </div>
      </div>
    </div>
  )
}

function RoundBox({ label, score, live, delay }: {
  label: string
  score: number | undefined
  live: boolean
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 260, delay }}
      style={{
        width: 112,
        borderRadius: 12,
        padding: '12px 0 8px',
        textAlign: 'center',
        background: live ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.05)',
        border: `2px solid ${live ? '#fbbf24' : 'rgba(255,255,255,0.10)'}`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Gold flash each time the live round's number changes */}
      {live && score !== undefined && (
        <motion.div
          key={`flash-${score}`}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(circle, rgba(251,191,36,0.8), rgba(251,191,36,0.15))',
          }}
        />
      )}
      <div style={{
        fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
        letterSpacing: '0.18em', color: live ? '#fbbf24' : 'rgba(255,255,255,0.45)',
        lineHeight: 1, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={score ?? 'empty'}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', damping: 16, stiffness: 300 }}
            style={{
              fontFamily: 'var(--font-score)', fontSize: 46, fontWeight: 900, lineHeight: 1,
              color: score === undefined ? 'rgba(255,255,255,0.18)' : '#ffffff',
            }}
          >
            {score ?? '–'}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export function DerbyPlayerScene({ name, seasonHr, team, scores, activeRound, moneyBallAt, pitcher }: Props) {
  const primaryColor = team?.primaryColor ?? '#fbbf24'
  const total = (scores.r1 ?? 0) + (scores.r2 ?? 0) + (scores.r3 ?? 0)
  const hasAnyScore = ROUND_NUMS.some(r => scores[ROUND_KEY[r]] !== undefined)

  // Fire the burst whenever the active round's HR count goes UP (not on mount,
  // not on -1 corrections, not when a blank is locked in as 0)
  const activeScore = scores[ROUND_KEY[activeRound]]
  const prevScoreRef = useRef(activeScore)
  const prevMoneyBallRef = useRef(moneyBallAt)
  const [burstId, setBurstId] = useState(0)
  const [burstVisible, setBurstVisible] = useState(false)

  useEffect(() => {
    const prev = prevScoreRef.current
    prevScoreRef.current = activeScore
    const prevMoneyBall = prevMoneyBallRef.current
    prevMoneyBallRef.current = moneyBallAt
    // The money ball's +3 lands in the same Firebase snapshot as its timestamp
    // — that jump belongs to the full-screen graphic, so sit this one out
    if (moneyBallAt != null && moneyBallAt !== prevMoneyBall) return
    if (activeScore !== undefined && activeScore > (prev ?? 0)) {
      setBurstId(n => n + 1)
      setBurstVisible(true)
    }
  }, [activeScore, moneyBallAt])

  useEffect(() => {
    if (!burstVisible) return
    const t = setTimeout(() => setBurstVisible(false), 1750)
    return () => clearTimeout(t)
  }, [burstId, burstVisible])

  return (
    <div style={{ position: 'absolute', left: DERBY_COL_X, bottom: 84, display: 'flex', gap: 14, alignItems: 'stretch' }}>
      {burstVisible && <HomeRunBurst key={burstId} />}

      {/* ── Player identity card ── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: 'rgba(8,13,24,0.95)',
        borderRadius: 14,
        borderLeft: `6px solid ${primaryColor}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}>
        {team?.logoUrl && (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 24 }}>
            <div style={{
              width: 84, height: 84, borderRadius: '50%',
              background: `${primaryColor}26`,
              border: `2px solid ${primaryColor}59`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src={team.logoUrl} alt="" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            </div>
          </div>
        )}
        <div style={{ padding: '18px 32px 16px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
            letterSpacing: '0.25em', color: '#fbbf24', textTransform: 'uppercase', lineHeight: 1,
          }}>
            Home Run Derby
          </div>
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 56, fontWeight: 900,
            color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.03em',
            lineHeight: 1.05, whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
          {/* Wraps: the pitcher's name is arbitrary length and this row is
              already carrying two items on a fixed-width column */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 700,
              color: primaryColor, textTransform: 'uppercase', letterSpacing: '0.12em',
            }}>
              {team?.shortName ?? ''}
            </span>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 700,
              color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              {seasonHr} HR this season
            </span>
            {pitcher && (
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 700,
                color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em',
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: 'rgba(255,255,255,0.32)' }}>Pitching </span>
                <span style={{ color: '#7dd3fc' }}>{pitcher}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Derby rounds card ── */}
      <div style={{
        background: 'rgba(8,13,24,0.95)',
        borderRadius: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {ROUND_NUMS.map((r, i) => (
          <RoundBox
            key={r}
            label={ROUND_BOX_LABEL[r]}
            score={scores[ROUND_KEY[r]]}
            live={r === activeRound}
            delay={0.15 + i * 0.08}
          />
        ))}

        <div style={{ width: 1, alignSelf: 'stretch', margin: '8px 4px', background: 'rgba(255,255,255,0.12)' }} />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 260, delay: 0.42 }}
          style={{ width: 112, textAlign: 'center' }}
        >
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
            letterSpacing: '0.18em', color: 'rgba(255,255,255,0.45)', lineHeight: 1, marginBottom: 4,
          }}>
            TOTAL
          </div>
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AnimatePresence mode="popLayout">
              <motion.span
                key={hasAnyScore ? total : 'empty'}
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 300 }}
                style={{
                  fontFamily: 'var(--font-score)', fontSize: 46, fontWeight: 900, lineHeight: 1,
                  color: hasAnyScore ? '#fbbf24' : 'rgba(255,255,255,0.18)',
                }}
              >
                {hasAnyScore ? total : '–'}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
