import { describe, it, expect } from 'vitest'
import {
  buildDerbyOddsModel, runDerbyOdds, derbyOddsWindow, derbyOddsShowNowAt, derbyOddsSignature,
  PRIOR_ROUND_MEAN, DEFAULT_ODDS_TRIALS,
  type DerbyOddsInput,
} from '../odds'
import { DEFAULT_DERBY_ODDS } from '../../hooks/useDerbyBroadcast'
import type { DerbyScoresMap, DerbyBetEntry } from '../logic'
import type { DerbyOddsState } from '../../types'

// A 12-hitter field is enough to exercise a real round-1 cut (top 8) without
// making the sim slow in CI.
const IDS = Array.from({ length: 12 }, (_, i) => `p${i}`)
const SEASON: Record<string, number> = Object.fromEntries(
  IDS.map((id, i) => [id, 12 - i]),   // p0 = 12 HR down to p11 = 1
)

function input(over: Partial<DerbyOddsInput> = {}): DerbyOddsInput {
  return {
    eligibleIds: IDS,
    seasonHr: SEASON,
    scores: {},
    activeRound: 1,
    entries: [],
    // Small but stable — these tests assert directions and orderings, not
    // third-decimal-place values.
    trials: 3000,
    seed: 42,
    ...over,
  }
}

const bet = (id: string, playerId: string, totalHr: number, name = id): DerbyBetEntry =>
  ({ id, name, playerId, totalHr })

describe('rate fitting', () => {
  it('starts every hitter near the league prior, scaled by season power', () => {
    const m = buildDerbyOddsModel(input())
    expect(m.leagueRoundMean).toBeCloseTo(PRIOR_ROUND_MEAN, 5)

    const big = m.rates.get('p0')!
    const small = m.rates.get('p11')!
    expect(big.meanPerRound).toBeGreaterThan(small.meanPerRound)
    // Shrinkage: a 12-HR bat may not project ten times a 1-HR bat
    expect(big.meanPerRound / small.meanPerRound).toBeLessThan(3)
    expect(big.meanPerRound / small.meanPerRound).toBeGreaterThan(1.2)
  })

  it('lets one live round outweigh the season prior', () => {
    // p11 is the weakest bat on paper and just put up 14
    const scores: DerbyScoresMap = { p11: { r1: 14 } }
    const before = buildDerbyOddsModel(input()).rates.get('p11')!
    const after = buildDerbyOddsModel(input({ scores, activeRound: 1 })).rates.get('p11')!

    expect(after.meanPerRound).toBeGreaterThan(before.meanPerRound * 2)
    // ...but not all the way to 14 — one round is one round
    expect(after.meanPerRound).toBeLessThan(14)
    expect(after.observedRounds).toBe(1)
  })

  it('re-estimates the league mean from what the field is actually doing', () => {
    // Everyone who has hit went deep — the whole board should project up
    const scores: DerbyScoresMap = {}
    for (const id of IDS.slice(0, 6)) scores[id] = { r1: 15 }
    const hot = buildDerbyOddsModel(input({ scores }))
    expect(hot.leagueRoundMean).toBeGreaterThan(PRIOR_ROUND_MEAN * 1.5)

    // A hitter who hasn't gone yet inherits the raised expectation
    const yetToHit = hot.rates.get('p11')!
    expect(yetToHit.observedRounds).toBe(0)
    expect(yetToHit.meanPerRound).toBeGreaterThan(
      buildDerbyOddsModel(input()).rates.get('p11')!.meanPerRound,
    )
  })

  it('projects a three-round pace from a single round — the "10 now, 30 later" case', () => {
    const scores: DerbyScoresMap = { p3: { r1: 10 } }
    const r = buildDerbyOddsModel(input({ scores })).rates.get('p3')!
    expect(r.bankedTotal).toBe(10)
    // Banked 10 plus two projected rounds, each pulled between the 10 they just
    // hit and the league prior
    expect(r.paceTotal).toBeGreaterThan(24)
    expect(r.paceTotal).toBeLessThan(34)
  })

  it('pro-rates the turn in progress by the clock', () => {
    // 6 HR with a third of the turn gone is a monster pace; with the turn
    // nearly over it's merely good.
    const scores: DerbyScoresMap = { p5: { r1: 6 } }
    const early = buildDerbyOddsModel(input({ scores, liveHitterId: 'p5', turnFraction: 0.33 }))
    const late = buildDerbyOddsModel(input({ scores, liveHitterId: 'p5', turnFraction: 0.95 }))

    expect(early.rates.get('p5')!.meanPerRound).toBeGreaterThan(late.rates.get('p5')!.meanPerRound)
    // Early in the turn there's a lot of hitting left, so the pace is higher
    expect(early.rates.get('p5')!.paceTotal).toBeGreaterThan(late.rates.get('p5')!.paceTotal)
  })

  it('expects nothing more from a turn that is over and has had its money ball', () => {
    const scores: DerbyScoresMap = { p5: { r1: 8 } }
    const spent = buildDerbyOddsModel(input({
      scores, liveHitterId: 'p5', turnFraction: 1, moneyBallTaken: true,
    })).rates.get('p5')!
    const pending = buildDerbyOddsModel(input({
      scores, liveHitterId: 'p5', turnFraction: 1, moneyBallTaken: false,
    })).rates.get('p5')!

    // Only the two rounds still to come are left in the pace
    expect(spent.paceTotal).toBeCloseTo(8 + 2 * spent.meanPerRound, 5)
    // A money ball still to come is worth its expected value and no more
    expect(pending.paceTotal).toBeGreaterThan(spent.paceTotal)
    expect(pending.paceTotal - spent.paceTotal).toBeLessThanOrEqual(3)
  })
})

