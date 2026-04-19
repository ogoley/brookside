import { motion, AnimatePresence } from 'framer-motion'
import { useLivePlayerStats } from '../hooks/useLivePlayerStats'
import type { StatOverlayState, PlayersMap, TeamsMap } from '../types'

interface Props {
  statOverlay: StatOverlayState
  players: PlayersMap
  teams: TeamsMap
  gameId: string | null
}

export function StatOverlay({ statOverlay, players, teams, gameId }: Props) {
  const { visible, playerId, type } = statOverlay

  const player = players[playerId]
  const team = player ? teams[player.teamId] : undefined
  const isPitcher = type === 'pitcher'
  const primary = team?.primaryColor ?? '#1a3a6b'
  const secondary = team?.secondaryColor ?? '#ffffff'

  // Live stats = season totals merged with current game at-bats
  const { hitting: h, pitching: p } = useLivePlayerStats(playerId || null, player, gameId)

  const hitterStats = [
    { label: 'AVG', value: h?.avg !== undefined ? h.avg.toFixed(3).replace(/^0/, '') : '---' },
    { label: 'HR',  value: h?.hr  ?? 0 },
    { label: 'RBI', value: h?.rbi ?? 0 },
    { label: 'OPS', value: h?.ops !== undefined ? h.ops.toFixed(3).replace(/^0/, '') : '---' },
    { label: 'BB',  value: h?.bb  ?? 0 },
  ]

  const pitcherStats = [
    { label: 'ERA', value: p?.era !== undefined ? p.era.toFixed(2) : '---' },
    { label: 'K',   value: p?.k   ?? 0 },
    { label: 'BB',  value: p?.bb  ?? 0 },
    { label: 'IP',  value: p?.inningsPitched ?? 0 },
  ]

  const statItems = isPitcher ? pitcherStats : hitterStats

  return (
    <AnimatePresence>
      {visible && player && (
        <motion.div
          key={`stat-overlay-${playerId}`}
          className="absolute bottom-0 left-0 right-0 overflow-hidden"
          style={{ height: 260 }}
          initial={{ y: 260 }}
          animate={{ y: 0 }}
          exit={{ y: 260 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          {/* Dark base */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.96)' }}
          />

          {/* Team color left wash */}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(90deg, ${primary}cc 0%, ${primary}44 28%, transparent 55%)` }}
          />

          {/* Top border in team color */}
          <motion.div
            className="absolute top-0 left-0 right-0"
            style={{ height: 6, background: primary }}
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }}
          />

          {/* Shimmer sweep on entry */}
          <motion.div
            initial={{ x: '-110%' }}
            animate={{ x: '210%' }}
            transition={{ delay: 0.2, duration: 1.0, ease: 'easeInOut' }}
            style={{
              position: 'absolute', inset: 0, width: '40%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)',
              pointerEvents: 'none',
            }}
          />

          {/* Content */}
          <div className="relative h-full flex items-center px-16 gap-16" style={{ zIndex: 10 }}>

            {/* Logo */}
            {team?.logoUrl && (
              <motion.img
                src={team.logoUrl}
                alt=""
                style={{ width: 160, height: 160, objectFit: 'contain', flexShrink: 0 }}
                initial={{ scale: 0, opacity: 0, rotate: -15 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 12, stiffness: 260, delay: 0.1 }}
              />
            )}

            {/* Player name block */}
            <div className="flex flex-col justify-center shrink-0" style={{ minWidth: 480 }}>
              <motion.p
                className="uppercase leading-none font-black"
                style={{ fontFamily: 'var(--font-score)', color: secondary, opacity: 0.9, fontSize: 40, letterSpacing: '0.1em' }}
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 0.9 }}
                transition={{ delay: 0.18, duration: 0.3, ease: 'easeOut' }}
              >
                {team?.shortName ?? ''} · {isPitcher ? 'Pitcher' : 'Batter'}
              </motion.p>
              <motion.p
                className="uppercase font-black leading-none"
                style={{ fontFamily: 'var(--font-score)', color: '#fff', fontSize: 92 }}
                initial={{ x: -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 280, delay: 0.24 }}
              >
                {player.name}
              </motion.p>
            </div>

            {/* Divider */}
            <motion.div
              className="self-stretch"
              style={{ width: 3, background: 'rgba(255,255,255,0.15)', margin: '32px 0' }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.38, duration: 0.25, ease: 'easeOut' }}
            />

            {/* Stat chips — staggered pop-up */}
            <div className="flex gap-16 flex-1">
              {statItems.map((s, i) => (
                <motion.div
                  key={s.label}
                  className="flex flex-col items-center justify-center"
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 300, delay: 0.42 + i * 0.07 }}
                >
                  <span
                    className="uppercase tracking-widest leading-none font-bold"
                    style={{ fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.75)', fontSize: 34 }}
                  >
                    {s.label}
                  </span>
                  <span
                    className="font-black leading-none tabular-nums"
                    style={{ fontFamily: 'var(--font-score)', color: '#fff', fontSize: 88 }}
                  >
                    {s.value}
                  </span>
                </motion.div>
              ))}
            </div>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
