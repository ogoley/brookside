import { AnimatePresence, motion } from 'framer-motion'
import type { Team, DerbyRoundNum } from '../../types'
import { ADVANCE_COUNT, ROUND_LABEL } from '../../derby/logic'
import { DERBY_COL_X, DERBY_COL_W, derbyRailBand } from './layout'

export interface DerbyMiniRow {
  playerId: string
  name: string
  team?: Team
  score?: number
  rank?: number
  tied: boolean       // on a contested cut score — swing-off pending
  chasing: boolean    // hitting right now from outside the field, climbing toward it
}

interface Props {
  rows: DerbyMiniRow[]
  round: DerbyRoundNum
  livePlayerId?: string | null
  locked?: boolean
  /** Tied players vs seats left, for the footer note. */
  tiedCount?: number
  spotsLeft?: number
  /** Is the turn clock on screen? The rail sits under it when it is. */
  clockVisible?: boolean
}

const BASE_ROW_H = 46
// Hard floor. Rows shrink this far before anyone alive is dropped — at 22px a
// last name still reads at 18px on a 1080 canvas.
const MIN_ROW_H = 22
const COMPACT_AT = 34
// Panel chrome that isn't rows: padding, header, tag row, divider
const CHROME_H = 74
const FOOTER_H = 30
const TRUNC_H = 18
// Past this depth the footer note is dropped to buy another row or two
const FOOTER_MAX_ROWS = 10

const HEAD_TAG: Record<DerbyRoundNum, string> = {
  1: 'Top 8 advance',
  2: 'Top 3 to the final',
  3: 'For the title',
}

function lastName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

/**
 * Always-on left rail: everyone who would move on as things stand.
 *
 * That is the seat count only when nobody is tied on the cut score. Any tie
 * straddling the line keeps EVERY tied player on the board, so the depth is
 * open-ended — 9 for a two-way tie at 8th, 10 for a three-way, and genuinely
 * more early in round 1 when a pile of hitters share a low cut score (seven
 * clinched plus five stuck on 0 is 12 alive for 8 seats). None of them can be
 * dropped: any one of them may win the swing-off.
 *
 * So the rail never truncates to a row count — it shrinks rows to fit the band
 * (46px → 22px, dropping the logo and tie pill along the way), and only past
 * ~19 deep, where the band physically runs out, does it cut the tail.
 */
