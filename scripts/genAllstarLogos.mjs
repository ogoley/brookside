// Generates the all-star team badge SVGs (Team Rist / Team Hiller)
// with Barlow Condensed 700 embedded as a base64 data URI so the text renders
// in <img>/OBS contexts.
//
// The ALL-STAR WEEKEND lockup used to be generated here too. It is now plain
// text — see src/components/AllStarWordmark.tsx — so this script only emits the
// two team badges.
//
// ANNUAL RUNBOOK (see ALLSTAR.md): edit ONLY the YEARLY CONFIG block below,
// run `node scripts/genAllstarLogos.mjs`, and deploy. Keep team `id`s in sync
// with ALLSTAR_SEED_TEAMS / ALLSTAR_SEED_ROSTERS in src/allstar.ts (each id's
// logoUrl is /logos/<id with _ -> ->.svg).
import { readFileSync, writeFileSync } from 'fs'

// ── YEARLY CONFIG ────────────────────────────────────────────────────────────
const YEAR = 2026
const TEAMS = [
  { id: 'team_rist',   banner: 'TEAM RIST',   color: '#c8102e', bannerFontSize: 62, bannerLs: 3 },
  { id: 'team_hiller', banner: 'TEAM HILLER', color: '#1e40af', bannerFontSize: 60, bannerLs: 2 },
]
// ─────────────────────────────────────────────────────────────────────────────

const b64 = readFileSync(new URL('./barlow-condensed-700.b64.txt', import.meta.url), 'ascii').trim()
const OUT = new URL('../public/logos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const fontStyle = `<style>@font-face{font-family:'Barlow Condensed';font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${b64}) format('woff2');}</style>`
const FONT = `font-family="'Barlow Condensed','Arial Narrow',sans-serif" font-weight="700"`

// Wiffle ball traced from the user-approved Noun Project reference (Melissa
// Schmitt): a perspective band of 6 oblong slots arcing top-center -> left ->
// bottom-center -> right edge, foreshortened to slivers near the silhouette.
// Reference space: ball center (345,300), r=245. [cx, cy, len, wid, rotDeg]
// Do NOT redesign: round holes and flat slot-fans were explicitly rejected.
const BALL_SLOTS = [
  [335,  62,  66, 19,   8],
  [228, 122, 112, 36, -19],
  [218, 262, 132, 54, -33],
  [318, 368, 136, 58, -57],
  [468, 398, 100, 48, -73],
  [566, 330, 114, 25, -86],
]

function ball(cx, cy, r, holeFill, mirror = false) {
  const s = r / 245
  const slots = BALL_SLOTS.map(([sx, sy, len, wid, rot]) => {
    const scx = cx + (sx - 345) * s
    const scy = cy + (sy - 300) * s
    const l = len * s
    const w = wid * s
    return `<rect x="${(scx - l / 2).toFixed(1)}" y="${(scy - w / 2).toFixed(1)}" width="${l.toFixed(1)}" height="${w.toFixed(1)}" rx="${(w / 2).toFixed(1)}" fill="${holeFill}" transform="rotate(${rot} ${scx.toFixed(1)} ${scy.toFixed(1)})"/>`
  })
  // Clip so edge slots stay inside the sphere, exactly like the reference
  const clipId = `ballClip${Math.round(cx)}x${Math.round(cy)}${mirror ? 'm' : ''}`
  // A mirrored twin makes a flanking pair read as one symmetric unit instead of
  // two copies of the same lopsided seam pattern.
  const flip = mirror ? ` transform="translate(${(2 * cx).toFixed(1)} 0) scale(-1 1)"` : ''
  return `
  <clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  <g clip-path="url(#${clipId})"><g${flip}>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>
    ${slots.join('\n    ')}
  </g></g>`
}

// SVG letter-spacing is added AFTER every glyph, including the last, so the
// trailing space is baked into the advance width that text-anchor="middle"
// centers. Nudging the anchor by ls/2 puts the visible ink back on the axis.
const midX = (cx, ls) => (cx + ls / 2).toFixed(2)

// 5-point star polygon
function starPoints(cx, cy, R, r) {
  const pts = []
  for (let i = 0; i < 5; i++) {
    const ao = (-90 + i * 72) * Math.PI / 180
    const ai = (-54 + i * 72) * Math.PI / 180
    pts.push(`${(cx + R * Math.cos(ao)).toFixed(1)},${(cy + R * Math.sin(ao)).toFixed(1)}`)
    pts.push(`${(cx + r * Math.cos(ai)).toFixed(1)},${(cy + r * Math.sin(ai)).toFixed(1)}`)
  }
  return pts.join(' ')
}

function teamBadge({ id, banner, color, bannerFontSize, bannerLs }) {
  const arcId = `topArc_${id}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${fontStyle}
  <defs>
    <path id="${arcId}" d="M 52 256 A 204 204 0 0 1 460 256" fill="none"/>
  </defs>

  <circle cx="256" cy="256" r="250" fill="#0f172a"/>
  <circle cx="256" cy="256" r="250" fill="none" stroke="${color}" stroke-width="12"/>
  <circle cx="256" cy="256" r="232" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.55"/>

  <text ${FONT} font-size="34" letter-spacing="8" fill="#ffffff" opacity="0.88">
    <textPath href="#${arcId}" startOffset="${(50 + (8 / 2) / (Math.PI * 204) * 100).toFixed(2)}%" text-anchor="middle">BROOKSIDE WIFFLE BALL</textPath>
  </text>

  <polygon points="${starPoints(256, 226, 148, 57)}" fill="${color}" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>
${ball(256, 208, 60, '#0f172a')}

  <rect x="76" y="310" width="360" height="76" rx="14" fill="${color}" stroke="#ffffff" stroke-width="5"/>
  <text x="${midX(256, bannerLs)}" y="368" text-anchor="middle" ${FONT} font-size="${bannerFontSize}" letter-spacing="${bannerLs}" fill="#ffffff">${banner}</text>

  <polygon points="${starPoints(178, 441, 17, 6.5)}" fill="#ffffff" opacity="0.9"/>
  <text x="${midX(256, 8)}" y="456" text-anchor="middle" ${FONT} font-size="40" letter-spacing="8" fill="#ffffff" opacity="0.9">${YEAR}</text>
  <polygon points="${starPoints(334, 441, 17, 6.5)}" fill="#ffffff" opacity="0.9"/>
</svg>
`
}

for (const team of TEAMS) {
  const file = `${team.id.replace(/_/g, '-')}.svg`
  writeFileSync(`${OUT}/${file}`, teamBadge(team))
  console.log(`wrote ${file}`)
}
