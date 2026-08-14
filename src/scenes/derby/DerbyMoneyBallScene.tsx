import { useState, useEffect } from 'react'
import { DERBY_MONEY_BALL_HR } from '../../derby/logic'

/**
 * Total life of the graphic — matches the CSS timeline in `index.css`
 * (`derby-mb-*`). The gate below unmounts it after this.
 */
export const MONEY_BALL_ANIM_MS = 3200

const GOLD = '#fbbf24'
const DEEP = '#7c2d12'
const MINT = '#34d399'

// Impact lands 12% into the 3.2s timeline — everything thrown off the contact
// point waits for it
const IMPACT_S = 0.38

// Deterministic spreads — no Math.random in render, so the burst is identical
// every time. Kept deliberately small: each one is its own composited layer.
const SPARKS = [
  { x: -520, y: -230, size: 22, color: GOLD, delay: 0.00, spin: 200, round: true },
  { x: 470, y: -300, size: 18, color: '#ffffff', delay: 0.04, spin: -260, round: false },
  { x: -330, y: -400, size: 26, color: GOLD, delay: 0.07, spin: 160, round: false },
  { x: 620, y: -120, size: 20, color: MINT, delay: 0.02, spin: -180, round: true },
  { x: -660, y: -50, size: 24, color: GOLD, delay: 0.06, spin: 240, round: true },
  { x: 250, y: -430, size: 17, color: '#ffffff', delay: 0.09, spin: -140, round: false },
  { x: 760, y: -330, size: 19, color: GOLD, delay: 0.11, spin: 220, round: true },
  { x: -760, y: -320, size: 18, color: MINT, delay: 0.08, spin: -200, round: false },
]

// Falling money for the tail of the graphic
const RAIN = [
  { x: -780, delay: 0.30, drift: 60, spin: 200, size: 34 },
  { x: -430, delay: 0.66, drift: -50, spin: -180, size: 30 },
  { x: -120, delay: 0.18, drift: 45, spin: 240, size: 38 },
  { x: 340, delay: 0.50, drift: -60, spin: -220, size: 32 },
  { x: 760, delay: 0.78, drift: 50, spin: 180, size: 36 },
]

const RINGS = [
  { color: GOLD, width: 8, to: 5, dur: 1.0, delay: 0.02 },
  { color: '#ffffff', width: 4, to: 3.6, dur: 1.15, delay: 0.14 },
]

/** Gold wiffle ball — same slot geometry as the scorebug's, cast in money. */
function GoldWiffleBall({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="95 50 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="mbBall" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#fff7cc" />
          <stop offset="45%" stopColor={GOLD} />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
        <clipPath id="mbClip"><circle cx="345" cy="300" r="245" /></clipPath>
      </defs>
      <circle cx="345" cy="300" r="240" fill="url(#mbBall)" stroke={DEEP} strokeWidth="14" />
      <g clipPath="url(#mbClip)" fill="rgba(124,45,18,0.55)">
        <rect x="302" y="52.5" width="66" height="19" rx="9.5" transform="rotate(8 335 62)" />
        <rect x="172" y="104" width="112" height="36" rx="18" transform="rotate(-19 228 122)" />
        <rect x="152" y="235" width="132" height="54" rx="27" transform="rotate(-33 218 262)" />
        <rect x="250" y="339" width="136" height="58" rx="29" transform="rotate(-57 318 368)" />
        <rect x="418" y="374" width="100" height="48" rx="24" transform="rotate(-73 468 398)" />
        <rect x="509" y="317.5" width="114" height="25" rx="12.5" transform="rotate(-86 566 330)" />
      </g>
    </svg>
  )
}