export function DerbyMiniBoardScene({
  rows: allRows, round, livePlayerId, locked, tiedCount = 0, spotsLeft = 0, clockVisible = true,
}: Props) {
  if (allRows.length === 0) return null

  const slots = ADVANCE_COUNT[round]
  const band = derbyRailBand(clockVisible)
  // Deep boards spend the footer's height on rows instead — the amber row tint
  // and the "N alive" chip already tell the swing-off story
  const showFooter = !locked && tiedCount > spotsLeft && spotsLeft > 0 && allRows.length <= FOOTER_MAX_ROWS
  const listAvail = band.maxHeight - CHROME_H - (showFooter ? FOOTER_H : 0)

  const fits = Math.max(1, Math.floor(listAvail / MIN_ROW_H))
  const truncating = allRows.length > fits
  // Dropping rows costs a "+N more" line, which comes out of the same budget
  const listH = listAvail - (truncating ? TRUNC_H : 0)
  const maxRows = truncating ? Math.max(1, Math.floor(listH / MIN_ROW_H)) : allRows.length

  let rows = allRows
  if (allRows.length > maxRows) {
    // Last resort only. The live hitter is never the one dropped — being seen
    // climbing is the whole point of pinning them here.
    const chaser = allRows.find(r => r.chasing)
    rows = chaser
      ? [...allRows.filter(r => !r.chasing).slice(0, maxRows - 1), chaser]
      : allRows.slice(0, maxRows)
  }
  const hiddenCount = allRows.length - rows.length

  const aliveCount = allRows.filter(r => !r.chasing).length
  const overflow = slots !== null && aliveCount > slots
  const rowH = Math.max(MIN_ROW_H, Math.min(BASE_ROW_H, Math.floor(listH / rows.length)))
  const s = rowH / BASE_ROW_H
  // Under this height the logo and tie pill stop helping and start crowding
  const compact = rowH < COMPACT_AT

  return (
    <div style={{
      position: 'absolute', top: band.top, left: DERBY_COL_X, width: DERBY_COL_W,
      maxHeight: band.maxHeight,
      background: 'rgba(8,13,24,0.94)',
      borderRadius: 14,
      borderLeft: '6px solid #fbbf24',
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      padding: '14px 14px 12px',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
          color: '#fbbf24', letterSpacing: '0.2em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {locked ? 'Moving on' : 'In the hunt'}
        </span>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800,
          color: 'rgba(255,255,255,0.4)', letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {ROUND_LABEL[round]}
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900,
          color: locked ? '#052e16' : '#080d18',
          background: locked ? '#4ade80' : '#fbbf24',
          borderRadius: 4, padding: '3px 8px',
          letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {locked ? '✓ Field set' : HEAD_TAG[round]}
        </span>
        {overflow && !locked && (
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900,
            color: '#080d18', background: '#f59e0b', borderRadius: 4, padding: '3px 8px',
            letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
          }}>
            {aliveCount} alive
            {/* Without the footer this chip is the only place the tie is spelled out */}
            {!showFooter && tiedCount > spotsLeft && ` · ${tiedCount} tied`}
          </span>
        )}
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', marginBottom: 6 }} />

      {/* ── Rows ──
          Wrapped in AnimatePresence so a player knocked out of the field slides
          out and the rest close the gap, rather than the board just blinking. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <AnimatePresence mode="popLayout" initial={false}>
        {rows.map((row, i) => {
          const isLive = row.playerId === livePlayerId
          const primaryColor = row.team?.primaryColor ?? '#555'
          return (
            <motion.div
              key={row.playerId}
              layout
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{
                layout: { type: 'spring', damping: 26, stiffness: 300 },
                default: { type: 'spring', damping: 24, stiffness: 240, delay: Math.min(i, 10) * 0.035 },
              }}
              style={{ height: rowH, flexShrink: 0 }}
            >
              <div
                className={isLive ? 'derby-live-row' : undefined}
                style={{
                  position: 'relative', overflow: 'hidden',
                  display: 'flex', alignItems: 'center',
                  height: rowH - 3, borderRadius: 8,
                  background: isLive
                    ? 'rgba(251,191,36,0.22)'
                    : row.chasing
                      ? 'rgba(255,255,255,0.02)'
                      : row.tied
                        ? 'rgba(245,158,11,0.10)'
                        : 'rgba(255,255,255,0.05)',
                  borderLeft: `3px solid ${isLive ? '#fbbf24' : row.tied ? '#f59e0b' : primaryColor}`,
                  opacity: row.chasing && !isLive ? 0.5 : 1,
                }}
              >
                {isLive && (
                  <div
                    className="derby-live-sweep"
                    style={{
                      position: 'absolute', top: 0, bottom: 0, left: 0, width: '30%',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.28), rgba(255,255,255,0))',
                      pointerEvents: 'none',
                    }}
                  />
                )}

                {/* Rank */}
                <div style={{ width: 26, flexShrink: 0, textAlign: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: Math.round(13 + 3 * s), fontWeight: 900,
                    color: isLive ? '#fbbf24' : 'rgba(255,255,255,0.45)', lineHeight: 1,
                  }}>
                    {row.chasing ? '–' : row.rank ?? '–'}
                  </span>
                </div>

                {/* Team mark — a logo shrinks past legibility on a deep board,
                    so tight rows fall back to a colour dot */}
                <div style={{ width: compact ? 14 : 22, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  {row.team?.logoUrl && !compact
                    ? <img src={row.team.logoUrl} alt="" style={{ width: Math.round(20 * s), height: Math.round(20 * s), objectFit: 'contain' }} />
                    : <span style={{ width: 8, height: 8, borderRadius: 4, background: primaryColor, display: 'block' }} />}
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0, paddingLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: Math.round(15 + 7 * s), fontWeight: 700,
                    color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.03em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1,
                  }}>
                    {lastName(row.name)}
                  </span>
                  {/* On a tight board the amber row tint carries this instead */}
                  {row.tied && !isLive && !compact && (
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 9, fontWeight: 900, flexShrink: 0,
                      color: '#080d18', background: '#f59e0b', borderRadius: 3,
                      padding: '2px 5px', letterSpacing: '0.1em', lineHeight: 1,
                    }}>
                      TIE
                    </span>
                  )}
                </div>

                {/* Score */}
                <div style={{ width: 42, flexShrink: 0, textAlign: 'center' }}>
                  <motion.span
                    key={row.score ?? 'none'}
                    initial={{ scale: 1.6 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 12, stiffness: 420 }}
                    style={{
                      display: 'inline-block',
                      fontFamily: 'var(--font-score)', fontSize: Math.round(16 + 8 * s), fontWeight: 900, lineHeight: 1,
                      color: row.score === undefined ? 'rgba(255,255,255,0.2)' : isLive ? '#ffffff' : '#fbbf24',
                    }}
                  >
                    {row.score ?? '–'}
                  </motion.span>
                </div>
              </div>
            </motion.div>
          )
        })}
        </AnimatePresence>
      </div>

      {/* Only when the band physically couldn't hold everyone */}
      {hiddenCount > 0 && (
        <div style={{
          fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800,
          color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em',
          textTransform: 'uppercase', textAlign: 'center', paddingTop: 4,
        }}>
          + {hiddenCount} more
        </div>
      )}

      {/* ── Swing-off note ── */}
      {showFooter && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 800,
            color: '#f59e0b', letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.3,
          }}
        >
          ⚡ {tiedCount} tied for the last {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} — swing-off
        </motion.div>
      )}
    </div>
  )
}
