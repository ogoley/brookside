import { useState, useEffect, useMemo, useRef } from 'react'
import { Reorder } from 'framer-motion'
import { ref, set, update, remove } from 'firebase/database'
import { db } from '../firebase'
import { useDerbyBroadcast } from '../hooks/useDerbyBroadcast'
import { useDerbyContestants, type DerbyContestant } from '../hooks/useDerbyContestants'
import { useDerbyClock } from '../hooks/useDerbyTimer'
import { useDerbyBets } from '../hooks/useDerbyBets'
import {
  ROUND_KEY, ROUND_LABEL, ADVANCE_COUNT,
  roundScore, derbyTotal, participantsForRound, effectiveAdvancers, cutInfo, isRoundLocked,
  derbySeedValue, seedOrderForRound, leaderboardForRound, derbyBetWinners, derbyPayout,
  derbyTimerRemainingMs, formatDerbyClock, DERBY_MONEY_BALL_HR,
} from '../derby/logic'
import type { DerbyBroadcastView, DerbyRoundNum, DerbyAdvancerLocks } from '../types'
import type { DerbyScoresMap } from '../derby/logic'

// Same front-end gate as the /derby admin footer — the /derby path is
// intentionally open at the rules layer, so this is a convenience lock only.
const ADMIN_PASSWORD = 'dingers'

const ROUNDS: DerbyRoundNum[] = [1, 2, 3]

const VIEWS: { key: DerbyBroadcastView; label: string; icon: string }[] = [
  { key: 'hidden', label: 'Hidden', icon: '🚫' },
  { key: 'player', label: 'Player Card', icon: '👤' },
  { key: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { key: 'upNext', label: 'Up Next', icon: '📋' },
  { key: 'winner', label: 'Champion', icon: '👑' },
]

const bcastRef = (path?: string) => ref(db, path ? `derby/broadcast/${path}` : 'derby/broadcast')

export function DerbyControllerRoute() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('derbyAdmin') === '1')

  useEffect(() => { document.title = 'Derby Control' }, [])

  if (!unlocked) {
    return <GateScreen onUnlock={() => { sessionStorage.setItem('derbyAdmin', '1'); setUnlocked(true) }} />
  }
  return <ControlPanel />
}

