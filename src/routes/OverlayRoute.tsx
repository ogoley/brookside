import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { GameScene, StatCardScene, MatchupScene, IdleScene } from '../scenes'

export function OverlayRoute() {
  const { game } = useGameData()
  const { teams } = useTeams()
  const { overlay } = useOverlayState()
  const { players } = usePlayers()

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
      <AnimatePresence mode="wait">
        <motion.div
          key={sceneKey}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {sceneKey === 'game' && (
            <GameScene game={game} overlay={overlay} teams={teams} players={players} />
          )}
          {sceneKey === 'statCard' && (
            <StatCardScene game={game} teams={teams} players={players} />
          )}
          {sceneKey === 'matchup' && (
            <MatchupScene game={game} teams={teams} players={players} />
          )}
          {sceneKey === 'idle' && <IdleScene />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
