import { motion } from 'framer-motion'
import type { TeamsMap, PlayersMap, StandingsData, Team, Player } from '../types'

// ── Qualification constants ───────────────────────────────────────────────────
const MIN_AB        = 10    // minimum at-bats to qualify for batting leaderboard
const MIN_IP_PCTG   = 0.30  // pitcher must have thrown in ≥30% of team's games
const GAME_INNINGS  = 6     // average innings per game — used to compute min IP

// ── Stub standings (used when no live standings prop is passed) ───────────────
const STUB_STANDINGS: StandingsData = [
  { teamId: 'swing_mafia',      w: 11, l: 3,  t: 0, streak: 'W3' },
  { teamId: 'gamecocks',        w: 10, l: 4,  t: 0, streak: 'W1' },
  { teamId: 'trash_pandas',     w: 8,  l: 6,  t: 0, streak: 'L1' },
  { teamId: 'wiffle_whalers',   w: 7,  l: 7,  t: 0, streak: 'W2' },
  { teamId: 'nuke_squad',       w: 7,  l: 7,  t: 0, streak: 'L2' },
  { teamId: 'yellow_bat_yetis', w: 6,  l: 8,  t: 0, streak: 'W1' },
  { teamId: 'base_invaders',    w: 4,  l: 10, t: 0, streak: 'L4' },
  { teamId: 'moose_knucklers',  w: 3,  l: 11, t: 0, streak: 'L3' },
]

interface Props {
  teams: TeamsMap
  players: PlayersMap
  standings?: StandingsData
}

// ── Crown SVG ─────────────────────────────────────────────────────────────────

