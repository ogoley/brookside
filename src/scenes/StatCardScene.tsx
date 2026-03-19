import type { GameMeta, TeamsMap, PlayersMap } from '../types'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  teams: TeamsMap
  players: PlayersMap
}

export function StatCardScene({ game, teams, players }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const homePlayers = Object.entries(players).filter(([, p]) => p.teamId === game.homeTeamId)
  const awayPlayers = Object.entries(players).filter(([, p]) => p.teamId === game.awayTeamId)

  return (
    <div
      className="relative w-full h-full flex overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${homeTeam?.primaryColor ?? '#1a3a6b'} 0%, #111 50%, ${awayTeam?.primaryColor ?? '#c0392b'} 100%)`,
      }}
    >
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* Subtle texture overlay */}
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0, rgba(255,255,255,.05) 1px, transparent 0, transparent 50%)' }} />

      {/* Two-column layout */}
      <div className="relative z-10 flex w-full h-full gap-4 p-8">
        <TeamColumn team={awayTeam} players={awayPlayers} label="Away" />
        <div className="w-px bg-white/20 self-stretch" />
        <TeamColumn team={homeTeam} players={homePlayers} label="Home" />
      </div>
    </div>
  )
}

function TeamColumn({
  team,
  players,
  label,
}: {
  team?: import('../types').Team
  players: [string, import('../types').Player][]
  label: string
}) {
  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Team header */}
      <div className="flex items-center gap-3 mb-2">
        {team?.logoUrl && (
          <img src={team.logoUrl} alt={team.name} className="w-12 h-12 object-contain" />
        )}
        <div>
          <p className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            {label}
          </p>
          <p
            className="text-white text-3xl font-black uppercase leading-none"
            style={{ fontFamily: 'var(--font-score)' }}
          >
            {team?.name ?? '---'}
          </p>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-4 text-white/40 text-xs uppercase tracking-widest px-2" style={{ fontFamily: 'var(--font-score)' }}>
        <span className="col-span-1">Player</span>
        <span className="text-center">AVG</span>
        <span className="text-center">HR</span>
        <span className="text-center">RBI</span>
      </div>

      {/* Players */}
      <div className="flex flex-col gap-2 overflow-hidden">
        {players.length === 0 && (
          <p className="text-white/30 text-sm italic" style={{ fontFamily: 'var(--font-ui)' }}>No players listed</p>
        )}
        {players.map(([id, player]) => (
          <div
            key={id}
            className="grid grid-cols-4 items-center px-3 py-2 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(4px)' }}
          >
            <span className="col-span-1 text-white font-semibold text-sm truncate" style={{ fontFamily: 'var(--font-ui)' }}>
              {player.name}
            </span>
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.avg !== undefined ? player.stats.avg.toFixed(3).replace(/^0/, '') : '---'}
            </span>
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.hr ?? 0}
            </span>
            <span className="text-center text-white font-bold" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.rbi ?? 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
