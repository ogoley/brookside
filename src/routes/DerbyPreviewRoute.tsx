// Dev-only: renders the derby leaderboard graphics against mock scores so they
// can be checked at every shape (field size, cut line, ties, live row) without
// touching Firebase or waiting for derby night. Not linked from anywhere.
//
//   /derby-preview?n=20&scored=12&round=1
//     n      — how many hitters in the field   (default 20)
//     scored — how many have hit so far        (default 12)
//     round  — 1 | 2 | 3                       (default 1)
//     tie    — how many share the cut score, so the board is 7 + tie deep
//              (2 → 9 rows, 5 → 12, 13 → 20 and past the band). `scored`
//              stretches automatically to make the tie possible.
//     locked — any value confirms the field
//     big      — show the full-screen takeover instead of the left rail
//     champion — the winner graphic; pair with bets=0|1|2|3 for no winner,
//                one winner, a two-way split, or a three-way split
//     money  — any value plays the money-ball graphic on a loop (clock reads 0:00)
//     odds   — the 50/50 odds board. The percentages are real output from
//              derby/odds.ts, so this is also how to sanity-check the model by
//              hand. NOTE it runs on its own realistic mock board, not on the
//              `n`/`scored`/`tie` scores the rail and leaderboard use — so the
//              two deliberately disagree about who's leading. See the comment
//              on ODDS_R1 below.
//     pitcher — name on the hitter card's "PITCHING" line (defaults to one;
//               pass an empty value to check the card without it)
//     fps    — live frame-rate readout, to judge animation cost on the real machine
import { useEffect, useMemo, useState } from 'react'
import { DerbyLeaderboardScene, type DerbyLeaderboardDisplayRow } from '../scenes/derby/DerbyLeaderboardScene'
import { DerbyMiniBoardScene, type DerbyMiniRow } from '../scenes/derby/DerbyMiniBoardScene'
import { DerbyTickerScene, type DerbyTickerRow, type DerbyTickerSegment } from '../scenes/derby/DerbyTickerScene'
import { DerbyPlayerScene } from '../scenes/derby/DerbyPlayerScene'
import { DerbyMoneyBall, MONEY_BALL_ANIM_MS } from '../scenes/derby/DerbyMoneyBallScene'
import { DerbyTurnClock } from '../components/DerbyTurnClock'
import AllStarWordmark from '../components/AllStarWordmark'
import { DEFAULT_DERBY_TIMER, DEFAULT_DERBY_BROADCAST } from '../hooks/useDerbyBroadcast'
import {
  leaderboardForRound, cutInfo, participantsForRound, derbyBetWinners, derbyPayout,
  ADVANCE_COUNT, ROUND_KEY, ROUND_LABEL, DERBY_TURN_MS, type DerbyScoresMap,
} from '../derby/logic'
import { DerbyWinnerScene } from '../scenes/derby/DerbyWinnerScene'
import { DerbyOddsScene, type DerbyOddsDisplayRow } from '../scenes/derby/DerbyOddsScene'
import { useDerbyOdds, turnFractionOf } from '../hooks/useDerbyOdds'
import type {
  Team, DerbyRoundNum, DerbyAdvancerLocks, DerbyTimerState, DerbyBroadcastState, DerbyEntry,
} from '../types'

// Real logo files as stand-ins — the mock teams aren't these teams, but a
// preview with no `logoUrl` silently skips every logo branch, and rows that fit
// without a badge can overflow with one.
const TEAMS: Team[] = [
  { name: 'Reds', shortName: 'RED', primaryColor: '#c0392b', secondaryColor: '#fff', logoUrl: '/logos/team-rist.svg' },
  { name: 'Blues', shortName: 'BLU', primaryColor: '#2563eb', secondaryColor: '#fff', logoUrl: '/logos/team-hiller.svg' },
  { name: 'Greens', shortName: 'GRN', primaryColor: '#16a34a', secondaryColor: '#fff', logoUrl: '/logos/team-rist.svg' },
]

