import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDerbyBroadcast } from '../hooks/useDerbyBroadcast'
import { useDerbyContestants } from '../hooks/useDerbyContestants'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { leaderboardForRound, ROUND_KEY } from '../derby/logic'
import { DerbyPlayerScene } from '../scenes/derby/DerbyPlayerScene'
import { DerbyLeaderboardScene, type DerbyLeaderboardDisplayRow } from '../scenes/derby/DerbyLeaderboardScene'
import { DerbyUpNextScene, type DerbyOrderDisplayRow } from '../scenes/derby/DerbyUpNextScene'
import { OverlayErrorBoundary } from '../components/OverlayErrorBoundary'
import { ALLSTAR_LOGO_URL } from '../allstar'

function DerbyOverlayContent() {
  const { broadcast } = useDerbyBroadcast()
  const { contestants, contestantById, teams } = useDerbyContestants()
  const { config } = useLeagueConfig()

  // Transparent body for OBS, same as the game overlay
  useEffect(() => {
    document.body.classList.add('overlay-mode')
    return () => document.body.classList.remove('overlay-mode')
  }, [])

  const featured = broadcast.featuredPlayerId
    ? contestantById.get(broadcast.featuredPlayerId)
    : undefined

  const leaderboardRows: DerbyLeaderboardDisplayRow[] = useMemo(() => {
    const eligibleIds = contestants.map(c => c.id)
    return leaderboardForRound(eligibleIds, broadcast.scores, broadcast.leaderboardRound)
      .map(r => {
        const c = contestantById.get(r.playerId)
        return {
          ...r,
          name: c?.name ?? '',
          team: c ? teams[c.teamId] : undefined,
        }
      })
      .filter(r => r.name !== '')
  }, [contestants, contestantById, teams, broadcast.scores, broadcast.leaderboardRound])

  const orderRows: DerbyOrderDisplayRow[] = useMemo(() => {
    const key = ROUND_KEY[broadcast.activeRound]
    return broadcast.battingOrder
      .map((id): DerbyOrderDisplayRow | null => {
        const c = contestantById.get(id)
        if (!c) return null
        return {
          playerId: id,
          name: c.name,
          team: teams[c.teamId],
          score: broadcast.scores[id]?.[key],
        }
      })
      .filter((r): r is DerbyOrderDisplayRow => r !== null)
  }, [broadcast.battingOrder, broadcast.scores, broadcast.activeRound, contestantById, teams])

  const view = broadcast.view

  return (
    // Fixed 1920×1080 canvas — OBS crops/scales this
    <div className="relative overflow-hidden" style={{ width: 1920, height: 1080, background: 'transparent' }}>
      <AnimatePresence mode="wait">
        {view === 'player' && featured && (
          <motion.div
            // Keyed by player so switching hitters animates out/in
            key={`player-${featured.id}`}
            className="absolute inset-0"
            initial={{ y: 140, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 140, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 240 }}
          >
            <DerbyPlayerScene
              name={featured.name}
              seasonHr={featured.seasonHr}
              team={teams[featured.teamId]}
              scores={broadcast.scores[featured.id] ?? {}}
              activeRound={broadcast.activeRound}
            />
          </motion.div>
        )}

        {view === 'leaderboard' && (
          <motion.div
            // Keyed by round so switching rounds re-runs the row stagger
            key={`leaderboard-${broadcast.leaderboardRound}`}
            className="absolute inset-0"
            initial={{ y: -60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
          >
            <DerbyLeaderboardScene rows={leaderboardRows} round={broadcast.leaderboardRound} />
          </motion.div>
        )}

        {view === 'upNext' && (
          <motion.div
            key="upNext"
            className="absolute inset-0"
            initial={{ x: 560, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 560, opacity: 0 }}
            transition={{ type: 'spring', damping: 27, stiffness: 230 }}
          >
            <DerbyUpNextScene
              rows={orderRows}
              currentIndex={Math.min(broadcast.currentBatterIndex, Math.max(0, orderRows.length - 1))}
              round={broadcast.activeRound}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* League logo bug — hidden when the overlay is fully hidden */}
      {config.leagueLogo && view !== 'hidden' && (
        <img
          src={config.leagueLogo}
          alt=""
          style={{
            position: 'absolute', bottom: 24, right: 32,
            width: 96, height: 96, objectFit: 'contain',
            opacity: 0.7, pointerEvents: 'none',
          }}
        />
      )}

      {/* All-Star Weekend watermark — top-left: derby scenes never render
          stats there (bottom-left collides with the leaderboard) */}
      {view !== 'hidden' && (
        <img
          src={ALLSTAR_LOGO_URL}
          alt=""
          style={{
            position: 'absolute', top: 24, left: 32,
            height: 92, objectFit: 'contain',
            opacity: 0.7, pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

export function DerbyOverlayRoute() {
  return (
    <OverlayErrorBoundary>
      <DerbyOverlayContent />
    </OverlayErrorBoundary>
  )
}
