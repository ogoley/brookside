import { motion } from 'framer-motion'
import type { TeamsMap, StandingsData } from '../types'

interface Props {
  teams: TeamsMap
  // Will be replaced with live Firebase /standings data when that path is wired up.
  // For now the component accepts optional override standings; falls back to STUB.
  standings?: StandingsData
}

// ── Stub data — replace with useStandings() hook when /standings is in Firebase ──
// 8-team league: top 2 get playoff bye, bottom 2 are in elimination zone.
const STUB_STANDINGS: StandingsData = [
  { teamId: 'swing_mafia',      w: 11, l: 3,  streak: 'W3' },
  { teamId: 'gamecocks',        w: 10, l: 4,  streak: 'W1' },
  { teamId: 'trash_pandas',     w: 8,  l: 6,  streak: 'L1' },
  { teamId: 'wiffle_whalers',   w: 7,  l: 7,  streak: 'W2' },
  { teamId: 'nuke_squad',       w: 7,  l: 7,  streak: 'L2' },
  { teamId: 'yellow_bat_yetis', w: 6,  l: 8,  streak: 'W1' },
  { teamId: 'base_invaders',    w: 4,  l: 10, streak: 'L4' },
  { teamId: 'moose_knucklers',  w: 3,  l: 11, streak: 'L3' },
]

// Playoff structure constants
const BYE_COUNT      = 2   // top N teams receive a first-round bye
const PLAYOFF_COUNT  = 6   // top N teams make the playoffs (rest are eliminated)

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(w: number, l: number): string {
  const total = w + l
  if (total === 0) return '.000'
  return (w / total).toFixed(3).replace(/^0\./, '.')
}

function gb(leaderW: number, leaderL: number, w: number, l: number): string {
  const diff = (leaderW - w + l - leaderL) / 2
  if (diff === 0) return '—'
  return diff % 1 === 0 ? String(diff) : diff.toFixed(1)
}

// ── Row divider ───────────────────────────────────────────────────────────────

function SectionDivider({ label, color, delay }: { label: string; color: string; delay: number }) {
  return (
    <motion.div
      className="flex items-center gap-4 px-8"
      style={{ height: 44 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.4 }}
    >
      <motion.div
        style={{ flex: 1, height: 1, background: color, opacity: 0.5 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: delay + 0.05, duration: 0.4, ease: 'easeOut' }}
      />
      <span
        className="uppercase tracking-widest font-bold"
        style={{ fontFamily: 'var(--font-score)', fontSize: 12, color, letterSpacing: '0.22em', whiteSpace: 'nowrap' }}
      >
        {label}
      </span>
      <motion.div
        style={{ flex: 1, height: 1, background: color, opacity: 0.5 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: delay + 0.05, duration: 0.4, ease: 'easeOut' }}
      />
    </motion.div>
  )
}

// ── Standing row ──────────────────────────────────────────────────────────────

