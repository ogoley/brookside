import { describe, it, expect } from 'vitest'
import {
  computeLines, rankTeams, buildPlayoffPicture, projectBracket, reseedSemifinals,
  statusTag, outlookLine, winPct, dedupeSchedule, DEFAULT_PLAYOFF_CONFIG,
  type GameResult, type ScheduledGame,
} from '../engine'

const g = (away: string, home: string, awayScore: number, homeScore: number): GameResult =>
  ({ homeTeamId: home, awayTeamId: away, homeScore, awayScore })

const s = (id: string, away: string, home: string, status: ScheduledGame['status'] = 'scheduled'): ScheduledGame =>
  ({ id, date: '2026-09-20', homeTeamId: home, awayTeamId: away, status })

describe('computeLines / winPct', () => {
  it('accumulates W-L-T, runs for/against and games played', () => {
    const lines = computeLines(['a', 'b', 'c'], [g('a', 'b', 5, 3), g('b', 'c', 2, 2), g('c', 'a', 1, 4)])
    expect(lines.get('a')).toMatchObject({ w: 2, l: 0, t: 0, gp: 2, rf: 9, ra: 4 })
    expect(lines.get('b')).toMatchObject({ w: 0, l: 1, t: 1, gp: 2, rf: 5, ra: 7 })
    expect(lines.get('c')).toMatchObject({ w: 0, l: 1, t: 1, gp: 2, rf: 3, ra: 6 })
    expect(winPct(lines.get('b')!)).toBeCloseTo(0.25)
    expect(winPct({ teamId: 'x', w: 0, l: 0, t: 0, gp: 0, rf: 0, ra: 0 })).toBe(0)
  })

  it('keeps teams with no games at 0-0', () => {
    const lines = computeLines(['a', 'b'], [])
    expect(lines.get('b')).toMatchObject({ w: 0, l: 0, gp: 0 })
  })
})

describe('rankTeams tiebreakers', () => {
  it('orders by win pct first', () => {
    const results = [g('a', 'b', 1, 0), g('a', 'c', 1, 0), g('b', 'c', 1, 0)]
    expect(rankTeams(computeLines(['a', 'b', 'c'], results), results).order).toEqual(['a', 'b', 'c'])
  })

  it('breaks a two-way tie on head-to-head before run differential', () => {
    // a and b are both 1-1. b beat a head-to-head; a has the far better run differential.
    const r = [g('b', 'a', 2, 1), g('a', 'c', 10, 0), g('d', 'b', 1, 0)]   // d 1-0, c 0-1
    const rk = rankTeams(computeLines(['a', 'b', 'c', 'd'], r), r)
    expect(rk.order).toEqual(['d', 'b', 'a', 'c'])
    expect(rk.tieNotes[0]).toEqual({ teamIds: ['a', 'b'], resolvedBy: 'headToHead' })
  })

  it('falls through to run differential when head-to-head is split', () => {
    const results = [g('a', 'b', 5, 0), g('b', 'a', 1, 0)]   // 1-1 each, a +4, b -4
    const rk = rankTeams(computeLines(['a', 'b'], results), results)
    expect(rk.order).toEqual(['a', 'b'])
    expect(rk.tieNotes[0].resolvedBy).toBe('runDiff')
  })

  it('falls through to runs allowed, then coin flip, when everything is level', () => {
    const results = [g('a', 'b', 3, 3)]   // tie game, identical everything
    const rk = rankTeams(computeLines(['a', 'b'], results), results)
    expect(rk.tieNotes[0].resolvedBy).toBe('coinFlip')
    const results2 = [g('a', 'c', 2, 0), g('b', 'd', 2, 1)]   // a,b both 1-0 with +2/+1 diff → runDiff separates
    expect(rankTeams(computeLines(['a', 'b', 'c', 'd'], results2), results2).order.slice(0, 2)).toEqual(['a', 'b'])
    const results3 = [g('a', 'c', 2, 0), g('b', 'd', 3, 1)]   // both +2; a allowed 0, b allowed 1 → runsAllowed
    const rk3 = rankTeams(computeLines(['a', 'b', 'c', 'd'], results3), results3)
    expect(rk3.order.slice(0, 2)).toEqual(['a', 'b'])
    expect(rk3.tieNotes.find(n => n.teamIds.includes('a'))?.resolvedBy).toBe('runsAllowed')
  })

  it('handles a three-way tie by splitting on head-to-head then restarting', () => {
    // a beat b and c; b beat c; c beat nobody among the group — but all 2-1 overall via game vs d
    const results = [
      g('a', 'b', 1, 0), g('a', 'c', 1, 0), g('b', 'c', 1, 0),
      g('d', 'a', 1, 0), g('d', 'b', 0, 1), g('d', 'c', 0, 1),   // a loses to d, b and c beat d
      g('d', 'x', 0, 1),
    ]
    // a 2-1, b 2-1, c 1-2 → only a,b tied; make c 2-1 by beating x
    const r = results.concat([g('c', 'x', 1, 0), g('x', 'd', 0, 1)])
    const rk = rankTeams(computeLines(['a', 'b', 'c', 'd', 'x'], r), r)
    expect(rk.order.slice(0, 3)).toEqual(['a', 'b', 'c'])
  })
})

