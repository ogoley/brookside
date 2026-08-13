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
}

interface Props {
  rows: DerbyLeaderboardDisplayRow[]
  round: DerbyRoundNum
}

const ADVANCE_TAG: Record<DerbyRoundNum, string | null> = {
  1: 'Top 8 advance',
  2: 'Top 3 to the final',
  3: 'Championship round',
}

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

// Comfortable spacing beats completeness: rows keep their full height and
// anything past this count is cut to a "+N more" footer (sorted rows mean the
// hidden ones are always the tail — below the cut line / yet to hit).
const MAX_ROWS = 11

export function DerbyLeaderboardScene({ rows: allRows, round }: Props) {
  const rows = allRows.slice(0, MAX_ROWS)
  const hiddenCount = allRows.length - rows.length
  const rowHeight = 62
  const advanceCount = ADVANCE_COUNT[round]
  // Advancing rows are always a sorted prefix — the cut line goes after them
  const advancingCount = allRows.filter(r => r.advancing).length
  const showCutLine = advanceCount !== null && advancingCount > 0 && advancingCount < allRows.length
  // Final round: crown the leader(s) once everyone has hit
  const finalComplete = round === 3 && allRows.length > 0 && allRows.every(r => r.score !== undefined)

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 920, maxHeight: 990,
        background: 'rgba(8,13,24,0.97)',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        padding: '34px 40px 28px',
        overflow: 'hidden',
      }}>
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}
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
          {ADVANCE_TAG[round] && (
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
              color: '#080d18', background: '#fbbf24', borderRadius: 20,
              padding: '6px 16px', letterSpacing: '0.1em', textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              {ADVANCE_TAG[round]}
            </div>
          )}
        </motion.div>

        <motion.div
          style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 12 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }}
        />

        {/* ── Column labels ── */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 4, marginBottom: 6 }}>
          <div style={{ flex: 1 }} />
          <div style={{ width: 96, textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            Round
          </div>
          <div style={{ width: 84, textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            Total
          </div>
        </div>

        {/* ── Rows ── */}
        {rows.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.25)',
            fontSize: 16, padding: '40px 0', textAlign: 'center',
            textTransform: 'uppercase', letterSpacing: '0.15em',
          }}>
            No hitters in this round yet
          </div>
        )}
        {rows.map((row, i) => {
          const isChampion = finalComplete && row.rank === 1
          const yetToHit = row.score === undefined
          const primaryColor = row.team?.primaryColor ?? '#555'
          return (
            <div key={row.playerId}>
              <motion.div
                initial={{ x: -70, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 22, stiffness: 200, delay: 0.08 + i * 0.05 }}
                style={{
                  display: 'flex', alignItems: 'center',
                  height: rowHeight,
                  marginBottom: 4,
                  borderRadius: 10,
                  background: isChampion
                    ? 'rgba(251,191,36,0.14)'
                    : row.advancing
                      ? 'rgba(255,255,255,0.07)'
                      : 'rgba(255,255,255,0.03)',
                  borderLeft: `4px solid ${isChampion ? '#fbbf24' : yetToHit ? 'rgba(255,255,255,0.1)' : primaryColor + '99'}`,
                  opacity: yetToHit ? 0.55 : 1,
                }}
              >
                {/* Rank */}
                <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {isChampion && <Crown />}
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 900,
                    color: isChampion ? '#fbbf24' : 'rgba(255,255,255,0.4)', lineHeight: 1,
                  }}>
                    {row.rank ?? '–'}
                  </span>
                </div>

                {/* Logo */}
                <div style={{ width: 48, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: `${primaryColor}33`, border: `2px solid ${primaryColor}66`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {row.team?.logoUrl
                      ? <img src={row.team.logoUrl} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
                      : <span style={{ fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 900, color: primaryColor }}>
                          {row.team?.shortName?.slice(0, 2) ?? '?'}
                        </span>}
                  </div>
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0, paddingLeft: 10, paddingRight: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 700,
                    color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1,
                  }}>
                    {row.name}
                  </span>
                  {isChampion && (
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
                      background: '#fbbf24', color: '#080d18', borderRadius: 4,
                      padding: '3px 8px', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0,
                    }}>
                      Champion
                    </span>
                  )}
                  {yetToHit && (
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 700,
                      color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em', textTransform: 'uppercase', flexShrink: 0,
                    }}>
                      Yet to hit
                    </span>
                  )}
                </div>

                {/* Round HR */}
                <div style={{ width: 96, flexShrink: 0, textAlign: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900, lineHeight: 1,
                    color: yetToHit ? 'rgba(255,255,255,0.18)' : '#fbbf24',
                  }}>
                    {row.score ?? '–'}
                  </span>
                </div>

                {/* Derby total */}
                <div style={{ width: 84, flexShrink: 0, textAlign: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 700, lineHeight: 1,
                    color: 'rgba(255,255,255,0.6)',
                  }}>
                    {row.total}
                  </span>
                </div>
              </motion.div>

              {/* ── Cut line after the advancing prefix ── */}
              {showCutLine && i === advancingCount - 1 && (
                <motion.div
                  initial={{ opacity: 0, scaleX: 0 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ delay: 0.15 + advancingCount * 0.05, duration: 0.4, ease: 'easeOut' }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '10px 4px' }}
                >
                  <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #fbbf24, rgba(251,191,36,0.15))' }} />
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
                    color: '#fbbf24', letterSpacing: '0.2em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {round === 1 ? 'Advancing to Round 2' : 'Advancing to the Final'}
                  </span>
                  <div style={{ flex: 1, height: 2, background: 'linear-gradient(270deg, #fbbf24, rgba(251,191,36,0.15))' }} />
                </motion.div>
              )}
            </div>
          )
        })}

        {/* ── "+N more" footer when the tail is cut for spacing ── */}
        {hiddenCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 + rows.length * 0.05, duration: 0.3 }}
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