function ControlPanel() {
  const { broadcast, loading } = useDerbyBroadcast()
  const { contestants, contestantById, teams } = useDerbyContestants()

  const eligibleIds = useMemo(() => contestants.map(c => c.id), [contestants])
  const { view, activeRound, leaderboardRound, scores, battingOrder, featuredPlayerId, ticker, miniBoard, advancers: locks } = broadcast
  const roundKey = ROUND_KEY[activeRound]

  // Order may reference players who've since been toggled OUT — keep the raw
  // array for writes, but only work with resolvable entries in the UI
  const order = useMemo(
    () => battingOrder.filter(id => contestantById.has(id)),
    [battingOrder, contestantById],
  )
  const currentIndex = Math.min(broadcast.currentBatterIndex, Math.max(0, order.length - 1))
  const currentBatterId = order[currentIndex]
  const currentBatter = currentBatterId ? contestantById.get(currentBatterId) : undefined
  const currentScore = currentBatterId ? roundScore(scores, currentBatterId, activeRound) : undefined

  const participants = useMemo(
    () => participantsForRound(eligibleIds, scores, activeRound, locks),
    [eligibleIds, scores, activeRound, locks],
  )
  const advancers = useMemo(
    () => effectiveAdvancers(participants, scores, activeRound, locks),
    [participants, scores, activeRound, locks],
  )

  // ── Writes ────────────────────────────────────────────────────────────
  const setView = (v: DerbyBroadcastView) => set(bcastRef('view'), v)
  const setLeaderboardRound = (r: DerbyRoundNum) => set(bcastRef('leaderboardRound'), r)
  const setFeatured = (id: string | null) => set(bcastRef('featuredPlayerId'), id)
  const setTicker = (on: boolean) => set(bcastRef('ticker'), on)
  const setMiniBoard = (on: boolean) => set(bcastRef('miniBoard'), on)

  // New round = that round's field, in that round's order, and a fresh turn
  // clock. Without this the previous round's whole order stayed on screen and
  // there was no way to tell which round you were looking at.
  const setActiveRound = (r: DerbyRoundNum) => {
    const nextField = participantsForRound(eligibleIds, scores, r, locks)
    const patch: Record<string, unknown> = { activeRound: r, leaderboardRound: r }
    // Only re-seed when the field actually changes — bouncing between rounds
    // and back must not throw away hand-dragged order
    if (!sameSet(order, nextField)) {
      const seeded = buildSeededOrder(r)
      patch['battingOrder'] = seeded
      patch['currentBatterIndex'] = 0
      patch['featuredPlayerId'] = seeded[0] ?? null
      Object.assign(patch, timerResetPatch(seeded[0] ?? null))
    } else {
      Object.assign(patch, timerResetPatch(order[0] ?? null))
      patch['currentBatterIndex'] = 0
      patch['featuredPlayerId'] = order[0] ?? null
    }
    return update(bcastRef(), patch)
  }

  const setScore = (playerId: string, round: DerbyRoundNum, n: number | null) => {
    const scoreRef = ref(db, `derby/broadcast/scores/${playerId}/${ROUND_KEY[round]}`)
    return n === null ? remove(scoreRef) : set(scoreRef, n)
  }

  const bumpCurrent = (delta: number) => {
    if (!currentBatterId) return
    setScore(currentBatterId, activeRound, Math.max(0, (currentScore ?? 0) + delta))
  }

  // Seeding rule itself lives in derby/logic.ts (pure + tested)
  const contestantInfo = (id: string) => ({
    seasonHr: contestantById.get(id)?.seasonHr ?? 0,
    name: contestantById.get(id)?.name ?? '',
  })

  const seedValue = (id: string, round: DerbyRoundNum) =>
    derbySeedValue(scores, id, round, contestantById.get(id)?.seasonHr ?? 0)

  const buildSeededOrder = (round: DerbyRoundNum) =>
    seedOrderForRound(participantsForRound(eligibleIds, scores, round, locks), scores, round, contestantInfo)

  const orderRule = activeRound > 1
    ? `Fewest ${ROUND_LABEL[activeRound - 1 as DerbyRoundNum]} HR first — the leaders hit last`
    : 'Most season HR first'

  const loadOrder = () => {
    if (participants.length === 0) return
    if (order.length > 0 && !window.confirm(`Replace the batting order with the ${participants.length} hitters of ${ROUND_LABEL[activeRound]}?\n\n${orderRule}. Drag rows after to fine-tune.`)) return
    const seeded = buildSeededOrder(activeRound)
    update(bcastRef(), {
      battingOrder: seeded, currentBatterIndex: 0, featuredPlayerId: seeded[0] ?? null,
      ...timerResetPatch(seeded[0] ?? null),
    })
  }

  // Auto-fill: if the order is empty once everything has loaded, seed it with
  // every hitter of the active round so the producer only dismisses/drags.
  // Guarded per-session so deliberately emptying the list doesn't refill it.
  const autoSeededRef = useRef(false)
  useEffect(() => {
    if (loading || autoSeededRef.current) return
    if (order.length > 0) { autoSeededRef.current = true; return }
    if (participants.length === 0) return
    autoSeededRef.current = true
    const seeded = buildSeededOrder(activeRound)
    const updates: Record<string, unknown> = { battingOrder: seeded, currentBatterIndex: 0 }
    if (!featuredPlayerId) updates['featuredPlayerId'] = seeded[0] ?? null
    update(bcastRef(), updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, order.length, participants.length])

  // ── Wipe a practice run ───────────────────────────────────────────────
  // Everything the derby competition produced goes; the 50/50 entries stay.
  // Those are real money already sent over Venmo — see ResetSection.
  const recordedScoreCount = useMemo(
    () => Object.values(scores).reduce(
      (n, s) => n + (s.r1 !== undefined ? 1 : 0) + (s.r2 !== undefined ? 1 : 0) + (s.r3 !== undefined ? 1 : 0),
      0,
    ),
    [scores],
  )

  const resetDerbyScores = () => {
    if (!window.confirm(
      `Reset the derby for a fresh run?\n\n`
      + `DELETES  ${recordedScoreCount} recorded home run score(s), the confirmed advancers, `
      + `the batting order and the declared champion.\n`
      + `KEEPS    every 50/50 bet — real money, untouched.\n\n`
      + `Nothing is archived. For the end of a real season use “Archive this derby & reset” on /derby.`
    )) return

    // Round 1 seeds off season HR, so this is unaffected by the scores we're
    // about to drop — the order comes back ready for another run
    const seeded = buildSeededOrder(1)
    return update(ref(db), {
      'derby/broadcast/scores': null,
      'derby/broadcast/advancers': null,
      'derby/broadcast/activeRound': 1,
      'derby/broadcast/leaderboardRound': 1,
      'derby/broadcast/view': 'hidden',
      'derby/broadcast/battingOrder': seeded,
      'derby/broadcast/currentBatterIndex': 0,
      'derby/broadcast/featuredPlayerId': seeded[0] ?? null,
      'derby/broadcast/timer/phase': 'main',
      'derby/broadcast/timer/running': false,
      'derby/broadcast/timer/startedAt': null,
      'derby/broadcast/timer/remainingMs': timer.durationMs,
      'derby/broadcast/timer/timeoutRemainingMs': timer.timeoutDurationMs,
      'derby/broadcast/timer/timeoutUsed': false,
      'derby/broadcast/timer/moneyBallAt': null,
      'derby/broadcast/timer/playerId': seeded[0] ?? null,
      'derby/result': null,
      // derby/entries and derby/disabledPlayers are deliberately absent
    })
  }

  const goToBatter = (i: number) => {
    const clamped = Math.max(0, Math.min(i, order.length - 1))
    update(bcastRef(), {
      currentBatterIndex: clamped, featuredPlayerId: order[clamped] ?? null,
      ...timerResetPatch(order[clamped] ?? null),
    })
  }

  const nextBatter = () => {
    if (order.length === 0) return
    const updates: Record<string, unknown> = {}
    // The outgoing batter is done — a missing score becomes a real 0
    if (currentBatterId && currentScore === undefined) {
      updates[`scores/${currentBatterId}/${roundKey}`] = 0
    }
    const newIdx = Math.min(currentIndex + 1, order.length - 1)
    updates['currentBatterIndex'] = newIdx
    updates['featuredPlayerId'] = order[newIdx] ?? null
    Object.assign(updates, timerResetPatch(order[newIdx] ?? null))
    update(bcastRef(), updates)
  }

  // ── Turn clock: each hitter gets 90s + one 30s timeout inside it ──────
  // `timer` is the stored state resolved to now — an expired timeout already
  // reads as the resumed turn clock, so every button acts on what's on screen
  const rawTimer = broadcast.timer
  const { timer, remainingMs: timerRemaining } = useDerbyClock(rawTimer)
  const inTimeout = timer.phase === 'timeout'
  const timerExpired = !inTimeout && timerRemaining <= 0

  const startClock = () => {
    if (timerRemaining <= 0) return
    update(bcastRef('timer'), { running: true, startedAt: Date.now() })
  }

  // `phase` is written explicitly: if the stored state still says 'timeout'
  // but it has already rolled over, stopping must commit the rollover too
  const pauseClock = () => {
    const rem = derbyTimerRemainingMs(timer, Date.now())
    update(bcastRef('timer'), inTimeout
      ? { phase: 'timeout', running: false, startedAt: null, timeoutRemainingMs: rem }
      : { phase: 'main', running: false, startedAt: null, remainingMs: rem, timeoutRemainingMs: timer.timeoutRemainingMs })
  }

  // The 30s pause freezes the turn clock exactly where it stands
  const takeTimeout = () => {
    if (timer.timeoutUsed || inTimeout) return
    update(bcastRef('timer'), {
      remainingMs: derbyTimerRemainingMs(timer, Date.now()),
      phase: 'timeout',
      timeoutRemainingMs: timer.timeoutDurationMs,
      timeoutUsed: true,
      running: true,
      startedAt: Date.now(),
    })
  }

  // Back to hitting — the turn clock picks straight back up where it froze,
  // whether the 30s ran out or the producer ended it early
  const endTimeout = () =>
    update(bcastRef('timer'), {
      phase: 'main',
      timeoutRemainingMs: 0,
      running: true,
      startedAt: Date.now(),
    })

  const setTimerVisible = (v: boolean) => set(bcastRef('timer/visible'), v)

  const setDurations = (durationMs: number, timeoutDurationMs: number) => {
    const patch: Record<string, unknown> = { durationMs, timeoutDurationMs }
    // A fresh, untouched clock adopts the new length right away; one that's
    // mid-turn keeps its number until the next reset
    if (!timer.running && timer.remainingMs === timer.durationMs) patch['remainingMs'] = durationMs
    if (!timer.running && timer.timeoutRemainingMs === timer.timeoutDurationMs) {
      patch['timeoutRemainingMs'] = timeoutDurationMs
    }
    update(bcastRef('timer'), patch)
  }

  // A fresh clock for a new hitter. Returned as multi-path keys so it rides
  // along in the same update as the batter change — the two can never drift.
  const timerResetPatch = (playerId: string | null) => ({
    'timer/phase': 'main',
    'timer/running': false,
    'timer/startedAt': null,
    'timer/remainingMs': timer.durationMs,
    'timer/timeoutRemainingMs': timer.timeoutDurationMs,
    'timer/timeoutUsed': false,
    'timer/playerId': playerId,
    'timer/moneyBallAt': null,
  })

  const resetClock = () => update(bcastRef(), timerResetPatch(currentBatterId ?? null))

  // ── Money ball: the one pitch after 0:00, worth 3 ─────────────────────
  const moneyBallTaken = timer.moneyBallAt != null
  const moneyBallReady = timerExpired && !moneyBallTaken && !!currentBatterId

  // Score and timestamp go up in ONE atomic update so the overlay sees them in
  // a single snapshot — that's how the hitter card knows to leave the +3 to the
  // full-screen money-ball graphic instead of firing its usual home run burst.
  const hitMoneyBall = () => {
    if (!moneyBallReady || !currentBatterId) return
    update(bcastRef(), {
      [`scores/${currentBatterId}/${roundKey}`]: (currentScore ?? 0) + DERBY_MONEY_BALL_HR,
      'timer/moneyBallAt': Date.now(),
    })
  }

  const undoMoneyBall = () => {
    if (!moneyBallTaken || !currentBatterId) return
    update(bcastRef(), {
      [`scores/${currentBatterId}/${roundKey}`]: Math.max(0, (currentScore ?? 0) - DERBY_MONEY_BALL_HR),
      'timer/moneyBallAt': null,
    })
  }

  // The overlay is read-only, so the controller owns the clock's transitions:
  // one timeout per running segment, re-derived from `startedAt` after a
  // reload. Same pattern as the game controller's stat auto-dismiss.
  // Keyed off the STORED state — this schedules the write that makes the
  // rollover real for everyone; the overlay derives the same thing meanwhile.
  useEffect(() => {
    if (!rawTimer.running || rawTimer.startedAt == null) return
    const ms = derbyTimerRemainingMs(rawTimer, Date.now())
    const id = setTimeout(() => {
      update(bcastRef('timer'), rawTimer.phase === 'timeout'
        // Timeout over → the turn clock resumes itself, no producer input
        ? { phase: 'main', timeoutRemainingMs: 0, running: true, startedAt: rawTimer.startedAt! + rawTimer.timeoutRemainingMs }
        : { running: false, startedAt: null, remainingMs: 0 })
    }, ms + 80)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTimer.running, rawTimer.startedAt, rawTimer.phase, rawTimer.remainingMs, rawTimer.timeoutRemainingMs])

  // ── Drag-and-drop order: local mirror while dragging, commit on drop ──
  const [localOrder, setLocalOrder] = useState<string[]>(order)
  const localOrderRef = useRef(localOrder)
  localOrderRef.current = localOrder
  const draggingRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current) return
    // Compare by value. `order` is derived from upstream snapshot state, and if
    // anything up that chain ever hands back a fresh object per render, setting
    // state on identity alone re-invalidates this effect forever (that is
    // exactly the "Maximum update depth exceeded" this page hit). Content-equal
    // means nothing to sync, so don't touch state.
    setLocalOrder(prev =>
      prev.length === order.length && prev.every((id, i) => id === order[i]) ? prev : order,
    )
  }, [order])

  const commitOrder = (next: string[]) => {
    // currentBatterIndex follows the current batter's new position
    const curId = order[currentIndex]
    const idx = curId ? Math.max(0, next.indexOf(curId)) : 0
    update(bcastRef(), { battingOrder: next, currentBatterIndex: idx })
  }

  const selectBatter = (id: string) => {
    const i = order.indexOf(id)
    if (i >= 0) update(bcastRef(), { currentBatterIndex: i, featuredPlayerId: id, ...timerResetPatch(id) })
  }

  const removeFromOrder = (id: string) => {
    const next = order.filter(x => x !== id)
    const curId = order[currentIndex]
    const idx = curId && curId !== id
      ? Math.max(0, next.indexOf(curId))
      : Math.max(0, Math.min(currentIndex, next.length - 1))
    update(bcastRef(), { battingOrder: next, currentBatterIndex: idx })
  }

  const addToOrder = (id: string) => {
    if (!id || order.includes(id)) return
    set(bcastRef('battingOrder'), [...order, id])
  }

  // ── Derived display bits ──────────────────────────────────────────────
  const notInOrder = contestants.filter(c => !order.includes(c.id))
  const featured = featuredPlayerId ? contestantById.get(featuredPlayerId) : undefined
  const advanceCount = ADVANCE_COUNT[activeRound]

  const [scoresOpen, setScoresOpen] = useState(false)
  const [addPick, setAddPick] = useState('')

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'var(--font-ui)', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 12px 48px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
          <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            🎥 Derby Control
          </h1>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            drives <code style={{ color: '#94a3b8' }}>/derby-overlay</code>
          </span>
        </div>

        {/* ── Broadcast view ── */}
        <Section title="Broadcast view" accent="#fbbf24">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 8 }}>
            {VIEWS.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  ...bigBtn,
                  background: view === v.key ? '#fbbf24' : '#1e293b',
                  color: view === v.key ? '#0f172a' : '#cbd5e1',
                  border: `2px solid ${view === v.key ? '#fbbf24' : '#334155'}`,
                }}
              >
                <span style={{ fontSize: 18, display: 'block' }}>{v.icon}</span>
                {v.label}
              </button>
            ))}
          </div>
          {view === 'leaderboard' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={smallLabel}>Showing round</span>
              {ROUNDS.map(r => (
                <Chip key={r} active={leaderboardRound === r} onClick={() => setLeaderboardRound(r)}>
                  {ROUND_LABEL[r]}
                </Chip>
              ))}
            </div>
          )}
          {view === 'player' && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8' }}>
              Showing: <strong style={{ color: '#fbbf24' }}>{featured?.name ?? 'nobody — pick a player below'}</strong>
            </div>
          )}

          {/* Ticker is independent of the view — it can crawl under any scene,
              or over a clean camera shot with everything else hidden */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
            <button
              onClick={() => setTicker(!ticker)}
              style={{
                ...smallBtn, fontWeight: 800,
                background: ticker ? '#16a34a' : '#1e293b',
                color: ticker ? '#ffffff' : '#cbd5e1',
                border: `2px solid ${ticker ? '#16a34a' : '#334155'}`,
              }}
            >
              📊 Ticker: {ticker ? 'ON' : 'OFF'}
            </button>
            <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
              Bottom crawl — every {ROUND_LABEL[activeRound]} hitter with their score (TBD until they hit). Always on screen, any view.
            </span>
          </div>

          {/* Left rail — also view-independent; hides itself under the takeover
              leaderboard, which says the same thing bigger */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button
              onClick={() => setMiniBoard(!miniBoard)}
              style={{
                ...smallBtn, fontWeight: 800,
                background: miniBoard ? '#16a34a' : '#1e293b',
                color: miniBoard ? '#ffffff' : '#cbd5e1',
                border: `2px solid ${miniBoard ? '#16a34a' : '#334155'}`,
              }}
            >
              🏆 Left rail: {miniBoard ? 'ON' : 'OFF'}
            </button>
            <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
              Who’s advancing right now — {advanceCount ?? 'all'} {advanceCount === null ? 'finalists' : 'spots'}
              {advancers.length > (advanceCount ?? Infinity) && `, ${advancers.length} alive on a tie`}. Hides under the big leaderboard.
            </span>
          </div>
        </Section>

        {/* ── Round ── */}
        <Section title="Derby round" accent="#60a5fa">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {ROUNDS.map(r => (
              <Chip key={r} active={activeRound === r} onClick={() => setActiveRound(r)} big>
                {ROUND_LABEL[r]}
              </Chip>
            ))}
            <button onClick={loadOrder} disabled={participants.length === 0} style={{
              ...smallBtn, marginLeft: 'auto',
              background: participants.length === 0 ? '#334155' : '#2563eb',
              color: '#ffffff', border: 'none',
              cursor: participants.length === 0 ? 'not-allowed' : 'pointer',
            }}>
              Load {ROUND_LABEL[activeRound]} order ({participants.length})
            </button>
          </div>
          {advanceCount !== null && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
              Top {advanceCount} advance (ties move up).{' '}
              {advancers.length > 0 && (
                <>
                  Currently in: <span style={{ color: '#4ade80', fontWeight: 600 }}>
                    {advancers.map(id => contestantById.get(id)?.name ?? '?').join(', ')}
                  </span>
                </>
              )}
            </div>
          )}
        </Section>

        {/* ── Champion ── always mounted: a posted result has to stay
            clearable no matter which round the producer is looking at */}
        <ChampionSection
          eligibleIds={eligibleIds}
          scores={scores}
          locks={locks}
          activeRound={activeRound}
          contestantById={contestantById}
          teams={teams}
          onShow={() => setView('winner')}
          onCleared={() => { if (broadcast.view === 'winner') setView('hidden') }}
        />

        {/* ── Advancement ── */}
        <AdvancementSection
          eligibleIds={eligibleIds}
          scores={scores}
          locks={locks}
          activeRound={activeRound}
          contestantById={contestantById}
        />

        {/* ── Now batting ── */}
        <Section title="Now batting" accent="#4ade80">
          {!currentBatter ? (
            <div style={{ fontSize: 14, color: '#64748b', padding: '8px 0' }}>
              No batting order yet — load the round order or add players below.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                    {currentBatter.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {teams[currentBatter.teamId]?.shortName ?? ''} · {currentBatter.seasonHr} season HR
                    · batter {currentIndex + 1} of {order.length}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {ROUND_LABEL[activeRound]} HR
                  </div>
                  <div style={{ fontFamily: 'var(--font-score)', fontSize: 52, fontWeight: 900, color: currentScore === undefined ? '#475569' : '#fbbf24', lineHeight: 1 }}>
                    {currentScore ?? '–'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => bumpCurrent(1)} style={{ ...bigBtn, flex: '2 1 140px', fontSize: 18, background: '#16a34a', color: '#ffffff', border: 'none' }}>
                  +1 HOME RUN 💣
                </button>
                <button onClick={() => bumpCurrent(-1)} style={{ ...bigBtn, flex: '1 1 70px', background: '#1e293b', color: '#cbd5e1', border: '2px solid #334155' }}>
                  −1
                </button>
              </div>

              {/* Money ball — the extra pitch after 0:00. Stays visible but
                  locked while the clock runs, so the rule is on the panel */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'stretch' }}>
                <button
                  onClick={hitMoneyBall}
                  disabled={!moneyBallReady}
                  style={{
                    ...bigBtn, flex: 1, fontSize: 19, position: 'relative',
                    background: moneyBallReady
                      ? 'linear-gradient(180deg, #fbbf24, #f59e0b)'
                      : moneyBallTaken ? '#422006' : '#1e293b',
                    color: moneyBallReady ? '#0f172a' : moneyBallTaken ? '#fbbf24' : '#475569',
                    border: `2px solid ${moneyBallReady ? '#fbbf24' : moneyBallTaken ? '#a16207' : '#334155'}`,
                    boxShadow: moneyBallReady ? '0 0 22px rgba(251,191,36,0.45)' : 'none',
                    cursor: moneyBallReady ? 'pointer' : 'not-allowed',
                  }}
                >
                  💰 MONEY BALL +{DERBY_MONEY_BALL_HR}
                </button>
                {moneyBallTaken && (
                  <button
                    onClick={undoMoneyBall}
                    title={`Undo the money ball — takes ${DERBY_MONEY_BALL_HR} back off`}
                    style={{ ...bigBtn, flex: '0 0 78px', background: '#1e293b', color: '#f87171', border: '2px solid #334155' }}
                  >
                    ↺ Undo
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: moneyBallReady ? '#fbbf24' : '#64748b', marginTop: 6, lineHeight: 1.5 }}>
                {moneyBallTaken
                  ? `Money ball hit — ${DERBY_MONEY_BALL_HR} home runs added.`
                  : moneyBallReady
                    ? 'Time is up — one more pitch. Hit it and the money ball graphic takes over the screen.'
                    : `Unlocks at 0:00: the final pitch counts as ${DERBY_MONEY_BALL_HR} home runs.`}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => goToBatter(currentIndex - 1)} disabled={currentIndex === 0} style={{ ...smallBtn, flex: 1, background: '#1e293b', color: currentIndex === 0 ? '#475569' : '#cbd5e1', border: '1px solid #334155' }}>
                  ◀ Prev batter
                </button>
                <button onClick={nextBatter} disabled={currentIndex >= order.length - 1} style={{ ...smallBtn, flex: 2, background: currentIndex >= order.length - 1 ? '#334155' : '#2563eb', color: '#ffffff', border: 'none', fontWeight: 800 }}>
                  Done — next batter ▶
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                “Next batter” locks in the current score (blank becomes 0), features the next hitter
                and puts a fresh clock on them.
              </div>
            </>
          )}
        </Section>

        {/* ── Turn clock ── */}
        <Section title="Turn clock" accent="#38bdf8">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 60, fontWeight: 900, lineHeight: 1,
              minWidth: 140, fontVariantNumeric: 'tabular-nums',
              color: inTimeout ? '#38bdf8'
                : moneyBallReady ? '#fbbf24'
                : timerExpired ? '#f87171'
                : timerRemaining <= 10_000 ? '#f87171'
                : timer.running ? '#fbbf24' : '#cbd5e1',
            }}>
              {formatDerbyClock(timerRemaining)}
            </div>
            <div style={{ flex: '1 1 200px', lineHeight: 1.6 }}>
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: inTimeout ? '#38bdf8'
                  : moneyBallReady ? '#fbbf24'
                  : timerExpired ? '#f87171'
                  : timer.running ? '#4ade80' : '#94a3b8',
              }}>
                {inTimeout
                  ? (timer.running ? '30-second timeout' : 'Timeout paused')
                  : moneyBallReady ? 'Final pitch — money ball'
                  : timerExpired ? "Time's up"
                  : timer.running ? 'Hitting' : 'Stopped'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {timer.timeoutUsed
                  ? <span style={{ color: '#64748b' }}>Timeout used</span>
                  : <span style={{ color: '#fbbf24' }}>Timeout available</span>}
                {inTimeout && <> · {formatDerbyClock(timer.remainingMs)} left after</>}
              </div>
              {timer.playerId && timer.playerId !== currentBatterId && (
                <div style={{ fontSize: 12, color: '#fbbf24' }}>
                  Clock belongs to {contestantById.get(timer.playerId)?.name ?? 'a previous hitter'} — reset to move it.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {timer.running ? (
              <button onClick={pauseClock} style={{ ...bigBtn, flex: '2 1 150px', fontSize: 17, background: '#b45309', color: '#ffffff', border: 'none' }}>
                ⏸ Stop clock
              </button>
            ) : (
              <button
                onClick={startClock}
                disabled={timerRemaining <= 0}
                style={{
                  ...bigBtn, flex: '2 1 150px', fontSize: 17, border: 'none', color: '#ffffff',
                  background: timerRemaining <= 0 ? '#334155' : '#16a34a',
                  cursor: timerRemaining <= 0 ? 'not-allowed' : 'pointer',
                }}
              >
                ▶ {timerRemaining < timer.durationMs || inTimeout ? 'Resume' : 'Start'} clock
              </button>
            )}
            <button onClick={resetClock} style={{ ...bigBtn, flex: '1 1 110px', background: '#1e293b', color: '#cbd5e1', border: '2px solid #334155' }}>
              ↺ Reset {Math.round(timer.durationMs / 1000)}s
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {inTimeout ? (
              <button onClick={endTimeout} style={{ ...bigBtn, flex: '1 1 100%', fontSize: 15, background: '#0ea5e9', color: '#ffffff', border: 'none' }}>
                ▶ End timeout early — back to hitting
              </button>
            ) : (
              <button
                onClick={takeTimeout}
                disabled={timer.timeoutUsed || timerExpired}
                style={{
                  ...bigBtn, flex: '1 1 100%', fontSize: 15, border: 'none', color: '#ffffff',
                  background: timer.timeoutUsed || timerExpired ? '#334155' : '#0284c7',
                  cursor: timer.timeoutUsed || timerExpired ? 'not-allowed' : 'pointer',
                }}
              >
                ⏱ {timer.timeoutUsed ? 'Timeout already used' : `Take ${Math.round(timer.timeoutDurationMs / 1000)}s timeout`}
              </button>
            )}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e293b',
          }}>
            <button
              onClick={() => setTimerVisible(!timer.visible)}
              style={{
                ...smallBtn, fontWeight: 800,
                background: timer.visible ? '#16a34a' : '#1e293b',
                color: timer.visible ? '#ffffff' : '#cbd5e1',
                border: `2px solid ${timer.visible ? '#16a34a' : '#334155'}`,
              }}
            >
              🕑 On screen: {timer.visible ? 'ON' : 'OFF'}
            </button>
            <SecondsInput
              label="Turn"
              value={timer.durationMs}
              onCommit={ms => setDurations(ms, timer.timeoutDurationMs)}
            />
            <SecondsInput
              label="Timeout"
              value={timer.timeoutDurationMs}
              onCommit={ms => setDurations(timer.durationMs, ms)}
            />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
            The clock rides top-left on the overlay under the All-Star lockup, on any view.
            Taking the timeout freezes the turn clock; when the 30s runs out the turn clock
            resumes on its own. Lengths apply to the next fresh clock.
          </div>
        </Section>

        {/* ── Batting order ── */}
        <Section title={`Batting order — ${ROUND_LABEL[activeRound]}`} accent="#c084fc">
          {/* The rule is stated on screen because the seeding is not otherwise
              guessable from a list of names */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 12, color: '#c084fc', fontWeight: 700,
          }}>
            <span style={{ fontSize: 14 }}>{activeRound > 1 ? '⬆' : '⬇'}</span>
            {orderRule}
          </div>

          {!sameSet(order, participants) && participants.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              background: 'rgba(251,191,36,0.10)', border: '1px solid #fbbf24',
              borderRadius: 8, padding: '8px 10px', marginBottom: 10,
              fontSize: 12, color: '#fbbf24', lineHeight: 1.5,
            }}>
              <span style={{ flex: '1 1 200px' }}>
                This list isn’t the {ROUND_LABEL[activeRound]} field ({order.length} listed, {participants.length} hitting).
              </span>
              <button onClick={loadOrder} style={{ ...smallBtn, background: '#fbbf24', color: '#0f172a', border: 'none', fontWeight: 800 }}>
                Fix order
              </button>
            </div>
          )}

          {localOrder.length === 0 ? (
            <div style={{ fontSize: 14, color: '#64748b', padding: '4px 0 8px' }}>
              The order fills itself with every eligible hitter once they load — or press “Load {ROUND_LABEL[activeRound]} order” above.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                Drag rows to reorder · double-click (or ▶) to make someone the current batter
              </div>
              <Reorder.Group
                axis="y"
                values={localOrder}
                onReorder={setLocalOrder}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, listStyle: 'none', padding: 0, margin: '0 0 10px' }}
              >
                {localOrder.map(id => {
                  const c = contestantById.get(id)
                  if (!c) return null
                  const s = roundScore(scores, id, activeRound)
                  const isCurrent = id === currentBatterId
                  const pos = localOrder.indexOf(id)
                  return (
                    <Reorder.Item
                      key={id}
                      value={id}
                      onDragStart={() => { draggingRef.current = true }}
                      onDragEnd={() => { draggingRef.current = false; commitOrder(localOrderRef.current) }}
                      onDoubleClick={() => selectBatter(id)}
                      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        background: isCurrent ? 'rgba(251,191,36,0.12)' : '#1e293b',
                        border: `1px solid ${isCurrent ? '#fbbf24' : '#334155'}`,
                        borderRadius: 8, cursor: 'grab', position: 'relative',
                        touchAction: 'none',
                      }}
                    >
                      <span style={{ color: '#475569', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⠿</span>
                      <span style={{ width: 22, textAlign: 'center', fontFamily: 'var(--font-score)', fontWeight: 800, color: isCurrent ? '#fbbf24' : '#64748b', fontSize: 14, flexShrink: 0 }}>
                        {pos + 1}
                      </span>
                      <span style={{
                        flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 14, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        userSelect: 'none',
                      }}>
                        {c.name}
                        {/* The number this row was sorted on, so the order reads at a glance */}
                        <span style={{ color: '#c084fc', fontWeight: 700, fontSize: 12 }}>
                          {' · '}{seedValue(id, activeRound)} {activeRound > 1 ? `R${activeRound - 1}` : 'szn'}
                        </span>
                        <span style={{ color: '#64748b', fontWeight: 400, fontSize: 12 }}> · {teams[c.teamId]?.shortName ?? ''}</span>
                        {isCurrent && <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700, marginLeft: 6 }}>● NOW</span>}
                      </span>
                      <ScoreInput value={s} onCommit={n => setScore(id, activeRound, n)} />
                      <button
                        onClick={() => selectBatter(id)}
                        title="Make current batter"
                        style={{
                          ...smallBtn, padding: '4px 10px', flexShrink: 0,
                          background: isCurrent ? '#fbbf24' : '#0f172a',
                          color: isCurrent ? '#0f172a' : '#94a3b8',
                          border: `1px solid ${isCurrent ? '#fbbf24' : '#334155'}`,
                        }}
                      >
                        ▶
                      </button>
                      <button onClick={() => setFeatured(id)} title="Show on player card" style={{ ...iconBtn, color: featuredPlayerId === id ? '#fbbf24' : '#64748b' }}>👁</button>
                      <button onClick={() => removeFromOrder(id)} style={{ ...iconBtn, color: '#f87171' }}>✕</button>
                    </Reorder.Item>
                  )
                })}
              </Reorder.Group>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={addPick}
              onChange={e => setAddPick(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: 13, fontFamily: 'var(--font-ui)' }}
            >
              <option value="">Add player to order…</option>
              {notInOrder.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.seasonHr} HR)</option>
              ))}
            </select>
            <button
              onClick={() => { addToOrder(addPick); setAddPick('') }}
              disabled={!addPick}
              style={{ ...smallBtn, background: addPick ? '#2563eb' : '#334155', color: '#ffffff', border: 'none' }}
            >
              Add
            </button>
          </div>
          {contestants.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#fbbf24' }}>
              No eligible players found — players need ≥1 season HR and must be marked IN on the /derby admin grid.
            </div>
          )}
        </Section>

        {/* ── All scores ── */}
        <Section
          title={`All scores (${contestants.length} eligible)`}
          accent="#f87171"
          collapsible
          open={scoresOpen}
          onToggle={() => setScoresOpen(o => !o)}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #334155' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Player</th>
                  <th style={thStyle}>Season</th>
                  <th style={thStyle}>R1</th>
                  <th style={thStyle}>R2</th>
                  <th style={thStyle}>Final</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {contestants.map(c => (
                  <ScoreRow
                    key={c.id}
                    contestant={c}
                    scores={scores[c.id] ?? {}}
                    total={derbyTotal(scores, c.id)}
                    onCommit={(round, n) => setScore(c.id, round, n)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            Blank = hasn't hit that round. The winner's Total is the number the 50/50 pays out on.
          </div>
        </Section>

        {/* ── Reset ── */}
        <ResetSection onReset={resetDerbyScores} scoreCount={recordedScoreCount} />
      </div>
    </div>
  )
}

// ── Wipe a test run ──────────────────────────────────────────────────────────
// Deliberately NOT the same thing as /derby's "Archive & reset":
//   here   — throw away practice home runs, keep the real money. No archive.
//   /derby — end of season: the bets and scores were real, so they get frozen
//            into derby/archive/{year} before anything is cleared.
// The 50/50 entries are real money people have already sent over Venmo. Nothing
// in this file may ever delete them.

function ResetSection({ onReset, scoreCount }: { onReset: () => void; scoreCount: number }) {
  const { entries } = useDerbyBets()
  const [open, setOpen] = useState(false)
  const entryCount = Object.keys(entries).length

  return (
    <Section title="Reset" accent="#f87171" collapsible open={open} onToggle={() => setOpen(o => !o)}>
      <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginBottom: 12 }}>
        <div style={{ color: '#f87171', fontWeight: 700 }}>
          Deletes: all {scoreCount} recorded home run{scoreCount === 1 ? '' : 's'}, the confirmed
          advancers, the batting order and the declared champion.
        </div>
        <div style={{ color: '#4ade80', fontWeight: 700 }}>
          Keeps: all {entryCount} 50/50 {entryCount === 1 ? 'bet' : 'bets'} — real money, never touched here.
        </div>
        <div style={{ color: '#64748b' }}>
          For a practice run. Nothing is archived — at the end of a real season use
          “Archive this derby &amp; reset” on <code style={{ color: '#94a3b8' }}>/derby</code>, which
          freezes the bets and scores together first.
        </div>
      </div>
      <button
        onClick={onReset}
        style={{
          ...smallBtn, width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 800,
          background: '#b91c1c', color: '#ffffff', border: 'none',
        }}
      >
        ↺ Reset derby scores &amp; champion
      </button>
    </Section>
  )
}