function MoneyBallGraphic({ playerName }: { playerName?: string }) {
  const full = `${MONEY_BALL_ANIM_MS / 1000}s`

  return (
    // No animation on this wrapper on purpose — fading a parent that holds a
    // dozen composited children makes the compositor rebuild a full-screen
    // render surface every frame. Each child fades itself.
    <div
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Gold wash on impact. Rasterised at 700×700 and blown up by a static
          scale — a soft radial gradient survives being stretched, and this is
          a fifth of the pixels a frame-filling gradient would cost to paint */}
      <div
        className="derby-mb-anim"
        style={{
          position: 'absolute', width: 700, height: 700,
          background: `radial-gradient(circle at 50% 50%, ${GOLD}cc, ${GOLD}22 42%, transparent 68%)`,
          transform: 'scale(2.4)',
          animation: `derby-mb-flash 0.9s ease-out ${IMPACT_S}s`,
        }}
      />

      {/* Money rain, falling past everything */}
      {RAIN.map((r, i) => (
        <div
          key={`rain-${i}`}
          className="derby-mb-anim"
          style={{
            position: 'absolute',
            fontFamily: 'var(--font-score)', fontSize: r.size, fontWeight: 900, color: GOLD,
            animation: `derby-mb-rain 2.2s linear ${IMPACT_S + r.delay}s`,
            ['--mb-x' as string]: `${r.x}px`,
            ['--mb-drift' as string]: `${r.drift}px`,
            ['--mb-spin' as string]: `${r.spin}deg`,
          }}
        >
          $
        </div>
      ))}

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Shockwaves */}
        {RINGS.map((ring, i) => (
          <div
            key={`ring-${i}`}
            className="derby-mb-anim"
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: 260, height: 260, marginLeft: -130, marginTop: -130,
              border: `${ring.width}px solid ${ring.color}`, borderRadius: '50%',
              animation: `derby-mb-ring ${ring.dur}s ease-out ${IMPACT_S + ring.delay}s`,
              ['--mb-ring-to' as string]: String(ring.to),
            }}
          />
        ))}

        {/* Sparks thrown off the contact point */}
        {SPARKS.map((p, i) => (
          <div
            key={`spark-${i}`}
            className="derby-mb-anim"
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: p.size, height: p.size, background: p.color,
              borderRadius: p.round ? '50%' : 4,
              animation: `derby-mb-spark 1.15s ease-out ${IMPACT_S + p.delay}s`,
              ['--mb-x' as string]: `${p.x}px`,
              ['--mb-y' as string]: `${p.y}px`,
              ['--mb-spin' as string]: `${p.spin}deg`,
            }}
          />
        ))}

        {/* Halo behind the ball — a painted gradient, never a CSS filter */}
        <div
          className="derby-mb-anim"
          style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 460, height: 460, marginLeft: -230, marginTop: -300,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${GOLD}88, ${GOLD}22 55%, transparent 72%)`,
            animation: `derby-mb-glow ${full} ease-out`,
          }}
        />

        {/* The ball — in from the left, spinning, parked behind the type */}
        <div
          className="derby-mb-anim"
          style={{
            position: 'absolute', top: '50%', left: '50%',
            marginLeft: -130, marginTop: -170,
            animation: `derby-mb-ball ${full} cubic-bezier(0.16, 0.9, 0.3, 1)`,
          }}
        >
          <GoldWiffleBall size={260} />
        </div>

        {playerName && (
          <div
            className="derby-mb-anim"
            style={{
              fontFamily: 'var(--font-score)', fontSize: 40, fontWeight: 800,
              letterSpacing: '0.24em', textTransform: 'uppercase', color: '#ffffff',
              textShadow: '0 4px 20px rgba(0,0,0,0.8)', marginBottom: 6, zIndex: 1,
              animation: `derby-mb-name ${full} ease-out`,
            }}
          >
            {playerName}
          </div>
        )}

        {/* Slam. The tilt is a STATIC transform on the wrapper: the headline
            itself only translates, so its stroked glyphs are rasterised once */}
        <div style={{ transform: 'rotate(-4deg)', zIndex: 1 }}>
          <div
            className="derby-mb-anim"
            style={{
              fontFamily: 'var(--font-score)', fontSize: 150, fontWeight: 900, fontStyle: 'italic',
              color: GOLD, textTransform: 'uppercase', letterSpacing: '0.03em',
              lineHeight: 0.95, whiteSpace: 'nowrap',
              // 3px, not 4: stroking glyph paths is the slowest part of
              // rasterising this headline
              WebkitTextStroke: `3px ${DEEP}`,
              textShadow: `0 9px 0 rgba(124,45,18,0.6)`,
              animation: `derby-mb-slam ${full} cubic-bezier(0.2, 1.05, 0.3, 1)`,
            }}
          >
            Money Ball
          </div>
        </div>

        {/* The payoff */}
        <div
          className="derby-mb-anim"
          style={{
            fontFamily: 'var(--font-score)', fontSize: 76, fontWeight: 900,
            textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 1,
            color: '#0f172a', background: `linear-gradient(180deg, ${GOLD}, #f59e0b)`,
            border: `4px solid ${DEEP}`, borderRadius: 18,
            padding: '10px 34px 6px', marginTop: 10, zIndex: 1,
            // Tight blur: a 44px spread over a 600px-wide box is a costly
            // one-off raster right when the graphic is trying to appear
            boxShadow: '0 8px 20px rgba(0,0,0,0.55)',
            animation: `derby-mb-plate ${full} cubic-bezier(0.2, 1.05, 0.3, 1)`,
          }}
        >
          +{DERBY_MONEY_BALL_HR} Home Runs
        </div>
      </div>
    </div>
  )
}

/**
 * Fires the money-ball graphic once per `at` timestamp and takes itself off
 * screen when the animation is done. A stale `at` (overlay reloaded minutes
 * later) never plays — the gate starts already finished.
 */
export function DerbyMoneyBall({ at, playerName }: { at: number; playerName?: string }) {
  const [done, setDone] = useState(() => Date.now() - at >= MONEY_BALL_ANIM_MS)

  useEffect(() => {
    if (done) return
    const id = setTimeout(() => setDone(true), Math.max(0, at + MONEY_BALL_ANIM_MS - Date.now()))
    return () => clearTimeout(id)
  }, [at, done])

  if (done) return null
  return <MoneyBallGraphic playerName={playerName} />
}
