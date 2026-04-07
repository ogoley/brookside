import { motion } from 'framer-motion'
import type { InsightsState } from '../types'

interface Props {
  insights: InsightsState
}

const SLOT_HEIGHT = 72 // fixed height per point row

function BulletSlot({ text, visible }: { text: string; visible: boolean }) {
  return (
    <motion.div
      className="flex items-start gap-6"
      style={{ height: SLOT_HEIGHT }}
      animate={{ x: visible ? 0 : -60, opacity: visible ? 1 : 0 }}
      transition={{ type: 'spring', damping: 22, stiffness: 200 }}
    >
      {/* Accent dot */}
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'rgba(96,165,250,0.8)',
          boxShadow: '0 0 16px rgba(96,165,250,0.4)',
          flexShrink: 0,
          marginTop: 12,
        }}
      />
      {/* Text */}
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 38,
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.3,
        }}
      >
        {text}
      </span>
    </motion.div>
  )
}

export function InsightsScene({ insights }: Props) {
  const allPoints = [insights.point1, insights.point2, insights.point3, insights.point4]
    .filter((p) => p.trim() !== '')
  const visibleCount = insights.visibleCount ?? 0

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: '#080d18' }}
    >
      {/* Subtle top-center glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 1200px 500px at 50% 0%, rgba(96,165,250,0.06), transparent 70%)' }}
      />

      <div
        className="relative flex flex-col justify-center h-full"
        style={{ maxWidth: 1440, margin: '0 auto', padding: '0 100px' }}
      >
        {/* Title */}
        <motion.div
          style={{ marginBottom: 56 }}
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
        >
          <div
            style={{
              fontFamily: 'var(--font-score)',
              fontSize: 56,
              fontWeight: 900,
              color: '#ffffff',
              letterSpacing: '0.1em',
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            {insights.title || 'Game Insights'}
          </div>

          {/* Accent line */}
          <motion.div
            style={{
              height: 3,
              background: 'linear-gradient(90deg, rgba(96,165,250,0.8), transparent)',
              marginTop: 16,
              maxWidth: 320,
              borderRadius: 2,
            }}
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }}
          />
        </motion.div>

        {/* Bullet points — all slots pre-laid out, animated in/out in place */}
        <div className="flex flex-col gap-8">
          {allPoints.map((text, i) => (
            <BulletSlot key={i} text={text} visible={i < visibleCount} />
          ))}
        </div>
      </div>
    </div>
  )
}