describe('champion probabilities', () => {
  it('sums to one across the field', () => {
    const r = runDerbyOdds(input())
    const total = r.champions.reduce((s, c) => s + c.winProb, 0)
    expect(total).toBeCloseTo(1, 2)
  })

  it('favours the better bat but leaves the field alive', () => {
    const r = runDerbyOdds(input())
    const byId = new Map(r.champions.map(c => [c.playerId, c.winProb]))
    expect(byId.get('p0')!).toBeGreaterThan(byId.get('p11') ?? 0)
    // Nobody is a lock off season stats alone — that would be the model being
    // over-confident, which ROUND_DISPERSION exists to prevent
    expect(byId.get('p0')!).toBeLessThan(0.35)
  })

  it('honours a producer lock — a player cut out of round 1 cannot win', () => {
    const scores: DerbyScoresMap = {}
    IDS.forEach((id, i) => { scores[id] = { r1: 20 - i } })
    // p0 topped the round but the producer confirmed a field without them
    const locked = IDS.slice(1, 9)
    const r = runDerbyOdds(input({ scores, activeRound: 2, locks: { r1: locked } }))

    expect(r.champions.find(c => c.playerId === 'p0')).toBeUndefined()
    for (const c of r.champions) expect(locked).toContain(c.playerId)
  })

  it('gives an eliminated player no chance once the field is set', () => {
    const scores: DerbyScoresMap = {}
    IDS.forEach((id, i) => { scores[id] = { r1: 20 - i } })
    const r = runDerbyOdds(input({ scores, activeRound: 2 }))
    // p9..p11 finished 10th–12th; top 8 advance
    for (const id of ['p9', 'p10', 'p11']) {
      expect(r.champions.find(c => c.playerId === id)).toBeUndefined()
    }
  })

  it('reports the final round as a three-way race', () => {
    const scores: DerbyScoresMap = {}
    IDS.forEach((id, i) => { scores[id] = { r1: 20 - i } })
    for (const id of IDS.slice(0, 8)) scores[id].r2 = 12 - IDS.indexOf(id)
    const r = runDerbyOdds(input({ scores, activeRound: 3 }))
    expect(r.champions.length).toBeLessThanOrEqual(3)
    expect(r.champions.reduce((s, c) => s + c.winProb, 0)).toBeCloseTo(1, 2)
  })
})