// ── Champion: settle the derby and the 50/50 in one action ───────────────────
// Writing `derby/result` is what the public /derby page reads, so declaring
// here posts the result there too — one entry point, no chance of the broadcast
// and the website naming different winners.

function ChampionSection({ eligibleIds, scores, locks, activeRound, contestantById, teams, onShow, onCleared }: {
  eligibleIds: string[]
  scores: DerbyScoresMap
  locks: DerbyAdvancerLocks
  activeRound: DerbyRoundNum
  contestantById: Map<string, DerbyContestant>
  teams: Record<string, { shortName?: string }>
  onShow: () => void
  onCleared: () => void
}) {
  const { entries, result } = useDerbyBets()
  const [open, setOpen] = useState(activeRound === 3)

  const finalists = useMemo(
    () => participantsForRound(eligibleIds, scores, 3, locks),
    [eligibleIds, scores, locks],
  )
  // Champion = the final round's leader; ties are the producer's call
  const ranked = useMemo(
    () => leaderboardForRound(eligibleIds, scores, 3, locks),
    [eligibleIds, scores, locks],
  )
  const leader = ranked.find(r => r.score !== undefined)
  const yetToHit = finalists.filter(id => roundScore(scores, id, 3) === undefined)

  // Draft = whatever is posted, else the live leader
  const [pick, setPick] = useState<string | null>(null)
  const [totalDraft, setTotalDraft] = useState<string | null>(null)
  const winnerId = pick ?? result?.winnerPlayerId ?? leader?.playerId ?? ''
  const suggestedTotal = winnerId ? derbyTotal(scores, winnerId) : 0
  const totalHr = totalDraft !== null
    ? parseInt(totalDraft, 10)
    : result?.winnerPlayerId === winnerId && result ? result.totalHr : suggestedTotal
  const validTotal = !isNaN(totalHr) && totalHr >= 0

  // Every entry counts on air: the entry IS the Venmo payment, so there is
  // nothing unpaid to filter. The /derby page still gates on the `paid` flag,
  // so an entry left unticked there is the one way the two can disagree —
  // hence the warning below rather than a silent divergence.
  const entryList = useMemo(
    () => Object.entries(entries).map(([id, e]) => ({ id, name: e.name, playerId: e.playerId, totalHr: e.totalHr })),
    [entries],
  )
  const unpaid = useMemo(() => Object.values(entries).filter(e => !e.paid), [entries])
  const outcome = useMemo(
    () => (winnerId && validTotal ? derbyBetWinners(entryList, winnerId, totalHr) : null),
    [entryList, winnerId, totalHr, validTotal],
  )
  const money = derbyPayout(entryList.length, outcome?.winners.length ?? 0)

  const posted = result?.finalized && result.winnerPlayerId === winnerId && result.totalHr === totalHr

  const declare = () => {
    if (!winnerId || !validTotal) return
    const name = contestantById.get(winnerId)?.name ?? winnerId
    if (!window.confirm(`Declare ${name} the derby champion with ${totalHr} home runs?\n\nThis posts the result to the public /derby page as well.`)) return
    set(ref(db, 'derby/result'), { winnerPlayerId: winnerId, totalHr, finalized: true })
      .then(() => { setPick(null); setTotalDraft(null); onShow() })
  }

  // Also drops the overlay off the champion graphic — otherwise it would sit
  // on a winner that no longer exists
  const clearResult = () => {
    if (!window.confirm('Reset the champion?\n\nThis clears the posted result here, on the overlay, and on the public /derby page. Derby scores are left alone.')) return
    remove(ref(db, 'derby/result')).then(() => { setPick(null); setTotalDraft(null); onCleared() })
  }

  const postedName = result?.winnerPlayerId
    ? contestantById.get(result.winnerPlayerId)?.name ?? result.winnerPlayerId
    : null

  return (
    <Section
      title={result?.finalized ? 'Champion — result posted' : 'Champion'}
      accent="#fbbf24"
      collapsible
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      {/* Always reachable, whatever round is selected — this is the reset */}
      {result?.finalized && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'rgba(251,191,36,0.10)', border: '1px solid #fbbf24',
          borderRadius: 10, padding: '10px 12px', marginBottom: 12,
        }}>
          <span style={{ flex: '1 1 200px', fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>
            👑 <strong style={{ color: '#fbbf24' }}>{postedName}</strong> is posted as champion
            with <strong style={{ color: '#fbbf24' }}>{result.totalHr}</strong> HR — live on the overlay and on /derby.
          </span>
          <button onClick={onShow} style={{ ...smallBtn, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155' }}>
            Show
          </button>
          <button onClick={clearResult} style={{ ...smallBtn, background: '#b91c1c', color: '#ffffff', border: 'none', fontWeight: 800 }}>
            ↺ Reset champion
          </button>
        </div>
      )}

      {finalists.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Nobody has reached the final round yet.
        </div>
      ) : (
        <>
          {yetToHit.length > 0 && (
            <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: 10, lineHeight: 1.6 }}>
              ⚠ {yetToHit.length} finalist{yetToHit.length === 1 ? '' : 's'} still to hit —{' '}
              {yetToHit.map(id => contestantById.get(id)?.name ?? '?').join(', ')}
            </div>
          )}

          {/* Who won */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <select
              value={winnerId}
              onChange={e => { setPick(e.target.value); setTotalDraft(null) }}
              style={{ flex: '2 1 220px', padding: '8px 10px', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: 13, fontFamily: 'var(--font-ui)' }}
            >
              <option value="">Pick the champion…</option>
              {finalists.map(id => (
                <option key={id} value={id}>
                  {contestantById.get(id)?.name ?? id}
                  {' — '}{roundScore(scores, id, 3) ?? '–'} final, {derbyTotal(scores, id)} total
                  {teams[contestantById.get(id)?.teamId ?? '']?.shortName ? ` (${teams[contestantById.get(id)!.teamId].shortName})` : ''}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 150px' }}>
              <span style={smallLabel}>Total HR</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={totalDraft ?? String(isNaN(totalHr) ? '' : totalHr)}
                onChange={e => setTotalDraft(e.target.value)}
                style={{ width: 74, padding: '7px 8px', textAlign: 'center', borderRadius: 8, background: '#0f172a', color: '#fbbf24', border: '1px solid #334155', fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 800 }}
              />
              {totalDraft !== null && totalHr !== suggestedTotal && (
                <button
                  onClick={() => setTotalDraft(null)}
                  title={`Back to the scored total (${suggestedTotal})`}
                  style={{ ...iconBtn, color: '#94a3b8', fontSize: 12 }}
                >
                  ↺ {suggestedTotal}
                </button>
              )}
            </div>
          </div>

          {/* What the 50/50 pays — shown BEFORE it goes on air */}
          <div style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
            padding: '10px 12px', marginBottom: 10, fontSize: 13, lineHeight: 1.7, color: '#94a3b8',
          }}>
            <div style={{ ...smallLabel, marginBottom: 4 }}>50/50 · {entryList.length} entries · ${money.pot} pot</div>
            {!outcome ? (
              <span>Pick a champion to settle the bet.</span>
            ) : outcome.winners.length === 0 ? (
              <span style={{ color: '#4ade80' }}>
                Nobody backed {contestantById.get(winnerId)?.name ?? 'them'} — the full ${money.pot} goes to charity.
              </span>
            ) : (
              <>
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                  {outcome.winners.map(w => `${w.name} (${w.totalHr})`).join(' · ')}
                </span>
                <span>
                  {' — '}{outcome.winners.length > 1
                    ? `${outcome.winners.length}-way tie at ${outcome.delta} off, $${money.each} each`
                    : outcome.exact ? `exact call, $${money.each}` : `${outcome.delta} off, $${money.each}`}
                  {' · '}${money.toCharity} to charity
                </span>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {outcome.contenders} of {entryList.length} entries backed the champion
                </div>
                {unpaid.length > 0 && (
                  <div style={{ fontSize: 11, color: '#fbbf24' }}>
                    ⚠ {unpaid.length} entr{unpaid.length === 1 ? 'y is' : 'ies are'} not ticked paid
                    ({unpaid.map(e => e.name).join(', ')}) — counted here, but /derby will exclude
                    {unpaid.length === 1 ? ' it' : ' them'}. Tick them on /derby to keep the two in step.
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={declare}
              disabled={!winnerId || !validTotal}
              style={{
                ...smallBtn, flex: '2 1 200px', fontWeight: 800, fontSize: 14,
                background: !winnerId || !validTotal ? '#334155' : '#fbbf24',
                color: !winnerId || !validTotal ? '#64748b' : '#0f172a', border: 'none',
                cursor: !winnerId || !validTotal ? 'not-allowed' : 'pointer',
              }}
            >
              👑 {posted ? 'Show champion graphic' : 'Declare champion & show'}
            </button>
            {/* Reset lives in the banner above, so it stays reachable even
                when this half of the section is irrelevant */}
          </div>

          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
            {posted
              ? '✓ Posted — the public /derby page is showing this result.'
              : 'Declaring posts the result to the public /derby page as well, then cuts the overlay to the champion graphic.'}
          </div>
        </>
      )}
    </Section>
  )
}

// ── Advancement: confirm who moves on out of a round ─────────────────────────
// The score cut is only a proposal. A tie for the last seat is settled by a
// swing-off that happens on the field, so the producer ticks the real field
// here and locks it — that written list then governs the next round's
// participants, the leaderboard's cut line, and the batting-order seeding.

const CUT_ROUNDS: DerbyRoundNum[] = [1, 2]

const CUT_TITLE: Record<number, string> = {
  1: 'Round 1 → Round 2',
  2: 'Round 2 → Final',
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

function AdvancementSection({ eligibleIds, scores, locks, activeRound, contestantById }: {
  eligibleIds: string[]
  scores: DerbyScoresMap
  locks: DerbyAdvancerLocks
  activeRound: DerbyRoundNum
  contestantById: Map<string, DerbyContestant>
}) {
  // Follows the live round — the final has no cut of its own, so it shows the
  // one that produced it (still editable after the fact)
  const [cutRound, setCutRound] = useState<DerbyRoundNum>(Math.min(activeRound, 2) as DerbyRoundNum)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [open, setOpen] = useState(true)

  // Follow the live round without an effect: adjusting state during render is
  // the supported way to react to a changed input, and it drops any half-made
  // selection at the same time
  const [followedRound, setFollowedRound] = useState(activeRound)
  if (followedRound !== activeRound) {
    setFollowedRound(activeRound)
    setCutRound(Math.min(activeRound, 2) as DerbyRoundNum)
    setDraft(null)
  }

  const pickCutRound = (r: DerbyRoundNum) => { setCutRound(r); setDraft(null) }

  const key = ROUND_KEY[cutRound] as 'r1' | 'r2'
  const locked = isRoundLocked(cutRound, locks)

  const participants = useMemo(
    () => participantsForRound(eligibleIds, scores, cutRound, locks),
    [eligibleIds, scores, cutRound, locks],
  )
  const info = useMemo(() => cutInfo(participants, scores, cutRound), [participants, scores, cutRound])
  const committed = useMemo(
    () => effectiveAdvancers(participants, scores, cutRound, locks),
    [participants, scores, cutRound, locks],
  )

  const selection = draft ?? committed
  const dirty = draft !== null && !sameSet(draft, committed)
  const slots = info.slots ?? 0
  const tiedSet = new Set(info.tied)

  const rows = useMemo(() => {
    return [...participants].sort((a, b) => {
      const as = roundScore(scores, a, cutRound)
      const bs = roundScore(scores, b, cutRound)
      if (as === undefined && bs === undefined) return 0
      if (as === undefined) return 1
      if (bs === undefined) return -1
      return bs - as
    })
  }, [participants, scores, cutRound])

  const toggle = (id: string) =>
    setDraft(sel => {
      const cur = sel ?? committed
      return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    })

  const confirm = () => set(bcastRef(`advancers/${key}`), selection).then(() => setDraft(null))
  const unlock = () => remove(bcastRef(`advancers/${key}`)).then(() => setDraft(null))
  const useLiveCut = () => setDraft(info.provisional)

  const name = (id: string) => contestantById.get(id)?.name ?? '?'

  return (
    <Section
      title="Advancement"
      accent="#4ade80"
      collapsible
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {CUT_ROUNDS.map(r => (
          <Chip key={r} active={cutRound === r} onClick={() => pickCutRound(r)} big>
            {CUT_TITLE[r]}
          </Chip>
        ))}
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
          textTransform: 'uppercase', padding: '5px 12px', borderRadius: 20,
          background: locked ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.12)',
          color: locked ? '#4ade80' : '#94a3b8',
          border: `1px solid ${locked ? '#4ade80' : '#334155'}`,
        }}>
          {locked ? '✓ Field set' : 'Live cut'}
        </span>
      </div>

      {/* ── Status ── */}
      <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginBottom: 10 }}>
        <div>
          <strong style={{ color: '#e2e8f0' }}>{slots} spots</strong> · {participants.length} hitters
          {' · '}
          <span style={{ color: selection.length === slots ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>
            {selection.length} selected
          </span>
        </div>
        {info.unscored.length > 0 && (
          <div style={{ color: '#fbbf24' }}>
            ⚠ {info.unscored.length} {info.unscored.length === 1 ? 'hitter hasn’t' : 'hitters haven’t'} gone yet
            {' — '}{info.unscored.map(name).join(', ')}
          </div>
        )}
        {info.contested && !locked && (
          <div style={{ color: '#f59e0b' }}>
            ⚡ Swing-off: {info.tied.length} tied at {roundScore(scores, info.tied[0], cutRound)} HR for the last{' '}
            {info.spotsLeft} {info.spotsLeft === 1 ? 'spot' : 'spots'} — {info.tied.map(name).join(', ')}.
            Hit it off, then tick the winner{info.spotsLeft === 1 ? '' : 's'} below and confirm.
          </div>
        )}
      </div>

      {/* ── Pick the field ── */}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', padding: '4px 0 8px' }}>
          Nobody in this round yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {rows.map(id => {
            const picked = selection.includes(id)
            const s = roundScore(scores, id, cutRound)
            const isTied = tiedSet.has(id) && info.contested && !locked
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: picked ? 'rgba(74,222,128,0.13)' : '#1e293b',
                  border: `1px solid ${picked ? '#4ade80' : isTied ? '#f59e0b' : '#334155'}`,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: picked ? '#4ade80' : 'transparent',
                  border: `2px solid ${picked ? '#4ade80' : '#475569'}`,
                  color: '#0f172a', fontSize: 13, fontWeight: 900, lineHeight: 1,
                }}>
                  {picked ? '✓' : ''}
                </span>
                <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {name(id)}
                  {isTied && <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 800, marginLeft: 8, letterSpacing: '0.08em' }}>SWING-OFF</span>}
                </span>
                <span style={{
                  fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 900, flexShrink: 0,
                  color: s === undefined ? '#475569' : '#fbbf24',
                }}>
                  {s ?? '–'}
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginLeft: 3 }}>HR</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Commit ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={confirm}
          disabled={selection.length === 0 || (locked && !dirty)}
          style={{
            ...smallBtn, flex: '2 1 180px', fontWeight: 800,
            background: selection.length === 0 || (locked && !dirty) ? '#334155' : '#16a34a',
            color: '#ffffff', border: 'none',
            cursor: selection.length === 0 || (locked && !dirty) ? 'not-allowed' : 'pointer',
          }}
        >
          {locked ? (dirty ? `Update field (${selection.length})` : 'Field confirmed') : `✓ Confirm these ${selection.length}`}
        </button>
        <button onClick={useLiveCut} style={{ ...smallBtn, flex: '1 1 110px', background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155' }}>
          Reset to score cut
        </button>
        {locked && (
          <button onClick={unlock} style={{ ...smallBtn, flex: '1 1 90px', background: '#1e293b', color: '#f87171', border: '1px solid #7f1d1d' }}>
            Unlock
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
        Confirming sets the {cutRound === 1 ? 'Round 2' : 'Final'} field — the overlay draws its cut line here and the
        next round's batting order seeds from it. Editable at any time; switch the round above and press
        “Load order” after you confirm.
      </div>
    </Section>
  )
}

// ── All-scores table row ─────────────────────────────────────────────────────

function ScoreRow({ contestant, scores, total, onCommit }: {
  contestant: DerbyContestant
  scores: { r1?: number; r2?: number; r3?: number }
  total: number
  onCommit: (round: DerbyRoundNum, n: number | null) => void
}) {
  return (
    <tr style={{ borderBottom: '1px solid #1e293b' }}>
      <td style={{ padding: '7px 6px', fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{contestant.name}</td>
      <td style={{ padding: '7px 6px', textAlign: 'center', color: '#64748b' }}>{contestant.seasonHr}</td>
      {ROUNDS.map(r => (
        <td key={r} style={{ padding: '7px 6px', textAlign: 'center' }}>
          <ScoreInput value={scores[ROUND_KEY[r]]} onCommit={n => onCommit(r, n)} />
        </td>
      ))}
      <td style={{ padding: '7px 6px', textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 800, color: '#fbbf24' }}>
        {total}
      </td>
    </tr>
  )
}

// ── Blur-commit score input (blank = not hit yet) ────────────────────────────

function ScoreInput({ value, onCommit }: { value: number | undefined; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setDraft(value === undefined ? '' : String(value)) }, [value])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== undefined) onCommit(null)
      return
    }
    const n = parseInt(trimmed, 10)
    if (!isNaN(n) && n >= 0) {
      if (n !== value) onCommit(n)
    } else {
      setDraft(value === undefined ? '' : String(value))
    }
  }

  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      placeholder="–"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 52, padding: '5px 4px', textAlign: 'center', borderRadius: 6,
        background: '#0f172a', color: value === undefined ? '#64748b' : '#fbbf24',
        border: '1px solid #334155', fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700,
      }}
    />
  )
}