// Bettors for the ?odds board — people, not hitters
const ODDS_BETTORS = [
  'Dragon Ogoley', 'Marty Vee', 'Sal Pastore', 'Denny Quinn', 'Ro Bianchi',
  'Casey Doyle', 'Fran Whitaker', 'Gus Nowak', 'Lou Brennan', 'Nina Falco',
  'Ozzie Grant', 'Peg Turner',
]

const NAMES = [
  'Mike Verteramo', 'Brendan McDonald', 'Sam Hiller', 'Joe Rist', 'Mike LaFleur', 'Pat Goley',
  'Tim Brennan', 'Kevin Doyle', 'Alex Nowak', 'Chris Pastore', 'Dan Quinn', 'Sean Reilly',
  'Luis Santos', 'Ben Turner', 'Raul Ubina', 'Nick Valdez', 'Tom Whitaker', 'Kai Xu',
  'Cole Young', 'Eli Zamora', 'Ryan Abbott', 'Marco Bianchi', 'Jose Colon', 'Pete Devine',
  'Drew Ellis', 'Gio Falco', 'Hank Grant', 'Ian Hobbs', 'Jon Ives', 'Kurt Jansen',
]

export function DerbyPreviewRoute() {
  const params = new URLSearchParams(window.location.search)
  const n = Math.min(parseInt(params.get('n') ?? '20', 10), NAMES.length)
  const scored = Math.min(parseInt(params.get('scored') ?? '12', 10), n)
  const round = (parseInt(params.get('round') ?? '1', 10) || 1) as DerbyRoundNum
  const tieWidth = Math.max(0, parseInt(params.get('tie') ?? '2', 10))
  const wantLocked = params.get('locked') !== null
  const big = params.get('big') !== null
  const clock = params.get('clock') !== '0'
  const money = params.get('money') !== null
  const fps = params.get('fps') !== null
  const showOdds = params.get('odds') !== null

  // A flat green so the transparent overlay reads like an OBS composite
  useEffect(() => {
    document.body.style.background = '#0b3b2e'
    return () => { document.body.style.background = '' }
  }, [])

  const ids = NAMES.slice(0, n).map((_, i) => `p${i}`)
  const key = ROUND_KEY[round]
  const slots = ADVANCE_COUNT[round] ?? n

  // A wide tie needs enough hitters to have gone for it to exist at all —
  // stretch `scored` to cover it so `?tie=13` alone gets you a 20-deep board
  const scoredEff = Math.min(n, Math.max(scored, tieWidth > 1 ? slots - 1 + tieWidth : 0))

  // Distinct, well-spaced base scores so an injected tie is the only one
  const base = (i: number) => Math.max(0, 40 - i * 2)
  const scores: DerbyScoresMap = {}
  ids.forEach((id, i) => {
    if (i < scoredEff) scores[id] = { [key]: base(i) }
  })
  // Park a tie ON the last seat and run it downward, which is what forces a
  // swing-off and what makes the board deeper than the seat count: `tie`
  // players share the 8th-place score, so the rail shows 7 clinched + `tie`.
  // tie=2 → 9 deep, tie=3 → 10, tie=5 → 12, tie=13 → 20 (past the band).
  const tieStart = slots - 1
  if (tieWidth > 1 && scoredEff > slots && tieStart >= 0) {
    for (let idx = tieStart; idx < tieStart + tieWidth; idx++) {
      if (idx < scoredEff) scores[ids[idx]] = { [key]: base(tieStart) }
    }
  }

  const liveId = ids[Math.min(scoredEff, n - 1)]

  // Lock the real way the producer would: everyone clinched, plus whoever wins
  // the swing-off (first `spotsLeft` of the tied group)
  const liveInfo = cutInfo(participantsForRound(ids, scores, round, undefined), scores, round)
  const locks: DerbyAdvancerLocks | undefined = wantLocked && round < 3
    ? { [ROUND_KEY[round] as 'r1' | 'r2']: [...liveInfo.clinched, ...liveInfo.tied.slice(0, liveInfo.spotsLeft)] }
    : undefined

  const rows = leaderboardForRound(ids, scores, round, locks)
  const display: DerbyLeaderboardDisplayRow[] = rows.map(r => ({
    ...r,
    name: NAMES[parseInt(r.playerId.slice(1), 10)],
    team: TEAMS[parseInt(r.playerId.slice(1), 10) % TEAMS.length],
  }))

  const noCut = ADVANCE_COUNT[round] === null
  const field = noCut ? rows : rows.filter(r => r.advancing)
  const live = rows.find(r => r.playerId === liveId)
  const chasing = live && !field.includes(live) ? [live] : []
  const mini: DerbyMiniRow[] = [...field, ...chasing].map(r => ({
    playerId: r.playerId,
    name: NAMES[parseInt(r.playerId.slice(1), 10)],
    team: TEAMS[parseInt(r.playerId.slice(1), 10) % TEAMS.length],
    score: r.score,
    rank: r.rank,
    tied: r.tied,
    chasing: chasing.includes(r),
  }))

  const info = cutInfo(participantsForRound(ids, scores, round, locks), scores, round)

  // Ticker segments: this round plus every round already hit. Earlier rounds get
  // a synthetic full set of scores so the label hand-off has something to crawl.
  const tickerSegments: DerbyTickerSegment[] = []
  for (let r = round; r >= 1; r--) {
    const rk = ROUND_KEY[r as DerbyRoundNum]
    const segIds = r === round
      ? ids
      : ids.slice(0, Math.max(3, slots + 1))
    const segRows: DerbyTickerRow[] = segIds.map((id, idx) => ({
      playerId: id,
      name: NAMES[parseInt(id.slice(1), 10)],
      team: TEAMS[parseInt(id.slice(1), 10) % TEAMS.length],
      score: r === round ? scores[id]?.[rk] : Math.max(0, 14 - idx),
      isCurrent: r === round && id === liveId,
    }))
    tickerSegments.push({
      key: rk,
      label: ROUND_LABEL[r as DerbyRoundNum],
      isCurrent: r === round,
      rows: segRows,
    })
  }

  const liveIdx = parseInt(liveId.slice(1), 10)
  // Stopped rather than running: a live `startedAt` would be an impure read
  // during render, and a frozen clock previews the layout just as well
  const mockTimer: DerbyTimerState = {
    ...DEFAULT_DERBY_TIMER,
    running: false,
    remainingMs: money ? 0 : 56_000,
    playerId: liveId,
  }

  // Champion graphic against a mock 50/50 field. `bets` picks the shape:
  //   1 = one clear winner · 2 = two tied either side · 3 = three-way tie
  //   0 = nobody backed the champion (whole pot to charity)
  const betShape = parseInt(params.get('bets') ?? '2', 10)
  const champTotal = 29
  const GUESSES: Record<number, number[]> = {
    0: [], 1: [30, 24, 35], 2: [30, 28, 24], 3: [30, 28, 30, 22],
  }
  const BETTORS = ['Dragon Ogoley', 'Marty Vee', 'Sal Pastore', 'Denny Quinn', 'Ro Bianchi']
  const mockEntries = (GUESSES[betShape] ?? GUESSES[2]).map((g, i) => ({
    id: `e${i}`, name: BETTORS[i % BETTORS.length], playerId: liveId, totalHr: g,
  }))
  // A few entries on other hitters, so the pot is realistic and the
  // wrong-player exclusion is exercised
  const decoys = [4, 5, 6, 7, 8].map((k, i) => ({
    id: `d${i}`, name: `Bettor ${i + 1}`, playerId: ids[k] ?? ids[0], totalHr: 26 + i,
  }))
  const allEntries = [...mockEntries, ...decoys]
  const champOutcome = derbyBetWinners(allEntries, liveId, champTotal)
  const champMoney = derbyPayout(allEntries.length, champOutcome.winners.length)

  // The odds board, driven through `useDerbyOdds` — the same hook the overlay
  // uses, so this previews the real chunked-simulation path (and not just the
  // pure model, which the unit tests already cover). The hook takes its state
  // as arguments rather than reading Firebase, so mock objects are enough.
  //
  // It gets its OWN mock board rather than reusing `scores` above: those are
  // spaced 40/38/36 to force distinct leaderboard ranks, and a field averaging
  // 38 home runs a round makes the model (correctly) project a winning total
  // near 100. Bracket permutations are the unit tests' job; what this preview
  // is for is seeing the graphic with numbers that look like derby night.
  const oddsMock = useMemo(() => {
    const r1 = [11, 8, 13, 6, 9, 4, 10, 3, 7, 5]
    const oddsScores: DerbyScoresMap = {}
    r1.forEach((v, i) => { if (ids[i]) oddsScores[ids[i]] = { r1: v } })
    // Whoever's up next is mid-turn on 6, so the live-hitter path is exercised
    const liveIdx2 = Math.min(r1.length, ids.length - 1)
    if (ids[liveIdx2]) oddsScores[ids[liveIdx2]] = { r1: 6 }

    const guesses = [31, 26, 38, 24, 33, 29, 22, 35, 27, 30, 41, 25]
    const entries: Record<string, DerbyEntry> = {}
    guesses.forEach((g, i) => {
      entries[`o${i}`] = {
        name: ODDS_BETTORS[i % ODDS_BETTORS.length],
        // Coprime stride so the bets land on nine different hitters — a mock
        // where everyone backed the same three sends the charity odds to 65%
        playerId: ids[(i * 5) % Math.min(ids.length, 9)],
        totalHr: g,
        paid: true,
        createdAt: 0,
      }
    })

    const broadcast: DerbyBroadcastState = {
      ...DEFAULT_DERBY_BROADCAST,
      activeRound: 1,
      scores: oddsScores,
      battingOrder: ids,
      currentBatterIndex: liveIdx2,
      // 45% through the turn, stopped so nothing here reads the wall clock
      timer: { ...DEFAULT_DERBY_TIMER, running: false, remainingMs: DERBY_TURN_MS * 0.55 },
    }
    const contestants = ids.map((id, i) => ({
      id, name: NAMES[i], teamId: String(i % TEAMS.length), seasonHr: Math.max(1, 18 - i),
    }))
    return { broadcast, contestants, entries }
  }, [ids])

  const { odds: oddsResult } = useDerbyOdds(
    oddsMock.broadcast, oddsMock.contestants, oddsMock.entries,
    { enabled: showOdds, turnFraction: turnFractionOf(oddsMock.broadcast.timer, 0) },
  )

  const oddsRows: DerbyOddsDisplayRow[] = (oddsResult?.rows ?? []).slice(0, 5).map(r => {
    const idx = parseInt(r.playerId.slice(1), 10)
    return {
      entryId: r.entryId,
      bettorName: r.bettorName,
      playerName: NAMES[idx],
      team: TEAMS[idx % TEAMS.length],
      guess: r.guess,
      winProb: r.winProb,
      playerWinProb: r.playerWinProb,
    }
  })
  const oddsFav = oddsResult?.champions[0]
  const oddsMoney = derbyPayout(oddsResult?.rows.length ?? 0, 1)

  return (
    <div style={{ width: 1920, height: 1080, position: 'relative' }}>
      {params.get('champion') !== null ? (
        <DerbyWinnerScene
          name={NAMES[parseInt(liveId.slice(1), 10)]}
          team={TEAMS[parseInt(liveId.slice(1), 10) % TEAMS.length]}
          totalHr={champTotal}
          scores={{ r1: 11, r2: 9, r3: 9 }}
          seasonHr={14}
          betWinners={champOutcome.winners}
          pot={champMoney.pot}
          toWinners={champMoney.toWinners}
          toCharity={champMoney.toCharity}
          eachTakes={champMoney.each}
        />
      ) : big ? (
        <DerbyLeaderboardScene rows={display} round={round} livePlayerId={liveId} locked={!!locks} />
      ) : (
        <>
          {/* The whole left column, so the dashboard can be read as one stack,
              plus the top-right wordmark the odds board has to clear */}
          <AllStarWordmark
            size={26}
            star
            style={{
              position: 'absolute', top: 24, right: 32,
              opacity: 0.7, pointerEvents: 'none',
            }}
          />
          {clock && <DerbyTurnClock timer={mockTimer} playerName={NAMES[liveIdx]} />}
          <DerbyMiniBoardScene
            rows={mini}
            round={round}
            livePlayerId={liveId}
            locked={!!locks}
            tiedCount={info.tied.length}
            spotsLeft={info.spotsLeft}
            clockVisible={clock}
          />
          <DerbyTickerScene segments={tickerSegments} />
          <DerbyPlayerScene
            name={NAMES[liveIdx]}
            seasonHr={12}
            team={TEAMS[liveIdx % TEAMS.length]}
            scores={scores[liveId] ?? {}}
            activeRound={round}
            pitcher={params.get('pitcher') ?? 'Rick Vaughn'}
          />
        </>
      )}
      {oddsResult && (
        <DerbyOddsScene
          rows={oddsRows}
          charityProb={oddsResult.charityProb}
          favourite={oddsFav ? {
            name: NAMES[parseInt(oddsFav.playerId.slice(1), 10)],
            team: TEAMS[parseInt(oddsFav.playerId.slice(1), 10) % TEAMS.length],
            winProb: oddsFav.winProb,
            totalIfWins: oddsFav.totalIfWins,
          } : undefined}
          round={1}
          pot={oddsMoney.pot}
          toWinners={oddsMoney.toWinners}
          projectedTotal={oddsResult.projectedWinningTotal}
        />
      )}
      {money && <MoneyBallLoop playerName={NAMES[liveIdx]} />}
      {fps && <FpsMeter />}
    </div>
  )
}

