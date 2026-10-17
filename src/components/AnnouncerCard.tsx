/**
 * Booth ID card — bottom-right, announcers stacked top-to-bottom (never side
 * by side, so the order can't imply who's sitting where). Read-only: driven by
 * /overlay/announcers. Blank-name slots are skipped.
 */
import { motion, AnimatePresence } from 'framer-motion'
import type { AnnouncersState } from '../types'

const FONT = 'var(--font-score)'
const GOLD = '#fbbf24'

export function AnnouncerCard({ announcers, bottom }: { announcers: AnnouncersState; bottom: number }) {
  const people = announcers.people.filter(p => p.name.trim())
  const show = announcers.visible && people.length > 0

  return (
    <div style={{ position: 'absolute', right: 32, bottom, transition: 'bottom 0.4s ease', pointerEvents: 'none' }}>
      <AnimatePresence>
        {show && (
          <motion.div
            key="announcers"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 240 }}
            style={{
              minWidth: 340, maxWidth: 520,
              background: 'linear-gradient(90deg, rgba(0,0,0,0.86), rgba(12,16,28,0.92))',
              borderRadius: 16, border: '1px solid rgba(251,191,36,0.3)', borderRight: `6px solid ${GOLD}`,
              boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
              padding: '14px 22px 16px',
            }}
          >
            <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: GOLD, letterSpacing: '0.34em', textTransform: 'uppercase', lineHeight: 1, marginBottom: 10 }}>
              {people.length === 1 ? 'On the call' : 'In the booth'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {people.map((p, i) => (
                <motion.div
                  key={`${i}-${p.name}`}
                  initial={{ x: 24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.12 + i * 0.08, duration: 0.3, ease: 'easeOut' }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: i ? 10 : 0, borderTop: i ? '1px solid rgba(255,255,255,0.1)' : 'none' }}
                >
                  <span style={{ fontFamily: FONT, fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </span>
                  {p.role.trim() && (
                    <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1 }}>
                      {p.role}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