// ── Clock length input (seconds in, ms out) ──────────────────────────────────

function SecondsInput({ label, value, onCommit }: {
  label: string
  value: number
  onCommit: (ms: number) => void
}) {
  const [draft, setDraft] = useState(String(Math.round(value / 1000)))
  useEffect(() => { setDraft(String(Math.round(value / 1000))) }, [value])

  const commit = () => {
    const n = parseInt(draft.trim(), 10)
    if (!isNaN(n) && n > 0 && n * 1000 !== value) onCommit(n * 1000)
    else setDraft(String(Math.round(value / 1000)))
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
      {label}
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{
          width: 58, padding: '5px 6px', textAlign: 'center', borderRadius: 6,
          background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155',
          fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700,
        }}
      />
      s
    </label>
  )
}

// ── Password gate ────────────────────────────────────────────────────────────

function GateScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  const check = () => {
    if (pw === ADMIN_PASSWORD) onUnlock()
    else { setError(true); setPw('') }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-ui)' }}>
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, width: '100%', maxWidth: 320, border: '1px solid #334155' }}>
        <div style={{ fontFamily: 'var(--font-score)', fontWeight: 900, fontSize: 18, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          🎥 Derby Control
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>Producer access</div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={e => { setPw(e.target.value); setError(false) }}
          onKeyDown={e => { if (e.key === 'Enter') check() }}
          placeholder="Password"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', fontSize: 14, marginBottom: 8, fontFamily: 'var(--font-ui)' }}
        />
        {error && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>Wrong password.</div>}
        <button onClick={check} style={{ ...smallBtn, width: '100%', padding: '10px 0', background: '#fbbf24', color: '#0f172a', border: 'none', fontSize: 14 }}>
          Enter
        </button>
      </div>
    </div>
  )
}