// ── Real fixture: every finalized 2026 game as of Sep 10 + the real remaining slate ──

import fx from './fixtures/season-2026-09-10.json'

const T = {
  NS: 'nuke_squad', TP: 'trash_pandas', BI: 'base_invaders', SM: 'swing_mafia',
  WW: 'wiffle_whalers', GC: 'gamecocks', MK: 'moose_knucklers', YBY: 'yellow_bat_yetis',
}

describe('buildPlayoffPicture on the real 2026 season (exact enumeration)', () => {
  const picture = buildPlayoffPicture(fx.teams, fx.results, fx.schedule as ScheduledGame[])
  const by = Object.fromEntries(picture.teams.map(t => [t.teamId, t]))

  it('reproduces the published standings', () => {
    expect(picture.order).toEqual([T.NS, T.TP, T.BI, T.SM, T.WW, T.GC, T.MK, T.YBY])
    expect(by[T.NS].line).toMatchObject({ w: 10, l: 1 })
    expect(by[T.TP].line).toMatchObject({ w: 9, l: 2 })
    expect(by[T.BI].line).toMatchObject({ w: 6, l: 4, gp: 10 })
    expect(by[T.SM].line).toMatchObject({ w: 6, l: 5 })
    expect(by[T.WW].line).toMatchObject({ w: 5, l: 6 })
    expect(by[T.GC].line).toMatchObject({ w: 4, l: 7 })
    expect(by[T.MK].line).toMatchObject({ w: 2, l: 9 })
    expect(by[T.YBY].line).toMatchObject({ w: 2, l: 10, gp: 12 })
    expect(by[T.NS].line.rf - by[T.NS].line.ra).toBe(93)   // matches the site's DIFF column
  })

  it('counts the postponed makeup as a real remaining game: 12 games → 2^12 outcomes', () => {
    expect(picture.exact).toBe(true)
    expect(picture.outcomesEvaluated).toBe(4096)
    expect(picture.remainingGames).toHaveLength(12)
    expect(picture.postponedGames).toHaveLength(1)
    expect(picture.postponedGames[0]).toMatchObject({ awayTeamId: T.BI, homeTeamId: T.GC, date: '2026-05-09' })
    // Makeups sort last in the still-to-play list
    expect(picture.remainingGames[11].status).toBe('postponed')
    expect(by[T.GC].remaining).toBe(3)
    expect(by[T.BI].remaining).toBe(4)
    expect(by[T.YBY].remaining).toBe(2)
    expect(by[T.NS].remaining).toBe(3)
  })

  it('top five have clinched a spot; nobody has a bye locked yet (Base Invaders can reach 10-4)', () => {
    for (const id of [T.NS, T.TP, T.BI, T.SM, T.WW]) {
      expect(by[id].clinchedPlayoff, id).toBe(true)
      expect(by[id].playoffOdds, id).toBe(1)
    }
    expect(by[T.NS].status).toBe('clinched')
    expect(by[T.NS].clinchedBye).toBe(false)
    expect(by[T.NS].winsToBye).toBe(1)
    expect(by[T.NS].bestSeed).toBe(1)
    expect(by[T.NS].worstSeed).toBe(3)
    expect(outlookLine(by[T.NS])).toBe('Clinches bye with 1 more win')
  })

  it('Trash Pandas clinch a bye with one more win', () => {
    expect(by[T.TP].status).toBe('clinched')
    expect(by[T.TP].winsToBye).toBe(1)
    expect(by[T.TP].bestSeed).toBe(1)
    expect(by[T.TP].worstSeed).toBe(3)
  })

  it('Base Invaders can still steal a bye only with help', () => {
    expect(by[T.BI].byeAlive).toBe(true)
    expect(by[T.BI].winsToBye).toBeNull()
    expect(by[T.BI].worstSeed).toBe(6)
    expect(by[T.SM].byeAlive).toBe(false)
    expect(by[T.WW].byeAlive).toBe(false)
  })

  it('Whalers are in: nobody below can pass them on the tiebreaks', () => {
    expect(by[T.WW].status).toBe('clinched')
    expect(by[T.WW].worstSeed).toBe(6)
  })

  it('Gamecocks control their destiny: one win clinches, only losing out (incl. the makeup) opens the door', () => {
    expect(by[T.GC].status).toBe('alive')
    expect(by[T.GC].winsToClinch).toBe(1)
    expect(by[T.GC].lossesToElimination).toBeNull()      // even 0-3 they can survive if nobody passes them
    expect(by[T.GC].playoffOdds).toBeCloseTo(3904 / 4096)   // 95.3%
    expect(by[T.GC].bestSeed).toBe(4)
    expect(by[T.GC].worstSeed).toBe(7)
    expect(outlookLine(by[T.GC])).toBe('Clinches with 1 more win')
  })

  it('Yetis are alive via the run-differential tiebreak (h2h with Gamecocks is 1-1): win out + Gamecocks lose out', () => {
    expect(by[T.YBY].status).toBe('alive')
    expect(by[T.YBY].eliminated).toBe(false)
    expect(by[T.YBY].playoffOdds).toBeCloseTo(128 / 4096)   // 3.1%: 5 fixed results of 12
    expect(by[T.YBY].bestSeed).toBe(6)
    expect(by[T.YBY].lossesToElimination).toBe(1)
    expect(outlookLine(by[T.YBY])).toBe('Eliminated with next loss')
  })

  it('Moose Knucklers must win out (incl. beating the Yetis) and have Gamecocks lose all three', () => {
    expect(by[T.MK].status).toBe('alive')
    expect(by[T.MK].playoffOdds).toBeCloseTo(64 / 4096)     // 1.6%: 6 fixed results of 12
    expect(by[T.MK].winsToClinch).toBeNull()
    expect(by[T.MK].lossesToElimination).toBe(1)
    expect(by[T.MK].bestSeed).toBe(6)
    expect(statusTag(by[T.MK])).toBeNull()
    expect(statusTag(by[T.GC])).toBeNull()
  })

  it('if the league formally cancelled the makeup (countPostponed=false) the Yetis would be eliminated', () => {
    const cancelled = buildPlayoffPicture(fx.teams, fx.results, fx.schedule as ScheduledGame[], { ...DEFAULT_PLAYOFF_CONFIG, countPostponed: false })
    const yby = cancelled.teams.find(t => t.teamId === T.YBY)!
    const ns = cancelled.teams.find(t => t.teamId === T.NS)!
    expect(cancelled.outcomesEvaluated).toBe(2048)
    expect(cancelled.remainingGames).toHaveLength(11)
    expect(yby.status).toBe('eliminated')
    expect(statusTag(yby)).toEqual({ text: 'Eliminated', tone: 'red' })
    expect(ns.status).toBe('clinched-bye')
    expect(statusTag(ns)).toEqual({ text: 'Clinched bye', tone: 'gold' })
  })

  it('seed ranges bracket the current seed', () => {
    for (const t of picture.teams) {
      expect(t.bestSeed).toBeLessThanOrEqual(t.seed)
      expect(t.worstSeed).toBeGreaterThanOrEqual(t.seed)
    }
  })

})

