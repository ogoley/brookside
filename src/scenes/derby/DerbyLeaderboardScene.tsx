import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Team, DerbyRoundNum } from '../../types'
import { ADVANCE_COUNT, ROUND_LABEL } from '../../derby/logic'

export interface DerbyLeaderboardDisplayRow {
  playerId: string
  name: string
  team?: Team
  score?: number     // this round's HR; undefined = yet to hit
  total: number
  rank?: number
  advancing: boolean
  tied: boolean      // sitting on a contested cut score — swing-off pending
}

interface Props {
  rows: DerbyLeaderboardDisplayRow[]
  round: DerbyRoundNum
  /** Hitter currently at the plate — gets the shimmer treatment. */
  livePlayerId?: string | null
  /** Producer has confirmed who moves on out of this round. */
  locked?: boolean
}

const ADVANCE_TAG: Record<DerbyRoundNum, string | null> = {
  1: 'Top 8 advance',
  2: 'Top 3 to the final',
  3: 'Championship round',
}

const CUT_LABEL: Record<DerbyRoundNum, string> = {
  1: 'Advancing to Round 2',
  2: 'Advancing to the Final',
  3: '',
}

// Vertical budget for rows once the panel chrome is paid for
const ROWS_AVAIL_H = 752
const BASE_ROW_H = 62
const MIN_ROW_H = 40
const CUT_H = 34
// Past this many hitters the board splits into two columns rather than
// shrinking rows into illegibility. 16 is the floor at which each column is
// still 8 rows deep, so a round-1 cut line stays in column one.
const TWO_COL_AT = 16
const MAX_ROWS = 30
const PANEL_PAD_X = 40
const GUTTER = 34
// How long the entrance stagger owns the rows before live movement takes over
const ENTER_WINDOW_MS = 1000

function Crown() {
  return (
    <svg width="20" height="15" viewBox="0 0 18 14" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M1 13 L3.5 4 L7.5 8.5 L9 1 L10.5 8.5 L14.5 4 L17 13 Z"
        fill="#fbbf24" stroke="#b45309" strokeWidth="0.8" strokeLinejoin="round"
      />
    </svg>
  )
}