/**
 * Live frame-rate readout — `?fps`. Judge animation cost on the actual machine
 * that will run the broadcast: `avg` is the last second, `worst` is the longest
 * single frame in it (anything over ~20ms is a visible hitch). Deliberately
 * cheap: one rAF loop, one setState a second.
 */
function FpsMeter() {
  const [stat, setStat] = useState({ fps: 0, worst: 0 })

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let windowStart = last
    let frames = 0
    let worst = 0

    const tick = (t: number) => {
      const dt = t - last
      last = t
      frames++
      if (dt > worst) worst = dt
      if (t - windowStart >= 1000) {
        setStat({ fps: Math.round((frames * 1000) / (t - windowStart)), worst: Math.round(worst) })
        windowStart = t
        frames = 0
        worst = 0
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const bad = stat.worst > 20
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, zIndex: 100,
      background: 'rgba(8,13,24,0.9)', borderRadius: 10, padding: '8px 14px',
      fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 800, letterSpacing: '0.06em',
      color: bad ? '#f87171' : '#4ade80', border: `2px solid ${bad ? '#f87171' : '#4ade80'}`,
    }}>
      {stat.fps} FPS
      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginLeft: 10 }}>
        worst {stat.worst}ms
      </span>
    </div>
  )
}

/** Replays the money-ball graphic on a loop so it can be judged frame by frame. */
function MoneyBallLoop({ playerName }: { playerName: string }) {
  const [at, setAt] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setAt(Date.now()), MONEY_BALL_ANIM_MS + 700)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
      <DerbyMoneyBall key={at} at={at} playerName={playerName} />
    </div>
  )
}