describe('buildPlayoffPicture edge cases', () => {
  it('no games played: nobody clinched or eliminated, everyone alive', () => {
    const slate = [s('1', 'a', 'b'), s('2', 'c', 'd')]
    const p = buildPlayoffPicture(['a', 'b', 'c', 'd'], [], slate, { spots: 2, byes: 1, tiebreakers: ['runDiff'], countPostponed: true })
    expect(p.teams.every(t => t.status === 'alive')).toBe(true)
    expect(p.outcomesEvaluated).toBe(4)
  })

  it('season over: statuses are final and odds are 0 or 1', () => {
    const results = [g('a', 'b', 1, 0), g('c', 'd', 1, 0), g('a', 'c', 1, 0), g('b', 'd', 1, 0)]
    const p = buildPlayoffPicture(['a', 'b', 'c', 'd'], results, [], { spots: 2, byes: 1, tiebreakers: ['runDiff'], countPostponed: true })
    expect(p.outcomesEvaluated).toBe(1)
    expect(p.order[0]).toBe('a')
    expect(p.teams.map(t => t.playoffOdds)).toEqual([1, 1, 0, 0])
    expect(p.teams[0].status).toBe('clinched-top')
    expect(p.teams[2].status).toBe('eliminated')
  })

  it('falls back to bounds (never over-claims) when too many games remain', () => {
    const many: ScheduledGame[] = Array.from({ length: 20 }, (_, i) => s(String(i), i % 2 ? 'a' : 'b', i % 2 ? 'c' : 'd'))
    const p = buildPlayoffPicture(['a', 'b', 'c', 'd'], [g('a', 'b', 1, 0)], many, { spots: 2, byes: 1, tiebreakers: ['runDiff'], countPostponed: true })
    expect(p.exact).toBe(false)
    expect(p.outcomesEvaluated).toBe(0)
    expect(p.teams.every(t => t.playoffOdds === null)).toBe(true)
    expect(p.teams.every(t => t.status === 'alive')).toBe(true)
  })

  it('ignores scheduled games involving unknown teams', () => {
    const p = buildPlayoffPicture(['a', 'b'], [g('a', 'b', 1, 0)], [s('x', 'a', 'ghost')], { spots: 1, byes: 0, tiebreakers: ['runDiff'], countPostponed: true })
    expect(p.remainingGames).toHaveLength(0)
    expect(p.teams[0].status).toBe('clinched-top')
  })
})

