import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ref, update } from 'firebase/database'
import { db } from '../firebase'
import type { HomrunState, Team } from '../types'

const DISMISS_MS = 10_000

interface Props {
  homerun: HomrunState
  playerName: string
  team?: Team
}

export function HomrunBanner({ homerun, playerName, team }: Props) {
  const primary = team?.primaryColor ?? '#1a1a2e'
  const secondary = team?.secondaryColor ?? '#ffffff'

  const nameParts = playerName.trim().split(' ')
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  const isGrandSlam = homerun.runsScored >= 4
  const mainText = isGrandSlam ? 'GRAND SLAM' : 'HOME RUN'
  // Font size slightly smaller for GRAND SLAM (10 chars) vs HOME RUN (8 chars)
  const mainFontSize = isGrandSlam ? 46 : 52

  useEffect(() => {
    const id = setTimeout(() => {
      update(ref(db, 'overlay/homerun'), { active: false })
    }, DISMISS_MS)
    return () => clearTimeout(id)
  }, [homerun.triggeredAt])

  return (
    <motion.div
      key={homerun.triggeredAt}
      initial={{ scaleX: 0.2, scaleY: 0.4, opacity: 0 }}
      animate={{ scaleX: 1, scaleY: 1, opacity: 1 }}
      exit={{ opacity: 0, scaleY: 0.6, transition: { duration: 0.4 } }}
      transition={{ type: 'spring', damping: 16, stiffness: 280 }}
      className="relative overflow-hidden flex items-center"
      style={{ background: primary, borderRadius: 9999, height: 88, transformOrigin: 'center' }}
    >
      {/* White flash */}
      <motion.div
        initial={{ opacity: 0.95 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ position: 'absolute', inset: 0, background: '#ffffff', zIndex: 20, borderRadius: 9999 }}
      />

      {/* Shockwave rings — initial burst */}
      {[{ delay: 0.05, opacity: 0.7, scale: 5 }, { delay: 0.22, opacity: 0.4, scale: 4 }].map((r, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0, opacity: r.opacity }}
          animate={{ scale: r.scale, opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: r.delay }}
          style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 48, height: 48, marginLeft: -24, marginTop: -24,
            borderRadius: '50%', border: `2px solid ${secondary}`,
            zIndex: 8, pointerEvents: 'none',
          }}
        />
      ))}

      {/* Echo ring — repeats every 3.5s to keep things alive */}
      <motion.div
        initial={{ scale: 0, opacity: 0.5 }}
        animate={{ scale: 6, opacity: 0 }}
        transition={{ duration: 1.4, ease: 'easeOut', delay: 1.2, repeat: Infinity, repeatDelay: 2.1 }}
        style={{
          position: 'absolute', left: '50%', top: '50%',
          width: 48, height: 48, marginLeft: -24, marginTop: -24,
          borderRadius: '50%', border: `1.5px solid ${secondary}`,
          zIndex: 8, pointerEvents: 'none',
        }}
      />

      {/* Shimmer sweep — light stripe slides across every ~4.5s */}
      <motion.div
        animate={{ x: ['-110%', '210%'] }}
        transition={{ duration: 1.6, ease: 'easeInOut', delay: 1.0, repeat: Infinity, repeatType: 'reverse', repeatDelay: 0 }}
        style={{
          position: 'absolute', top: 0, bottom: 0, width: '35%',
          background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.13), transparent)`,
          zIndex: 15, pointerEvents: 'none',
        }}
      />

      {/* Logo — slams in from left */}
      {homerun.logoUrl ? (
        <motion.img
          src={homerun.logoUrl}
          alt=""
          initial={{ x: -50, opacity: 0, scale: 0.4 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={{ delay: 0.18, type: 'spring', damping: 11, stiffness: 260 }}
          style={{ height: 70, width: 70, objectFit: 'contain', flexShrink: 0, marginLeft: 10, position: 'relative', zIndex: 10 }}
        />
      ) : (
        <div style={{ width: 14, flexShrink: 0 }} />
      )}

      {/* Center — left-aligned to push weight left, giving room to right block */}
      <div
        className="flex items-center flex-1"
        style={{ position: 'relative', zIndex: 10, paddingLeft: 10, overflow: 'hidden' }}
      >
        {/* Run count prefix — shown for 1–3 runs only; GRAND SLAM is self-explanatory */}
        {!isGrandSlam && (
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.25, ease: 'easeOut' }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 10,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900,
              color: secondary, lineHeight: 1,
              textShadow: '0 2px 10px rgba(0,0,0,0.4)',
            }}>
              {homerun.runsScored}
            </span>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 700,
              color: secondary, opacity: 0.65,
              letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1,
            }}>
              RUN
            </span>
          </motion.div>
        )}

        {/* HOME RUN / GRAND SLAM letters slam down */}
        <div style={{ display: 'flex', alignItems: 'center', lineHeight: 1 }}>
          {mainText.split('').map((char, i) => (
            <motion.span
              key={i}
              initial={{ y: -60, opacity: 0, scale: 1.7 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.13 + i * 0.038, type: 'spring', damping: 6, stiffness: 440 }}
              style={{
                fontFamily: 'var(--font-score)',
                fontSize: mainFontSize,
                fontWeight: 900,
                color: secondary,
                lineHeight: 1,
                display: 'inline-block',
                letterSpacing: char === ' ' ? '0.14em' : '0.01em',
                textShadow: '0 3px 16px rgba(0,0,0,0.45)',
              }}
            >
              {char}
            </motion.span>
          ))}
        </div>
      </div>

      {/* Right block: DRAGON (small) / OGOLEY (big) — slides in from right */}
      <motion.div
        initial={{ x: 50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.44, type: 'spring', damping: 14, stiffness: 260 }}
        style={{
          marginRight: 20,
          flexShrink: 0,
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 19, fontWeight: 700,
          color: secondary, opacity: 0.7,
          letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {firstName}
        </span>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 36, fontWeight: 900,
          color: secondary, letterSpacing: '0.04em',
          textTransform: 'uppercase', lineHeight: 1,
          textShadow: '0 2px 10px rgba(0,0,0,0.35)',
        }}>
          {lastName || firstName}
        </span>
      </motion.div>
    </motion.div>
  )
}
