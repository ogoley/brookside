import { describe, it, expect } from 'vitest'
import { applyAtBat, replayHalfInning, computeGameStats, mergeHittingStats, mergePitchingStats } from '../engine'
import type { AtBatRecord, RunnersState, HittingStats, PitchingStats } from '../../types'
import { AUTO_OUT_BATTER_ID } from '../../types'

// ── Helpers ──────────────────────────────────────────────────────────────

const emptyBases: () => RunnersState = () => ({ first: null, second: null, third: null })
const getName = (id: string) => id

function makeAtBat(overrides: Partial<AtBatRecord> & Pick<AtBatRecord, 'batterId' | 'result' | 'batterAdvancedTo'>): AtBatRecord {
  return {
    pitcherId: 'p1',
    isSub: false,
    inning: 1,
    isTopInning: true,
    timestamp: Date.now(),
    runnersOnBase: emptyBases(),
    runnerOutcomes: {},
    runnersScored: [],
    outsOnPlay: 0,
    rbiCount: 0,
    ...overrides,
  }
}

function runApply(
  record: AtBatRecord,
  runners: RunnersState = emptyBases(),
  opts: { homeScore?: number; awayScore?: number; isHomeTeamBatting?: boolean } = {},
) {
  return applyAtBat({
    record,
    currentRunners: runners,
    batterName: record.batterId,
    getPlayerName: getName,
    homeScore: opts.homeScore ?? 0,
    awayScore: opts.awayScore ?? 0,
    isHomeTeamBatting: opts.isHomeTeamBatting ?? false,
  })
}

// ── applyAtBat ────────────────────────────────────────────────────────────

