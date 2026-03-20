import { AnimatePresence, motion } from 'framer-motion'
import type { GameMeta, OverlayState, PlayersMap, TeamsMap, MatchupState } from '../types'
import { Scoreboard } from '../components/Scoreboard'
import { HomrunBanner } from '../components/HomrunBanner'
import { StatOverlay } from '../components/StatOverlay'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  overlay: OverlayState
  teams: TeamsMap
  players: PlayersMap
  matchup: MatchupState
}

export function GameScene({ game, overlay, teams, players, matchup }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  return (
    <div className="relative w-full h-full flex flex-col">
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* Scoreboard / Homerun banner — absolutely centered at top */}
      <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
        <AnimatePresence mode="wait">
          {overlay.homerun?.active ? (
            <HomrunBanner
              key="homerun"
              homerun={overlay.homerun}
              playerName={players[overlay.homerun.playerId]?.name ?? ''}
              team={overlay.homerun.teamSide === 'home' ? homeTeam : awayTeam}
            />
          ) : (
            <motion.div
              key="scoreboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ transform: `scale(${overlay.scoreboardScale})`, transformOrigin: 'top center' }}
            >
              <Scoreboard
                game={game}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
                timer={overlay.timer}
                showBorder={overlay.scoreboardBorder}
                matchup={matchup}
                players={players}
                statOverlayVisible={overlay.statOverlay.visible}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ephemeral stat overlay — bottom */}
      <StatOverlay
        statOverlay={overlay.statOverlay}
        players={players}
        teams={teams}
        gameId={game.currentGameId ?? null}
      />
    </div>
  )
}
