import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { Team, DerbyRoundNum } from '../../types'
import { ROUND_LABEL } from '../../derby/logic'

export interface DerbyOrderDisplayRow {
  playerId: string
  name: string
  team?: Team
  score?: number   // this round's HR; undefined = hasn't hit yet
}

interface Props {
  rows: DerbyOrderDisplayRow[]
  currentIndex: number
  round: DerbyRoundNum
}

const STATUS_TAG: Record<number, string> = { 0: 'Now batting', 1: 'On deck', 2: 'In the hole' }

// Auto-scroll pace when the list overflows the panel (pixels per second)
const SCROLL_SPEED = 22

export function DerbyUpNextScene({ rows, currentIndex, round }: Props) {
  const rowHeight = 54

  // Measure how far the list overflows its viewport; if it does, ping-pong
  // scroll very slowly: pause at top → drift down → pause → drift back up.
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflowPx, setOverflowPx] = useState(0)

  useEffect(() => {
    const v = viewportRef.current
    const c = contentRef.current
    if (!v || !c) return
    setOverflowPx(Math.max(0, c.scrollHeight - v.clientHeight))
  }, [rows.length])

  const scrollDuration = overflowPx > 0
    ? Math.max(16, (overflowPx / SCROLL_SPEED) * 2 + 10)
    : 0

  return (
    <div style={{
      position: 'absolute', right: 72, top: 64, bottom: 64,
      display: 'flex', alignItems: 'center',
    }}>
      <div style={{
        width: 480, maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(8,13,24,0.97)',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        padding: '28px 26px 22px',
        boxSizing: 'border-box',
      }}>
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          style={{ marginBottom: 8, flexShrink: 0 }}
        >
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
            color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase', lineHeight: 1,
          }}>
            Home Run Derby · {ROUND_LABEL[round]}
          </div>
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 34, fontWeight: 900,
            color: '#ffffff', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.15,
          }}>
            Batting Order
          </div>
        </motion.div>

        <motion.div
          style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 12, flexShrink: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }}
        />

        {rows.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.25)',
            fontSize: 15, padding: '28px 0', textAlign: 'center',
            textTransform: 'uppercase', letterSpacing: '0.15em',
          }}>
            Order not set yet
          </div>
        )}

        {/* ── Scrolling viewport ── */}
        <div ref={viewportRef} style={{ flex: '0 1 auto', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <motion.div
            ref={contentRef}
            animate={overflowPx > 0
              ? { y: [0, 0, -overflowPx, -overflowPx, 0] }
              : { y: 0 }}
            transition={overflowPx > 0
              ? { duration: scrollDuration, times: [0, 0.12, 0.46, 0.58, 1], repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.3 }}
          >
            {rows.map((row, i) => {
              const offset = i - currentIndex
              const done = offset < 0
              const isCurrent = offset === 0
              const tag = STATUS_TAG[offset]
              const primaryColor = row.team?.primaryColor ?? '#555'
              return (
                <motion.div
                  key={row.playerId}
                  initial={{ x: 70, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 200, delay: 0.08 + i * 0.045 }}
                  style={{
                    display: 'flex', alignItems: 'center',
                    height: rowHeight,
                    marginBottom: 3,
                    borderRadius: 10,
                    background: isCurrent ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isCurrent ? '#fbbf24' : 'transparent'}`,
                    borderLeft: isCurrent ? '4px solid #fbbf24' : `4px solid ${primaryColor}${done ? '4d' : '99'}`,
                    opacity: done ? 0.45 : 1,
                    paddingRight: 14,
                  }}
                >
                  {/* Order number */}
                  <div style={{ width: 44, flexShrink: 0, textAlign: 'center' }}>
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 17, fontWeight: 900,
                      color: isCurrent ? '#fbbf24' : 'rgba(255,255,255,0.35)', lineHeight: 1,
                    }}>
                      {i + 1}
                    </span>
                  </div>

                  {/* Logo */}
                  <div style={{ width: 38, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    {row.team?.logoUrl
                      ? <img src={row.team.logoUrl} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
                      : <span style={{ fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 900, color: primaryColor }}>
                          {row.team?.shortName?.slice(0, 2) ?? ''}
                        </span>}
                  </div>

                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 23, fontWeight: 700,
                      color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      display: 'block', lineHeight: 1.1,
                    }}>
                      {row.name}
                    </span>
                  </div>

                  {/* Right side: status tag or completed score */}
                  {tag ? (
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900, flexShrink: 0,
                      background: isCurrent ? '#fbbf24' : 'rgba(255,255,255,0.1)',
                      color: isCurrent ? '#080d18' : 'rgba(255,255,255,0.65)',
                      borderRadius: 20, padding: '4px 12px',
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                    }}>
                      {tag}
                    </span>
                  ) : done ? (
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 23, fontWeight: 900, flexShrink: 0,
                      color: row.score === undefined ? 'rgba(255,255,255,0.2)' : '#fbbf24', lineHeight: 1,
                    }}>
                      {row.score ?? '–'}<span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginLeft: 3 }}>HR</span>
                    </span>
                  ) : null}
                </motion.div>
              )
            })}
          </motion.div>

          {/* Soft fades so clipped rows drift in/out instead of hard-cutting */}
          {overflowPx > 0 && (
            <>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 26, pointerEvents: 'none',
                background: 'linear-gradient(180deg, rgba(8,13,24,0.97), rgba(8,13,24,0))',
              }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, pointerEvents: 'none',
                background: 'linear-gradient(0deg, rgba(8,13,24,0.97), rgba(8,13,24,0))',
              }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