// The simulation starts from `participantsForRound`, not from round 1, so
// being cut is structural rather than something the sim has to keep rolling
// its way out of. These pin that down — a knocked-out hitter reading 3% on a
// broadcast graphic is the failure everyone would notice.
describe('players who did not advance', () => {
  const doneR1: DerbyScoresMap = {}
  IDS.forEach((id, i) => { doneR1[id] = { r1: 20 - i } })   // p0 best … p11 worst

  it('gives a cut hitter exactly zero, not merely a small number', () => {
    const r = runDerbyOdds(input({ scores: doneR1, activeRound: 2 }))
    const byId = new Map(r.champions.map(c => [c.playerId, c.winProb]))
    // p8..p11 finished 9th–12th of 12 with 8 seats
    for (const id of ['p8', 'p9', 'p10', 'p11']) {
      expect(byId.get(id) ?? 0).toBe(0)
    }
    // ...and the eight who did advance still carry the whole probability
    expect(r.champions.reduce((s, c) => s + c.winProb, 0)).toBeCloseTo(1, 2)
  })

  it('gives a bet on a cut hitter exactly zero', () => {
    const r = runDerbyOdds(input({
      scores: doneR1, activeRound: 2,
      entries: [bet('out', 'p10', 30), bet('in', 'p1', 30)],
    }))
    const by = new Map(r.rows.map(x => [x.entryId, x]))
    expect(by.get('out')!.winProb).toBe(0)
    expect(by.get('out')!.playerWinProb).toBe(0)
    expect(by.get('out')!.expectedShare).toBe(0)
    expect(by.get('in')!.winProb).toBeGreaterThan(0)
  })

  it('honours a producer lock over the score cut, in both directions', () => {
    // The producer confirms a field that drops the round's top scorer and
    // keeps someone who finished below the line.
    const locked = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p11']
    const r = runDerbyOdds(input({ scores: doneR1, activeRound: 2, locks: { r1: locked } }))
    const byId = new Map(r.champions.map(c => [c.playerId, c.winProb]))
    expect(byId.get('p0') ?? 0).toBe(0)          // top of round 1, cut anyway
    expect(byId.get('p11') ?? 0).toBeGreaterThan(0)  // bottom of round 1, kept
  })

  it('keeps everyone alive while a tie for the last seat is unsettled', () => {
    // Seven clinched, three tied on the cut score for the 8th seat.
    const tied: DerbyScoresMap = {}
    IDS.forEach((id, i) => { tied[id] = { r1: i < 7 ? 20 - i : i < 10 ? 5 : 1 } })
    const r = runDerbyOdds(input({ scores: tied, activeRound: 2 }))
    const byId = new Map(r.champions.map(c => [c.playerId, c.winProb]))
    // All three of the tied group can still win the swing-off
    for (const id of ['p7', 'p8', 'p9']) expect(byId.get(id) ?? 0).toBeGreaterThan(0)
    // The ones below the tie cannot
    for (const id of ['p10', 'p11']) expect(byId.get(id) ?? 0).toBe(0)
  })

  it('ignores hitters the board never advanced when round 1 was left incomplete', () => {
    // The regression this restructure was for. Only five of twelve ever got a
    // round 1 score and the producer moved to round 2 anyway — which is the
    // state that had round 1 names turning up on the round 2 boards.
    //
    // Replaying the bracket from round 1 treated the seven blanks as a 0, and
    // with only five hitters above zero the cut had three seats left to fill:
    // three players who never took a swing got dealt into round 2 and could
    // win the whole thing. `participantsForRound` says the field is the five.
    const partial: DerbyScoresMap = {}
    for (let i = 0; i < 5; i++) partial[IDS[i]] = { r1: 12 - i }
    const r = runDerbyOdds(input({ scores: partial, activeRound: 2 }))

    const byId = new Map(r.champions.map(c => [c.playerId, c.winProb]))
    for (const id of IDS.slice(5)) expect(byId.get(id) ?? 0).toBe(0)
    expect(r.champions).toHaveLength(5)
    expect(r.champions.reduce((s, c) => s + c.winProb, 0)).toBeCloseTo(1, 2)

    // And no bet on one of them can pay
    const withBets = runDerbyOdds(input({
      scores: partial, activeRound: 2,
      entries: [bet('ghost', 'p9', 28), bet('real', 'p0', 28)],
    }))
    expect(withBets.rows.find(x => x.entryId === 'ghost')!.winProb).toBe(0)
    expect(withBets.rows.find(x => x.entryId === 'real')!.winProb).toBeGreaterThan(0)
  })

  it('counts banked earlier rounds in the winner\'s total', () => {
    // Everyone in the final has 30 in the books before the last round starts.
    const scores: DerbyScoresMap = {}
    IDS.forEach((id, i) => { scores[id] = { r1: 20 - i } })
    for (const id of IDS.slice(0, 8)) scores[id].r2 = 10 + (20 - IDS.indexOf(id)) - 10
    const r = runDerbyOdds(input({ scores, activeRound: 3 }))
    // The three finalists banked r1 + r2 of at least 30 between them, so no
    // simulated winning total may come in under that.
    const finalists = r.champions.map(c => c.playerId)
    const minBanked = Math.min(...finalists.map(id => (scores[id].r1 ?? 0) + (scores[id].r2 ?? 0)))
    expect(r.projectedWinningTotal.low).toBeGreaterThanOrEqual(minBanked)
  })
})

