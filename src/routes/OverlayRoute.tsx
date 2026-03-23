import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { useMatchup } from '../hooks/useMatchup'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { GameScene, StatCardScene, MatchupScene, IdleScene, StandingsScene, LeaderboardScene } from '../scenes'
import { OverlayErrorBoundary } from '../components/OverlayErrorBoundary'

function OverlayContent() {
  const { game } = useGameData()
  const { teams } = useTeams()
  const { overlay } = useOverlayState()
  const { players } = usePlayers()
  const { matchup } = useMatchup()
  const { config } = useLeagueConfig()

  // Mark body as overlay mode so CSS can set transparent background
  useEffect(() => {
    document.body.classList.add('overlay-mode')
    return () => document.body.classList.remove('overlay-mode')
  }, [])

  const sceneKey = overlay.activeScene

  return (
    // Fixed 1920×1080 canvas — OBS crops/scales this
    <div
      className="relative overflow-hidden"
      style={{ width: 1920, height: 1080, background: 'transparent' }}
    >
      {/* Base layer — always present so scoreboard is visible under any scene */}
      <div className="absolute inset-0">
        <GameScene game={game} overlay={overlay} teams={teams} players={players} matchup={matchup} />
      </div>

      {/* League logo bug — bottom-right corner, always on top */}
      {config.leagueLogo && (
        <img
          src={config.leagueLogo}
          alt=""
          style={{
            position: 'absolute',
            bottom: 24,
            right: 32,
            width: 96,
            height: 96,
            objectFit: 'contain',
            opacity: 0.7,
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />
      )}

      {/* Overlay scenes — rendered on top, animated in/out */}
      <AnimatePresence mode="wait">
        {sceneKey === 'statCard' && (
          <motion.div
            key="statCard"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <StatCardScene game={game} teams={teams} players={players} />
          </motion.div>
        )}
        {sceneKey === 'matchup' && (
          <motion.div
            key="matchup"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            <MatchupScene game={game} teams={teams} players={players} matchup={matchup} />
          </motion.div>
        )}
        {sceneKey === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <LeaderboardScene teams={teams} players={players} />
          </motion.div>
        )}
        {sceneKey === 'standings' && (
          <motion.div
            key="standings"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <StandingsScene teams={teams} />
          </motion.div>
        )}
        {sceneKey === 'idle' && (
          <motion.div
            key="idle"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <IdleScene />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function OverlayRoute() {
  return (
    <OverlayErrorBoundary>
      <OverlayContent />
    </OverlayErrorBoundary>
  )
}
