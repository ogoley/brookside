/**
 * Corner logo bug. 'league' = the plain league logo (unchanged); any other
 * mode = a playoff badge: league logo + PLAYOFFS + round name + QF·SF·F
 * progress pips. 'auto' follows the bracket's current round.
 */
import { motion, AnimatePresence } from 'framer-motion'
import type { LogoMode } from '../types'
import { ROUND_LABEL, ROUND_ORDER, ROUND_SHORT, resolveLogoRound, type ResolvedBracket } from '../postseason/bracket'

const FONT = 'var(--font-score)'
const GOLD = '#fbbf24'

export function PlayoffLogoBug({ leagueLogo, mode, bracket, bottom, hidden }: {
  leagueLogo: string
  mode: LogoMode
  bracket: ResolvedBracket | null
  bottom: number
  hidden: boolean
}) {
  const round = resolveLogoRound(mode, bracket)
  const champion = mode === 'auto' && !!bracket?.champion

  if (!round) {
    if (!leagueLogo) return null
    return (
      <img src={leagueLogo} alt="" style={{
        position: 'absolute', bottom, right: 32, width: 96, height: 96, objectFit: 'contain',
        transition: 'bottom 0.4s ease, opacity 0.3s ease', opacity: hidden ? 0 : 0.7, pointerEvents: 'none',
      }} />
    )
  }

  const idx = ROUND_ORDER.indexOf(round)
  return (
    <div style={{ position: 'absolute', bottom, right: 32, transition: 'bottom 0.4s ease, opacity 0.3s ease', opacity: hidden ? 0 : 1, pointerEvents: 'none' }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={round + String(champion)}
          initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 240 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 16, height: 104, padding: '0 22px 0 14px',
            background: 'linear-gradient(90deg, rgba(0,0,0,0.86), rgba(12,16,28,0.92))',
            borderRadius: 16, border: '1px solid rgba(251,191,36,0.35)', borderRight: `6px solid ${GOLD}`,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
          }}
        >
          {leagueLogo && <img src={leagueLogo} alt="" style={{ width: 78, height: 78, objectFit: 'contain' }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: GOLD, letterSpacing: '0.34em', textTransform: 'uppercase', lineHeight: 1 }}>
              {bracket ? `${bracket.season} ` : ''}Playoffs
            </span>
            <span style={{ fontFamily: FONT, fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>
              {champion ? 'Champions' : ROUND_LABEL[round]}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {ROUND_ORDER.map((r, i) => (
                <span key={r} style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', lineHeight: 1,
                  padding: '3px 8px', borderRadius: 4,
                  color: i === idx ? '#111' : i < idx ? 'rgba(251,191,36,0.8)' : 'rgba(255,255,255,0.35)',
                  background: i === idx ? GOLD : i < idx ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.06)',
                }}>
                  {ROUND_SHORT[r]}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
