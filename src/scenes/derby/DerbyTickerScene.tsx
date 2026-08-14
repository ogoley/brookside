import { useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { Team } from '../../types'

export interface DerbyTickerRow {
  playerId: string
  name: string
  team?: Team
  score?: number      // this round's HR; undefined = hasn't hit yet → "TBD"
  isCurrent?: boolean // the hitter currently at the plate
}

/** One topic on the crawl: a round, its label, and its hitters. */
export interface DerbyTickerSegment {
  key: string          // 'r1' | 'r2' | 'r3'
  label: string        // 'Round 1'
  isCurrent: boolean   // the round being hit right now
  rows: DerbyTickerRow[]
}

interface Props {
  segments: DerbyTickerSegment[]
}

// Crawl pace in pixels per second — ESPN-ish: readable, never rushed
const SPEED = 95
const CANVAS_W = 1920
const BAR_H = 64
// Slack added to the loop so one label element per segment is always enough:
// with the track longer than the bar, a docked label can never also be needed
// somewhere on screen at the same time.
const TRACK_SLACK = 400

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * Bottom-of-screen crawl, ESPN topic-block style.
 *
 * The bar is a chain of segments — one per round, current round first, then
 * every round already hit. Each segment is `[label][its hitters]`. A segment's
 * label **docks** at the left edge while that segment's scores run past it, so
 * the viewer always knows which round they're reading. When the next segment
 * arrives its label travels in from the right and slides *over* the docked one,
 * taking the dock for itself. Scores are clipped at the label's right edge, so
 * they disappear behind it rather than sliding past it.
 *
 * ## Why this one is driven by rAF and not CSS
 *
 * Everything else in the derby overlay animates through CSS keyframes on the
 * compositor (see the frame-rate rule in CLAUDE.md), and the plain crawl this
 * replaced did too. Docking can't be expressed that way: a label holds still
 * while the track keeps moving, then resumes — a clamp against the track's
 * position, not a fixed curve. Splitting it into per-label CSS animations would
 * mean several independently-started animations whose phases drift apart, and
 * a drifting hand-off is a visible glitch every cycle.
 *
 * So one rAF loop computes every position from a single elapsed-time origin.
 * The cost is deliberately kept to what the compositor wants: it writes ONE
 * `transform` per label plus one for the track, and touches `zIndex` /
 * `visibility` only on the frames they actually change. No layout-triggering
 * property is written per frame — do not add one.
 */
export function DerbyTickerScene({ segments }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<(HTMLDivElement | null)[]>([])
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [metrics, setMetrics] = useState<{ labelW: number; itemsW: number[] } | null>(null)

  // Measure the label block and each segment's row strip. Re-measured when the
  // segments change and once webfonts land — a Barlow-vs-fallback swap moves
  // every width enough to throw the docking hand-off off by tens of pixels.
  useLayoutEffect(() => {
    const measure = () => {
      const widths = labelRefs.current.map(el => el?.offsetWidth ?? 0)
      const labelW = widths.length ? Math.max(...widths) : 0
      const itemsW = itemRefs.current.map(el => el?.scrollWidth ?? 0)
      if (labelW > 0) setMetrics({ labelW, itemsW })
    }
    measure()
    let cancelled = false
    document.fonts?.ready.then(() => { if (!cancelled) measure() })
    return () => { cancelled = true }
  }, [segments])

  const geom = useMemo(() => {
    if (!metrics || segments.length === 0) return null
    const { labelW, itemsW } = metrics
    // A segment owns its label's slot plus its rows
    const widths = segments.map((_, i) => labelW + (itemsW[i] ?? 0))
    const natural = widths.reduce((a, b) => a + b, 0)
    const pad = Math.max(0, CANVAS_W + TRACK_SLACK - natural)
    const total = natural + pad

    const starts: number[] = []
    let acc = 0
    for (const w of widths) { starts.push(acc); acc += w }
    // The trailing pad belongs to the last segment, so its label stays docked
    // through the gap instead of handing over early
    const spans = widths.map((w, i) => (i === widths.length - 1 ? w + pad : w))

    return { labelW, total, starts, spans, pad }
  }, [metrics, segments])

  // ── The crawl ──
  const originRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (!geom) return
    const { labelW, total, starts, spans } = geom
    const itemsViewW = CANVAS_W - labelW
    // Only written when they change — per-frame writes are transform-only
    const wasDocked: (boolean | null)[] = segments.map(() => null)
    const wasVisible: (boolean | null)[] = segments.map(() => null)

    let raf = 0
    const frame = (now: number) => {
      if (originRef.current == null) originRef.current = now
      const scroll = mod(((now - originRef.current) / 1000) * SPEED, total)

      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-(scroll + labelW)}px,0,0)`
      }

      labelRefs.current.forEach((el, i) => {
        if (!el) return
        // How far the crawl has run since THIS label reached the dock. The
        // window is half-open — [0, span) — so the spans partition the loop and
        // exactly one label is docked on every frame, including the hand-off
        // frame itself. (`u > total - span` leaves the dock empty for one frame.)
        const since = mod(scroll - starts[i], total)
        const docked = since < spans[i]
        // Travelling position: counts down from `total` to 0 at the dock
        const u = total - since
        const visible = docked || u <= itemsViewW + labelW
        el.style.transform = `translate3d(${docked ? 0 : u}px,0,0)`
        if (wasDocked[i] !== docked) {
          // An arriving label always covers the one it is replacing
          el.style.zIndex = docked ? '2' : '3'
          wasDocked[i] = docked
        }
        if (wasVisible[i] !== visible) {
          el.style.visibility = visible ? 'visible' : 'hidden'
          wasVisible[i] = visible
        }
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [geom, segments])

  if (segments.length === 0) return null

  const labelW = geom?.labelW
  const pad = geom?.pad ?? 0

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: BAR_H, overflow: 'hidden',
      background: 'rgba(8,13,24,0.95)',
      borderTop: '3px solid #fbbf24',
      boxShadow: '0 -8px 30px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
    }}>
      {/* ── Rows ── clipped to start at the docked label's right edge, so a
          segment's scores vanish behind the label instead of running past it */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, right: 0,
        left: labelW ?? 0, overflow: 'hidden',
      }}>
        <div
          ref={trackRef}
          style={{
            display: 'flex', alignItems: 'center', height: '100%',
            width: 'max-content', willChange: 'transform',
          }}
        >
          {/* Two copies is provably enough: the track is longer than the bar */}
          {[0, 1].map(rep => (
            <Fragment key={rep}>
              {segments.map((seg, i) => (
                <Fragment key={`${rep}-${seg.key}`}>
                  {/* Holds the label's slot open in the flow */}
                  <div style={{ width: labelW ?? 0, flexShrink: 0 }} />
                  <div
                    ref={rep === 0 ? (el => { itemRefs.current[i] = el }) : undefined}
                    style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  >
                    {seg.rows.map(row => (
                      <TickerItem key={`${seg.key}-${row.playerId}`} row={row} />
                    ))}
                  </div>
                </Fragment>
              ))}
              <div style={{ width: pad, flexShrink: 0 }} />
            </Fragment>
          ))}
        </div>
      </div>

      {/* ── Labels ── one per segment, travelling then docking */}
      {segments.map((seg, i) => (
        <div
          key={seg.key}
          ref={el => { labelRefs.current[i] = el }}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: labelW || 'max-content',
            zIndex: 3,
            visibility: geom ? 'hidden' : 'visible',
            willChange: 'transform',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            background: '#fbbf24', padding: '0 22px',
            // Reads as a card sliding over the one beneath it, and gives the
            // scores a soft edge to disappear under
            boxShadow: '8px 0 22px rgba(0,0,0,0.55)',
          }}
        >
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
            color: 'rgba(8,13,24,0.65)', letterSpacing: '0.22em',
            textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap',
          }}>
            {seg.isCurrent ? 'Home Run Derby' : 'Results'}
          </span>
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900,
            color: '#080d18', letterSpacing: '0.06em',
            textTransform: 'uppercase', lineHeight: 1.15, whiteSpace: 'nowrap',
          }}>
            {seg.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function TickerItem({ row }: { row: DerbyTickerRow }) {
  const pending = row.score === undefined
  const accent = row.team?.primaryColor ?? '#64748b'

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {/* Separator */}
      <span style={{
        color: 'rgba(251,191,36,0.35)', fontSize: 12, padding: '0 18px',
        lineHeight: 1, flexShrink: 0,
      }}>
        ◆
      </span>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: row.isCurrent ? 'rgba(251,191,36,0.16)' : 'transparent',
        border: `1px solid ${row.isCurrent ? 'rgba(251,191,36,0.7)' : 'transparent'}`,
        borderRadius: 8, padding: row.isCurrent ? '4px 12px' : '4px 0',
      }}>
        {/* Team mark */}
        {row.team?.logoUrl
          ? <img src={row.team.logoUrl} alt="" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
          : <span style={{ width: 10, height: 10, borderRadius: 5, background: accent, flexShrink: 0 }} />}

        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 27, fontWeight: 700,
          color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em',
          whiteSpace: 'nowrap', lineHeight: 1,
        }}>
          {row.name}
        </span>

        {row.isCurrent && (
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900,
            background: '#fbbf24', color: '#080d18', borderRadius: 20,
            padding: '3px 9px', letterSpacing: '0.12em', lineHeight: 1, flexShrink: 0,
          }}>
            AT BAT
          </span>
        )}

        {/* Score, or TBD until they've hit. Fixed width so a score landing
            mid-crawl doesn't reflow the track under the docking maths. */}
        <div style={{ minWidth: 74, flexShrink: 0 }}>
          {pending ? (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 800,
              color: 'rgba(255,255,255,0.32)', letterSpacing: '0.1em', lineHeight: 1,
            }}>
              TBD
            </span>
          ) : (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900,
              color: '#fbbf24', lineHeight: 1, whiteSpace: 'nowrap',
            }}>
              {row.score}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginLeft: 4 }}>
                HR
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