describe('applyAtBat', () => {
  it('single with empty bases — batter on 1st, 0 outs', () => {
    const ab = makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' })
    const r = runApply(ab)
    expect(r.nextRunners).toEqual({ first: 'b1', second: null, third: null })
    expect(r.outsOnPlay).toBe(0)
    expect(r.runsScored).toBe(0)
    expect(r.rbiCount).toBe(0)
  })

  it('double with empty bases — batter on 2nd', () => {
    const ab = makeAtBat({ batterId: 'b1', result: 'double', batterAdvancedTo: 'second' })
    const r = runApply(ab)
    expect(r.nextRunners).toEqual({ first: null, second: 'b1', third: null })
    expect(r.outsOnPlay).toBe(0)
  })

  it('triple with empty bases — batter on 3rd', () => {
    const ab = makeAtBat({ batterId: 'b1', result: 'triple', batterAdvancedTo: 'third' })
    const r = runApply(ab)
    expect(r.nextRunners).toEqual({ first: null, second: null, third: 'b1' })
  })

  it('home run with empty bases — 1 run, 1 RBI, bases clear', () => {
    const ab = makeAtBat({
      batterId: 'b1', result: 'home_run', batterAdvancedTo: 'home',
      runnersScored: [],
    })
    const r = runApply(ab)
    expect(r.nextRunners).toEqual(emptyBases())
    expect(r.runsScored).toBe(1)
    expect(r.rbiCount).toBe(1)
    expect(r.outsOnPlay).toBe(0)
  })

  it('grand slam — 4 runs, 4 RBI, bases clear', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: 'r3' }
    const ab = makeAtBat({
      batterId: 'b1', result: 'home_run', batterAdvancedTo: 'home',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'scored', second: 'scored', third: 'scored' },
      runnersScored: ['r1', 'r2', 'r3'],
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual(emptyBases())
    expect(r.runsScored).toBe(4) // 3 runners + batter
    expect(r.rbiCount).toBe(4)
  })

  it('walk with empty bases — batter on 1st', () => {
    const ab = makeAtBat({ batterId: 'b1', result: 'walk', batterAdvancedTo: 'first' })
    const r = runApply(ab)
    expect(r.nextRunners).toEqual({ first: 'b1', second: null, third: null })
    expect(r.outsOnPlay).toBe(0)
    expect(r.rbiCount).toBe(0)
  })

  it('walk with bases loaded — forced advancement, 1 RBI', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: 'r3' }
    const ab = makeAtBat({
      batterId: 'b1', result: 'walk', batterAdvancedTo: 'first',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'second', second: 'third', third: 'scored' },
      runnersScored: ['r3'],
      rbiCount: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'b1', second: 'r1', third: 'r2' })
    expect(r.runsScored).toBe(1)
    expect(r.rbiCount).toBe(1) // walk with bases loaded gets RBI
  })

  it('strikeout with runners — runners stay, 1 out, 0 RBI', () => {
    const runners: RunnersState = { first: 'r1', second: null, third: 'r3' }
    const ab = makeAtBat({
      batterId: 'b1', result: 'strikeout', batterAdvancedTo: 'out',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'stayed', third: 'stayed' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'r1', second: null, third: 'r3' })
    expect(r.outsOnPlay).toBe(1)
    expect(r.runsScored).toBe(0)
    expect(r.rbiCount).toBe(0)
  })

  it('strikeout zeroes RBI even if a runner somehow scored', () => {
    const runners: RunnersState = { first: null, second: null, third: 'r3' }
    const ab = makeAtBat({
      batterId: 'b1', result: 'strikeout', batterAdvancedTo: 'out',
      runnersOnBase: runners,
      runnerOutcomes: { third: 'scored' },
      runnersScored: ['r3'],
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.rbiCount).toBe(0) // strikeout never gets RBI
    expect(r.runsScored).toBe(1) // the run still scores
  })

  it('groundout with chain rule (1st only) — lead runner sits, batter on 1st', () => {
    const runners: RunnersState = { first: 'r1', second: null, third: null }
    const ab = makeAtBat({
      batterId: 'b1', result: 'groundout', batterAdvancedTo: 'first',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'sits' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'b1', second: null, third: null })
    expect(r.outsOnPlay).toBe(1)
  })

  it('groundout with chain rule (1st+2nd) — lead sits, 1st advances, batter on 1st', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: null }
    const ab = makeAtBat({
      batterId: 'b1', result: 'groundout', batterAdvancedTo: 'first',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'second', second: 'sits' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'b1', second: 'r1', third: null })
    expect(r.outsOnPlay).toBe(1)
  })

  it('groundout with chain rule (bases loaded) — 3rd sits, others cascade', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: 'r3' }
    const ab = makeAtBat({
      batterId: 'b1', result: 'groundout', batterAdvancedTo: 'first',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'second', second: 'third', third: 'sits' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'b1', second: 'r1', third: 'r2' })
    expect(r.outsOnPlay).toBe(1)
  })

  it('groundout without chain (runner on 2nd only) — batter out, runner stays', () => {
    const runners: RunnersState = { first: null, second: 'r2', third: null }
    const ab = makeAtBat({
      batterId: 'b1', result: 'groundout', batterAdvancedTo: 'out',
      runnersOnBase: runners,
      runnerOutcomes: { second: 'stayed' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: null, second: 'r2', third: null })
    expect(r.outsOnPlay).toBe(1)
  })

  it('popout — no chain rule, batter out', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: null }
    const ab = makeAtBat({
      batterId: 'b1', result: 'popout', batterAdvancedTo: 'out',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'stayed', second: 'stayed' },
      outsOnPlay: 1,
    })
    const r = runApply(ab, runners)
    expect(r.nextRunners).toEqual({ first: 'r1', second: 'r2', third: null })
    expect(r.outsOnPlay).toBe(1)
  })
})

// ── replayHalfInning ──────────────────────────────────────────────────────

