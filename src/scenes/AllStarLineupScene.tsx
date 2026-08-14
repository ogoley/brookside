import { motion } from 'framer-motion'
import type { GameMeta, TeamsMap, PlayersMap, Team, LineupEntry } from '../types'
import { TeamColorInjector } from '../components/TeamColorInjector'
import { useAllstarRosters } from '../hooks/useAllstarRosters'
import { useGameLineup } from '../hooks/useGameLineup'
import { playerOnTeam } from '../allstar'
import AllStarWordmark from '../components/AllStarWordmark'

interface Props {
  game: GameMeta
  teams: TeamsMap
  players: PlayersMap
}

interface LineupRow {
  playerId: string
  name: string
  leagueTeamLogo: string
  avg?: number
  hr: number
  rbi: number
}

/**
 * Full-screen all-star lineup board: both teams' batting orders side by side
 * with season stats and each player's league-team logo. Order comes from the
 * scorekeeper lineup when a game is linked, otherwise the drafted roster order
 * in config/allstar/rosters, otherwise the plain team filter.
 */
export function AllStarLineupScene({ game, teams, players }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]
  const rosters = useAllstarRosters()

  const { lineup: homeLineup } = useGameLineup(game.currentGameId ?? null, game.homeTeamId || null)
  const { lineup: awayLineup } = useGameLineup(game.currentGameId ?? null, game.awayTeamId || null)

  const buildRows = (teamId: string, lineup: LineupEntry[]): LineupRow[] => {
    const orderedIds: Array<{ playerId: string; subName?: string }> =
      lineup.length > 0
        ? lineup.map(e => ({ playerId: e.playerId, subName: e.subName }))
        : (rosters?.[teamId]
            ?? Object.keys(players).filter(id => playerOnTeam(id, players[id], teamId, rosters) && !players[id].isSub)
          ).map(playerId => ({ playerId }))

    return orderedIds.map(({ playerId, subName }) => {
      const p = players[playerId]
      return {
        playerId,
        name: p?.name ?? subName ?? '—',
        leagueTeamLogo: p ? (teams[p.teamId]?.logoUrl ?? '') : '',
        avg: p?.stats?.hitting?.avg,
        hr: p?.stats?.hitting?.hr ?? 0,
        rbi: p?.stats?.hitting?.rbi ?? 0,
      }
    })
  }

  const awayRows = buildRows(game.awayTeamId, awayLineup)
  const homeRows = buildRows(game.homeTeamId, homeLineup)

  const awayColor = awayTeam?.primaryColor ?? '#c8102e'
  const homeColor = homeTeam?.primaryColor ?? '#1e40af'

  return (
    <div
      className="relative w-full h-full flex flex-col overflow-hidden"
      style={{ background: `linear-gradient(90deg, ${awayColor}66 0%, #0b1120 32%, #0b1120 68%, ${homeColor}66 100%), #0b1120` }}
    >
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* Subtle texture */}
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0, rgba(255,255,255,.05) 1px, transparent 0, transparent 50%)' }}
      />

      {/* All-Star Weekend lockup */}
      <motion.div
        className="relative z-10 flex justify-center pt-8 pb-2"
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 16, stiffness: 200 }}
      >
        <AllStarWordmark size={80} />
      </motion.div>

      {/* Columns */}
      <div className="relative z-10 flex flex-1 gap-10 px-16 pb-10 pt-2 min-h-0">
        <LineupColumn team={awayTeam} rows={awayRows} side="away" color={awayColor} />
        <div className="w-px bg-white/20 self-stretch" />
        <LineupColumn team={homeTeam} rows={homeRows} side="home" color={homeColor} />
      </div>
    </div>
  )
}

function LineupColumn({ team, rows, side, color }: {
  team?: Team
  rows: LineupRow[]
  side: 'away' | 'home'
  color: string
}) {
  const rowXBase = side === 'away' ? -120 : 120

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      {/* Team header */}
      <motion.div
        className="flex items-center justify-center gap-4"
        initial={{ x: rowXBase, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 16, stiffness: 220, delay: 0.15 }}
      >
        {team?.logoUrl && <img src={team.logoUrl} alt="" style={{ width: 84, height: 84, objectFit: 'contain' }} />}
        <div className="flex flex-col">
          <span className="text-white font-black uppercase leading-none" style={{ fontFamily: 'var(--font-score)', fontSize: 46 }}>
            {team?.name ?? '---'}
          </span>
          <span className="text-white/50 text-sm uppercase tracking-widest leading-none mt-1" style={{ fontFamily: 'var(--font-score)' }}>
            {side === 'away' ? 'Away' : 'Home'}
          </span>
        </div>
      </motion.div>

      {/* Column headers */}
      <motion.div
        className="grid items-center text-white/40 uppercase tracking-widest px-4"
        style={{ fontFamily: 'var(--font-score)', fontSize: 15, gridTemplateColumns: '44px 1fr 44px 76px 64px 64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.3 }}
      >
        <span>#</span>
        <span>Player</span>
        <span />
        <span className="text-center">AVG</span>
        <span className="text-center">HR</span>
        <span className="text-center">RBI</span>
      </motion.div>

      {/* Rows */}
      <div className="flex flex-col gap-2 min-h-0">
        {rows.length === 0 && (
          <p className="text-white/30 text-sm italic px-4" style={{ fontFamily: 'var(--font-ui)' }}>No roster set</p>
        )}
        {rows.map((row, i) => (
          <motion.div
            key={row.playerId}
            className="grid items-center px-4 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.10)', gridTemplateColumns: '44px 1fr 44px 76px 64px 64px', height: 56 }}
            initial={{ x: rowXBase, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260, delay: 0.42 + i * 0.05 }}
          >
            <span className="font-black" style={{ fontFamily: 'var(--font-score)', fontSize: 22, color }}>
              {i + 1}
            </span>
            <span className="text-white font-semibold truncate" style={{ fontFamily: 'var(--font-ui)', fontSize: 22 }}>
              {row.name}
            </span>
            {row.leagueTeamLogo
              ? <img src={row.leagueTeamLogo} alt="" style={{ width: 30, height: 30, objectFit: 'contain', opacity: 0.9 }} />
              : <span />}
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)', fontSize: 22 }}>
              {row.avg !== undefined ? row.avg.toFixed(3).replace(/^0/, '') : '---'}
            </span>
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)', fontSize: 22 }}>
              {row.hr}
            </span>
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)', fontSize: 22 }}>
              {row.rbi}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
