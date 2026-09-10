import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameData } from '../hooks/useGameData'
import { useTeams } from '../hooks/useTeams'
import { useOverlayState } from '../hooks/useOverlayState'
import { usePlayers } from '../hooks/usePlayers'
import { useMatchup } from '../hooks/useMatchup'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { useStandings } from '../hooks/useStandings'
import { useGames } from '../hooks/useGames'
import { useSponsors } from '../hooks/useSponsors'
import { usePlayoffPicture } from '../hooks/usePlayoffPicture'
import { GameScene, StatCardScene, MatchupScene, IdleScene, StandingsScene, LeaderboardScene, InsightsScene, AllStarLineupScene, PlayoffScene } from '../scenes'
import { OverlayErrorBoundary } from '../components/OverlayErrorBoundary'
import { SponsorInterstitial } from '../components/SponsorInterstitial'
import { Ticker, TICKER_HEIGHT } from '../components/Ticker'
import { buildTickerSections } from '../ticker/items'
import { isExhibitionGame, ALLSTAR_LOGO_URL } from '../allstar'

function OverlayContent() {
  const { game } = useGameData()
  const { teams } = useTeams()
  const { overlay } = useOverlayState()
  const { players } = usePlayers()
  const { matchup } = useMatchup()
  const { config } = useLeagueConfig()
  const { standings } = useStandings()
  const { games } = useGames()
  const { sponsors } = useSponsors()
  const { picture } = usePlayoffPicture()

  // Mark body as overlay mode so CSS can set transparent background
  useEffect(() => {
    document.body.classList.add('overlay-mode')
    return () => document.body.classList.remove('overlay-mode')
  }, [])

  const sceneKey = overlay.activeScene

  // Bottom-line ticker content — recomputed only when its inputs change.
  const tickerSections = useMemo(
    () => buildTickerSections({ teams, players, standings, games, sponsors, schedule: picture?.remainingGames, picture }, overlay.ticker),
    [teams, players, standings, games, sponsors, picture, overlay.ticker],
  )
  // The ticker rides along the game scene only — full-screen scenes own the
  // whole canvas (their bottom rows would be covered otherwise).
  const tickerOnAir = overlay.ticker.visible && tickerSections.length > 0 && sceneKey === 'game'
  const bottomInset = tickerOnAir ? TICKER_HEIGHT : 0

  return (
    // Fixed 1920×1080 canvas — OBS crops/scales this
    <div
      className="relative overflow-hidden"
      style={{ width: 1920, height: 1080, background: 'transparent' }}
    >
      {/* Base layer — always present so scoreboard is visible under any scene */}
      <div className="absolute inset-0">
        <GameScene game={game} overlay={overlay} teams={teams} players={players} matchup={matchup} bottomInset={bottomInset} />
      </div>

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
            <LeaderboardScene teams={teams} players={players} standings={standings.length ? standings : undefined} />
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
            <StandingsScene teams={teams} standings={standings.length ? standings : undefined} picture={picture} />
          </motion.div>
        )}
        {sceneKey === 'playoffs' && (
          <motion.div
            key="playoffs"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <PlayoffScene teams={teams} picture={picture} />
          </motion.div>
        )}
        {sceneKey === 'insights' && (
          <motion.div
            key="insights"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <InsightsScene insights={overlay.insights} />
          </motion.div>
        )}
        {sceneKey === 'allstarLineups' && (
          <motion.div
            key="allstarLineups"
            className="absolute inset-0"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <AllStarLineupScene game={game} teams={teams} players={players} />
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

      {/* Between-innings sponsor card — above every scene: it's a paid
          placement, so it wins even if a full-screen board is up. */}
      <SponsorInterstitial state={overlay.sponsor} sponsor={sponsors[overlay.sponsor.sponsorId]} />

      {/* Bottom-line ticker — game scene only (see tickerOnAir) */}
      <Ticker ticker={{ ...overlay.ticker, visible: tickerOnAir }} sections={tickerSections} />

      {/* League logo bug — rendered last so it sits above all scenes;
          lifts above the ticker while it's on air */}
      {config.leagueLogo && (
        <img
          src={config.leagueLogo}
          alt=""
          style={{
            position: 'absolute',
            bottom: 24 + bottomInset,
            right: 32,
            transition: 'bottom 0.4s ease, opacity 0.3s ease',
            width: 96,
            height: 96,
            objectFit: 'contain',
            opacity: overlay.statOverlay.visible && sceneKey === 'game' ? 0 : 0.7,  // the stat strip owns the bottom-right while it is up
            pointerEvents: 'none',
          }}
        />
      )}

      {/* All-Star Weekend watermark — appears automatically whenever an
          exhibition matchup is on the scorebug, on any overlay route.
          Top-left: bottom-left would collide with the batter stat strip. */}
      {isExhibitionGame(game, teams) && (
        <img
          src={ALLSTAR_LOGO_URL}
          alt=""
          style={{
            position: 'absolute',
            top: 24,
            left: 32,
            height: 92,
            objectFit: 'contain',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        />
      )}
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
