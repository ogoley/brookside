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
//     big    — show the full-screen takeover instead of the left rail
//     money  — any value plays the money-ball graphic on a loop (clock reads 0:00)
//     fps    — live frame-rate readout, to judge animation cost on the real machine
import { useEffect, useState } from 'react'
import { DerbyLeaderboardScene, type DerbyLeaderboardDisplayRow } from '../scenes/derby/DerbyLeaderboardScene'
import { DerbyMiniBoardScene, type DerbyMiniRow } from '../scenes/derby/DerbyMiniBoardScene'
import { DerbyPlayerScene } from '../scenes/derby/DerbyPlayerScene'
import { DerbyMoneyBall, MONEY_BALL_ANIM_MS } from '../scenes/derby/DerbyMoneyBallScene'
import { DerbyTurnClock } from '../components/DerbyTurnClock'
import { DEFAULT_DERBY_TIMER } from '../hooks/useDerbyBroadcast'
import { leaderboardForRound, cutInfo, participantsForRound, ADVANCE_COUNT, ROUND_KEY, type DerbyScoresMap } from '../derby/logic'
import type { Team, DerbyRoundNum, DerbyAdvancerLocks, DerbyTimerState } from '../types'

const TEAMS: Team[] = [
  { name: 'Reds', shortName: 'RED', primaryColor: '#c0392b', secondaryColor: '#fff', logoUrl: '' },
  { name: 'Blues', shortName: 'BLU', primaryColor: '#2563eb', secondaryColor: '#fff', logoUrl: '' },
  { name: 'Greens', shortName: 'GRN', primaryColor: '#16a34a', secondaryColor: '#fff', logoUrl: '' },
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

  const liveIdx = parseInt(liveId.slice(1), 10)
  // Stopped rather than running: a live `startedAt` would be an impure read
  // during render, and a frozen clock previews the layout just as well
  const mockTimer: DerbyTimerState = {
    ...DEFAULT_DERBY_TIMER,
    running: false,
    remainingMs: money ? 0 : 56_000,
    playerId: liveId,
  }

  return (
    <div style={{ width: 1920, height: 1080, position: 'relative' }}>
      {big ? (
        <DerbyLeaderboardScene rows={display} round={round} livePlayerId={liveId} locked={!!locks} />
      ) : (
        <>
          {/* The whole left column, so the dashboard can be read as one stack */}
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
          <DerbyPlayerScene
            name={NAMES[liveIdx]}
            seasonHr={12}
            team={TEAMS[liveIdx % TEAMS.length]}
            scores={scores[liveId] ?? {}}
            activeRound={round}
          />
        </>
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