// The bet is on the player who WINS THE FINAL ROUND, and then on that player's
// total across all three. It is not on whoever hit the most home runs overall —
// a hitter can take the title on a big final having been quiet earlier, and it
// is *their* modest total the payout is measured against, not the bigger total
// of somebody they beat.
describe('the champion is the final round\'s winner, not the leading total', () => {
  // Three finalists, everything recorded, so there is nothing left to simulate
  // and the outcome is forced. A wins the final on 16 but totals only 26;
  // B totals 33 and loses the final.
  const FINAL: DerbyScoresMap = {
    p0: { r1: 5, r2: 5, r3: 16 },    // A — champion, 26 total
    p1: { r1: 15, r2: 15, r3: 3 },   // B — 33 total, beaten in the final
    p2: { r1: 12, r2: 12, r3: 9 },   // C — 33 total, also beaten
  }
  const locks = { r1: ['p0', 'p1', 'p2'], r2: ['p0', 'p1', 'p2'] }
  const final = (entries: DerbyBetEntry[] = []) =>
    runDerbyOdds(input({ scores: FINAL, activeRound: 3, locks, entries }))

  it('crowns the hitter who won the final, not the one with the most home runs', () => {
    const r = final()
    expect(r.champions[0].playerId).toBe('p0')
    expect(r.champions[0].winProb).toBe(1)
    // The two bigger totals get nothing — they lost the round that decides it
    expect(r.champions.find(c => c.playerId === 'p1')).toBeUndefined()
    expect(r.champions.find(c => c.playerId === 'p2')).toBeUndefined()
  })

  it('pays on the champion\'s own total, not the biggest total in the derby', () => {
    const r = final([
      bet('calledA', 'p0', 26),   // exactly A's total — wins
      bet('calledB', 'p0', 33),   // right player, but chased the big number
      bet('onB', 'p1', 33),       // nailed B's total; B didn't win, so nothing
    ])
    const by = new Map(r.rows.map(x => [x.entryId, x]))
    expect(by.get('calledA')!.winProb).toBe(1)
    expect(by.get('calledB')!.winProb).toBe(0)
    expect(by.get('onB')!.winProb).toBe(0)
    expect(r.projectedWinningTotal.median).toBe(26)
  })

  it('measures distance from the champion\'s total in both directions', () => {
    // 24 and 28 are both 2 away from 26 and split; 30 is 4 away and loses.
    const r = final([bet('under', 'p0', 24), bet('over', 'p0', 28), bet('far', 'p0', 30)])
    const by = new Map(r.rows.map(x => [x.entryId, x]))
    expect(by.get('under')!.winProb).toBe(1)
    expect(by.get('over')!.winProb).toBe(1)
    expect(by.get('under')!.expectedShare).toBeCloseTo(0.5, 5)
    expect(by.get('far')!.winProb).toBe(0)
  })
})

