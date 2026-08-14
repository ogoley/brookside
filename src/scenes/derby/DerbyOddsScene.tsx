import { motion } from 'framer-motion'
import type { Team, DerbyRoundNum } from '../../types'
import { ROUND_LABEL, DERBY_CHARITY_NAME } from '../../derby/logic'

export interface DerbyOddsDisplayRow {
  entryId: string
  bettorName: string
  /** The hitter they backed. */
  playerName: string
  team?: Team
  guess: number
  winProb: number
  playerWinProb: number
}

export interface DerbyOddsFavourite {
  name: string
  team?: Team
  winProb: number
  /** Projected three-round total in the runs where they win. */
  totalIfWins: number
}

interface Props {
  rows: DerbyOddsDisplayRow[]
  /** P(nobody backed the eventual champion) — the pot goes to charity whole. */
  charityProb: number
  favourite?: DerbyOddsFavourite
  round: DerbyRoundNum
  pot: number
  toWinners: number
  /** Median simulated winning total, with a 10–90 band. */
  projectedTotal?: { median: number; low: number; high: number }
}

const GOLD = '#fbbf24'
const PANEL_W = 560

function lastName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

/** Whole percent, but never a bare "0%" for something that can still happen. */
function pct(p: number): string {
  if (p <= 0) return '0%'
  if (p < 0.005) return '<1%'
  return `${Math.round(p * 100)}%`
}

/**
 * The 50/50 odds board — who is most likely to walk off with the pot.
 *
 * Not a leaderboard: an entry only cashes if it named the hitter who actually
 * wins AND called their three-round total closest, so the order here regularly
 * disagrees with who is leading the derby. That disagreement is the point of
 * putting it on screen.
 *
 * Comes up on a timer rather than a producer cue (see `derbyOddsWindow`), so it
 * has to say what it is in its first second — hence the header spelling out the
 * pot and the footer spelling out the charity case.
 */
export function DerbyOddsScene({
  rows, charityProb, favourite, round, pot, toWinners, projectedTotal,
}: Props) {
  const top = rows.slice(0, 5)
  // Bars are relative to the leader, not to 100% — early on every chance is in
  // single digits and an absolute scale would render five invisible slivers.
  const scale = Math.max(0.01, top[0]?.winProb ?? 0.01)

  return (
    <div style={{
      position: 'absolute', top: 96, right: 40, width: PANEL_W,
      background: 'rgba(8,13,24,0.94)',
      borderRadius: 16,
      borderRight: `6px solid ${GOLD}`,
      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      padding: '16px 18px 14px',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900,
          color: GOLD, letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          50/50 Watch
        </span>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 800,
          color: 'rgba(255,255,255,0.42)', letterSpacing: '0.14em',
          textTransform: 'uppercase', lineHeight: 1,
        }}>
          {ROUND_LABEL[round]} · Live odds
        </span>
      </div>

      <div style={{
        marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
          color: '#080d18', background: GOLD, borderRadius: 4, padding: '3px 8px',
          letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          ${toWinners} to the winner
        </span>
        <span style={{
          fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
          color: 'rgba(255,255,255,0.5)', lineHeight: 1,
        }}>
          ${pot} pot · chance of holding the ticket
        </span>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '12px 0 8px' }} />

      {/* ── The five ── */}
      {top.length === 0 ? (
        <div style={{
          fontFamily: 'var(--font-ui)', fontSize: 15, color: 'rgba(255,255,255,0.45)',
          padding: '14px 2px',
        }}>
          No entries in the pool yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top.map((row, i) => {
            const accent = row.team?.primaryColor ?? '#475569'
            const leader = i === 0
            return (
              <motion.div
                key={row.entryId}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 260, delay: i * 0.06 }}
                style={{
                  position: 'relative', overflow: 'hidden',
                  borderRadius: 10, height: 62,
                  background: leader ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.05)',
                  borderLeft: `4px solid ${leader ? GOLD : accent}`,
                  display: 'flex', alignItems: 'center', paddingRight: 14,
                }}
              >
                {/* Probability bar, behind the text. Scales on the compositor
                    from a fixed-width element — animating `width` here would
                    lay out the whole panel on every frame. */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: Math.min(1, row.winProb / scale) }}
                  transition={{ type: 'spring', damping: 30, stiffness: 140, delay: 0.1 + i * 0.06 }}
                  style={{
                    position: 'absolute', inset: 0, transformOrigin: 'left center',
                    background: leader
                      ? 'linear-gradient(90deg, rgba(251,191,36,0.30), rgba(251,191,36,0.06))'
                      : `linear-gradient(90deg, ${accent}55, ${accent}0a)`,
                    pointerEvents: 'none',
                  }}
                />

                {/* Rank */}
                <div style={{ width: 40, flexShrink: 0, textAlign: 'center', position: 'relative' }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900,
                    color: leader ? GOLD : 'rgba(255,255,255,0.42)', lineHeight: 1,
                  }}>
                    {i + 1}
                  </span>
                </div>

                {/* Bettor over the pick */}
                <div style={{ flex: 1, minWidth: 0, position: 'relative', paddingRight: 10 }}>
                  <div style={{
                    fontFamily: 'var(--font-score)', fontSize: 25, fontWeight: 800,
                    color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.02em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    lineHeight: 1.05,
                  }}>
                    {row.bettorName}
                  </div>
                  <div style={{
                    marginTop: 3, display: 'flex', alignItems: 'center', gap: 6,
                    fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 700,
                    color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', lineHeight: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}>
                    {row.team?.logoUrl && (
                      <img src={row.team.logoUrl} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} />
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {lastName(row.playerName)}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.28)' }}>·</span>
                    <span style={{ color: GOLD, flexShrink: 0 }}>called {row.guess}</span>
                  </div>
                </div>

                {/* Chance */}
                <div style={{ position: 'relative', textAlign: 'right', flexShrink: 0, width: 84 }}>
                  <div style={{
                    fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900,
                    color: leader ? GOLD : '#ffffff', lineHeight: 1,
                  }}>
                    {pct(row.winProb)}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 800,
                    color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em',
                    textTransform: 'uppercase', lineHeight: 1, marginTop: 3,
                  }}>
                    Hitter {pct(row.playerWinProb)}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ── Footer: what the model thinks actually happens ── */}
      <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {favourite && (
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
            fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
            letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>
              Projected winner
            </span>
            <span style={{ color: '#ffffff' }}>
              {lastName(favourite.name)}{' '}
              <span style={{ color: GOLD }}>
                {Math.round(favourite.totalIfWins)} HR
              </span>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                {' '}· {pct(favourite.winProb)}
              </span>
            </span>
          </div>
        )}
        {projectedTotal && (
          <div style={{
            marginTop: 4,
            fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 700,
            color: 'rgba(255,255,255,0.32)', letterSpacing: '0.08em',
            textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            Winning total likely {projectedTotal.low}–{projectedTotal.high}
          </div>
        )}
        {charityProb > 0.005 && (
          <div style={{
            marginTop: 6,
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
            color: '#4ade80', letterSpacing: '0.06em',
            textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            {pct(charityProb)} chance nobody called it — whole pot to {DERBY_CHARITY_NAME}
          </div>
        )}
      </div>
    </div>
  )
}
