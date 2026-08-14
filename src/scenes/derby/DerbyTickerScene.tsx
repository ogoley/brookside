import { useLayoutEffect, useRef, useState } from 'react'
import type { Team, DerbyRoundNum } from '../../types'
import { ROUND_LABEL } from '../../derby/logic'

export interface DerbyTickerRow {
  playerId: string
  name: string
  team?: Team
  score?: number      // this round's HR; undefined = hasn't hit yet → "TBD"
  isCurrent?: boolean // the hitter currently at the plate
}

interface Props {
  rows: DerbyTickerRow[]
  round: DerbyRoundNum
}

// Crawl pace in pixels per second — ESPN-ish: readable, never rushed
const SPEED = 95
const CANVAS_W = 1920

/**
 * Bottom-of-screen ticker that crawls right → left forever.
 *
 * The track renders the row list `reps` times back-to-back and slides left by
 * exactly one copy's width, so the loop is seamless with no snap. `reps` is
 * derived from the measured width of one copy: always enough copies to cover
 * the 1920px canvas plus one spare, so a short list still fills the bar.
 */
export function DerbyTickerScene({ rows, round }: Props) {
  const copyRef = useRef<HTMLDivElement>(null)
  const [copyW, setCopyW] = useState(0)

  // Measure one copy. Re-measure on row changes and once webfonts land — a
  // Barlow-vs-fallback swap changes the width enough to desync the loop.
  useLayoutEffect(() => {
    const measure = () => {
      if (copyRef.current) setCopyW(copyRef.current.scrollWidth)
    }
    measure()
    let cancelled = false
    document.fonts?.ready.then(() => { if (!cancelled) measure() })
    return () => { cancelled = true }
  }, [rows])

  if (rows.length === 0) return null

  const reps = copyW > 0 ? Math.max(2, Math.ceil(CANVAS_W / copyW) + 1) : 2
  const duration = copyW > 0 ? copyW / SPEED : 0

  const copy = (key: number) => (
    <div
      key={key}
      ref={key === 0 ? copyRef : undefined}
      aria-hidden={key !== 0}
      style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
    >
      {rows.map(row => <TickerItem key={`${key}-${row.playerId}`} row={row} />)}
    </div>
  )

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: 64, display: 'flex', alignItems: 'stretch',
      background: 'rgba(8,13,24,0.95)',
      borderTop: '3px solid #fbbf24',
      boxShadow: '0 -8px 30px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
    }}>
      {/* ── Fixed brand block ── */}
      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        background: '#fbbf24', padding: '0 22px', zIndex: 2,
      }}>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 900,
          color: 'rgba(8,13,24,0.65)', letterSpacing: '0.22em',
          textTransform: 'uppercase', lineHeight: 1,
        }}>
          Home Run Derby
        </span>
        <span style={{
          fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900,
          color: '#080d18', letterSpacing: '0.06em',
          textTransform: 'uppercase', lineHeight: 1.15,
        }}>
          {ROUND_LABEL[round]}
        </span>
      </div>

      {/* ── Crawling track ── */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', height: '100%',
            width: 'max-content',
            willChange: 'transform',
            ['--derby-ticker-shift' as string]: `${100 / reps}%`,
            // One animation cycle = one copy's width of travel
            animation: duration > 0
              ? `derby-ticker-crawl ${duration}s linear infinite`
              : undefined,
          }}
        >
          {Array.from({ length: reps }, (_, i) => copy(i))}
        </div>

        {/* Soft edge fade so items don't hard-cut at the right edge */}
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 40,
          background: 'linear-gradient(270deg, rgba(8,13,24,0.95), rgba(8,13,24,0))',
        }} />
      </div>
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

        {/* Score, or TBD until they've hit */}
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
  )
}