describe('bracket', () => {
  it('projects byes for seeds 1-2 and 3v6 / 4v5 quarterfinals', () => {
    const b = projectBracket(DEFAULT_PLAYOFF_CONFIG)
    expect(b.byes).toEqual([1, 2])
    expect(b.quarterfinals).toEqual([
      { label: 'QF1', highSeed: 3, lowSeed: 6 },
      { label: 'QF2', highSeed: 4, lowSeed: 5 },
    ])
  })

  it('reseeds the semifinals so the 1 seed gets the lowest survivor', () => {
    expect(reseedSemifinals([1, 2], [3, 5])).toEqual([
      { label: 'SF1', highSeed: 1, lowSeed: 5 },
      { label: 'SF2', highSeed: 2, lowSeed: 3 },
    ])
    // 6 upsets 3 → the 1 seed draws the 6, not the QF2 winner
    expect(reseedSemifinals([1, 2], [6, 4])).toEqual([
      { label: 'SF1', highSeed: 1, lowSeed: 6 },
      { label: 'SF2', highSeed: 2, lowSeed: 4 },
    ])
  })
})

describe('dedupeSchedule', () => {
  it('removes scheduled games that already have a result on the same date and matchup', () => {
    const schedule = [s('1', 'a', 'b'), { ...s('2', 'c', 'd'), date: '2026-09-21' }]
    const results = [{ ...g('a', 'b', 3, 1), date: '2026-09-20' }]
    expect(dedupeSchedule(schedule, results).map(x => x.id)).toEqual(['2'])
  })

  it('keeps a rematch on a different date', () => {
    const schedule = [{ ...s('1', 'a', 'b'), date: '2026-09-27' }]
    const results = [{ ...g('a', 'b', 3, 1), date: '2026-09-20' }]
    expect(dedupeSchedule(schedule, results)).toHaveLength(1)
  })
})
