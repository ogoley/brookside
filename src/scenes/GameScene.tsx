import type { GameMeta, OverlayState, PlayersMap, TeamsMap } from '../types'
import { Scoreboard } from '../components/Scoreboard'
import { StatOverlay } from '../components/StatOverlay'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  overlay: OverlayState
  teams: TeamsMap
  players: PlayersMap
}

export function GameScene({ game, overlay, teams, players }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  return (
    <div className="relative w-full h-full flex flex-col">
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* Scoreboard — centered, ~25% of screen width */}
      <div className="flex justify-center w-full">
        <div style={{ width: '26%' }}>
          <Scoreboard game={game} homeTeam={homeTeam} awayTeam={awayTeam} />
        </div>
      </div>

      {/* Transparent game area */}
      <div className="flex-1" />

      {/* Ephemeral stat overlay — bottom */}
      <StatOverlay
        statOverlay={overlay.statOverlay}
        players={players}
        teams={teams}
      />
    </div>
  )
}