describe('settling the 50/50', () => {
  it('sends the pot to charity when nobody backed anyone', () => {
    const r = runDerbyOdds(input({ entries: [] }))
    expect(r.charityProb).toBe(1)
    expect(r.rows).toHaveLength(0)
  })

  it('caps an entry at the chance its hitter wins', () => {
    const r = runDerbyOdds(input({ entries: [bet('e1', 'p0', 30)] }))
    const row = r.rows[0]
    expect(row.winProb).toBeCloseTo(row.playerWinProb, 5)
    // One entry on one player: charity takes everything else
    expect(r.charityProb).toBeCloseTo(1 - row.playerWinProb, 5)
  })

  it('splits a hitter\'s chance between the bets on them by how close the call is', () => {
    // Three people on p0. The middle guess should beat the wild ones.
    const scores: DerbyScoresMap = { p0: { r1: 10 } }
    const r = runDerbyOdds(input({
      scores,
      entries: [bet('low', 'p0', 5), bet('mid', 'p0', 28), bet('high', 'p0', 70)],
    }))
    const by = new Map(r.rows.map(x => [x.entryId, x]))
    expect(by.get('mid')!.winProb).toBeGreaterThan(by.get('low')!.winProb)
    expect(by.get('mid')!.winProb).toBeGreaterThan(by.get('high')!.winProb)
    // The three between them can only ever win when p0 does
    const combined = r.rows.reduce((s, x) => s + x.expectedShare, 0)
    expect(combined).toBeCloseTo(by.get('mid')!.playerWinProb, 5)
  })

  it('prefers a good number on a likely hitter over a perfect number on an unlikely one', () => {
    // p11 is the weakest bat in the field; p0 the strongest.
    const r = runDerbyOdds(input({
      entries: [bet('onFav', 'p0', 26), bet('onLongshot', 'p11', 26)],
    }))
    const by = new Map(r.rows.map(x => [x.entryId, x]))
    expect(by.get('onFav')!.winProb).toBeGreaterThan(by.get('onLongshot')!.winProb)
    expect(r.rows[0].entryId).toBe('onFav')
  })

  it('counts a tie as a split, not as two whole wins', () => {
    // Two identical bets on the same player can only ever tie each other
    const r = runDerbyOdds(input({ entries: [bet('a', 'p0', 26), bet('b', 'p0', 26)] }))
    const [a, b] = r.rows
    expect(a.winProb).toBeCloseTo(b.winProb, 5)
    expect(a.expectedShare).toBeCloseTo(a.winProb / 2, 5)
    // Both are winners in every trial p0 takes it
    expect(a.winProb).toBeCloseTo(a.playerWinProb, 5)
  })

  it('accounts for every trial: somebody wins, or charity does', () => {
    const r = runDerbyOdds(input({
      entries: [bet('a', 'p0', 26), bet('b', 'p1', 24), bet('c', 'p0', 33), bet('d', 'p5', 19)],
    }))
    const share = r.rows.reduce((s, x) => s + x.expectedShare, 0)
    expect(share + r.charityProb).toBeCloseTo(1, 5)
  })

  it('never pays an entry on a player who is out of the derby', () => {
    const scores: DerbyScoresMap = {}
    IDS.forEach((id, i) => { scores[id] = { r1: 20 - i } })
    const r = runDerbyOdds(input({
      scores, activeRound: 2,
      entries: [bet('dead', 'p11', 26), bet('alive', 'p0', 26)],
    }))
    expect(r.rows.find(x => x.entryId === 'dead')!.winProb).toBe(0)
    expect(r.rows.find(x => x.entryId === 'alive')!.winProb).toBeGreaterThan(0)
    // Sorted best-first, so the dead entry is last
    expect(r.rows[0].entryId).toBe('alive')
  })

  it('moves the odds when the hitter someone backed goes deep', () => {
    const entries = [bet('a', 'p6', 26), bet('b', 'p0', 26)]
    const cold = runDerbyOdds(input({ entries }))
    const hot = runDerbyOdds(input({ scores: { p6: { r1: 18 } }, entries }))

    const before = cold.rows.find(x => x.entryId === 'a')!.playerWinProb
    const after = hot.rows.find(x => x.entryId === 'a')!.playerWinProb
    expect(after).toBeGreaterThan(before * 2)
  })
})

describe('projected winning total', () => {
  it('brackets the median inside the 10–90 band', () => {
    const { projectedWinningTotal: p } = runDerbyOdds(input())
    expect(p.low).toBeLessThanOrEqual(p.median)
    expect(p.median).toBeLessThanOrEqual(p.high)
    expect(p.low).toBeLessThan(p.high)
  })

  it('rises when the field is hitting', () => {
    const scores: DerbyScoresMap = {}
    for (const id of IDS) scores[id] = { r1: 18 }
    const hot = runDerbyOdds(input({ scores, activeRound: 2 }))
    const base = runDerbyOdds(input())
    expect(hot.projectedWinningTotal.median).toBeGreaterThan(base.projectedWinningTotal.median)
  })
})

