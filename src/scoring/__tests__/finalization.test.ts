import { describe, it, expect } from 'vitest'
import { computeFinalization } from '../finalization'
import type { FinalizeOutput } from '../finalization'
import type { AtBatRecord, PlayersMap, GameRecord, HittingStats, PitchingStats } from '../../types'
import { AUTO_OUT_BATTER_ID } from '../../types'

// ── Helpers ──────────────────────────────────────────────────────────────

const emptyBases = () => ({ first: null, second: null, third: null })

function makeAtBat(overrides: Partial<AtBatRecord> & Pick<AtBatRecord, 'batterId' | 'result' | 'batterAdvancedTo'>): AtBatRecord {
  return {
    pitcherId: 'p_away',
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

function makeGame(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    homeTeamId: 'home',
    awayTeamId: 'away',
    date: '2026-04-05',
    isStreamed: false,
    finalized: false,
    startedAt: Date.now(),
    inning: 7,
    isTopInning: false,
    outs: 3,
    homeScore: 0,
    awayScore: 0,
    ...overrides,
  }
}

const basePlayers: PlayersMap = {
  b1: { name: 'Batter 1', teamId: 'away', stats: {} },
  b2: { name: 'Batter 2', teamId: 'away', stats: {} },
  b3: { name: 'Batter 3', teamId: 'home', stats: {} },
  b4: { name: 'Batter 4', teamId: 'home', stats: {} },
  p_home: { name: 'Pitcher Home', teamId: 'home', stats: {} },
  p_away: { name: 'Pitcher Away', teamId: 'away', stats: {} },
}

function getUpdatedHitting(output: FinalizeOutput, playerId: string): HittingStats | undefined {
  return output.updates[`players/${playerId}/stats/hitting`] as HittingStats | undefined
}

function getUpdatedPitching(output: FinalizeOutput, playerId: string): PitchingStats | undefined {
  return output.updates[`players/${playerId}/stats/pitching`] as PitchingStats | undefined
}

// ── Single game finalization ────────────────────────────────────────────

describe('computeFinalization — single game', () => {
  it('computes hitting stats from a single game', () => {
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({ batterId: 'b1', result: 'double', batterAdvancedTo: 'second' }),
      makeAtBat({ batterId: 'b1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({ batterId: 'b1', result: 'walk', batterAdvancedTo: 'first' }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 1, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const h = getUpdatedHitting(output, 'b1')!
    expect(h).toBeDefined()
    expect(h.gp).toBe(1)
    expect(h.pa).toBe(4)
    expect(h.ab).toBe(3)
    expect(h.h).toBe(2)
    expect(h.doubles).toBe(1)
    expect(h.bb).toBe(1)
    expect(h.k).toBe(1)
    expect(h.avg).toBeCloseTo(0.667, 2) // 2/3
    expect(h.obp).toBeCloseTo(0.75, 2)  // (2+1)/4
  })

  it('computes pitching stats with ERA ×7', () => {
    // Pitcher records 21 outs (full 7 innings), allows 2 runs
    const atBats: AtBatRecord[] = []
    for (let i = 0; i < 21; i++) {
      atBats.push(makeAtBat({
        batterId: `b${i}`,
        pitcherId: 'p_away',
        result: 'groundout',
        batterAdvancedTo: 'out',
        outsOnPlay: 1,
      }))
    }
    // Two HRs allowed (runs scored)
    atBats.push(makeAtBat({
      batterId: 'b_hr1', pitcherId: 'p_away', result: 'home_run',
      batterAdvancedTo: 'home', runnersScored: [],
    }))
    atBats.push(makeAtBat({
      batterId: 'b_hr2', pitcherId: 'p_away', result: 'home_run',
      batterAdvancedTo: 'home', runnersScored: [],
    }))

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 2, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: {
        ...basePlayers,
        b_hr1: { name: 'HR 1', teamId: 'home', stats: {} },
        b_hr2: { name: 'HR 2', teamId: 'home', stats: {} },
      },
    })

    const p = getUpdatedPitching(output, 'p_away')!
    expect(p).toBeDefined()
    expect(p.runsAllowed).toBe(2)
    expect(p.inningsPitched).toBe(7)
    // ERA = (2 / 7) * 7 = 2.0
    expect(p.era).toBe(2)
  })

  it('sets finalized flag in updates', () => {
    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame(),
      currentGameAtBats: [],
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    expect(output.updates['games/g1/finalized']).toBe(true)
    expect(output.updates['games/g1/finalizedAt']).toBeTypeOf('number')
  })
})

// ── Sub exclusion ──────────────────────────────────────────────────────

describe('computeFinalization — sub handling', () => {
  it('writes sub stats to /players (consumers filter on player.isSub)', () => {
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first', isSub: false }),
      makeAtBat({ batterId: 'sub_123', result: 'home_run', batterAdvancedTo: 'home', isSub: true }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 1, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    // Sub stats ARE written — finalize is now idempotent. The sub's
    // /players/{id} record carries isSub:true; downstream consumers filter.
    expect(getUpdatedHitting(output, 'sub_123')).toBeDefined()
    // Regular player still appears
    expect(getUpdatedHitting(output, 'b1')).toBeDefined()
  })

  it('ignores spurious batter in runnersScored when batter was not on base', () => {
    // BOT 1 of YBY game: Ryan HR with sub on first. runnersScored cache had
    // [sub, Ryan] even though Ryan wasn't on base. Pre-fix code counted +2
    // for Ryan (batterAdvancedTo='home' AND in runnersScored).
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'r_on_first', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({
        batterId: 'b1',
        result: 'home_run',
        batterAdvancedTo: 'home',
        runnersOnBase: { first: 'r_on_first', second: null, third: null },
        runnerOutcomes: { first: 'scored' },
        runnersScored: ['r_on_first', 'b1'],   // batter spuriously cached in
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 0, awayScore: 2 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    expect(getUpdatedHitting(output, 'b1')?.r).toBe(1)
    expect(getUpdatedHitting(output, 'r_on_first')?.r).toBe(1)
    // 2 runs scored on this play (runner on first + batter)
    expect(output.updates['games/g1/awayScore']).toBe(2)
  })

  it('credits ghost-of-self when batter is also on base and that base scores', () => {
    // BOT 3 of YBY game: Ryan on third (ghost-of-self), Ryan bats double,
    // ghost-Ryan + Dragon score. Ryan should get +1 run from the ghost score
    // even though batterId === runnersOnBase[third]. Earlier de-dup attempt
    // incorrectly stripped this.
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'r2', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({
        batterId: 'b1',  // also on third as ghost
        result: 'double',
        batterAdvancedTo: 'second',
        runnersOnBase: { first: null, second: 'r2', third: 'b1' },
        runnerOutcomes: { second: 'scored', third: 'scored' },
        runnersScored: ['r2', 'b1'],
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame(),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    // Ghost-of-self on third scores → b1 gets +1 even though they're the batter
    expect(getUpdatedHitting(output, 'b1')?.r).toBe(1)
    expect(getUpdatedHitting(output, 'r2')?.r).toBe(1)
    // 2 runs scored on this play
    expect(output.updates['games/g1/awayScore']).toBe(2)
  })

  it('credits regular runners who score on a sub-batter at-bat', () => {
    // b1 (regular) singles, then sub_123 (sub) hits a HR scoring b1.
    // Under the old "skip sub at-bat entirely" rule, b1's run was lost.
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first', isSub: false }),
      makeAtBat({
        batterId: 'sub_123',
        result: 'home_run',
        batterAdvancedTo: 'home',
        isSub: true,
        runnersOnBase: { first: 'b1', second: null, third: null },
        runnerOutcomes: { first: 'scored' },
        runnersScored: ['b1'],
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 2, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const b1Hitting = getUpdatedHitting(output, 'b1')
    expect(b1Hitting?.r).toBe(1)
  })

  it('includes sub at-bats in game summaries', () => {
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'sub_123', result: 'single', batterAdvancedTo: 'first', isSub: true }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame(),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    // Game summary SHOULD include subs
    const summary = output.updates['gameSummaries/g1/sub_123'] as Record<string, unknown>
    expect(summary).toBeDefined()
    expect(summary.h).toBe(1)
  })
})

// ── W/L event-sourcing ─────────────────────────────────────────────────

describe('computeFinalization — W/L', () => {
  it('awards W to winning team pitcher and L to losing team pitcher', () => {
    // Home team wins 1-0. Each pitcher records 9+ outs (qualifying).
    const atBats: AtBatRecord[] = []
    // Away pitcher: 9 outs (b3/b4 are home team batters)
    for (let i = 0; i < 9; i++) {
      atBats.push(makeAtBat({
        batterId: i % 2 === 0 ? 'b3' : 'b4',
        pitcherId: 'p_away',
        result: 'strikeout',
        batterAdvancedTo: 'out',
        outsOnPlay: 1,
        isTopInning: false,
      }))
    }
    // Home pitcher: 9 outs (b1/b2 are away team batters)
    for (let i = 0; i < 9; i++) {
      atBats.push(makeAtBat({
        batterId: i % 2 === 0 ? 'b1' : 'b2',
        pitcherId: 'p_home',
        result: 'groundout',
        batterAdvancedTo: 'out',
        outsOnPlay: 1,
        isTopInning: true,
      }))
    }

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 1, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const homeP = getUpdatedPitching(output, 'p_home')!
    const awayP = getUpdatedPitching(output, 'p_away')!
    expect(homeP.w).toBe(1)
    expect(homeP.l).toBe(0)
    expect(awayP.w).toBe(0)
    expect(awayP.l).toBe(1)
  })

  it('no W/L on tie game', () => {
    const atBats: AtBatRecord[] = []
    for (let i = 0; i < 9; i++) {
      atBats.push(makeAtBat({
        batterId: 'b1', pitcherId: 'p_home', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }
    for (let i = 0; i < 9; i++) {
      atBats.push(makeAtBat({
        batterId: 'b3', pitcherId: 'p_away', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 3, awayScore: 3 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const homeP = getUpdatedPitching(output, 'p_home')!
    const awayP = getUpdatedPitching(output, 'p_away')!
    expect(homeP.w).toBe(0)
    expect(homeP.l).toBe(0)
    expect(awayP.w).toBe(0)
    expect(awayP.l).toBe(0)
  })

  it('no W/L when pitcher has fewer than 9 outs', () => {
    const atBats: AtBatRecord[] = []
    // Only 8 outs each — doesn't qualify
    for (let i = 0; i < 8; i++) {
      atBats.push(makeAtBat({
        batterId: 'b1', pitcherId: 'p_home', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }
    for (let i = 0; i < 8; i++) {
      atBats.push(makeAtBat({
        batterId: 'b3', pitcherId: 'p_away', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 5, awayScore: 2 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const homeP = getUpdatedPitching(output, 'p_home')!
    const awayP = getUpdatedPitching(output, 'p_away')!
    expect(homeP.w).toBe(0)
    expect(homeP.l).toBe(0)
    expect(awayP.w).toBe(0)
    expect(awayP.l).toBe(0)
  })
})

// ── Multi-game cumulative stats ─────────────────────────────────────────

describe('computeFinalization — multi-game cumulative', () => {
  it('accumulates hitting stats across two games', () => {
    // Game 1 (previous): b1 went 2-for-3 with a walk
    const prevAtBats: Array<AtBatRecord & { gameId: string }> = [
      { ...makeAtBat({ batterId: 'b1', result: 'single', batterAdvancedTo: 'first' }), gameId: 'g1' },
      { ...makeAtBat({ batterId: 'b1', result: 'double', batterAdvancedTo: 'second' }), gameId: 'g1' },
      { ...makeAtBat({ batterId: 'b1', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }), gameId: 'g1' },
      { ...makeAtBat({ batterId: 'b1', result: 'walk', batterAdvancedTo: 'first' }), gameId: 'g1' },
    ]
    const prevGames: Record<string, GameRecord> = {
      g1: makeGame({ homeScore: 3, awayScore: 1, finalized: true }),
    }

    // Game 2 (current): b1 goes 1-for-2
    const currentAtBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', result: 'home_run', batterAdvancedTo: 'home', runnersScored: [] }),
      makeAtBat({ batterId: 'b1', result: 'groundout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
    ]

    const output = computeFinalization({
      gameId: 'g2',
      game: makeGame({ homeScore: 1, awayScore: 2 }),
      currentGameAtBats: currentAtBats,
      previousAtBats: prevAtBats,
      previousGames: prevGames,
      players: basePlayers,
    })

    const h = getUpdatedHitting(output, 'b1')!
    expect(h.gp).toBe(2) // appeared in 2 games
    expect(h.pa).toBe(6) // 4 prev + 2 current
    expect(h.ab).toBe(5) // 3 prev + 2 current
    expect(h.h).toBe(3)  // 2 prev + 1 current
    expect(h.hr).toBe(1)
    expect(h.doubles).toBe(1)
    expect(h.bb).toBe(1)
    expect(h.k).toBe(1)
    expect(h.avg).toBeCloseTo(0.6, 2) // 3/5
    expect(h.obp).toBeCloseTo(0.667, 2) // (3+1)/6
  })

  it('accumulates pitching stats and W/L across two games', () => {
    // Game 1 (previous): p_home pitched 9 outs, 1 run. Home won.
    const prevAtBats: Array<AtBatRecord & { gameId: string }> = []
    for (let i = 0; i < 9; i++) {
      prevAtBats.push({
        ...makeAtBat({
          batterId: 'b1', pitcherId: 'p_home', result: 'strikeout',
          batterAdvancedTo: 'out', outsOnPlay: 1,
        }),
        gameId: 'g1',
      })
    }
    // 1 run allowed in game 1
    prevAtBats.push({
      ...makeAtBat({
        batterId: 'b1', pitcherId: 'p_home', result: 'home_run',
        batterAdvancedTo: 'home', runnersScored: [],
      }),
      gameId: 'g1',
    })
    // Away pitcher in game 1 (9 outs, gets the loss)
    for (let i = 0; i < 9; i++) {
      prevAtBats.push({
        ...makeAtBat({
          batterId: 'b3', pitcherId: 'p_away', result: 'groundout',
          batterAdvancedTo: 'out', outsOnPlay: 1,
        }),
        gameId: 'g1',
      })
    }

    const prevGames: Record<string, GameRecord> = {
      g1: makeGame({ homeScore: 3, awayScore: 1, finalized: true }),
    }

    // Game 2 (current): p_home pitches again, 9 outs, 0 runs. Home wins again.
    const currentAtBats: AtBatRecord[] = []
    for (let i = 0; i < 9; i++) {
      currentAtBats.push(makeAtBat({
        batterId: 'b1', pitcherId: 'p_home', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }
    // Away pitcher game 2 (9 outs, loss again)
    for (let i = 0; i < 9; i++) {
      currentAtBats.push(makeAtBat({
        batterId: 'b3', pitcherId: 'p_away', result: 'groundout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }))
    }

    const output = computeFinalization({
      gameId: 'g2',
      game: makeGame({ homeScore: 2, awayScore: 0 }),
      currentGameAtBats: currentAtBats,
      previousAtBats: prevAtBats,
      previousGames: prevGames,
      players: basePlayers,
    })

    const homeP = getUpdatedPitching(output, 'p_home')!
    expect(homeP.gp).toBe(2)
    expect(homeP.w).toBe(2)
    expect(homeP.l).toBe(0)
    expect(homeP.runsAllowed).toBe(1) // only 1 run in game 1
    expect(homeP.k).toBe(18) // 9 per game

    const awayP = getUpdatedPitching(output, 'p_away')!
    expect(awayP.w).toBe(0)
    expect(awayP.l).toBe(2)
  })
})

// ── Game summaries ──────────────────────────────────────────────────────

describe('computeFinalization — game summaries', () => {
  it('writes per-player game summaries including pitching IP', () => {
    const atBats: AtBatRecord[] = [
      makeAtBat({
        batterId: 'b1', pitcherId: 'p_away', result: 'single',
        batterAdvancedTo: 'first',
      }),
      makeAtBat({
        batterId: 'b2', pitcherId: 'p_away', result: 'strikeout',
        batterAdvancedTo: 'out', outsOnPlay: 1,
      }),
      makeAtBat({
        batterId: 'b1', pitcherId: 'p_away', result: 'home_run',
        batterAdvancedTo: 'home', runnersScored: [],
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 1, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const b1Summary = output.updates['gameSummaries/g1/b1'] as Record<string, unknown>
    expect(b1Summary).toBeDefined()
    expect(b1Summary.pa).toBe(2)
    expect(b1Summary.h).toBe(2)
    expect(b1Summary.hr).toBe(1)
    expect(b1Summary.r).toBe(1) // scored on HR

    const pitcherSummary = output.updates['gameSummaries/g1/p_away'] as Record<string, unknown>
    expect(pitcherSummary).toBeDefined()
    expect(pitcherSummary.inningsPitched).toBeCloseTo(0.33, 1) // 1 out
    expect(pitcherSummary.runsAllowed).toBe(1)
  })
})

// ── Auto Out (Forceful Action) finalization ─────────────────────────────

describe('computeFinalization — auto_out', () => {
  it('does not write a phantom __auto_out__ entry to season hitting stats', () => {
    // Three normal at-bats from b1, then an auto-out (e.g. missing 4th batter)
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', pitcherId: 'p_home', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({ batterId: 'b2', pitcherId: 'p_home', result: 'strikeout', batterAdvancedTo: 'out', outsOnPlay: 1 }),
      makeAtBat({
        batterId: AUTO_OUT_BATTER_ID, pitcherId: 'p_home',
        result: 'auto_out', batterAdvancedTo: 'out', outsOnPlay: 1,
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame({ homeScore: 0, awayScore: 0 }),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    // No phantom season hitting stats keyed by sentinel
    expect(output.updates[`players/${AUTO_OUT_BATTER_ID}/stats/hitting`]).toBeUndefined()
    expect(output.updates[`players/${AUTO_OUT_BATTER_ID}/stats/pitching`]).toBeUndefined()

    // Real batter is unaffected
    const b1 = getUpdatedHitting(output, 'b1')
    expect(b1).toBeDefined()
    expect(b1!.pa).toBe(1)
    expect(b1!.h).toBe(1)
  })

  it('does not write a phantom __auto_out__ game summary entry', () => {
    const atBats: AtBatRecord[] = [
      makeAtBat({ batterId: 'b1', pitcherId: 'p_home', result: 'single', batterAdvancedTo: 'first' }),
      makeAtBat({
        batterId: AUTO_OUT_BATTER_ID, pitcherId: 'p_home',
        result: 'auto_out', batterAdvancedTo: 'out', outsOnPlay: 1,
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame(),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    // No phantom game summary entry under the sentinel key
    expect(output.updates[`gameSummaries/g1/${AUTO_OUT_BATTER_ID}`]).toBeUndefined()

    // Real batter still gets their summary
    expect(output.updates['gameSummaries/g1/b1']).toBeDefined()
  })

  it('credits the pitcher with the auto-out toward IP (season + game summary)', () => {
    // Pitcher faces one auto-out only — gets 1 out toward IP
    const atBats: AtBatRecord[] = [
      makeAtBat({
        batterId: AUTO_OUT_BATTER_ID, pitcherId: 'p_home',
        result: 'auto_out', batterAdvancedTo: 'out', outsOnPlay: 1,
      }),
    ]

    const output = computeFinalization({
      gameId: 'g1',
      game: makeGame(),
      currentGameAtBats: atBats,
      previousAtBats: [],
      previousGames: {},
      players: basePlayers,
    })

    const pitching = getUpdatedPitching(output, 'p_home')
    expect(pitching).toBeDefined()
    expect(pitching!.inningsPitched).toBeCloseTo(0.33, 1) // 1 out
    expect(pitching!.k).toBe(0) // auto-out is not a strikeout
    expect(pitching!.bb).toBe(0)

    const pitcherSummary = output.updates['gameSummaries/g1/p_home'] as Record<string, unknown>
    expect(pitcherSummary).toBeDefined()
    expect(pitcherSummary.inningsPitched).toBeCloseTo(0.33, 1)
  })
})
