import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Sponsor, SponsorOverlayState } from '../types'
import { ordinal, displayWebsite, sponsorStillActive } from '../sponsors/logic'

interface Props {
  state: SponsorOverlayState
  sponsor: Sponsor | undefined
  /** Injected for tests; defaults to Date.now */
  now?: () => number
}

const PANEL_W = 1180
const PANEL_H = 540
const DEFAULT_ACCENT = '#fbbf24'

/**
 * Between-innings sponsor card. Purely reactive: the controller flips
 * overlay/sponsor.active and schedules the dismiss; this component only
 * decides whether the card should still be on screen (triggeredAt +
 * durationMs) so a dead controller tab can never leave it frozen on air.
 */
export function SponsorInterstitial({ state, sponsor, now = Date.now }: Props) {
  const [tick, setTick] = useState(0)

  // Re-evaluate visibility every 500ms while active so the time-based guard
  // in sponsorStillActive can expire the card without any Firebase write.
  useEffect(() => {
    if (!state.active) return
    const id = setInterval(() => setTick(t => t + 1), 500)
    return () => clearInterval(id)
  }, [state.active, state.triggeredAt])

  void tick
  const show = sponsorStillActive(state, now()) && !!sponsor && !!sponsor.logoUrl

  const accent = sponsor?.accentColor || DEFAULT_ACCENT
  const website = displayWebsite(sponsor?.website)
  const inningLabel = state.inning > 0 ? `The ${ordinal(state.inning)} inning is presented by` : 'This broadcast is presented by'

  return (
    <AnimatePresence>
      {show && sponsor && (
        <motion.div
          key={`sponsor-${state.sponsorId}-${state.triggeredAt}`}
          data-testid="sponsor-interstitial"
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          transition={{ duration: 0.2 }}
        >
          {/* Panel — slides in from the left, leaves to the right */}
          <motion.div
            initial={{ x: -PANEL_W * 1.3, skewX: -6 }}
            animate={{ x: 0, skewX: 0 }}
            exit={{ x: PANEL_W * 1.3, skewX: 6, transition: { type: 'spring', damping: 30, stiffness: 180 } }}
            transition={{ type: 'spring', damping: 26, stiffness: 170, mass: 1.1 }}
            style={{
              position: 'relative',
              width: PANEL_W, minHeight: PANEL_H,
              borderRadius: 28,
              overflow: 'hidden',
              background: 'linear-gradient(135deg, rgba(12,18,34,0.97) 0%, rgba(8,13,24,0.95) 60%, rgba(6,10,20,0.97) 100%)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: `0 30px 90px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4), 0 0 80px ${accent}22`,
              display: 'flex', flexDirection: 'column',
              padding: '34px 56px 30px 68px',
            }}
          >
            {/* Accent edge */}
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }}
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 12,
                background: accent, transformOrigin: 'top',
                boxShadow: `0 0 28px ${accent}99`,
              }}
            />

            {/* Diagonal sheen */}
            <div
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(115deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.04) 100%)',
              }}
            />

            {/* Eyebrow row */}
            <motion.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              style={{ display: 'flex', alignItems: 'center', gap: 18, position: 'relative' }}
            >
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 900,
                color: '#080d18', background: accent, borderRadius: 999,
                padding: '6px 16px', letterSpacing: '0.22em', textTransform: 'uppercase',
                lineHeight: 1,
              }}>
                Inning Break
              </span>
              <span
                data-testid="sponsor-eyebrow"
                style={{
                  fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 700,
                  color: 'rgba(255,255,255,0.62)', letterSpacing: '0.28em', textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                {inningLabel}
              </span>
            </motion.div>

            {/* Logo stage */}
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', minHeight: 300, margin: '18px 0 14px',
            }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.86, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.38, type: 'spring', damping: 20, stiffness: 190 }}
                style={{
                  position: 'relative', overflow: 'hidden',
                  borderRadius: 22,
                  background: sponsor.lightPlate ? '#ffffff' : 'transparent',
                  padding: sponsor.lightPlate ? '26px 40px' : 0,
                  boxShadow: sponsor.lightPlate ? '0 18px 50px rgba(0,0,0,0.45)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  maxWidth: 940,
                }}
              >
                <img
                  src={sponsor.logoUrl}
                  alt={sponsor.name}
                  style={{
                    display: 'block',
                    maxWidth: 860, maxHeight: 250,
                    width: 'auto', height: 'auto',
                    objectFit: 'contain',
                    filter: sponsor.lightPlate ? 'none' : 'drop-shadow(0 10px 30px rgba(0,0,0,0.55))',
                  }}
                />
                {/* Light sweep across the logo once it lands */}
                <motion.div
                  initial={{ x: '-140%' }}
                  animate={{ x: '240%' }}
                  transition={{ delay: 0.95, duration: 1.1, ease: 'easeInOut' }}
                  style={{
                    position: 'absolute', top: 0, bottom: 0, width: '35%',
                    background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0) 100%)',
                    pointerEvents: 'none',
                    mixBlendMode: sponsor.lightPlate ? 'normal' : 'screen',
                  }}
                />
              </motion.div>
            </div>

            {/* Name / tagline / website */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.45 }}
              style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, position: 'relative' }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  data-testid="sponsor-name"
                  style={{
                    fontFamily: 'var(--font-score)', fontSize: 54, fontWeight: 900,
                    color: '#ffffff', letterSpacing: '0.05em', textTransform: 'uppercase',
                    lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {sponsor.name}
                </div>
                {sponsor.tagline && (
                  <div style={{
                    fontFamily: 'var(--font-ui)', fontSize: 22, fontWeight: 500,
                    color: 'rgba(255,255,255,0.66)', marginTop: 8, lineHeight: 1.2,
                  }}>
                    {sponsor.tagline}
                  </div>
                )}
              </div>
              {website && (
                <div
                  data-testid="sponsor-website"
                  style={{
                    flexShrink: 0,
                    fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 800,
                    color: accent, border: `2px solid ${accent}`, borderRadius: 999,
                    padding: '10px 24px', letterSpacing: '0.08em', lineHeight: 1,
                    background: `${accent}14`,
                  }}
                >
                  {website}
                </div>
              )}
            </motion.div>

            {/* Time-remaining rail */}
            {state.durationMs > 0 && (
              <motion.div
                key={`rail-${state.triggeredAt}`}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: Math.max(0.1, (state.durationMs - Math.max(0, now() - state.triggeredAt)) / 1000), ease: 'linear' }}
                style={{
                  position: 'absolute', left: 12, right: 0, bottom: 0, height: 5,
                  background: `linear-gradient(90deg, ${accent}, ${accent}66)`,
                  transformOrigin: 'left',
                }}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
