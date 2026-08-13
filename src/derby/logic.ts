// Pure home-run-derby bracket logic — no Firebase, no React.
// Round 1: every eligible player hits. Top 8 advance to round 2, top 3 to the
// final round. Ties for the last advancing spot ALL advance.

import type { DerbyRoundNum, DerbyRoundKey, DerbyRoundScores } from '../types'

export type DerbyScoresMap = Record<string, DerbyRoundScores>

export const ROUND_KEY: Record<DerbyRoundNum, DerbyRoundKey> = { 1: 'r1', 2: 'r2', 3: 'r3' }

// How many advance OUT of each round (null = final round, nobody advances)
export const ADVANCE_COUNT: Record<DerbyRoundNum, number | null> = { 1: 8, 2: 3, 3: null }

export const ROUND_LABEL: Record<DerbyRoundNum, string> = {
  1: 'Round 1',
  2: 'Round 2',
  3: 'Final Round',
}

export function roundScore(scores: DerbyScoresMap, playerId: string, round: DerbyRoundNum): number | undefined {
  return scores[playerId]?.[ROUND_KEY[round]]
}

/** A player's derby total across all rounds hit so far. */
export function derbyTotal(scores: DerbyScoresMap, playerId: string): number {
  const s = scores[playerId] ?? {}
  return (s.r1 ?? 0) + (s.r2 ?? 0) + (s.r3 ?? 0)
}

/**
 * Players advancing OUT of `round`, ties for the last spot included.
 * Only players with a recorded score for the round can advance — while the
 * round is still in progress this is a live "cut line", not a final verdict.
 */
export function advancersFromRound(participants: string[], scores: DerbyScoresMap, round: DerbyRoundNum): string[] {
  const n = ADVANCE_COUNT[round]
  if (n === null) return []
  const scored = participants
    .map(id => ({ id, score: roundScore(scores, id, round) }))
    .filter((x): x is { id: string; score: number } => x.score !== undefined)
    .sort((a, b) => b.score - a.score)
  if (scored.length <= n) return scored.map(x => x.id)
  const cutoff = scored[n - 1].score
  return scored.filter(x => x.score >= cutoff).map(x => x.id)
}

/** Who hits in `round`. Round 1 = all eligible; later rounds = advancers of the previous. */
export function participantsForRound(eligibleIds: string[], scores: DerbyScoresMap, round: DerbyRoundNum): string[] {
  if (round === 1) return eligibleIds
  const prevRound = (round - 1) as DerbyRoundNum
  return advancersFromRound(participantsForRound(eligibleIds, scores, prevRound), scores, prevRound)
}

export interface DerbyLeaderboardRow {
  playerId: string
  score?: number     // this round's HR; undefined = yet to hit
  total: number      // derby total across all rounds
  rank?: number      // competition ranking (ties share); undefined until scored
  advancing: boolean
}

/**
 * Ranked leaderboard for a round: scored players first (desc, competition
 * ranking so ties share a rank), yet-to-hit players after in participant order.
 * Because rows are sorted by score, the advancing set is always a prefix.
 */
export function leaderboardForRound(eligibleIds: string[], scores: DerbyScoresMap, round: DerbyRoundNum): DerbyLeaderboardRow[] {
  const participants = participantsForRound(eligibleIds, scores, round)
  const advancing = new Set(advancersFromRound(participants, scores, round))
  const rows: DerbyLeaderboardRow[] = participants.map(id => ({
    playerId: id,
    score: roundScore(scores, id, round),
    total: derbyTotal(scores, id),
    advancing: advancing.has(id),
  }))
  rows.sort((a, b) => {
    if (a.score === undefined && b.score === undefined) return 0
    if (a.score === undefined) return 1
    if (b.score === undefined) return -1
    return b.score - a.score || b.total - a.total
  })
  let lastScore: number | undefined
  let lastRank = 0
  rows.forEach((r, i) => {
    if (r.score === undefined) return
    if (r.score === lastScore) {
      r.rank = lastRank
    } else {
      r.rank = i + 1
      lastRank = i + 1
      lastScore = r.score
    }
  })
  return rows
}