export function DerbyLeaderboardScene({ rows: allRows, round, livePlayerId, locked }: Props) {
  const rows = allRows.slice(0, MAX_ROWS)
  const hiddenCount = allRows.length - rows.length
  const advanceCount = ADVANCE_COUNT[round]

  // The staggered entrance owns row positions only for the first beat; after
  // that every move is live and must be instant-ish, not delayed by index
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), ENTER_WINDOW_MS)
    return () => clearTimeout(t)
  }, [])

  // Advancing rows are always a sorted prefix (see leaderboardForRound), so one
  // line after them is enough. Before anyone has hit, the line still sits at the
  // seat count so the board reads as "these are the N slots" from the first pitch.
  const advancingCount = rows.filter(r => r.advancing).length
  const cutIndex = advanceCount === null
    ? -1
    : Math.max(advancingCount, Math.min(advanceCount, rows.length))
  const showCutLine = cutIndex > 0 && cutIndex < rows.length

  const twoCol = rows.length >= TWO_COL_AT
  const perCol = twoCol ? Math.ceil(rows.length / 2) : rows.length
  const rowH = Math.max(MIN_ROW_H, Math.min(BASE_ROW_H, Math.floor(ROWS_AVAIL_H / Math.max(1, perCol))))
  const s = rowH / BASE_ROW_H

  const panelW = twoCol ? 1580 : 920
  const innerW = panelW - PANEL_PAD_X * 2
  const colW = twoCol ? Math.floor((innerW - GUTTER) / 2) : innerW

  // Rows are absolutely placed rather than flowed: exact positions mean a
  // hitter climbing the board — even across the column break — animates to a
  // known spot instead of being unmounted and re-mounted by a reflow.
  const cutCol = showCutLine && twoCol && cutIndex > perCol ? 1 : 0
  const listH = perCol * rowH + (showCutLine ? CUT_H : 0)

  const place = (i: number) => {
    const col = twoCol && i >= perCol ? 1 : 0
    // The cut line eats a slot, so everything below it in ITS column shifts down
    const pushed = showCutLine && col === cutCol && i >= cutIndex
    return {
      x: col * (colW + GUTTER),
      y: (i - col * perCol) * rowH + (pushed ? CUT_H : 0),
    }
  }
  const cutX = cutCol * (colW + GUTTER)
  const cutY = (cutIndex - cutCol * perCol) * rowH

  // Final round: crown the leader(s) once everyone has hit
  const finalComplete = round === 3 && rows.length > 0 && rows.every(r => r.score !== undefined)

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: panelW, maxHeight: 990,
        background: 'rgba(8,13,24,0.97)',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        padding: `34px ${PANEL_PAD_X}px 28px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}>
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6, gap: 20 }}
        >
          <div>
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 800,
              color: '#fbbf24', letterSpacing: '0.25em', textTransform: 'uppercase', lineHeight: 1,
            }}>
              Home Run Derby
            </div>
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 46, fontWeight: 900,
              color: '#ffffff', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.1,
            }}>
              {ROUND_LABEL[round]}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {locked && advanceCount !== null && (
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 900,
                color: '#052e16', background: '#4ade80', borderRadius: 20,
                padding: '6px 14px', letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                ✓ Field set
              </div>
            )}
            {ADVANCE_TAG[round] && (
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
                color: '#080d18', background: '#fbbf24', borderRadius: 20,
                padding: '6px 16px', letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                {ADVANCE_TAG[round]}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 10 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }}
        />

        {rows.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.25)',
            fontSize: 16, padding: '40px 0', textAlign: 'center',
            textTransform: 'uppercase', letterSpacing: '0.15em',
          }}>
            No hitters in this round yet
          </div>
        )}

        {/* ── Rows ── */}
        <div style={{ position: 'relative', height: listH }}>
          {rows.map((row, i) => {
            const p = place(i)
            return (
              <Row
                key={row.playerId}
                row={row}
                x={p.x}
                y={p.y}
                width={colW}
                rowH={rowH}
                s={s}
                delay={entered ? 0 : 0.08 + Math.min(i, 12) * 0.045}
                isLive={row.playerId === livePlayerId}
                isChampion={finalComplete && row.rank === 1}
                showEliminated={!!locked && !row.advancing && row.score !== undefined}
              />
            )
          })}

          {/* ── Cut line ── */}
          {showCutLine && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: cutX, y: cutY }}
              transition={{
                x: { type: 'spring', damping: 30, stiffness: 280 },
                y: { type: 'spring', damping: 30, stiffness: 280 },
                opacity: { delay: entered ? 0 : 0.35, duration: 0.4 },
              }}
              style={{
                position: 'absolute', top: 0, left: 0, width: colW, height: CUT_H,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #fbbf24, rgba(251,191,36,0.15))' }} />
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
                color: '#fbbf24', letterSpacing: '0.2em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}>
                {locked ? `✓ ${CUT_LABEL[round]}` : CUT_LABEL[round]}
              </span>
              <div style={{ flex: 1, height: 2, background: 'linear-gradient(270deg, #fbbf24, rgba(251,191,36,0.15))' }} />
            </motion.div>
          )}
        </div>

        {/* ── "+N more" footer when the tail is cut for spacing ── */}
        {hiddenCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            style={{
              fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 700,
              color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', textTransform: 'uppercase',
              textAlign: 'center', padding: '8px 0 2px',
            }}
          >
            + {hiddenCount} more {hiddenCount === 1 ? 'hitter' : 'hitters'}
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ── One leaderboard row ──────────────────────────────────────────────────────

interface RowProps {
  row: DerbyLeaderboardDisplayRow
  x: number
  y: number
  width: number
  rowH: number
  s: number
  delay: number
  isLive: boolean
  isChampion: boolean
  showEliminated: boolean
}

function Row({ row, x, y, width, rowH, s, delay, isLive, isChampion, showEliminated }: RowProps) {
  const yetToHit = row.score === undefined
  const primaryColor = row.team?.primaryColor ?? '#555'
  const accent = isLive || isChampion ? '#fbbf24' : yetToHit ? 'rgba(255,255,255,0.1)' : primaryColor + '99'
  // Badges are the first thing to go when rows get short
  const roomy = s > 0.72

  return (
    <motion.div
      initial={{ opacity: 0, x: x - 70, y }}
      animate={{ opacity: 1, x, y }}
      transition={{
        x: { type: 'spring', damping: 28, stiffness: 260, delay },
        y: { type: 'spring', damping: 28, stiffness: 260, delay },
        opacity: { duration: 0.35, delay },
      }}
      style={{ position: 'absolute', top: 0, left: 0, width, height: rowH }}
    >
      <div
        className={isLive ? 'derby-live-row' : undefined}
        style={{
          position: 'relative', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
          height: rowH - 4,
          borderRadius: 10,
          background: isLive
            ? 'rgba(251,191,36,0.20)'
            : isChampion
              ? 'rgba(251,191,36,0.14)'
              : row.advancing
                ? 'rgba(255,255,255,0.07)'
                : 'rgba(255,255,255,0.03)',
          borderLeft: `4px solid ${accent}`,
          opacity: yetToHit && !isLive ? 0.55 : 1,
        }}
      >
        {/* Specular sweep — only on the live row */}
        {isLive && (
          <div
            className="derby-live-sweep"
            style={{
              position: 'absolute', top: 0, bottom: 0, left: 0, width: '26%',
              background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.30), rgba(255,255,255,0))',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Rank */}
        <div style={{ width: Math.round(56 * Math.max(s, 0.8)), flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {isChampion && roomy && <Crown />}
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: Math.round(16 + 4 * s), fontWeight: 900,
            color: isChampion || isLive ? '#fbbf24' : 'rgba(255,255,255,0.4)', lineHeight: 1,
          }}>
            {row.rank ?? '–'}
          </span>
        </div>

        {/* Logo */}
        <div style={{ width: Math.round(48 * Math.max(s, 0.8)), flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{
            width: Math.round(38 * s), height: Math.round(38 * s), borderRadius: '50%',
            background: `${primaryColor}33`, border: `2px solid ${primaryColor}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {row.team?.logoUrl
              ? <img src={row.team.logoUrl} alt="" style={{ width: Math.round(26 * s), height: Math.round(26 * s), objectFit: 'contain' }} />
              : <span style={{ fontFamily: 'var(--font-score)', fontSize: Math.round(9 + 2 * s), fontWeight: 900, color: primaryColor }}>
                  {row.team?.shortName?.slice(0, 2) ?? '?'}
                </span>}
          </div>
        </div>

        {/* Name + badges */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 10, paddingRight: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: Math.round(20 + 6 * s), fontWeight: 700,
            color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1,
          }}>
            {row.name}
          </span>

          {isLive && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              fontFamily: 'var(--font-score)', fontSize: Math.round(10 + 3 * s), fontWeight: 900,
              background: '#fbbf24', color: '#080d18', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              <span className="derby-live-dot" style={{ width: 6, height: 6, borderRadius: 3, background: '#080d18', display: 'block' }} />
              On the clock
            </span>
          )}

          {isChampion && (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: Math.round(10 + 3 * s), fontWeight: 900,
              background: '#fbbf24', color: '#080d18', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              Champion
            </span>
          )}

          {row.tied && !isLive && (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: Math.round(10 + 3 * s), fontWeight: 900,
              color: '#080d18', background: '#f59e0b', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              Swing-off
            </span>
          )}

          {showEliminated && roomy && !isLive && (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: Math.round(9 + 2 * s), fontWeight: 800,
              color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              Eliminated
            </span>
          )}

          {yetToHit && !isLive && roomy && (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: Math.round(9 + 2 * s), fontWeight: 700,
              color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              Yet to hit
            </span>
          )}
        </div>

        {/* Round HR */}
        <div style={{ width: Math.round(96 * Math.max(s, 0.7)), flexShrink: 0, textAlign: 'center' }}>
          <motion.span
            // Re-keyed on the number so each home run pops the digit
            key={row.score ?? 'none'}
            initial={{ scale: 1.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 12, stiffness: 420 }}
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-score)', fontSize: Math.round(22 + 8 * s), fontWeight: 900, lineHeight: 1,
              color: yetToHit ? 'rgba(255,255,255,0.18)' : isLive ? '#ffffff' : '#fbbf24',
            }}
          >
            {row.score ?? '–'}
          </motion.span>
        </div>

        {/* Derby total */}
        <div style={{ width: Math.round(84 * Math.max(s, 0.7)), flexShrink: 0, textAlign: 'center' }}>
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: Math.round(16 + 4 * s), fontWeight: 700, lineHeight: 1,
            color: 'rgba(255,255,255,0.6)',
          }}>
            {row.total}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
