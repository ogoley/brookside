import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, animate } from 'framer-motion'
import type { TickerState } from '../types'
import { crawlDurationSec, readableOn, type TickerItem, type TickerSection } from '../ticker/items'

export const TICKER_HEIGHT = 68
const CAP_WIDTH = 300
const CANVAS_WIDTH = 1920

interface Props {
  ticker: TickerState
  sections: TickerSection[]
  /** Canvas width the crawl travels across (1920 for the OBS source) */
  width?: number
}

/**
 * Bottom-line ticker. One section at a time crawls right→left across the
 * bar while the left cap names the section (ESPN BottomLine style); when
 * the tail clears the cap the next section starts. Content comes from
 * buildTickerSections() — this component only animates it.
 */
export function Ticker({ ticker, sections, width = CANVAS_WIDTH }: Props) {
  const accent = ticker.accentColor || '#fbbf24'
  const capText = readableOn(accent)
  const viewportW = width - CAP_WIDTH

  const [idx, setIdx] = useState(0)
  // Bumped every time a crawl finishes so the same section can re-run
  // (single-section tickers) and after fonts load (re-measure).
  const [cycle, setCycle] = useState(0)
  const [trackW, setTrackW] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef(ticker.speed)
  speedRef.current = ticker.speed

  const count = sections.length
  const safeIdx = count === 0 ? 0 : Math.min(idx, count - 1)
  const section = sections[safeIdx]

  const advance = useCallback(() => {
    setIdx(i => (count === 0 ? 0 : (i + 1) % count))
    setCycle(c => c + 1)
  }, [count])

  // Measure the freshly rendered track before paint — once per crawl. Live
  // data updates re-render the items in place but must not restart the
  // crawl, so the section's *items* are deliberately not a dependency; a
  // different section id at the same index (list changed) is a new crawl.
  const sectionId = section?.id
  useLayoutEffect(() => {
    setTrackW(trackRef.current ? Math.ceil(trackRef.current.scrollWidth) : null)
  }, [safeIdx, cycle, sectionId])

  // Fonts landing late change widths — re-measure once they're in.
  useEffect(() => {
    let cancelled = false
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
    fonts?.ready.then(() => { if (!cancelled) setCycle(c => c + 1) })
    return () => { cancelled = true }
  }, [])

  // Drive the crawl imperatively so we control exactly when "done" fires.
  useEffect(() => {
    const el = trackRef.current
    if (!el || trackW == null || !section || !ticker.visible) return
    let cancelled = false
    const duration = crawlDurationSec(viewportW, trackW, speedRef.current)
    const controls = animate(el, { x: [viewportW, -trackW] }, { duration, ease: 'linear' })
    controls.then(() => { if (!cancelled) advance() })
    return () => { cancelled = true; controls.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackW, safeIdx, cycle, sectionId, ticker.visible, viewportW, advance])

  const show = ticker.visible && count > 0

  return (
    <AnimatePresence>
      {show && section && (
        <motion.div
          key="ticker"
          data-testid="ticker"
          initial={{ y: TICKER_HEIGHT + 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: TICKER_HEIGHT + 12, opacity: 0, transition: { duration: 0.35 } }}
          transition={{ type: 'spring', damping: 26, stiffness: 220 }}
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            height: TICKER_HEIGHT, width,
            display: 'flex', alignItems: 'stretch',
            background: 'rgba(6,10,20,0.96)',
            borderTop: `2px solid ${accent}`,
            boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {/* Section cap */}
          <div
            style={{
              width: CAP_WIDTH, flexShrink: 0, position: 'relative', zIndex: 2,
              background: accent, color: capText,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
              boxShadow: '8px 0 24px rgba(0,0,0,0.45)',
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={`${section.id}-${safeIdx}`}
                data-testid="ticker-cap"
                initial={{ y: 28, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -28, opacity: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                style={{
                  fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900,
                  letterSpacing: '0.2em', textTransform: 'uppercase', lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {section.label}
              </motion.span>
            </AnimatePresence>
            {/* Cap notch */}
            <div style={{
              position: 'absolute', right: -14, top: 0, bottom: 0, width: 28,
              background: accent, transform: 'skewX(-14deg)',
            }} />
          </div>

          {/* Crawl viewport */}
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
            {/* Fade under the cap so items emerge cleanly */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 90, zIndex: 1,
              background: 'linear-gradient(90deg, rgba(6,10,20,1) 0%, rgba(6,10,20,0) 100%)',
              pointerEvents: 'none',
            }} />
            <div
              key={`${section.id}-${safeIdx}-${cycle}`}
              ref={trackRef}
              data-testid="ticker-track"
              style={{
                position: 'absolute', top: 0, bottom: 0, left: 0,
                display: 'flex', alignItems: 'center',
                whiteSpace: 'nowrap',
                paddingLeft: 40,
                transform: `translateX(${viewportW}px)`,
                willChange: 'transform',
              }}
            >
              {section.items.map((item, i) => (
                <TickerItemView key={item.key} item={item} accent={accent} last={i === section.items.length - 1} />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function TickerItemView({ item, accent, last }: { item: TickerItem; accent: string; last: boolean }) {
  const ring = item.color ?? 'rgba(255,255,255,0.25)'
  return (
    <span data-testid="ticker-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
      {item.logoUrl ? (
        <span style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: `${ring}33`, border: `2px solid ${ring}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <img src={item.logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
        </span>
      ) : item.lead ? null : (
        <span style={{ width: 10, height: 10, borderRadius: 2, background: accent, transform: 'rotate(45deg)', flexShrink: 0, opacity: 0.9 }} />
      )}
      {item.lead && (
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 800,
          color: accent, letterSpacing: '0.16em', textTransform: 'uppercase', lineHeight: 1,
          opacity: 0.95,
        }}>
          {item.lead}
        </span>
      )}
      <span style={{
        fontFamily: 'var(--font-score)', fontSize: 28, fontWeight: 700,
        color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1,
      }}>
        {item.text}
      </span>
      {item.value && (
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 28, fontWeight: 900,
          color: accent, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {item.value}
        </span>
      )}
      {item.detail && (
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 600,
          color: 'rgba(255,255,255,0.55)', letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1,
        }}>
          {item.detail}
        </span>
      )}
      {/* Separator */}
      <span aria-hidden style={{
        display: 'inline-block', width: 8, height: 8, margin: '0 34px 0 30px',
        background: last ? 'transparent' : accent, opacity: 0.55, transform: 'rotate(45deg)',
      }} />
    </span>
  )
}