describe('determinism', () => {
  it('gives identical numbers for identical input', () => {
    const args = input({ entries: [bet('a', 'p0', 26), bet('b', 'p3', 31)] })
    const a = runDerbyOdds(args)
    const b = runDerbyOdds(args)
    expect(a.rows.map(r => r.winProb)).toEqual(b.rows.map(r => r.winProb))
    expect(a.charityProb).toBe(b.charityProb)
  })

  it('ignores clock movement inside the same eighth of a turn', () => {
    const base = { scores: { p2: { r1: 4 } }, liveHitterId: 'p2' }
    const a = derbyOddsSignature(input({ ...base, turnFraction: 0.50 }))
    const b = derbyOddsSignature(input({ ...base, turnFraction: 0.55 }))
    const c = derbyOddsSignature(input({ ...base, turnFraction: 0.80 }))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('changes signature when a score, a lock, or a bet changes', () => {
    const base = input({ entries: [bet('a', 'p0', 26)] })
    const sig = derbyOddsSignature(base)
    expect(derbyOddsSignature({ ...base, scores: { p0: { r1: 3 } } })).not.toBe(sig)
    expect(derbyOddsSignature({ ...base, locks: { r1: IDS.slice(0, 8) } })).not.toBe(sig)
    expect(derbyOddsSignature({ ...base, entries: [bet('a', 'p0', 27)] })).not.toBe(sig)
    // Entry order is not information
    expect(derbyOddsSignature({
      ...base, entries: [bet('b', 'p1', 20), bet('a', 'p0', 26)],
    })).toBe(derbyOddsSignature({
      ...base, entries: [bet('a', 'p0', 26), bet('b', 'p1', 20)],
    }))
  })
})

describe('rotation window', () => {
  // The shipped cycle: 60s round, 15s of it on screen, so 45s away first.
  const T0 = 1000
  const odds: DerbyOddsState = {
    enabled: true, mode: 'timer', startedAt: T0, intervalMs: 60_000, durationMs: 15_000,
  }
  const at = (offset: number) => derbyOddsWindow(odds, T0 + offset)

  it('stays away for 45 seconds, then shows for 15', () => {
    expect(at(0).visible).toBe(false)
    expect(at(44_999).visible).toBe(false)
    expect(at(45_000).visible).toBe(true)
    expect(at(59_999).visible).toBe(true)
    // ...and round again
    expect(at(60_000).visible).toBe(false)
    expect(at(105_000).visible).toBe(true)
  })

  it('is hidden first, so taking the board down does not bounce it back', () => {
    // The producer presses "keep it up: NO" at T0; the controller stamps
    // startedAt = now. The board must go away, not re-appear instantly.
    expect(at(0).visible).toBe(false)
    expect(at(1_000).visible).toBe(false)
  })

  it('counts down to the next showing and to the next hide', () => {
    expect(at(30_000).msUntilNext).toBe(15_000)
    expect(at(50_000).msLeft).toBe(10_000)
  })

  it('treats a cycle stamped in the future as not yet started', () => {
    // Producer's clock ahead of the overlay's. The phase must not wrap round to
    // somewhere arbitrary — it reads as the top of the away stretch.
    const w = derbyOddsWindow({ ...odds, startedAt: T0 + 5_000 }, T0)
    expect(w.visible).toBe(false)
    expect(w.msUntilNext).toBe(45_000)
  })

  it('puts the board up straight away from derbyOddsShowNowAt', () => {
    const now = 500_000
    const started = derbyOddsShowNowAt(odds, now)
    const w = derbyOddsWindow({ ...odds, startedAt: started }, now)
    expect(w.visible).toBe(true)
    expect(w.msLeft).toBe(15_000)
  })

  it('stays up at every point in the cycle when kept up', () => {
    const live: DerbyOddsState = { ...odds, mode: 'always' }
    for (const t of [0, 1000, 30_000, 45_000, 59_999, 1e12]) {
      expect(derbyOddsWindow(live, t).visible).toBe(true)
    }
  })

  it('disappears when disabled, whatever the mode', () => {
    expect(derbyOddsWindow({ ...odds, enabled: false, mode: 'always' }, T0).visible).toBe(false)
    expect(derbyOddsWindow({ ...odds, enabled: false, mode: 'timer' }, T0).visible).toBe(false)
  })

  it('defaults to on, in bursts, 45 away and 15 up', () => {
    expect(DEFAULT_DERBY_ODDS.enabled).toBe(true)
    expect(DEFAULT_DERBY_ODDS.mode).toBe('timer')
    expect(DEFAULT_DERBY_ODDS.intervalMs - DEFAULT_DERBY_ODDS.durationMs).toBe(45_000)
    expect(DEFAULT_DERBY_ODDS.durationMs).toBe(15_000)
  })
})

describe('cost', () => {
  it('runs a full-size sim fast enough to slice across frames', () => {
    const started = performance.now()
    runDerbyOdds(input({ trials: DEFAULT_ODDS_TRIALS, entries: [bet('a', 'p0', 26)] }))
    // Generous — CI machines are slow. The point is to catch an accidental
    // order-of-magnitude regression, since this runs on the broadcast machine.
    expect(performance.now() - started).toBeLessThan(4000)
  })
})
