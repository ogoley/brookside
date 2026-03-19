import type { GameMeta, TeamsMap, PlayersMap } from '../types'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  teams: TeamsMap
  players: PlayersMap
}

// Stretch goal scene — placeholder with good structure
export function MatchupScene({ game, teams, players: _players }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  return (
    <div
      className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden"
      style={{ background: '#0d1117' }}
    >
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      <p
        className="text-white/30 text-base uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        Matchup — coming soon
      </p>
      <p
        className="text-white/20 text-sm mt-2"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        Select active batter & pitcher in the controller to populate this card.
      </p>
    </div>
  )
}
