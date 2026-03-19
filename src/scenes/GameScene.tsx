import { AnimatePresence, motion } from 'framer-motion'
import type { GameMeta, OverlayState, PlayersMap, TeamsMap } from '../types'
import { Scoreboard } from '../components/Scoreboard'
import { HomrunBanner } from '../components/HomrunBanner'
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

      {/* Scoreboard / Homerun banner — centered, ~36% of screen width */}
      <div className="flex justify-center w-full pt-4">
        <div style={{ width: '36%' }}>
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
              >
                <Scoreboard game={game} homeTeam={homeTeam} awayTeam={awayTeam} timer={overlay.timer} />
              </motion.div>
            )}
          </AnimatePresence>
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
