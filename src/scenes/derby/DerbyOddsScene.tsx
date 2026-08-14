import { AnimatePresence, motion } from 'framer-motion'
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
const PANEL_W = 440

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
      // Clears the All-Star wordmark watermark, which sits at top: 24 and runs
      // about 60px tall — the two share this corner now.
      position: 'absolute', top: 108, right: 40, width: PANEL_W,
      background: 'rgba(8,13,24,0.94)',
      borderRadius: 13,
      borderRight: `5px solid ${GOLD}`,
      boxShadow: '0 14px 40px rgba(0,0,0,0.5)',
      padding: '12px 14px 11px',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 900,
          color: GOLD, letterSpacing: '0.13em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          50/50 Watch
        </span>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 800,
          color: 'rgba(255,255,255,0.42)', letterSpacing: '0.13em',
          textTransform: 'uppercase', lineHeight: 1,
        }}>
          {ROUND_LABEL[round]} · Live odds
        </span>
      </div>

      <div style={{
        marginTop: 5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
      }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
          color: '#080d18', background: GOLD, borderRadius: 3, padding: '3px 7px',
          letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          ${toWinners} to the winner
        </span>
        <span style={{
          fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600,
          color: 'rgba(255,255,255,0.5)', lineHeight: 1,
        }}>
          ${pot} pot · who's holding the winning ticket
        </span>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '9px 0 6px' }} />

      {/* ── The five ── */}
      {top.length === 0 ? (
        <div style={{
          fontFamily: 'var(--font-ui)', fontSize: 13, color: 'rgba(255,255,255,0.45)',
          padding: '10px 2px',
        }}>
          No entries in the pool yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* Column headers. Most of the pool is IN the derby, so without a
              label the big name reads as a hitter and the board looks like it
              is calling the wrong person to win. Say which is which. */}
          <div style={{
            display: 'flex', alignItems: 'center',
            paddingRight: 11, marginBottom: 1,
          }}>
            <span style={{ width: 26, flexShrink: 0 }} />
            <span style={{
              flex: 1, minWidth: 0,
              fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900,
              color: 'rgba(255,255,255,0.45)', letterSpacing: '0.14em',
              textTransform: 'uppercase', lineHeight: 1,
            }}>
              Bettor <span style={{ color: 'rgba(255,255,255,0.25)' }}>· backing · call</span>
            </span>
            <span style={{
              width: 62, flexShrink: 0, textAlign: 'right',
              fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900,
              color: 'rgba(255,255,255,0.45)', letterSpacing: '0.14em',
              textTransform: 'uppercase', lineHeight: 1,
            }}>
              Win
            </span>
          </div>

          {/* The board sits on screen for the whole derby, so the interesting
              moment is a bettor CHANGING places, not the panel arriving.
              `layout` glides a row to its new slot instead of the list
              re-flowing under the viewer, and popLayout lets someone knocked
              out of the top five leave while the rest close up. */}
          <AnimatePresence mode="popLayout" initial={false}>
          {top.map((row, i) => {
            const accent = row.team?.primaryColor ?? '#475569'
            const leader = i === 0
            return (
              <motion.div
                key={row.entryId}
                layout
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{
                  layout: { type: 'spring', damping: 28, stiffness: 320 },
                  // No stagger on updates — only the first paint fans in, and
                  // a delay on every recompute would make a swap look laggy.
                  default: { type: 'spring', damping: 26, stiffness: 260 },
                }}
                style={{
                  position: 'relative', overflow: 'hidden',
                  borderRadius: 8, height: 42,
                  background: leader ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.05)',
                  borderLeft: `3px solid ${leader ? GOLD : accent}`,
                  display: 'flex', alignItems: 'center', paddingRight: 11,
                }}
              >
                {/* Probability bar, behind the text. Scales on the compositor
                    from a fixed-width element — animating `width` here would
                    lay out the whole panel on every frame. */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: Math.min(1, row.winProb / scale) }}
                  // Unhurried on purpose: the bar sliding is how a viewer sees
                  // a chance move. No delay — it re-animates on every update.
                  transition={{ type: 'spring', damping: 30, stiffness: 140 }}
                  style={{
                    position: 'absolute', inset: 0, transformOrigin: 'left center',
                    background: leader
                      ? 'linear-gradient(90deg, rgba(251,191,36,0.30), rgba(251,191,36,0.06))'
                      : `linear-gradient(90deg, ${accent}55, ${accent}0a)`,
                    pointerEvents: 'none',
                  }}
                />

                {/* Rank */}
                <div style={{ width: 26, flexShrink: 0, textAlign: 'center', position: 'relative' }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 19, fontWeight: 900,
                    color: leader ? GOLD : 'rgba(255,255,255,0.42)', lineHeight: 1,
                  }}>
                    {i + 1}
                  </span>
                </div>

                {/* One line: BETTOR · bet on · HITTER · their call.
                    Both names are the same size — this is read off a stream,
                    and the old sub-line was too small to catch. The bettor is
                    the one that ellipsises: the hitter is a last name and
                    almost never needs to. */}
                <div style={{
                  flex: 1, minWidth: 0, position: 'relative', paddingRight: 8,
                  display: 'flex', alignItems: 'baseline', gap: 6,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 21, fontWeight: 800,
                    color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.02em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    lineHeight: 1.05, flexShrink: 1, minWidth: 0,
                  }}>
                    {row.bettorName}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800,
                    color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em',
                    textTransform: 'uppercase', lineHeight: 1, flexShrink: 0,
                  }}>
                    on
                  </span>
                  {/* Team mark reinforces which of the two names is the hitter */}
                  {row.team?.logoUrl && (
                    <img
                      src={row.team.logoUrl}
                      alt=""
                      style={{ width: 15, height: 15, objectFit: 'contain', flexShrink: 0, alignSelf: 'center' }}
                    />
                  )}
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 21, fontWeight: 800,
                    color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: '0.02em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    lineHeight: 1.05, flexShrink: 0, minWidth: 0,
                  }}>
                    {lastName(row.playerName)}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-score)', fontSize: 21, fontWeight: 900,
                    color: GOLD, lineHeight: 1.05, flexShrink: 0,
                  }}>
                    {row.guess}
                  </span>
                </div>

                {/* Chance */}
                <div style={{ position: 'relative', textAlign: 'right', flexShrink: 0, width: 62 }}>
                  <div style={{
                    fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 900,
                    color: leader ? GOLD : '#ffffff', lineHeight: 1,
                  }}>
                    {pct(row.winProb)}
                  </div>
                </div>
              </motion.div>
            )
          })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Footer: what the model thinks actually happens ── */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {favourite && (
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
            fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800,
            letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.3,
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
            marginTop: 3,
            fontFamily: 'var(--font-score)', fontSize: 11.5, fontWeight: 700,
            color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em',
            textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            Winning total likely {projectedTotal.low}–{projectedTotal.high}
          </div>
        )}
        {charityProb > 0.005 && (
          <div style={{
            marginTop: 5,
            fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 800,
            color: '#4ade80', letterSpacing: '0.05em',
            textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            {pct(charityProb)} chance nobody called it — whole pot to {DERBY_CHARITY_NAME}
          </div>
        )}
      </div>
    </div>
  )
}