describe('replayHalfInning', () => {
  it('replays a 3-out half-inning correctly', () => {
    const abs: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({
        batterId: 'b2', result: 'groundout', batterAdvancedTo: 'first',
        runnersOnBase: { first: 'b1', second: null, third: null },
        runnerOutcomes: { first: 'sits' },
        outsOnPlay: 1,
      }),
      makeAtBat({
        batterId: 'b3', result: 'home_run', batterAdvancedTo: 'home',
        runnersOnBase: { first: 'b2', second: null, third: null },
        runnerOutcomes: { first: 'scored' },
        runnersScored: ['b2'],
        rbiCount: 2,
      }),
      makeAtBat({ batterId: 'b4', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({ batterId: 'b5', result: 'popout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
    ]

    const result = replayHalfInning(abs, getName, false, 0, 0)
    expect(result.totalOuts).toBe(3)
    expect(result.totalRuns).toBe(2) // b2 scored on HR + b3 scored (HR batter)
    expect(result.finalRunners).toEqual(emptyBases())
  })
})

// ── computeGameStats ──────────────────────────────────────────────────────

describe('computeGameStats', () => {
  it('computes hitting stats for a batter', () => {
    const abs: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({ batterId: 'b1', result: 'double', batterAdvancedTo: 'second' }),
      makeAtBat({ batterId: 'b1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({ batterId: 'b1', result: 'walk', batterAdvancedTo: 'first' }),
    ]

    const stats = computeGameStats(abs, 'b1')
    expect(stats.hitting).not.toBeNull()
    const h = stats.hitting!
    expect(h.pa).toBe(4)
    expect(h.ab).toBe(3) // walk doesn't count as AB
    expect(h.h).toBe(2) // single + double
    expect(h.doubles).toBe(1)
    expect(h.bb).toBe(1)
    expect(h.k).toBe(1)
    expect(h.avg).toBeCloseTo(0.667, 2) // 2/3
    expect(h.obp).toBeCloseTo(0.75, 2) // (2+1)/4
  })

  it('computes pitching stats for a pitcher', () => {
    const abs: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', pitcherId: 'p1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({ batterId: 'b2', pitcherId: 'p1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({ batterId: 'b3', pitcherId: 'p1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({
        batterId: 'b4', pitcherId: 'p1', result: 'home_run', batterAdvancedTo: 'home',
        runnersScored: [],
      }),
      makeAtBat({ batterId: 'b5', pitcherId: 'p1', result: 'walk', batterAdvancedTo: 'first' }),
      makeAtBat({ batterId: 'b6', pitcherId: 'p1', result: 'popout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
    ]

    const stats = computeGameStats(abs, 'p1')
    expect(stats.pitching).not.toBeNull()
    const p = stats.pitching!
    expect(p.k).toBe(3)
    expect(p.bb).toBe(1)
    expect(p.runsAllowed).toBe(1) // HR batter scored
    // 4 outs total = 1.33 IP
    expect(p.inningsPitched).toBeCloseTo(1.33, 1)
  })

  it('counts runs scored by a player as a runner', () => {
    const abs: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({
        batterId: 'b2', result: 'home_run', batterAdvancedTo: 'home',
        runnersOnBase: { first: 'b1', second: null, third: null },
        runnerOutcomes: { first: 'scored' },
        runnersScored: ['b1'],
        rbiCount: 2,
      }),
    ]

    const b1Stats = computeGameStats(abs, 'b1')
    expect(b1Stats.hitting!.r).toBe(1) // scored as runner on b2's HR
  })
})

// ── mergeHittingStats ─────────────────────────────────────────────────────

describe('mergeHittingStats', () => {
  it('sums counting stats and recomputes rate stats', () => {
    const season: HittingStats = { gp: 5, pa: 20, ab: 18, h: 6, doubles: 1, triples: 0, hr: 1, r: 3, rbi: 4, bb: 2, k: 5, avg: 0.333, obp: 0.4, slg: 0.5, ops: 0.9 }
    const game: HittingStats = { gp: 1, pa: 4, ab: 3, h: 2, doubles: 1, triples: 0, hr: 0, r: 1, rbi: 1, bb: 1, k: 0, avg: 0.667, obp: 0.75, slg: 1.0, ops: 1.75 }

    const merged = mergeHittingStats(season, game)
    expect(merged.gp).toBe(6)
    expect(merged.pa).toBe(24)
    expect(merged.ab).toBe(21)
    expect(merged.h).toBe(8)
    expect(merged.bb).toBe(3)
    expect(merged.avg).toBeCloseTo(0.381, 2) // 8/21
    expect(merged.obp).toBeCloseTo(0.458, 2) // (8+3)/24
  })
})

// ── mergePitchingStats ────────────────────────────────────────────────────

describe('mergePitchingStats', () => {
  it('uses raw runsAllowed when available', () => {
    const season: PitchingStats = { gp: 3, k: 15, bb: 3, inningsPitched: 14, era: 2.0, runsAllowed: 4, w: 2, l: 1 }
    const game: PitchingStats = { gp: 1, k: 5, bb: 1, inningsPitched: 7, era: 0, runsAllowed: 0 }

    const merged = mergePitchingStats(season, game)
    expect(merged.gp).toBe(4)
    expect(merged.k).toBe(20)
    expect(merged.bb).toBe(4)
    expect(merged.inningsPitched).toBe(21)
    expect(merged.runsAllowed).toBe(4)
    // ERA = (4 / 21) * 7 = 1.33
    expect(merged.era).toBeCloseTo(1.33, 1)
  })

  it('falls back to ERA-based derivation when runsAllowed is missing', () => {
    // Old stored stats without runsAllowed
    const season: PitchingStats = { gp: 2, k: 10, bb: 2, inningsPitched: 14, era: 2.0 }
    const game: PitchingStats = { gp: 1, k: 7, bb: 0, inningsPitched: 7, era: 0, runsAllowed: 0 }

    const merged = mergePitchingStats(season, game)
    expect(merged.k).toBe(17)
    // Season runs = ERA * IP / 7 = 2.0 * 14 / 7 = 4
    // Game runs = 0
    // ERA = (4 / 21) * 7 = 1.33
    expect(merged.era).toBeCloseTo(1.33, 1)
  })
})

// ── Auto Out (Forceful Action) ───────────────────────────────────────────

describe('applyAtBat — auto_out', () => {
  it('empty bases — 1 out, no runners, no runs', () => {
    const ab = makeAtBat({ batterId: AUTO_OUT_BATTER_ID, result: 'auto_out', batterAdvancedTo: 'out' })
    const r = runApply(ab)
    expect(r.outsOnPlay).toBe(1)
    expect(r.nextRunners).toEqual(emptyBases())
    expect(r.runsScored).toBe(0)
    expect(r.rbiCount).toBe(0)
  })

  it('runners on base — runners stay put, 1 out', () => {
    const runners: RunnersState = { first: 'r1', second: 'r2', third: null }
    const ab = makeAtBat({
      batterId: AUTO_OUT_BATTER_ID, result: 'auto_out', batterAdvancedTo: 'out',
      runnersOnBase: runners,
      runnerOutcomes: { first: 'stayed', second: 'stayed' },
    })
    const r = runApply(ab, runners)
    expect(r.outsOnPlay).toBe(1)
    expect(r.nextRunners).toEqual({ first: 'r1', second: 'r2', third: null })
    expect(r.runsScored).toBe(0)
    expect(r.rbiCount).toBe(0)
  })

  it('replays correctly inside replayHalfInning — 3 auto-outs end the half', () => {
    const ab1 = makeAtBat({ batterId: AUTO_OUT_BATTER_ID, result: 'auto_out', batterAdvancedTo: 'out', timestamp: 1 })
    const ab2 = makeAtBat({ batterId: AUTO_OUT_BATTER_ID, result: 'auto_out', batterAdvancedTo: 'out', timestamp: 2 })
    const ab3 = makeAtBat({ batterId: AUTO_OUT_BATTER_ID, result: 'auto_out', batterAdvancedTo: 'out', timestamp: 3 })
    const result = replayHalfInning([ab1, ab2, ab3], getName, false, 0, 0)
    expect(result.totalOuts).toBe(3)
    expect(result.totalRuns).toBe(0)
    expect(result.finalRunners).toEqual(emptyBases())
  })
})

describe('computeGameStats — auto_out', () => {
  it('credits the pitcher with +1 out (1/3 IP) and does not pollute pitcher batting', () => {
    const ab = makeAtBat({
      batterId: AUTO_OUT_BATTER_ID, pitcherId: 'p1',
      result: 'auto_out', batterAdvancedTo: 'out', outsOnPlay: 1,
    })
    const pitcherStats = computeGameStats([ab], 'p1')
    expect(pitcherStats.pitching).not.toBeNull()
    expect(pitcherStats.pitching!.inningsPitched).toBeCloseTo(0.33, 2) // 1/3 of an inning
    expect(pitcherStats.pitching!.k).toBe(0) // not a strikeout
    expect(pitcherStats.pitching!.bb).toBe(0)
    expect(pitcherStats.hitting).toBeNull() // pitcher didn't bat
  })

  it('does not credit any real player with a plate appearance', () => {
    const ab = makeAtBat({
      batterId: AUTO_OUT_BATTER_ID, pitcherId: 'p1',
      result: 'auto_out', batterAdvancedTo: 'out', outsOnPlay: 1,
    })
    // Any other player ID should produce no batting stats from this auto-out
    const realBatterStats = computeGameStats([ab], 'b1')
    expect(realBatterStats.hitting).toBeNull()
  })
})
