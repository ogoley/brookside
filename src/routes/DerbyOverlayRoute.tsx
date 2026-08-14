import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDerbyBroadcast } from '../hooks/useDerbyBroadcast'
import { useDerbyContestants } from '../hooks/useDerbyContestants'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import {
  leaderboardForRound, participantsForRound, cutInfo, isRoundLocked, ADVANCE_COUNT, ROUND_KEY,
} from '../derby/logic'
import { DerbyPlayerScene } from '../scenes/derby/DerbyPlayerScene'
import { DerbyLeaderboardScene, type DerbyLeaderboardDisplayRow } from '../scenes/derby/DerbyLeaderboardScene'
import { DerbyUpNextScene, type DerbyOrderDisplayRow } from '../scenes/derby/DerbyUpNextScene'
import { DerbyTickerScene, type DerbyTickerRow } from '../scenes/derby/DerbyTickerScene'
import { DerbyMiniBoardScene, type DerbyMiniRow } from '../scenes/derby/DerbyMiniBoardScene'
import { DerbyMoneyBall } from '../scenes/derby/DerbyMoneyBallScene'
import { DerbyTurnClock } from '../components/DerbyTurnClock'
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
    return leaderboardForRound(eligibleIds, broadcast.scores, broadcast.leaderboardRound, broadcast.advancers)
      .map(r => {
        const c = contestantById.get(r.playerId)
        return {
          ...r,
          name: c?.name ?? '',
          team: c ? teams[c.teamId] : undefined,
        }
      })
      .filter(r => r.name !== '')
  }, [contestants, contestantById, teams, broadcast.scores, broadcast.leaderboardRound, broadcast.advancers])

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

  const currentIndex = Math.min(broadcast.currentBatterIndex, Math.max(0, orderRows.length - 1))

  // Ticker = everyone hitting this round: the batting order first (producer's
  // intent), then any round participant who never made it into the order.
  const tickerRows: DerbyTickerRow[] = useMemo(() => {
    const key = ROUND_KEY[broadcast.activeRound]
    const inOrder = orderRows.map(r => r.playerId)
    const extras = participantsForRound(contestants.map(c => c.id), broadcast.scores, broadcast.activeRound, broadcast.advancers)
      .filter(id => !inOrder.includes(id))
    const currentId = orderRows[currentIndex]?.playerId
    return [
      ...orderRows.map(r => ({ ...r, isCurrent: r.playerId === currentId })),
      ...extras.flatMap((id): DerbyTickerRow[] => {
        const c = contestantById.get(id)
        return c ? [{ playerId: id, name: c.name, team: teams[c.teamId], score: broadcast.scores[id]?.[key] }] : []
      }),
    ]
  }, [orderRows, currentIndex, contestants, contestantById, teams, broadcast.scores, broadcast.activeRound, broadcast.advancers])

  // Whoever is at the plate right now
  const liveBatterId = orderRows[currentIndex]?.playerId ?? null
  // The takeover leaderboard only shimmers when it's showing the round in play
  const liveOnLeaderboard = broadcast.leaderboardRound === broadcast.activeRound ? liveBatterId : null

  // Left rail: only the players who'd move on as things stand. That's the seat
  // count normally, but a tie straddling the cut keeps everyone tied on the
  // board (2-way tie for 8th → 9 rows) until the producer settles it. The live
  // hitter is pinned on the end while they climb toward the field.
  const miniRows: DerbyMiniRow[] = useMemo(() => {
    const eligibleIds = contestants.map(c => c.id)
    const rows = leaderboardForRound(eligibleIds, broadcast.scores, broadcast.activeRound, broadcast.advancers)
    const noCut = ADVANCE_COUNT[broadcast.activeRound] === null
    const field = noCut ? rows : rows.filter(r => r.advancing)
    const live = liveBatterId ? rows.find(r => r.playerId === liveBatterId) : undefined
    const chasing = live && !field.includes(live) ? [live] : []

    return [...field, ...chasing].flatMap((r): DerbyMiniRow[] => {
      const c = contestantById.get(r.playerId)
      if (!c) return []
      return [{
        playerId: r.playerId,
        name: c.name,
        team: teams[c.teamId],
        score: r.score,
        rank: r.rank,
        tied: r.tied,
        chasing: chasing.includes(r),
      }]
    })
  }, [contestants, contestantById, teams, broadcast.scores, broadcast.activeRound, broadcast.advancers, liveBatterId])

  const miniCut = useMemo(() => {
    const eligibleIds = contestants.map(c => c.id)
    const participants = participantsForRound(eligibleIds, broadcast.scores, broadcast.activeRound, broadcast.advancers)
    return cutInfo(participants, broadcast.scores, broadcast.activeRound)
  }, [contestants, broadcast.scores, broadcast.activeRound, broadcast.advancers])

  const view = broadcast.view

  // The clock is stamped with the hitter it was reset for; fall back to whoever
  // is featured so a hand-started clock still names someone
  const clockPlayerId = broadcast.timer.playerId ?? broadcast.featuredPlayerId
  const clockPlayerName = clockPlayerId ? contestantById.get(clockPlayerId)?.name : undefined

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
              moneyBallAt={broadcast.timer.moneyBallAt}
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
            <DerbyLeaderboardScene
              rows={leaderboardRows}
              round={broadcast.leaderboardRound}
              livePlayerId={liveOnLeaderboard}
              locked={isRoundLocked(broadcast.leaderboardRound, broadcast.advancers)}
            />
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
              currentIndex={currentIndex}
              round={broadcast.activeRound}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left rail — always on, independent of `view`. Suppressed only under
          the full leaderboard takeover, which says the same thing bigger. */}
      <AnimatePresence>
        {broadcast.miniBoard && view !== 'leaderboard' && miniRows.length > 0 && (
          <motion.div
            key="miniBoard"
            className="absolute inset-0"
            initial={{ x: -460, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -460, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            style={{ pointerEvents: 'none' }}
          >
            <DerbyMiniBoardScene
              rows={miniRows}
              round={broadcast.activeRound}
              livePlayerId={liveBatterId}
              locked={isRoundLocked(broadcast.activeRound, broadcast.advancers)}
              tiedCount={miniCut.tied.length}
              spotsLeft={miniCut.spotsLeft}
              clockVisible={broadcast.timer.visible}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ticker — runs independently of `view`, so it can crawl over a clean
          camera shot with every other graphic hidden */}
      <AnimatePresence>
        {broadcast.ticker && (
          <motion.div
            key="ticker"
            className="absolute inset-0"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
          >
            <DerbyTickerScene rows={tickerRows} round={broadcast.activeRound} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Turn clock — like the ticker, independent of `view` so it can run
          over a clean camera shot. Sits under the All-Star lockup: the
          leaderboard is centred and Up Next hugs the right rail */}
      <AnimatePresence>
        {broadcast.timer.visible && (
          <DerbyTurnClock
            key="turnClock"
            timer={broadcast.timer}
            playerName={clockPlayerName}
          />
        )}
      </AnimatePresence>

      {/* League logo bug — hidden when the overlay is fully hidden; rides
          above the ticker when the crawl is up */}
      {config.leagueLogo && view !== 'hidden' && (
        <img
          src={config.leagueLogo}
          alt=""
          style={{
            position: 'absolute', bottom: broadcast.ticker ? 88 : 24, right: 32,
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

      {/* Money ball — the biggest moment on the board, so it plays over
          everything and on any view. Keyed by the timestamp so each one fires
          exactly once; the component retires itself when the animation ends */}
      {broadcast.timer.moneyBallAt != null && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
          <DerbyMoneyBall
            key={broadcast.timer.moneyBallAt}
            at={broadcast.timer.moneyBallAt}
            playerName={clockPlayerName}
          />
        </div>
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
