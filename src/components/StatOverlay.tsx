import { motion, AnimatePresence } from 'framer-motion'
import { useLivePlayerStats } from '../hooks/useLivePlayerStats'
import { useGameData } from '../hooks/useGameData'
import { useAllstarRosters } from '../hooks/useAllstarRosters'
import { effectiveGameTeamId, isExhibitionTeam } from '../allstar'
import { usePostseasonMeta, usePostseasonPlayers } from '../hooks/usePostseason'
import { isPostseasonGameId } from '../postseason/paths'
import type { StatOverlayState, PlayersMap, TeamsMap, HittingStats, PitchingStats } from '../types'

type StatItem = { label: string; value: string | number }

function hitterItems(h: HittingStats | null): StatItem[] {
  return [
    { label: 'AVG', value: h?.avg !== undefined ? h.avg.toFixed(3).replace(/^0/, '') : '---' },
    { label: 'HR',  value: h?.hr  ?? 0 },
    { label: 'RBI', value: h?.rbi ?? 0 },
    { label: 'OPS', value: h?.ops !== undefined ? h.ops.toFixed(3).replace(/^0/, '') : '---' },
    { label: 'BB',  value: h?.bb  ?? 0 },
  ]
}

function pitcherItems(p: PitchingStats | null): StatItem[] {
  return [
    { label: 'ERA', value: p?.era !== undefined ? p.era.toFixed(2) : '---' },
    { label: 'K',   value: p?.k   ?? 0 },
    { label: 'BB',  value: p?.bb  ?? 0 },
    { label: 'IP',  value: p?.inningsPitched ?? 0 },
  ]
}

interface Props {
  statOverlay: StatOverlayState
  players: PlayersMap
  teams: TeamsMap
  gameId: string | null
  /** Lift the strip above the bottom-line ticker when it is on air */
  bottomOffset?: number
}

export function StatOverlay({ statOverlay, players, teams, gameId, bottomOffset = 0 }: Props) {
  const { visible, playerId, type } = statOverlay

  const { game } = useGameData()
  const allstarRosters = useAllstarRosters()

  const player = players[playerId]
  // For all-star games the accent team is the player's all-star side, not
  // their league team — effectiveGameTeamId falls back to player.teamId
  // whenever the game teams have no roster entry.
  const gameTeamId = player
    ? effectiveGameTeamId(playerId, player, game.homeTeamId, game.awayTeamId, allstarRosters)
    : undefined
  const team = player ? teams[gameTeamId ?? player.teamId] : undefined
  // All-star: the player's league team differs from the team they're playing
  // for tonight — show who they're representing.
  const leagueTeam = player && gameTeamId && gameTeamId !== player.teamId ? teams[player.teamId] : undefined
  const isPitcher = type === 'pitcher'
  const primary = team?.primaryColor ?? '#1a3a6b'
  const secondary = team?.secondaryColor ?? '#ffffff'

  // Playoffs: the strip gets a second row. A playoff game's at-bats merge
  // into the playoff row only — the regular-season row stays frozen.
  const { meta: postseason } = usePostseasonMeta()
  const postseasonPlayers = usePostseasonPlayers()
  const isPlayoffGame = isPostseasonGameId(gameId)
  const showPlayoffRow = postseason.active || isPlayoffGame

  // Live stats = season totals merged with current game at-bats
  const { hitting: h, pitching: p } = useLivePlayerStats(playerId || null, player, isPlayoffGame ? null : gameId)
  const playoffSeason = postseasonPlayers[playerId]?.seasons?.[String(postseason.season)]
  const { hitting: ph, pitching: pp } = useLivePlayerStats(
    playerId || null,
    player ? { ...player, stats: { hitting: playoffSeason?.hitting, pitching: playoffSeason?.pitching } } : undefined,
    isPlayoffGame ? gameId : null,
  )

  const statItems = isPitcher ? pitcherItems(p) : hitterItems(h)
  const playoffHasData = isPitcher ? !!pp : !!ph
  const playoffItems = (isPitcher ? pitcherItems(pp) : hitterItems(ph))
    .map(s => playoffHasData ? s : { ...s, value: '–' })

  return (
    <AnimatePresence>
      {visible && player && (
        <motion.div
          key={`stat-overlay-${playerId}`}
          className="absolute bottom-0 left-0 right-0 overflow-hidden"
          style={{ height: 260, bottom: bottomOffset }}
          initial={{ y: 260 + bottomOffset }}
          animate={{ y: 0 }}
          exit={{ y: 260 + bottomOffset }}
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
                {(isExhibitionTeam(gameTeamId, teams) ? team?.name : team?.shortName) ?? ''} · {isPitcher ? 'Pitcher' : 'Batter'}
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
              {leagueTeam && (
                <motion.div
                  className="flex items-center gap-3 mt-3"
                  initial={{ x: -40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.32, duration: 0.3, ease: 'easeOut' }}
                >
                  {leagueTeam.logoUrl && (
                    <img src={leagueTeam.logoUrl} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
                  )}
                  <span
                    className="uppercase leading-none font-bold"
                    style={{ fontFamily: 'var(--font-score)', color: 'rgba(255,255,255,0.85)', fontSize: 28, letterSpacing: '0.08em' }}
                  >
                    Representing the {leagueTeam.name}
                  </span>
                </motion.div>
              )}
            </div>

            {/* Divider */}
            <motion.div
              className="self-stretch"
              style={{ width: 3, background: 'rgba(255,255,255,0.15)', margin: '32px 0' }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.38, duration: 0.25, ease: 'easeOut' }}
            />

            {/* Playoffs: two slim rows (regular season / playoffs) */}
            {showPlayoffRow && (
              <div className="flex flex-col justify-center flex-1" style={{ gap: 4 }}>
                {[
                  { key: 'head', label: '', items: statItems, head: true },
                  { key: 'reg', label: `${postseason.season} Season`, items: statItems },
                  { key: 'po', label: 'Playoffs', items: playoffItems, gold: true },
                ].map((row, r) => (
                  <motion.div
                    key={row.key}
                    className="flex items-center"
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: 'spring', damping: 16, stiffness: 300, delay: 0.42 + r * 0.08 }}
                    style={{ height: row.head ? 34 : 76 }}
                  >
                    <span
                      className="uppercase font-black leading-none shrink-0"
                      style={{ width: 186, fontFamily: 'var(--font-score)', fontSize: 30, letterSpacing: '0.08em', color: row.gold ? '#fbbf24' : 'rgba(255,255,255,0.8)' }}
                    >
                      {row.label}
                    </span>
                    {row.items.map(s => (
                      <span
                        key={s.label}
                        className="text-center leading-none tabular-nums shrink-0"
                        style={{
                          width: 150, fontFamily: 'var(--font-score)',
                          fontSize: row.head ? 30 : 60, fontWeight: row.head ? 700 : 900,
                          letterSpacing: row.head ? '0.1em' : undefined,
                          color: row.head ? 'rgba(255,255,255,0.75)' : row.gold ? '#fbbf24' : '#fff',
                        }}
                      >
                        {row.head ? s.label : s.value}
                      </span>
                    ))}
                  </motion.div>
                ))}
              </div>
            )}

            {/* Stat chips — staggered pop-up */}
            {!showPlayoffRow && <div className="flex gap-16 flex-1">
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
            </div>}

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