function StandingRow({
  rank,
  teamId,
  standing,
  teams,
  leaderW,
  leaderL,
  zone,
  delay,
}: {
  rank: number
  teamId: string
  standing: { w: number; l: number; streak: string }
  teams: TeamsMap
  leaderW: number
  leaderL: number
  zone: 'bye' | 'playoff' | 'eliminated'
  delay: number
}) {
  const team = teams[teamId]
  const primaryColor = team?.primaryColor ?? '#555'

  const accentColor =
    zone === 'bye'       ? '#fbbf24' :
    zone === 'eliminated' ? '#ef4444' :
    'rgba(255,255,255,0.15)'

  const rowBg =
    zone === 'bye'       ? 'rgba(251,191,36,0.07)'  :
    zone === 'eliminated' ? 'rgba(239,68,68,0.07)'   :
    'rgba(255,255,255,0.04)'

  const streakColor = standing.streak.startsWith('W') ? '#4ade80' : '#f87171'

  return (
    <motion.div
      className="flex items-center"
      style={{
        height: 88,
        background: rowBg,
        borderRadius: 12,
        marginBottom: 6,
        borderLeft: `4px solid ${accentColor}`,
        overflow: 'hidden',
        position: 'relative',
      }}
      initial={{ x: 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 22, stiffness: 200, delay }}
    >
      {/* Rank */}
      <div style={{ width: 72, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--font-score)',
            fontSize: zone === 'bye' ? 34 : 28,
            fontWeight: 900,
            color: zone === 'bye' ? '#fbbf24' : zone === 'eliminated' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.55)',
            lineHeight: 1,
          }}
        >
          {rank}
        </span>
      </div>

      {/* Team logo */}
      <div style={{ width: 72, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: `${primaryColor}33`,
          border: `2px solid ${primaryColor}77`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {team?.logoUrl
            ? <img src={team.logoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
            : <span style={{ fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 900, color: primaryColor }}>
                {team?.shortName?.slice(0, 2) ?? '?'}
              </span>
          }
        </div>
      </div>

      {/* Team name */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 16, paddingRight: 24 }}>
        <div
          style={{
            fontFamily: 'var(--font-score)',
            fontSize: 26,
            fontWeight: 700,
            color: zone === 'eliminated' ? 'rgba(255,255,255,0.45)' : '#ffffff',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {team?.name ?? teamId}
        </div>
        {zone === 'bye' && (
          <div style={{
            display: 'inline-block',
            marginTop: 5,
            background: 'rgba(251,191,36,0.18)',
            border: '1px solid rgba(251,191,36,0.4)',
            borderRadius: 4,
            padding: '2px 8px',
            fontFamily: 'var(--font-score)',
            fontSize: 10,
            fontWeight: 700,
            color: '#fbbf24',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}>
            Playoff Bye
          </div>
        )}
        {zone === 'eliminated' && (
          <div style={{
            display: 'inline-block',
            marginTop: 5,
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 4,
            padding: '2px 8px',
            fontFamily: 'var(--font-score)',
            fontSize: 10,
            fontWeight: 700,
            color: '#f87171',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}>
            Eliminated
          </div>
        )}
      </div>

      {/* W */}
      <StatCell label="W" value={String(standing.w)} highlight={zone === 'bye'} eliminated={zone === 'eliminated'} />

      {/* L */}
      <StatCell label="L" value={String(standing.l)} eliminated={zone === 'eliminated'} />

      {/* PCT */}
      <StatCell label="PCT" value={pct(standing.w, standing.l)} highlight={zone === 'bye'} eliminated={zone === 'eliminated'} wide />

      {/* GB */}
      <StatCell label="GB" value={gb(leaderW, leaderL, standing.w, standing.l)} eliminated={zone === 'eliminated'} />

      {/* Streak */}
      <div style={{ width: 100, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingRight: 24 }}>
        <span style={{ fontFamily: 'var(--font-score)', fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1, marginBottom: 4 }}>
          STK
        </span>
        <span style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: streakColor, lineHeight: 1 }}>
          {standing.streak}
        </span>
      </div>
    </motion.div>
  )
}

function StatCell({ label, value, highlight, eliminated, wide }: {
  label: string; value: string; highlight?: boolean; eliminated?: boolean; wide?: boolean
}) {
  return (
    <div style={{ width: wide ? 110 : 90, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--font-score)', fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1, marginBottom: 4 }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-score)',
        fontSize: 26,
        fontWeight: 900,
        lineHeight: 1,
        color: eliminated ? 'rgba(255,255,255,0.3)' : highlight ? '#fbbf24' : '#ffffff',
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Main scene ────────────────────────────────────────────────────────────────

export function StandingsScene({ teams, standings }: Props) {
  const rows = standings ?? STUB_STANDINGS
  const leader = rows[0]

  // Build render list interleaving rows + section dividers
  type RenderItem =
    | { kind: 'row'; index: number; rank: number; entry: StandingsData[number]; zone: 'bye' | 'playoff' | 'eliminated' }
    | { kind: 'divider'; label: string; color: string }

  const items: RenderItem[] = []
  rows.forEach((entry, index) => {
    items.push({
      kind: 'row',
      index,
      rank: index + 1,
      entry,
      zone: index < BYE_COUNT ? 'bye' : index >= PLAYOFF_COUNT ? 'eliminated' : 'playoff',
    })
    if (index === BYE_COUNT - 1) {
      items.push({ kind: 'divider', label: 'Playoff Bye Line', color: '#fbbf24' })
    }
    if (index === PLAYOFF_COUNT - 1 && PLAYOFF_COUNT < rows.length) {
      items.push({ kind: 'divider', label: 'Elimination Zone', color: '#ef4444' })
    }
  })

  // Assign animation delays — rows and their following divider stagger together
  let rowCount = 0
  const delays: number[] = []
  for (const item of items) {
    if (item.kind === 'row') {
      delays.push(0.1 + rowCount * 0.08)
      rowCount++
    } else {
      delays.push(0.1 + (rowCount - 1) * 0.08 + 0.12)
    }
  }

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: '#080d18' }}
    >
      {/* Subtle top-center glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 1200px 400px at 50% 0%, rgba(255,255,255,0.04), transparent 70%)' }}
      />

      <div
        className="relative flex flex-col"
        style={{ maxWidth: 1440, margin: '0 auto', padding: '52px 64px 0' }}
      >
        {/* ── Header ── */}
        <motion.div
          className="flex items-end justify-between"
          style={{ marginBottom: 32 }}
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
        >
          <div>
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
              League Standings
            </div>
            <div style={{ fontFamily: 'var(--font-score)', fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 6 }}>
              2025 Season
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center" style={{ paddingBottom: 4 }}>
            {(['W', 'L', 'PCT', 'GB', 'STK'] as const).map((h) => (
              <div
                key={h}
                style={{
                  width: h === 'PCT' ? 110 : h === 'STK' ? 100 : 90,
                  textAlign: 'center',
                  fontFamily: 'var(--font-score)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                }}
              >
                {h}
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Header divider ── */}
        <motion.div
          style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 12 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }}
        />

        {/* ── Standings rows + section dividers ── */}
        {items.map((item, i) =>
          item.kind === 'row' ? (
            <StandingRow
              key={item.entry.teamId}
              rank={item.rank}
              teamId={item.entry.teamId}
              standing={item.entry}
              teams={teams}
              leaderW={leader?.w ?? 0}
              leaderL={leader?.l ?? 0}
              zone={item.zone}
              delay={delays[i]}
            />
          ) : (
            <SectionDivider
              key={item.label}
              label={item.label}
              color={item.color}
              delay={delays[i]}
            />
          )
        )}
      </div>
    </div>
  )
}