function Crown() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M1 13 L3.5 4 L7.5 8.5 L9 1 L10.5 8.5 L14.5 4 L17 13 Z"
        fill="#fbbf24"
        stroke="#b45309"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, highlight, wide }: {
  label: string
  value: string
  highlight?: boolean
  wide?: boolean
}) {
  return (
    <div style={{ width: wide ? 100 : 76, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{
        fontFamily: 'var(--font-score)', fontSize: 10,
        color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
        letterSpacing: '0.15em', lineHeight: 1, marginBottom: 3,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, lineHeight: 1,
        color: highlight ? '#fbbf24' : '#ffffff',
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Leader row ────────────────────────────────────────────────────────────────

function LeaderRow({
  rank, player, team,
  primary, stat1, stat2,
  delay, side,
}: {
  rank: number
  player: Player
  team?: Team
  primary: { label: string; value: string }
  stat1:   { label: string; value: string }
  stat2:   { label: string; value: string }
  delay: number
  side: 'left' | 'right'
}) {
  const primaryColor = team?.primaryColor ?? '#555'
  const isFirst = rank === 1

  return (
    <motion.div
      className="flex items-center"
      style={{
        height: 80,
        background: isFirst ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        marginBottom: 5,
        borderLeft: `4px solid ${isFirst ? '#fbbf24' : primaryColor + '99'}`,
        overflow: 'hidden',
      }}
      initial={{ x: side === 'left' ? -80 : 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 22, stiffness: 200, delay }}
    >
      {/* Rank + crown */}
      <div style={{ width: 58, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        {isFirst && <Crown />}
        <span style={{
          fontFamily: 'var(--font-score)',
          fontSize: isFirst ? 26 : 21,
          fontWeight: 900,
          color: isFirst ? '#fbbf24' : 'rgba(255,255,255,0.4)',
          lineHeight: 1,
        }}>
          {rank}
        </span>
      </div>

      {/* Logo */}
      <div style={{ width: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `${primaryColor}33`,
          border: `2px solid ${primaryColor}66`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {team?.logoUrl
            ? <img src={team.logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            : <span style={{ fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 900, color: primaryColor }}>
                {team?.shortName?.slice(0, 2) ?? '?'}
              </span>
          }
        </div>
      </div>

      {/* Name + team */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 10, paddingRight: 12 }}>
        <div style={{
          fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 700,
          color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em',
          lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {player.name}
        </div>
        <div style={{
          fontFamily: 'var(--font-score)', fontSize: 11,
          color: `${primaryColor}cc`, textTransform: 'uppercase',
          letterSpacing: '0.08em', marginTop: 4,
        }}>
          {team?.shortName ?? ''}
        </div>
      </div>

      {/* Stats */}
      <StatCell label={primary.label} value={primary.value} highlight wide />
      <StatCell label={stat1.label}   value={stat1.value} />
      <StatCell label={stat2.label}   value={stat2.value} />
    </motion.div>
  )
}

// ── Column header row ─────────────────────────────────────────────────────────

function ColumnHeader({ title, color, stats, delay }: {
  title: string
  color: string
  stats: string[]
  delay: number
}) {
  return (
    <motion.div
      className="flex items-center justify-between"
      style={{ marginBottom: 10 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.3 }}
    >
      <span style={{
        fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 900,
        color, textTransform: 'uppercase', letterSpacing: '0.2em',
      }}>
        {title}
      </span>
      <div className="flex">
        {stats.map((h, i) => (
          <div
            key={h}
            style={{
              width: i === 0 ? 100 : 76,
              textAlign: 'center',
              fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 700,
              color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase',
            }}
          >
            {h}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Main scene ────────────────────────────────────────────────────────────────

export function LeaderboardScene({ teams, players, standings }: Props) {
  const standingsData = standings ?? STUB_STANDINGS

  // Build team games map: teamId → total games played
  const teamGamesMap: Record<string, number> = {}
  standingsData.forEach(s => { teamGamesMap[s.teamId] = s.w + s.l + s.t })

  // Top 10 batters — min AB, sorted by AVG desc
  const topBatters = Object.entries(players)
    .filter(([, p]) =>
      (p.stats.hitting?.ab ?? 0) >= MIN_AB &&
      p.stats.hitting?.avg !== undefined
    )
    .sort(([, a], [, b]) => (b.stats.hitting!.avg! - a.stats.hitting!.avg!))
    .slice(0, 10)

  // Top 6 pitchers — qualification filter, sorted by ERA asc
  const topPitchers = Object.entries(players)
    .filter(([, p]) => {
      const ip        = p.stats.pitching?.inningsPitched ?? 0
      const teamGames = teamGamesMap[p.teamId] ?? 0
      const minIP     = teamGames * MIN_IP_PCTG * GAME_INNINGS
      return ip >= minIP && p.stats.pitching?.era !== undefined
    })
    .sort(([, a], [, b]) => (a.stats.pitching!.era! - b.stats.pitching!.era!))
    .slice(0, 6)

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: '#080d18' }}
    >
      {/* Subtle top glow */}
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
          style={{ marginBottom: 28 }}
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
        >
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 56, fontWeight: 900,
            color: '#ffffff', letterSpacing: '0.1em', lineHeight: 1, textTransform: 'uppercase',
          }}>
            League Leaders
          </div>
          <div style={{
            fontFamily: 'var(--font-score)', fontSize: 14,
            color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em',
            textTransform: 'uppercase', marginTop: 6,
          }}>
            2025 Season
          </div>
        </motion.div>

        {/* Header divider */}
        <motion.div
          style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 20 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }}
        />

        {/* ── Two columns ── */}
        <div className="flex" style={{ gap: 48 }}>

          {/* LEFT — Batters */}
          <div style={{ flex: 1 }}>
            <ColumnHeader title="Top Batters" color="#fbbf24" stats={['AVG', 'HR', 'RBI']} delay={0.08} />
            {topBatters.map(([, player], i) => {
              const h = player.stats.hitting!
              return (
                <LeaderRow
                  key={i}
                  rank={i + 1}
                  player={player}
                  team={teams[player.teamId]}
                  primary={{ label: 'AVG', value: h.avg!.toFixed(3).replace(/^0/, '') }}
                  stat1={{ label: 'HR',  value: String(h.hr  ?? 0) }}
                  stat2={{ label: 'RBI', value: String(h.rbi ?? 0) }}
                  delay={0.1 + i * 0.055}
                  side="left"
                />
              )
            })}
            {topBatters.length === 0 && (
              <div style={{
                fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.2)',
                fontSize: 15, marginTop: 24, textAlign: 'center',
                textTransform: 'uppercase', letterSpacing: '0.15em',
              }}>
                No qualified batters
              </div>
            )}
          </div>

          {/* Vertical divider */}
          <motion.div
            style={{ width: 1, background: 'rgba(255,255,255,0.1)', alignSelf: 'stretch', flexShrink: 0 }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.06, duration: 0.5, ease: 'easeOut' }}
          />

          {/* RIGHT — Pitchers */}
          <div style={{ flex: 1 }}>
            <ColumnHeader title="Top Pitchers" color="#60a5fa" stats={['ERA', 'K', 'IP']} delay={0.08} />
            {topPitchers.map(([, player], i) => {
              const p = player.stats.pitching!
              return (
                <LeaderRow
                  key={i}
                  rank={i + 1}
                  player={player}
                  team={teams[player.teamId]}
                  primary={{ label: 'ERA', value: p.era!.toFixed(2) }}
                  stat1={{ label: 'K',  value: String(p.k ?? 0) }}
                  stat2={{ label: 'IP', value: String(Math.floor(p.inningsPitched ?? 0)) }}
                  delay={0.1 + i * 0.07}
                  side="right"
                />
              )
            })}
            {topPitchers.length === 0 && (
              <div style={{
                fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.2)',
                fontSize: 15, marginTop: 24, textAlign: 'center',
                textTransform: 'uppercase', letterSpacing: '0.15em',
              }}>
                No qualified pitchers
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
