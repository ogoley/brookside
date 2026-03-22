import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence, usePresence } from 'framer-motion'
import { computeGameStats } from '../scoring/engine'
import { useGameStats } from '../hooks/useGameStats'
import type { GameMeta, TeamsMap, PlayersMap, MatchupState, HittingStats, PitchingStats } from '../types'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  teams: TeamsMap
  players: PlayersMap
  matchup: MatchupState
}

function lastName(name: string): string {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1].toUpperCase()
}

function statFmt(val: number | undefined | null): string {
  if (val == null) return '—'
  return String(val)
}

function avgFmt(val: number | undefined | null): string {
  if (!val) return '.000'
  return val.toFixed(3).replace(/^0\./, '.')
}

function ipFmt(val: number | undefined | null): string {
  if (val == null) return '0.0'
  return val.toFixed(1)
}

// ── Stat row ──────────────────────────────────────────────────────────────

function StatRow({ label, value, accentColor, index, side }: {
  label: string; value: string; accentColor: string; index: number; side: 'left' | 'right'
}) {
  return (
    <motion.div
      className="flex items-center"
      style={{ justifyContent: side === 'left' ? 'flex-end' : 'flex-start', gap: 14 }}
      initial={{ opacity: 0, x: side === 'left' ? -50 : 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', damping: 22, stiffness: 300, delay: index * 0.07 }}
    >
      {side === 'left' ? (
        <>
          <span style={{ fontFamily: 'var(--font-score)', fontSize: 14, color: 'rgba(255,255,255,0.62)', minWidth: 52, textAlign: 'right' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-score)', fontSize: 38, color: '#fff', fontWeight: 900, minWidth: 80, textAlign: 'right', lineHeight: 1 }}>{value}</span>
          <div style={{ width: 4, height: 26, background: accentColor, borderRadius: 2, flexShrink: 0 }} />
        </>
      ) : (
        <>
          <div style={{ width: 4, height: 26, background: accentColor, borderRadius: 2, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-score)', fontSize: 38, color: '#fff', fontWeight: 900, minWidth: 80, lineHeight: 1 }}>{value}</span>
          <span style={{ fontFamily: 'var(--font-score)', fontSize: 14, color: 'rgba(255,255,255,0.62)', minWidth: 52 }}>{label}</span>
        </>
      )}
    </motion.div>
  )
}

function BatterStatsGrid({ stats, accentColor }: { stats: HittingStats; accentColor: string }) {
  const rows = [
    { label: 'AVG', value: avgFmt(stats.avg) },
    { label: 'H',   value: `${statFmt(stats.h)}/${statFmt(stats.ab)}` },
    { label: 'HR',  value: statFmt(stats.hr) },
    { label: 'RBI', value: statFmt(stats.rbi) },
    { label: 'BB',  value: statFmt(stats.bb) },
    { label: 'K',   value: statFmt(stats.k) },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-end' }}>
      {rows.map((r, i) => <StatRow key={r.label} {...r} accentColor={accentColor} index={i} side="left" />)}
    </div>
  )
}

function PitcherStatsGrid({ stats, accentColor }: { stats: PitchingStats; accentColor: string }) {
  const rows = [
    { label: 'ERA', value: stats.era != null ? stats.era.toFixed(2) : '0.00' },
    { label: 'IP',  value: ipFmt(stats.inningsPitched) },
    { label: 'K',   value: statFmt(stats.k) },
    { label: 'BB',  value: statFmt(stats.bb) },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
      {rows.map((r, i) => <StatRow key={r.label} {...r} accentColor={accentColor} index={i} side="right" />)}
    </div>
  )
}

function EmptyStatsNote({ side, accentColor }: { side: 'left' | 'right'; accentColor: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
      style={{ textAlign: side === 'left' ? 'right' : 'left' }}>
      <span style={{ fontFamily: 'var(--font-score)', fontSize: 13, color: accentColor, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {side === 'left' ? 'No at-bats yet' : 'No pitches yet'}
      </span>
    </motion.div>
  )
}

function TeamLogo({ logoUrl, color, size = 96 }: { logoUrl?: string; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}44`, border: `2px solid ${color}99`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 28px ${color}66`, flexShrink: 0,
    }}>
      {logoUrl
        ? <img src={logoUrl} alt="" style={{ width: size * 0.62, height: size * 0.62, objectFit: 'contain' }} />
        : <div style={{ width: size * 0.4, height: size * 0.4, borderRadius: '50%', background: `${color}66` }} />
      }
    </div>
  )
}

// ── Main scene ────────────────────────────────────────────────────────────

export function MatchupScene({ game, teams, players, matchup }: Props) {
  // usePresence lets this component control its own unmount timing
  const [isPresent, safeToRemove] = usePresence()

  // Hold the DOM alive until our exit animations finish (~800ms)
  useEffect(() => {
    if (isPresent) return
    const t = setTimeout(() => safeToRemove?.(), 1100)
    return () => clearTimeout(t)
  }, [isPresent, safeToRemove])

  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const { atBats } = useGameStats(game.currentGameId ?? null)
  const atBatList = useMemo(
    () => Object.values(atBats).sort((a, b) => a.timestamp - b.timestamp),
    [atBats],
  )

  const { batterId, pitcherId } = matchup
  const batter = batterId ? players[batterId] : null
  const pitcher = pitcherId ? players[pitcherId] : null
  const batterTeam = batter ? teams[batter.teamId] : null
  const pitcherTeam = pitcher ? teams[pitcher.teamId] : null

  const batterGameStats = useMemo(
    () => (batterId ? computeGameStats(atBatList, batterId) : null),
    [atBatList, batterId],
  )
  const pitcherGameStats = useMemo(
    () => (pitcherId ? computeGameStats(atBatList, pitcherId) : null),
    [atBatList, pitcherId],
  )

  const [shockwaveKey, setShockwaveKey] = useState(0)
  const [statsVisible, setStatsVisible] = useState(false)

  useEffect(() => {
    setStatsVisible(false)
    const t1 = setTimeout(() => setShockwaveKey(k => k + 1), 260)
    const t2 = setTimeout(() => setStatsVisible(true), 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [batterId, pitcherId])

  const batterColor = batterTeam?.primaryColor ?? '#1a3a6b'
  const pitcherColor = pitcherTeam?.primaryColor ?? '#c0392b'

  // Fixed column widths — sum must equal 1920 for the clip windows to tile perfectly
  const SIDE_W = 840
  const CENTER_W = 240  // 840 + 240 + 840 = 1920 ✓

  // ── Body content ──────────────────────────────────────────────────────
  // Rendered in BOTH clip windows (left half and right half).
  // Pure JSX — no hooks inside. Width is exactly 1920px so the two
  // 50%-width clip windows tile it perfectly: left shows x 0–960,
  // right shows x 960–1920.
  const bodyContent = (
    <div style={{ width: 1920, height: '100%', position: 'relative', background: '#0d1e38' }}>
      {/* Team-colored ambient glows */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(ellipse 900px 700px at 18% 60%, ${batterColor}42, transparent 70%),
          radial-gradient(ellipse 900px 700px at 82% 60%, ${pitcherColor}42, transparent 70%)
        `,
      }} />

      {/* Center seam */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(to right, transparent 49%, rgba(255,255,255,0.08) 50%, transparent 51%)',
      }} />

      {/* Shockwave rings — centered at x=960 (50% of 1920) */}
      <AnimatePresence>
        {shockwaveKey > 0 && (
          <div key={shockwaveKey} className="pointer-events-none" style={{
            position: 'absolute', zIndex: 30,
            left: 910, top: 'calc(50% - 50px)',  // center of 100px ring = x:960
          }}>
            <motion.div style={{ position: 'absolute', width: 100, height: 100, borderRadius: '50%', border: '5px solid rgba(255,255,255,0.95)' }}
              initial={{ scale: 0.15, opacity: 1 }}
              animate={{ scale: 16, opacity: 0 }}
              transition={{ duration: 0.52, ease: [0.05, 0.7, 0.3, 1] }}
            />
            <motion.div style={{ position: 'absolute', width: 100, height: 100, borderRadius: '50%', border: `3px solid ${batterColor}cc` }}
              initial={{ scale: 0.1, opacity: 0.9 }}
              animate={{ scale: 20, opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.04 }}
            />
            <motion.div style={{ position: 'absolute', width: 100, height: 100, borderRadius: '50%', border: `3px solid ${pitcherColor}cc` }}
              initial={{ scale: 0.1, opacity: 0.9 }}
              animate={{ scale: 20, opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.09 }}
            />
            <motion.div style={{ position: 'absolute', width: 100, height: 100, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)' }}
              initial={{ scale: 0.3, opacity: 1 }}
              animate={{ scale: 2.5, opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
          </div>
        )}
      </AnimatePresence>

      {/* ── NAMEPLATE ROW ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingTop: 160 }}>

        {/* BATTER — springs in from left */}
        <motion.div
          style={{ width: SIDE_W, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
          initial={{ x: -1000, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 13, stiffness: 210, delay: 0.05 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingRight: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <TeamLogo logoUrl={batterTeam?.logoUrl} color={batterColor} size={100} />
              </div>
              <div style={{ fontFamily: 'var(--font-score)', fontSize: 88, fontWeight: 900, color: '#fff', textShadow: `0 0 70px ${batterColor}99`, letterSpacing: '-0.025em', lineHeight: 1 }}>
                {batter ? lastName(batter.name) : '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                {batter?.jerseyNumber && (
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700, background: `${batterColor}40`, color: batterColor, padding: '3px 8px', borderRadius: 4 }}>
                    #{batter.jerseyNumber}
                  </span>
                )}
                <span style={{ fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 700, color: batterColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {batterTeam?.name ?? ''}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>
                Batter
              </div>
            </div>
            {/* Accent bar */}
            <div style={{ width: 7, height: 200, background: `linear-gradient(to bottom, transparent, ${batterColor}, transparent)`, borderRadius: 4, boxShadow: `0 0 22px ${batterColor}bb`, flexShrink: 0 }} />
          </div>
        </motion.div>

        {/* VS — center */}
        <div style={{ width: CENTER_W, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 18 }}>
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.72, type: 'spring', damping: 12, stiffness: 240 }}
          >
            <div style={{
              width: 78, height: 78, borderRadius: '50%',
              background: 'rgba(255,255,255,0.14)', border: '2px solid rgba(255,255,255,0.32)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-score)', fontSize: 28, fontWeight: 900, color: '#fff',
              boxShadow: '0 0 30px rgba(255,255,255,0.06)',
            }}>
              VS
            </div>
          </motion.div>
        </div>

        {/* PITCHER — springs in from right */}
        <motion.div
          style={{ width: SIDE_W, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
          initial={{ x: 1000, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 13, stiffness: 210, delay: 0.05 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            {/* Accent bar */}
            <div style={{ width: 7, height: 200, background: `linear-gradient(to bottom, transparent, ${pitcherColor}, transparent)`, borderRadius: 4, boxShadow: `0 0 22px ${pitcherColor}bb`, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <TeamLogo logoUrl={pitcherTeam?.logoUrl} color={pitcherColor} size={100} />
              </div>
              <div style={{ fontFamily: 'var(--font-score)', fontSize: 88, fontWeight: 900, color: '#fff', textShadow: `0 0 70px ${pitcherColor}99`, letterSpacing: '-0.025em', lineHeight: 1 }}>
                {pitcher ? lastName(pitcher.name) : '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                {pitcher?.jerseyNumber && (
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700, background: `${pitcherColor}40`, color: pitcherColor, padding: '3px 8px', borderRadius: 4 }}>
                    #{pitcher.jerseyNumber}
                  </span>
                )}
                <span style={{ fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 700, color: pitcherColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {pitcherTeam?.name ?? ''}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>
                Pitcher
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── DIVIDER ── */}
      <motion.div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ delay: 0.85, duration: 0.5, ease: 'easeOut' }}
      >
        <div style={{ width: SIDE_W * 2 + CENTER_W, height: 1, background: 'rgba(255,255,255,0.22)' }} />
      </motion.div>

      {/* ── STATS ROW ── */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 30 }}>
        <div style={{ width: SIDE_W, display: 'flex', justifyContent: 'flex-end', paddingRight: 27 }}>
          {statsVisible && (
            batterGameStats?.hitting
              ? <BatterStatsGrid stats={batterGameStats.hitting} accentColor={batterColor} />
              : <EmptyStatsNote side="left" accentColor={batterColor} />
          )}
        </div>
        <div style={{ width: CENTER_W }} />
        <div style={{ width: SIDE_W, display: 'flex', justifyContent: 'flex-start', paddingLeft: 27 }}>
          {statsVisible && (
            pitcherGameStats?.pitching
              ? <PitcherStatsGrid stats={pitcherGameStats.pitching} accentColor={pitcherColor} />
              : <EmptyStatsNote side="right" accentColor={pitcherColor} />
          )}
        </div>
      </div>
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full" style={{ background: 'transparent' }}>
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* ── HEADING — floats absolutely over the full-page curtain; just the text exits upward ── */}
      <motion.div
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 52, pointerEvents: 'none' }}
        initial={{ opacity: 0, y: -30 }}
        animate={isPresent ? { opacity: 1, y: 0 } : { opacity: 0, y: -220 }}
        transition={isPresent
          ? { type: 'spring', damping: 24, stiffness: 220 }
          : { type: 'spring', damping: 20, stiffness: 160 }
        }
      >
        <div style={{ fontFamily: 'var(--font-score)', fontSize: 52, fontWeight: 900, color: '#fff', letterSpacing: '0.12em', lineHeight: 1, textTransform: 'uppercase' }}>
          Head to Head
        </div>
        <div style={{ fontFamily: 'var(--font-score)', fontSize: 15, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: 8 }}>
          Today's Matchup
        </div>
      </motion.div>

      {/* ── FULL-PAGE CURTAIN ──
          Two 50%-wide clip windows covering the entire 1080px height.
          On exit: left slides off left, right slides off right —
          the widening gap reveals the GameScene scoreboard behind.
      ── */}

        {/* LEFT WINDOW — shows bodyContent x: 0–960
            Entry: windows don't animate (the cards inside spring in).
            Exit: slow curtain drag — starts hesitant, then pulls away,
                  revealing the GameScene scoreboard through the widening gap. */}
        <motion.div
          style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden' }}
          animate={{ x: isPresent ? 0 : '-100%' }}
          transition={isPresent
            ? { duration: 0 }
            : { duration: 0.9, ease: [0.3, 0, 0.7, 1], delay: 0.05 }
          }
        >
          <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: '100%' }}>
            {bodyContent}
          </div>
        </motion.div>

        {/* RIGHT WINDOW — shows bodyContent x: 960–1920 */}
        <motion.div
          style={{ position: 'absolute', left: '50%', top: 0, width: '50%', height: '100%', overflow: 'hidden' }}
          animate={{ x: isPresent ? 0 : '100%' }}
          transition={isPresent
            ? { duration: 0 }
            : { duration: 0.9, ease: [0.3, 0, 0.7, 1], delay: 0.05 }
          }
        >
          <div style={{ position: 'absolute', left: -960, top: 0, width: 1920, height: '100%' }}>
            {bodyContent}
          </div>
        </motion.div>

      {/* Footer watermark */}
      <motion.div
        className="absolute bottom-7 left-0 right-0 flex justify-center"
        animate={{ opacity: isPresent ? 1 : 0 }}
        transition={{ delay: isPresent ? 1.6 : 0, duration: 0.3 }}
      >
        <span style={{ fontFamily: 'var(--font-score)', fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Current Game Stats
        </span>
      </motion.div>
    </div>
  )
}
