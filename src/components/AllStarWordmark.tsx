import { useId, type CSSProperties } from 'react'

// All-Star Weekend wordmark — two centred lines, ALLSTAR over WEEKEND.
// This replaced the old `/logos/allstar-weekend.svg` lockup: plain
// text scales to any size, needs no regeneration, and carries no year, so the
// annual rollover no longer touches it at all.
//
// The two lines are tracked to the SAME width, so the stack squares off.
// At zero tracking Barlow Condensed 900 sets "ALLSTAR" 3.3100em wide and
// "WEEKEND" 3.5430em (ink), so the shorter line takes the extra tracking. These
// are WEIGHT-SPECIFIC — the 700 face is a good deal narrower — so re-measure if
// either the words or FONT_WEIGHT change:
//   ctx.font = '900 100px "Barlow Condensed"'
//   ctx.measureText(s) -> actualBoundingBoxLeft / actualBoundingBoxRight
const FONT_WEIGHT = 900
const INK_EM = { ALLSTAR: 3.3100, WEEKEND: 3.5430 }
const GAPS = 6                                    // 7 letters -> 6 inter-letter gaps
const BASE_LS = 0.06                              // tracking on the wider line
const LINE_EM = INK_EM.WEEKEND + GAPS * BASE_LS   // width of both lines, in em
const LS = {
  ALLSTAR: (LINE_EM - INK_EM.ALLSTAR) / GAPS,
  WEEKEND: BASE_LS,
}

// Vertical rhythm. With `line-height: 1` the line box is 1em, but the font's own
// box is 1.20em (ascent 1.00 + descent 0.20), so the -0.10em half-leading puts
// the baseline 0.90em down: 0.20em of the box sits above the caps and 0.10em
// below the baseline. So the two boxes already hold the lines 0.30em apart on
// their own, and a margin has to work from THAT, not from zero — hence the
// subtraction below (it goes slightly negative to pull the stack tighter).
const CAP_EM = 0.70                               // cap height
const SLACK_ABOVE_CAPS = 0.20                     // em of line box above the caps
const SLACK_BELOW_BASE = 0.10                     // em of line box below the baseline
const LINE_GAP_EM = 0.24                          // optical gap, baseline -> next cap top
const INK_H_EM = 2 * CAP_EM + LINE_GAP_EM

// On-dark tints of the two team colours, NOT the colours themselves. The real
// ones (`#c8102e` Rist / `#1e40af` Hiller, in ALLSTAR_SEED_TEAMS) are dark navy
// and maroon: fine as fills behind white type, unreadable AS type over a dark
// overlay once the outline came off. These are the same hues opened up to sit on
// video, matching how the rest of the derby overlay already handles on-dark
// accents (DerbyTurnClock uses #f87171 / #38bdf8 rather than raw team colours).
// NOT derived, so if the teams' colours ever change these must be changed too —
// the annual runbook in ALLSTAR.md calls that out.
const BLUE = '#5b9df9'
const RED = '#f56e6e'

// Backdrop star. A 5-point star is NOT as tall as it is wide: it spans 2R·sin72
// across and only R·(1+cos36) down, so the viewBox is sized to the real bounds
// and the two constants below keep the rendered box matching them.
const STAR_VB_W = 190.21, STAR_VB_H = 180.90
const STAR_ASPECT = STAR_VB_W / STAR_VB_H
const STAR_POINTS = (() => {
  const pts: string[] = []
  for (let i = 0; i < 5; i++) {
    const ao = (-90 + i * 72) * Math.PI / 180
    const ai = (-54 + i * 72) * Math.PI / 180
    pts.push(`${(STAR_VB_W / 2 + 100 * Math.cos(ao)).toFixed(2)},${(100 + 100 * Math.sin(ao)).toFixed(2)}`)
    pts.push(`${(STAR_VB_W / 2 + 38.51 * Math.cos(ai)).toFixed(2)},${(100 + 38.51 * Math.sin(ai)).toFixed(2)}`)
  }
  return pts.join(' ')
})()
/** Star height as a multiple of the per-line font size. */
const STAR_H_EM = 3.6
// No text outline: the type is plain bold condensed, like the derby name rows.
// The star therefore has to stay faint enough for the type to read over it —
// a soft drop shadow is all that separates them now.
const STAR_OPACITY = 0.3


function Line({ text, color, size, ls, style }: {
  text: string; color: string; size: number; ls: number; style?: CSSProperties
}) {
  return (
    // The wrapper carries the same font-size as the span on purpose: its strut
    // and the inline-block then share a baseline offset, so the line box is
    // exactly `size` tall and the slack constants below hold. Leave the strut at
    // the inherited size and the box grows by an unrelated amount.
    <div style={{ textAlign: 'center', fontSize: size, ...style }}>
      <span
        style={{
          display: 'inline-block',
          color,
          letterSpacing: `${ls}em`,
          // CSS applies letter-spacing after the LAST glyph too, so the trailing
          // space is inside the span's width and would shove the ink off centre
          // by ls/2. Negative margin takes it back out of the layout box.
          marginRight: `-${ls}em`,
        }}
      >
        {text}
      </span>
    </div>
  )
}

/**
 * @param size Font size in px of each line. Ink height is `size * INK_H_EM`.
 * @param star Draw a gold star behind the type, centred on the INK (not on the
 *   box — the box carries the font's leading, which would sit it ~2px high).
 */
export default function AllStarWordmark({ size = 36, star = false, style }: {
  size?: number; star?: boolean; style?: CSSProperties
}) {
  const gradId = useId()
  const starH = STAR_H_EM * size
  // Ink starts SLACK_ABOVE_CAPS below the box top; centre the star on its middle.
  const inkMid = (SLACK_ABOVE_CAPS + INK_H_EM / 2) * size
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        fontFamily: 'var(--font-score)',
        fontWeight: FONT_WEIGHT,
        lineHeight: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        textShadow: `0 ${Math.max(1, size * 0.04)}px ${size * 0.1}px rgba(0,0,0,0.45)`,
        ...style,
      }}
    >
      {star && (
        <svg
          viewBox={`0 0 ${STAR_VB_W} ${STAR_VB_H}`}
          width={starH * STAR_ASPECT}
          height={starH}
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: inkMid,
            transform: 'translate(-50%, -50%)',
            zIndex: 0, pointerEvents: 'none', overflow: 'visible',
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fde047" />
              <stop offset="1" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
          <polygon points={STAR_POINTS} fill={`url(#${gradId})`} opacity={STAR_OPACITY} />
        </svg>
      )}
      <Line
        text="ALLSTAR" color={BLUE} size={size} ls={LS.ALLSTAR}
        style={{
          // The boxes already sit SLACK_BELOW + SLACK_ABOVE apart, so close the
          // difference down to the gap actually wanted.
          marginBottom: (LINE_GAP_EM - SLACK_BELOW_BASE - SLACK_ABOVE_CAPS) * size,
          position: 'relative', zIndex: 1,
        }}
      />
      <Line
        text="WEEKEND" color={RED} size={size} ls={LS.WEEKEND}
        style={{ position: 'relative', zIndex: 1 }}
      />
    </div>
  )
}
