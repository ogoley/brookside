// Pure home-run-derby bracket logic — no Firebase, no React.
// Round 1: every eligible player hits. Top 8 advance to round 2, top 3 to the
// final round. Ties for the last advancing spot ALL advance.

import type {
  DerbyRoundNum, DerbyRoundKey, DerbyRoundScores, DerbyTimerState, DerbyAdvancerLocks,
} from '../types'

export type DerbyScoresMap = Record<string, DerbyRoundScores>

export const ROUND_KEY: Record<DerbyRoundNum, DerbyRoundKey> = { 1: 'r1', 2: 'r2', 3: 'r3' }

// How many advance OUT of each round (null = final round, nobody advances)
export const ADVANCE_COUNT: Record<DerbyRoundNum, number | null> = { 1: 8, 2: 3, 3: null }

export const ROUND_LABEL: Record<DerbyRoundNum, string> = {
  1: 'Round 1',
  2: 'Round 2',
  3: 'Final Round',
}

// ── Turn clock ───────────────────────────────────────────────────────────────
// Each hitter gets DERBY_TURN_MS of swings plus one DERBY_TIMEOUT_MS pause they
// may call at any point inside it.
export const DERBY_TURN_MS = 90_000
export const DERBY_TIMEOUT_MS = 30_000

// When the clock hits 0:00 the hitter gets one more pitch — the money ball —
// and a homer off it counts triple.
export const DERBY_MONEY_BALL_HR = 3

/** Milliseconds left on whichever clock (turn or timeout) is currently live. */
export function derbyTimerRemainingMs(timer: DerbyTimerState, now: number): number {
  const base = timer.phase === 'timeout' ? timer.timeoutRemainingMs : timer.remainingMs
  if (!timer.running || timer.startedAt == null) return Math.max(0, base)
  // Clamped both ways: a `now` that hasn't caught up to `startedAt` yet (first
  // render after a start) must read as a full clock, never more
  return Math.max(0, Math.min(base, base - (now - timer.startedAt)))
}

/**
 * The clock as it actually stands right now: a timeout that has run out rolls
 * over into the resumed turn clock. The controller writes that rollover too,
 * but deriving it keeps the read-only overlay correct even if the controller
 * tab is throttled in the background or closed mid-timeout.
 */
export function resolveDerbyTimer(timer: DerbyTimerState, now: number): DerbyTimerState {
  if (timer.phase !== 'timeout' || !timer.running || timer.startedAt == null) return timer
  const endsAt = timer.startedAt + timer.timeoutRemainingMs
  if (now < endsAt) return timer
  // Hitting resumes the instant the timeout expired — not when we noticed
  return { ...timer, phase: 'main', timeoutRemainingMs: 0, running: true, startedAt: endsAt }
}

