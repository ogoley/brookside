import { describe, it, expect } from 'vitest'
import {
  cutInfo, advancersFromRound, effectiveAdvancers, participantsForRound,
  leaderboardForRound, isRoundLocked, seedOrderForRound,
  derbyBetWinners, derbyPayout, type DerbyScoresMap,
} from '../logic'
import type { DerbyAdvancerLocks } from '../../types'

// 10 hitters, round 1. Scores chosen so 8th and 9th tie at 4 → 9 players sit in
// 8 seats, which is exactly the swing-off case.
const R1: DerbyScoresMap = {
  a: { r1: 12 }, b: { r1: 11 }, c: { r1: 10 }, d: { r1: 9 }, e: { r1: 8 },
  f: { r1: 7 }, g: { r1: 6 }, h: { r1: 4 }, i: { r1: 4 }, j: { r1: 2 },
}
const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']

describe('cutInfo', () => {
  it('splits a contested cut into clinched and tied', () => {
    const info = cutInfo(TEN, R1, 1)
    expect(info.slots).toBe(8)
    expect(info.clinched).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(info.tied).toEqual(['h', 'i'])
    expect(info.spotsLeft).toBe(1)
    expect(info.contested).toBe(true)
    // Ties for the last seat all sit above the line until the swing-off settles it
    expect(info.provisional).toHaveLength(9)
  })

  it('is not contested when the tied group exactly fills the seats left', () => {
    // g and h tie at 4 for the last two seats — both fit, nobody swings off
    const scores: DerbyScoresMap = { ...R1, g: { r1: 4 }, i: { r1: 3 } }
    const info = cutInfo(TEN, scores, 1)
    expect(info.tied).toEqual(['g', 'h'])
    expect(info.spotsLeft).toBe(2)
    expect(info.contested).toBe(false)
    expect(info.provisional).toHaveLength(8)
  })

  it('is contested when more players tie than seats remain', () => {
    // three at 4 for two seats
    const scores: DerbyScoresMap = { ...R1, g: { r1: 4 } }
    const info = cutInfo(TEN, scores, 1)
    expect(info.tied).toEqual(['g', 'h', 'i'])
    expect(info.spotsLeft).toBe(2)
    expect(info.contested).toBe(true)
  })

  // The two shapes the left rail exists to handle, stated as the derby crew
  // describes them: normally 8 on the board, more when a tie straddles the cut.
  it('shows 9 alive on a two-way tie for 8th', () => {
    const scores: DerbyScoresMap = {
      a: { r1: 20 }, b: { r1: 18 }, c: { r1: 16 }, d: { r1: 14 },
      e: { r1: 12 }, f: { r1: 10 }, g: { r1: 8 },
      h: { r1: 6 }, i: { r1: 6 },   // tied for the 8th seat
      j: { r1: 4 },
    }
    const info = cutInfo(TEN, scores, 1)
    expect(info.clinched).toHaveLength(7)
    expect(info.tied).toEqual(['h', 'i'])
    expect(info.spotsLeft).toBe(1)
    expect(info.contested).toBe(true)
    expect(info.provisional).toHaveLength(9)
  })

  it('shows 9 alive on a three-way tie for 7th/8th/9th', () => {
    const scores: DerbyScoresMap = {
      a: { r1: 20 }, b: { r1: 18 }, c: { r1: 16 }, d: { r1: 14 }, e: { r1: 12 }, f: { r1: 10 },
      g: { r1: 8 }, h: { r1: 8 }, i: { r1: 8 },   // three sharing seats 7–9
      j: { r1: 4 },
    }
    const info = cutInfo(TEN, scores, 1)
    expect(info.clinched).toHaveLength(6)
    expect(info.tied).toEqual(['g', 'h', 'i'])
    expect(info.spotsLeft).toBe(2)     // 2 of the 3 move on
    expect(info.contested).toBe(true)
    expect(info.provisional).toHaveLength(9)
  })

  it('has no ceiling on how deep a tie makes the field', () => {
    // Five stuck on the same low score for the last seat — the board is 12
    // alive for 8 spots, and none of them can be cut without a swing-off
    const scores: DerbyScoresMap = {
      a: { r1: 20 }, b: { r1: 18 }, c: { r1: 16 }, d: { r1: 14 },
      e: { r1: 12 }, f: { r1: 10 }, g: { r1: 8 },
      h: { r1: 2 }, i: { r1: 2 }, j: { r1: 2 }, k: { r1: 2 }, l: { r1: 2 },
    }
    const twelve = [...TEN, 'k', 'l']
    const info = cutInfo(twelve, scores, 1)
    expect(info.clinched).toHaveLength(7)
    expect(info.tied).toEqual(['h', 'i', 'j', 'k', 'l'])
    expect(info.spotsLeft).toBe(1)
    expect(info.provisional).toHaveLength(12)
    // All five carry the swing-off flag on the board
    expect(leaderboardForRound(twelve, scores, 1).filter(r => r.tied)).toHaveLength(5)
  })

  it('treats unscored players as not yet in the field', () => {
    const partial: DerbyScoresMap = { a: { r1: 5 }, b: { r1: 3 } }
    const info = cutInfo(TEN, partial, 1)
    expect(info.provisional).toEqual(['a', 'b'])
    expect(info.spotsLeft).toBe(6)
    expect(info.unscored).toHaveLength(8)
    expect(info.contested).toBe(false)
  })

  it('has no cut in the final round', () => {
    expect(cutInfo(['a', 'b', 'c'], R1, 3).slots).toBeNull()
    expect(advancersFromRound(['a', 'b', 'c'], R1, 3)).toEqual([])
  })

  it('counts 0 as a real score, not a missing one', () => {
    const scores: DerbyScoresMap = { a: { r1: 0 }, b: { r1: 1 } }
    const info = cutInfo(['a', 'b'], scores, 1)
    expect(info.unscored).toEqual([])
    expect(info.provisional).toEqual(['b', 'a'])
  })
})

