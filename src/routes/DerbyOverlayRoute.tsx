import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDerbyBroadcast } from '../hooks/useDerbyBroadcast'
import { useDerbyContestants } from '../hooks/useDerbyContestants'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import {
  leaderboardForRound, participantsForRound, cutInfo, isRoundLocked,
  derbyBetWinners, derbyPayout,
  ADVANCE_COUNT, ROUND_KEY, ROUND_LABEL,
} from '../derby/logic'
import { derbyOddsWindow } from '../derby/odds'
import { useDerbyOdds, turnFractionOf } from '../hooks/useDerbyOdds'
import { DerbyOddsScene, type DerbyOddsDisplayRow } from '../scenes/derby/DerbyOddsScene'
import type { DerbyRoundNum, DerbyBroadcastState, DerbyEntry, Team } from '../types'
import type { DerbyContestant } from '../hooks/useDerbyContestants'
import { DerbyPlayerScene } from '../scenes/derby/DerbyPlayerScene'
import { DerbyLeaderboardScene, type DerbyLeaderboardDisplayRow } from '../scenes/derby/DerbyLeaderboardScene'
import { DerbyUpNextScene, type DerbyOrderDisplayRow } from '../scenes/derby/DerbyUpNextScene'
import { DerbyTickerScene, type DerbyTickerRow, type DerbyTickerSegment } from '../scenes/derby/DerbyTickerScene'
import { DerbyMiniBoardScene, type DerbyMiniRow } from '../scenes/derby/DerbyMiniBoardScene'
import { DerbyWinnerScene } from '../scenes/derby/DerbyWinnerScene'
import { useDerbyBets } from '../hooks/useDerbyBets'
import { DerbyMoneyBall } from '../scenes/derby/DerbyMoneyBallScene'
import { DerbyTurnClock } from '../components/DerbyTurnClock'
import { OverlayErrorBoundary } from '../components/OverlayErrorBoundary'
import AllStarWordmark from '../components/AllStarWordmark'