// ── Layout pieces ────────────────────────────────────────────────────────────

function Section({ title, accent, children, collapsible, open, onToggle }: {
  title: string
  accent: string
  children: React.ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 4, height: 16, background: accent, borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </span>
      {collapsible && <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 13 }}>{open ? '▾' : '▸'}</span>}
    </div>
  )
  return (
    <div style={{ background: '#16213a', borderRadius: 12, border: '1px solid #1e293b', padding: '14px 16px', marginBottom: 12 }}>
      {collapsible
        ? <button onClick={onToggle} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>{header}</button>
        : header}
      {(!collapsible || open) && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

function Chip({ active, onClick, children, big }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  big?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: big ? '8px 18px' : '5px 14px', borderRadius: 20,
        fontSize: big ? 13 : 12, fontWeight: 800,
        fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.05em',
        background: active ? '#fbbf24' : '#1e293b', color: active ? '#0f172a' : '#94a3b8',
        border: `1px solid ${active ? '#fbbf24' : '#334155'}`, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const bigBtn: React.CSSProperties = {
  padding: '10px 8px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.04em',
  cursor: 'pointer', lineHeight: 1.3,
}

const smallBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  fontFamily: 'var(--font-ui)', cursor: 'pointer',
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
  padding: '2px 4px', flexShrink: 0, lineHeight: 1,
}

const smallLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em',
}

const thStyle: React.CSSProperties = {
  padding: '6px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b',
}