describe('effectiveAdvancers', () => {
  it('falls back to the score cut when nothing is locked', () => {
    expect(effectiveAdvancers(TEN, R1, 1)).toEqual(advancersFromRound(TEN, R1, 1))
  })

  it('lets a locked list settle a swing-off — the loser drops out', () => {
    // i won the swing-off over h; the producer confirms the field of 8
    const locks: DerbyAdvancerLocks = { r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'] }
    const adv = effectiveAdvancers(TEN, R1, 1, locks)
    expect(adv).toContain('i')
    expect(adv).not.toContain('h')
    expect(adv).toHaveLength(8)
  })

  it('honours a locked list that overrides the scores entirely', () => {
    const locks: DerbyAdvancerLocks = { r1: ['j'] }
    expect(effectiveAdvancers(TEN, R1, 1, locks)).toEqual(['j'])
  })

  it('drops locked ids that are no longer in the round', () => {
    const locks: DerbyAdvancerLocks = { r1: ['a', 'zzz'] }
    expect(effectiveAdvancers(TEN, R1, 1, locks)).toEqual(['a'])
  })

  it('reports lock state per round', () => {
    const locks: DerbyAdvancerLocks = { r1: ['a'] }
    expect(isRoundLocked(1, locks)).toBe(true)
    expect(isRoundLocked(2, locks)).toBe(false)
    expect(isRoundLocked(3, { r1: ['a'], r2: ['a'] })).toBe(false) // final has no cut
  })
})

describe('participantsForRound', () => {
  it('carries a locked round-1 field into round 2', () => {
    const locks: DerbyAdvancerLocks = { r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'] }
    expect(participantsForRound(TEN, R1, 2, locks)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'])
  })

  it('chains both locks into the final', () => {
    const scores: DerbyScoresMap = {
      ...R1,
      a: { r1: 12, r2: 5 }, b: { r1: 11, r2: 5 }, c: { r1: 10, r2: 5 }, d: { r1: 9, r2: 5 },
    }
    const locks: DerbyAdvancerLocks = {
      r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'],
      r2: ['a', 'b', 'd'], // c lost the four-way swing-off at 5
    }
    expect(participantsForRound(TEN, scores, 3, locks)).toEqual(['a', 'b', 'd'])
  })
})

describe('derbyBetWinners', () => {
  // Dragon Ogoley wins the derby with 29 across all three rounds.
  const bet = (id: string, name: string, playerId: string, totalHr: number) => ({ id, name, playerId, totalHr })
  const DRAGON = 'dragon'
  const OTHER = 'someone_else'

  it('gives it to the single closest bet on the winner', () => {
    const out = derbyBetWinners([
      bet('1', 'Alice', DRAGON, 30),
      bet('2', 'Bob', DRAGON, 24),
    ], DRAGON, 29)
    expect(out.winners.map(w => w.name)).toEqual(['Alice'])
    expect(out.delta).toBe(1)
    expect(out.exact).toBe(false)
  })

  it('splits when two bets are equally close from opposite sides', () => {
    // 28 and 30 are both 1 away from 29 — direction does not matter
    const out = derbyBetWinners([
      bet('1', 'Alice', DRAGON, 30),
      bet('2', 'Bob', DRAGON, 28),
      bet('3', 'Cara', DRAGON, 25),
    ], DRAGON, 29)
    expect(out.winners.map(w => w.name)).toEqual(['Alice', 'Bob'])
    expect(out.delta).toBe(1)
  })

  it('splits between any number of tied bets, same number or not', () => {
    const out = derbyBetWinners([
      bet('1', 'Alice', DRAGON, 30),
      bet('2', 'Bob', DRAGON, 28),
      bet('3', 'Cara', DRAGON, 30),
      bet('4', 'Dan', DRAGON, 40),
    ], DRAGON, 29)
    expect(out.winners.map(w => w.name)).toEqual(['Alice', 'Bob', 'Cara'])
    expect(out.winners).toHaveLength(3)
  })

  it('ignores a closer number bet on the wrong player', () => {
    const out = derbyBetWinners([
      bet('1', 'Alice', OTHER, 29),   // nailed the number, wrong winner
      bet('2', 'Bob', DRAGON, 34),
    ], DRAGON, 29)
    expect(out.winners.map(w => w.name)).toEqual(['Bob'])
    expect(out.contenders).toBe(1)
  })

  it('flags an exact call', () => {
    const out = derbyBetWinners([
      bet('1', 'Alice', DRAGON, 29),
      bet('2', 'Bob', DRAGON, 28),
    ], DRAGON, 29)
    expect(out.winners.map(w => w.name)).toEqual(['Alice'])
    expect(out.exact).toBe(true)
    expect(out.delta).toBe(0)
  })

  it('has no winner when nobody backed the actual winner', () => {
    const out = derbyBetWinners([bet('1', 'Alice', OTHER, 29)], DRAGON, 29)
    expect(out.winners).toEqual([])
    expect(out.delta).toBeNull()
    expect(out.contenders).toBe(0)
  })
})

describe('derbyPayout', () => {
  it('halves the pot and splits the winners’ half evenly', () => {
    expect(derbyPayout(12, 2)).toEqual({ pot: 120, toCharity: 60, toWinners: 60, each: 30 })
  })

  it('gives charity the odd dollar on an odd pot', () => {
    const p = derbyPayout(13, 1)
    expect(p.pot).toBe(130)
    expect(p.toWinners + p.toCharity).toBe(130)
    expect(p.toCharity).toBeGreaterThanOrEqual(p.toWinners)
  })

  it('pays nobody when there are no winning entries', () => {
    expect(derbyPayout(10, 0).each).toBe(0)
  })
})

describe('seedOrderForRound', () => {
  const SEASON: Record<string, number> = { a: 9, b: 7, c: 5, d: 3, e: 1 }
  const info = (id: string) => ({ seasonHr: SEASON[id] ?? 0, name: id })

  it('opens round 1 with the biggest season bats', () => {
    expect(seedOrderForRound(['c', 'a', 'e', 'b', 'd'], {}, 1, info)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('hits round 2 fewest-first so the leaders bat last', () => {
    const scores: DerbyScoresMap = {
      a: { r1: 12 }, b: { r1: 4 }, c: { r1: 9 }, d: { r1: 1 }, e: { r1: 7 },
    }
    expect(seedOrderForRound(['a', 'b', 'c', 'd', 'e'], scores, 2, info)).toEqual(['d', 'b', 'e', 'c', 'a'])
  })

  it('hits the final fewest-first too, off round 2', () => {
    const scores: DerbyScoresMap = {
      a: { r1: 12, r2: 3 }, b: { r1: 4, r2: 8 }, c: { r1: 9, r2: 5 },
    }
    expect(seedOrderForRound(['a', 'b', 'c'], scores, 3, info)).toEqual(['a', 'c', 'b'])
  })

  it('treats a missing previous-round score as 0, so it leads off', () => {
    const scores: DerbyScoresMap = { a: { r1: 6 }, b: {} }
    expect(seedOrderForRound(['a', 'b'], scores, 2, info)).toEqual(['b', 'a'])
  })

  it('breaks a seed tie on season HR in the same direction', () => {
    const scores: DerbyScoresMap = { a: { r1: 5 }, c: { r1: 5 }, e: { r1: 5 } }
    // ascending round 2: fewest season HR first
    expect(seedOrderForRound(['a', 'c', 'e'], scores, 2, info)).toEqual(['e', 'c', 'a'])
    // descending round 1 would be the reverse
    expect(seedOrderForRound(['e', 'c', 'a'], {}, 1, info)).toEqual(['a', 'c', 'e'])
  })
})

describe('leaderboardForRound', () => {
  it('ranks by score but orders advancing players first', () => {
    const locks: DerbyAdvancerLocks = { r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'] }
    const rows = leaderboardForRound(TEN, R1, 1, locks)

    // Advancing set is a contiguous prefix, so one cut line suffices
    const advancingFlags = rows.map(r => r.advancing)
    expect(advancingFlags.slice(0, 8).every(Boolean)).toBe(true)
    expect(advancingFlags.slice(8).some(Boolean)).toBe(false)

    // The swing-off loser sits below the line still carrying his earned rank
    const h = rows.find(r => r.playerId === 'h')!
    const i = rows.find(r => r.playerId === 'i')!
    expect(h.rank).toBe(i.rank)     // both tied at 4 HR
    expect(h.advancing).toBe(false)
    expect(i.advancing).toBe(true)
  })

  it('flags tied players only while the cut is unsettled', () => {
    const unlocked = leaderboardForRound(TEN, R1, 1)
    expect(unlocked.filter(r => r.tied).map(r => r.playerId).sort()).toEqual(['h', 'i'])

    const locked = leaderboardForRound(TEN, R1, 1, { r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'] })
    expect(locked.some(r => r.tied)).toBe(false)
  })

  it('shares a rank across ties and skips the next number', () => {
    const scores: DerbyScoresMap = { a: { r1: 5 }, b: { r1: 5 }, c: { r1: 3 } }
    const rows = leaderboardForRound(['a', 'b', 'c'], scores, 1)
    expect(rows.map(r => r.rank)).toEqual([1, 1, 3])
  })

  it('sinks yet-to-hit players to the bottom with no rank', () => {
    const scores: DerbyScoresMap = { a: { r1: 5 }, c: { r1: 3 } }
    const rows = leaderboardForRound(['a', 'b', 'c'], scores, 1)
    expect(rows.map(r => r.playerId)).toEqual(['a', 'c', 'b'])
    expect(rows[2].rank).toBeUndefined()
    expect(rows[2].advancing).toBe(false)
  })

  it('shows only the finalists in the final round, with no cut', () => {
    const scores: DerbyScoresMap = {
      ...R1,
      a: { r1: 12, r2: 6 }, b: { r1: 11, r2: 5 }, c: { r1: 10, r2: 4 }, d: { r1: 9, r2: 3 },
    }
    const locks: DerbyAdvancerLocks = { r1: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i'] }
    const rows = leaderboardForRound(TEN, scores, 3, locks)
    expect(rows.map(r => r.playerId)).toEqual(['a', 'b', 'c'])
    expect(rows.every(r => !r.advancing)).toBe(true)
  })
})