function DerbyOverlayContent() {
  const { broadcast } = useDerbyBroadcast()
  const { contestants, contestantById, teams } = useDerbyContestants()
  const { config } = useLeagueConfig()
  const bets = useDerbyBets()

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

  // Ticker = one segment per round, current round first then every round
  // already hit. The live round runs in batting order (so it reads as a running
  // order, with the hitter at the plate flagged); finished rounds run ranked,
  // because by then they're results.
  const tickerSegments: DerbyTickerSegment[] = useMemo(() => {
    const eligibleIds = contestants.map(c => c.id)
    const currentId = orderRows[currentIndex]?.playerId
    const segments: DerbyTickerSegment[] = []

    for (let r = broadcast.activeRound; r >= 1; r--) {
      const round = r as DerbyRoundNum
      const key = ROUND_KEY[round]
      const isCurrent = round === broadcast.activeRound
      const field = participantsForRound(eligibleIds, broadcast.scores, round, broadcast.advancers)

      const ids = isCurrent
        // Producer's order first, then anyone in the round who never made it in
        ? [...orderRows.map(o => o.playerId), ...field.filter(id => !orderRows.some(o => o.playerId === id))]
        : leaderboardForRound(eligibleIds, broadcast.scores, round, broadcast.advancers).map(row => row.playerId)

      const rows = ids.flatMap((id): DerbyTickerRow[] => {
        const c = contestantById.get(id)
        if (!c) return []
        return [{
          playerId: id,
          name: c.name,
          team: teams[c.teamId],
          score: broadcast.scores[id]?.[key],
          isCurrent: isCurrent && id === currentId,
        }]
      })

      if (rows.length > 0) segments.push({ key, label: ROUND_LABEL[round], isCurrent, rows })
    }
    return segments
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

  // ── Champion graphic ──
  // Driven by `derby/result`, the same record the public 50/50 page reads, so
  // the two can never name different winners. Every entry counts: the entry
  // IS the Venmo payment, so there is nothing unpaid to filter out.
  const winner = useMemo(() => {
    if (!bets.result?.winnerPlayerId) return null
    const { winnerPlayerId, totalHr } = bets.result
    const c = contestantById.get(winnerPlayerId)
    const entryList = Object.entries(bets.entries).map(([id, e]) => ({
      id, name: e.name, playerId: e.playerId, totalHr: e.totalHr,
    }))
    const outcome = derbyBetWinners(entryList, winnerPlayerId, totalHr)
    const money = derbyPayout(entryList.length, outcome.winners.length)
    return {
      name: c?.name ?? 'Champion',
      team: c ? teams[c.teamId] : undefined,
      seasonHr: c?.seasonHr,
      totalHr,
      scores: broadcast.scores[winnerPlayerId] ?? {},
      betWinners: outcome.winners,
      pot: money.pot,
      toWinners: money.toWinners,
      toCharity: money.toCharity,
      eachTakes: money.each,
    }
  }, [bets.result, bets.entries, contestantById, teams, broadcast.scores])

  const view = broadcast.view
  // Gate the takeover on the graphic ACTUALLY rendering, not just on the view.
  // Clearing a posted result while the champion is up would otherwise leave a
  // blank screen: no winner to draw, and the rail/ticker/clock all stood down.
  const championUp = view === 'winner' && winner !== null

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

        {view === 'winner' && winner && (
          <motion.div
            key="winner"
            className="absolute inset-0"
            // No scale/blur on the way in — the champion card is full of large
            // stroked type, and scaling it re-rasterises every glyph
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <DerbyWinnerScene {...winner} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left rail — always on, independent of `view`. Suppressed only under
          the full leaderboard takeover, which says the same thing bigger. */}
      <AnimatePresence>
        {broadcast.miniBoard && view !== 'leaderboard' && !championUp && miniRows.length > 0 && (
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
        {/* The champion takeover owns the screen — the crawl and the clock
            step aside for it without the producer having to toggle them */}
        {broadcast.ticker && !championUp && (
          <motion.div
            key="ticker"
            className="absolute inset-0"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
          >
            <DerbyTickerScene segments={tickerSegments} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Turn clock — like the ticker, independent of `view` so it can run
          over a clean camera shot. Sits under the All-Star lockup: the
          leaderboard is centred and Up Next hugs the right rail */}
      <AnimatePresence>
        {broadcast.timer.visible && !championUp && (
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

      {/* All-Star Weekend wordmark — top-right watermark, the mirror of the
          league logo bug bottom-right. The left column is the busy side.
          The odds board below is positioned to clear it. */}
      {view !== 'hidden' && (
        <AllStarWordmark
          size={26}
          star
          style={{
            position: 'absolute', top: 24, right: 32,
            opacity: 0.7, pointerEvents: 'none',
          }}
        />
      )}

      {/* 50/50 odds board — the only other thing on the right-hand side, so it
          sits under the wordmark. Stands down under any takeover that owns
          that side of the screen or the whole thing. */}
      <DerbyOddsBoard
        broadcast={broadcast}
        contestants={contestants}
        teams={teams}
        entries={bets.entries}
        suppressed={view === 'leaderboard' || view === 'upNext' || championUp}
      />

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

/**
 * The 50/50 odds board and its rotation.
 *
 * Split out as its own component for one reason: the show/hide cycle is derived
 * from the wall clock (the overlay can't write, so nothing marks it visible)
 * and therefore needs a tick. Ticking inside `DerbyOverlayContent` would
 * re-render the ticker, the rail and the hitter card once a second for nothing.
 *
 * The simulation itself runs on every state change, not only while the board is
 * up — otherwise the board would appear blank and fill in a moment later, on
 * air. It is gated on `enabled` so an overlay with the feature off never pays
 * for it.
 */
function DerbyOddsBoard({ broadcast, contestants, teams, entries, suppressed }: {
  broadcast: DerbyBroadcastState
  contestants: DerbyContestant[]
  teams: Record<string, Team>
  entries: Record<string, DerbyEntry>
  suppressed: boolean
}) {
  const [now, setNow] = useState(() => Date.now())

  // Ticks whenever the board is in play, in BOTH modes. 'timer' mode needs it
  // to work out where in the cycle it is; 'always' mode needs it because the
  // model pro-rates the hitter's part-finished turn by the clock, and a board
  // that sits on screen all derby has to keep up with them as they climb.
  useEffect(() => {
    if (!broadcast.odds.enabled) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [broadcast.odds.enabled])

  const turnFraction = turnFractionOf(broadcast.timer, now)
  const { odds } = useDerbyOdds(broadcast, contestants, entries, {
    enabled: broadcast.odds.enabled,
    turnFraction,
  })

  const contestantById = useMemo(
    () => new Map(contestants.map(c => [c.id, c])),
    [contestants],
  )

  const rows: DerbyOddsDisplayRow[] = useMemo(() => {
    if (!odds) return []
    return odds.rows.slice(0, 5).map(r => {
      const c = contestantById.get(r.playerId)
      return {
        entryId: r.entryId,
        bettorName: r.bettorName,
        // An entry can name a player since toggled OUT of the derby; they
        // can't win, but the row still has to say who was picked.
        playerName: c?.name ?? 'Withdrawn',
        team: c ? teams[c.teamId] : undefined,
        guess: r.guess,
        winProb: r.winProb,
        playerWinProb: r.playerWinProb,
      }
    })
  }, [odds, contestantById, teams])

  const favourite = useMemo(() => {
    const top = odds?.champions[0]
    if (!top) return undefined
    const c = contestantById.get(top.playerId)
    return {
      name: c?.name ?? '',
      team: c ? teams[c.teamId] : undefined,
      winProb: top.winProb,
      totalIfWins: top.totalIfWins,
    }
  }, [odds, contestantById, teams])

  const win = derbyOddsWindow(broadcast.odds, now)
  const entryCount = Object.keys(entries).length
  const money = derbyPayout(entryCount, 1)

  // No bets, nothing to say — and since the board defaults to on, this is what
  // stops a permanently-mounted "no entries yet" panel going to air before
  // anyone has Venmo'd in.
  const hasSomethingToShow = entryCount > 0 && rows.length > 0

  return (
    <AnimatePresence>
      {win.visible && !suppressed && odds && hasSomethingToShow && (
        <motion.div
          key="oddsBoard"
          className="absolute inset-0"
          initial={{ x: 640, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 640, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 230 }}
          style={{ pointerEvents: 'none' }}
        >
          <DerbyOddsScene
            rows={rows}
            charityProb={odds.charityProb}
            favourite={favourite?.name ? favourite : undefined}
            round={broadcast.activeRound}
            pot={money.pot}
            toWinners={money.toWinners}
            projectedTotal={odds.projectedWinningTotal}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function DerbyOverlayRoute() {
  return (
    <OverlayErrorBoundary>
      <DerbyOverlayContent />
    </OverlayErrorBoundary>
  )
}