/** `1:23` normally, tenths (`9.4`) inside the last 10 seconds — broadcast habit. */
export function formatDerbyClock(ms: number): string {
  if (ms < 10_000) return (Math.ceil(ms / 100) / 10).toFixed(1)
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function roundScore(scores: DerbyScoresMap, playerId: string, round: DerbyRoundNum): number | undefined {
  return scores[playerId]?.[ROUND_KEY[round]]
}

/** A player's derby total across all rounds hit so far. */
export function derbyTotal(scores: DerbyScoresMap, playerId: string): number {
  const s = scores[playerId] ?? {}
  return (s.r1 ?? 0) + (s.r2 ?? 0) + (s.r3 ?? 0)
}

/** The state of a round's cut line: who is safe, who is fighting for what's left. */
export interface DerbyCutInfo {
  slots: number | null   // seats out of this round; null = final round
  clinched: string[]     // score strictly better than the cut score — in regardless
  tied: string[]         // sitting exactly on the cut score
  spotsLeft: number      // seats remaining for the tied group
  contested: boolean     // more tied players than seats left → swing-off needed
  provisional: string[]  // clinched + tied — the live cut, ties included
  unscored: string[]     // participants who haven't hit yet
}

/**
 * The live, score-derived cut for `round`. Only players with a recorded score
 * can advance, so mid-round this is a running preview, not a verdict.
 */
export function cutInfo(participants: string[], scores: DerbyScoresMap, round: DerbyRoundNum): DerbyCutInfo {
  const slots = ADVANCE_COUNT[round]
  const unscored = participants.filter(id => roundScore(scores, id, round) === undefined)
  const empty: DerbyCutInfo = {
    slots, clinched: [], tied: [], spotsLeft: 0, contested: false, provisional: [], unscored,
  }
  if (slots === null) return empty

  const scored = participants
    .map(id => ({ id, score: roundScore(scores, id, round) }))
    .filter((x): x is { id: string; score: number } => x.score !== undefined)
    .sort((a, b) => b.score - a.score)

  // Fewer hitters than seats: everyone who has hit is in, seats to spare
  if (scored.length <= slots) {
    const ids = scored.map(x => x.id)
    return { ...empty, clinched: ids, provisional: ids, spotsLeft: slots - ids.length }
  }

  const cutScore = scored[slots - 1].score
  const clinched = scored.filter(x => x.score > cutScore).map(x => x.id)
  const tied = scored.filter(x => x.score === cutScore).map(x => x.id)
  const spotsLeft = slots - clinched.length
  return {
    slots, clinched, tied, spotsLeft,
    contested: tied.length > spotsLeft,
    provisional: [...clinched, ...tied],
    unscored,
  }
}

/**
 * Players advancing OUT of `round` by score alone, ties for the last spot
 * included. See `effectiveAdvancers` for the number that actually governs.
 */
export function advancersFromRound(participants: string[], scores: DerbyScoresMap, round: DerbyRoundNum): string[] {
  return cutInfo(participants, scores, round).provisional
}

/** Has the producer confirmed who moves on out of this round? */
export function isRoundLocked(round: DerbyRoundNum, locks?: DerbyAdvancerLocks): boolean {
  return ADVANCE_COUNT[round] !== null && locks?.[ROUND_KEY[round] as 'r1' | 'r2'] !== undefined
}

/**
 * Who actually moves on: the producer's confirmed list when the round has been
 * locked, otherwise the live score cut. A tie for the last seat is settled by
 * an off-system swing-off, so the locked list is the authority — it is filtered
 * to the round's participants only to shed ids of players since toggled OUT.
 */
export function effectiveAdvancers(
  participants: string[], scores: DerbyScoresMap, round: DerbyRoundNum, locks?: DerbyAdvancerLocks,
): string[] {
  const locked = ADVANCE_COUNT[round] === null ? undefined : locks?.[ROUND_KEY[round] as 'r1' | 'r2']
  if (locked) return locked.filter(id => participants.includes(id))
  return advancersFromRound(participants, scores, round)
}

/** Who hits in `round`. Round 1 = all eligible; later rounds = advancers of the previous. */
export function participantsForRound(
  eligibleIds: string[], scores: DerbyScoresMap, round: DerbyRoundNum, locks?: DerbyAdvancerLocks,
): string[] {
  if (round === 1) return eligibleIds
  const prevRound = (round - 1) as DerbyRoundNum
  return effectiveAdvancers(participantsForRound(eligibleIds, scores, prevRound, locks), scores, prevRound, locks)
}

// ── Batting order seeding ────────────────────────────────────────────────────

/** The number a round's batting order is seeded on: last round's HR, or season HR in round 1. */
export function derbySeedValue(
  scores: DerbyScoresMap, playerId: string, round: DerbyRoundNum, seasonHr: number,
): number {
  return round > 1 ? roundScore(scores, playerId, (round - 1) as DerbyRoundNum) ?? 0 : seasonHr
}

/**
 * The order a round hits in.
 *
 * **Rounds 2 and 3 go fewest home runs first** — the leaders bat last so the
 * round builds to them, which is how the derby is actually run. Round 1 has no
 * derby score yet, so it seeds off season HR the other way and the big bats
 * open the show. Ties fall back to season HR (same direction), then name.
 */
export function seedOrderForRound(
  field: string[],
  scores: DerbyScoresMap,
  round: DerbyRoundNum,
  info: (id: string) => { seasonHr: number; name: string },
): string[] {
  const ascending = round > 1
  return [...field].sort((a, b) => {
    const ai = info(a)
    const bi = info(b)
    const av = derbySeedValue(scores, a, round, ai.seasonHr)
    const bv = derbySeedValue(scores, b, round, bi.seasonHr)
    if (av !== bv) return ascending ? av - bv : bv - av
    if (ai.seasonHr !== bi.seasonHr) return ascending ? ai.seasonHr - bi.seasonHr : bi.seasonHr - ai.seasonHr
    return ai.name.localeCompare(bi.name)
  })
}

export interface DerbyLeaderboardRow {
  playerId: string
  score?: number     // this round's HR; undefined = yet to hit
  total: number      // derby total across all rounds
  rank?: number      // competition ranking (ties share); undefined until scored
  advancing: boolean
  tied: boolean      // on a contested cut score — headed for a swing-off
}

/**
 * Ranked leaderboard for a round.
 *
 * Rank is competition ranking by this round's score (ties share a rank), but
 * DISPLAY order puts everyone advancing first, so the advancing set is always a
 * prefix and the overlay can draw one cut line after it. The two orders come
 * apart only after a swing-off is locked in: the tied player who lost drops
 * below the line while still carrying the tied rank they earned.
 */
export function leaderboardForRound(
  eligibleIds: string[], scores: DerbyScoresMap, round: DerbyRoundNum, locks?: DerbyAdvancerLocks,
): DerbyLeaderboardRow[] {
  const participants = participantsForRound(eligibleIds, scores, round, locks)
  const info = cutInfo(participants, scores, round)
  const advancing = new Set(effectiveAdvancers(participants, scores, round, locks))
  // A tie only matters until the producer settles it
  const tied = new Set(!isRoundLocked(round, locks) && info.contested ? info.tied : [])

  const rows: DerbyLeaderboardRow[] = participants.map(id => ({
    playerId: id,
    score: roundScore(scores, id, round),
    total: derbyTotal(scores, id),
    advancing: advancing.has(id),
    tied: tied.has(id),
  }))

  // Rank pass — pure score order, before advancement reshuffles the display
  const byScore = [...rows].sort((a, b) => {
    if (a.score === undefined && b.score === undefined) return 0
    if (a.score === undefined) return 1
    if (b.score === undefined) return -1
    return b.score - a.score || b.total - a.total
  })
  let lastScore: number | undefined
  let lastRank = 0
  byScore.forEach((r, i) => {
    if (r.score === undefined) return
    if (r.score === lastScore) {
      r.rank = lastRank
    } else {
      r.rank = i + 1
      lastRank = i + 1
      lastScore = r.score
    }
  })

  // Display pass — advancing prefix, then by score, yet-to-hit last
  return byScore.sort((a, b) => {
    if (a.advancing !== b.advancing) return a.advancing ? -1 : 1
    if (a.score === undefined && b.score === undefined) return 0
    if (a.score === undefined) return 1
    if (b.score === undefined) return -1
    return b.score - a.score || b.total - a.total
  })
}
