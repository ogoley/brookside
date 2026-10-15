import { describe, it, expect } from 'vitest'
import { resolveBracket, slotForMatchup, slotWhen, BRACKET_2026, type PostseasonGameEntry } from '../bracket'
import { computePostseasonFinalization } from '../finalize'
import { gameRoot, isPostseasonGameId } from '../paths'
import type { AtBatRecord, GameRecord, PlayersMap } from '../../types'

function game(home: string, away: string, homeScore: number, awayScore: number, extra: Partial<GameRecord> = {}): GameRecord {
  return {
    homeTeamId: home, awayTeamId: away, date: '2026-10-15', isStreamed: false,
    finalized: true, startedAt: 1, inning: 7, isTopInning: false, outs: 3,
    homeScore, awayScore, ...extra,
  }
}

const entry = (gameId: string, g: GameRecord): PostseasonGameEntry => ({ gameId, game: g })

describe('paths', () => {
  it('routes po_ games to /postseason, everything else to the root', () => {
    expect(isPostseasonGameId('po_2026-10-15_base_invaders_yellow_bat_yetis')).toBe(true)
    expect(gameRoot('po_x')).toBe('postseason/')
    expect(gameRoot('2026-09-27_trash_pandas_wiffle_whalers')).toBe('')
    expect(gameRoot(null)).toBe('')
  })
})

describe('resolveBracket — fixed bracket, no reseeding', () => {
  it('starts with the quarterfinals: 3 hosts 6, 4 hosts 5, semis waiting', () => {
    const b = resolveBracket(BRACKET_2026, [])
    expect(b.currentRound).toBe('qf')
    expect(b.slots.qf36.home?.teamId).toBe('base_invaders')
    expect(b.slots.qf36.away?.teamId).toBe('yellow_bat_yetis')
    expect(b.slots.qf45.home?.teamId).toBe('wiffle_whalers')
    expect(b.slots.qf45.away?.teamId).toBe('swing_mafia')
    expect(b.slots.sf1.high?.teamId).toBe('nuke_squad')
    expect(b.slots.sf1.low).toBeNull()
    expect(b.slots.sf1.status).toBe('waiting')
    expect(b.slots.qf36.status).toBe('scheduled')
  })

  it('upsets do NOT reseed: 6 winning still plays the 2 seed, 4 plays the 1 seed', () => {
    // With reseeding the 1 seed would host the 6; the league's fixed bracket keeps 2 v 3/6.
    const b = resolveBracket(BRACKET_2026, [
      entry('po_a', game('base_invaders', 'yellow_bat_yetis', 3, 5)),
      entry('po_b', game('wiffle_whalers', 'swing_mafia', 8, 2)),
    ])
    expect(b.currentRound).toBe('sf')
    expect(b.slots.sf2.home?.teamId).toBe('trash_pandas')
    expect(b.slots.sf2.away).toEqual({ teamId: 'yellow_bat_yetis', seed: 6 })
    expect(b.slots.sf1.home?.teamId).toBe('nuke_squad')
    expect(b.slots.sf1.away).toEqual({ teamId: 'wiffle_whalers', seed: 4 })
  })

  it('the higher remaining seed hosts the final, and the final winner is champion', () => {
    const b = resolveBracket(BRACKET_2026, [
      entry('po_a', game('base_invaders', 'yellow_bat_yetis', 9, 5)),
      entry('po_b', game('wiffle_whalers', 'swing_mafia', 1, 2)),
      entry('po_c', game('nuke_squad', 'swing_mafia', 2, 4)),
      entry('po_d', game('trash_pandas', 'base_invaders', 6, 1)),
    ])
    expect(b.currentRound).toBe('final')
    expect(b.slots.final.home?.teamId).toBe('trash_pandas')   // 2 seed over 5 seed
    expect(b.slots.final.away?.teamId).toBe('swing_mafia')
    expect(b.champion).toBeNull()

    const done = resolveBracket(BRACKET_2026, [
      entry('po_a', game('base_invaders', 'yellow_bat_yetis', 9, 5)),
      entry('po_b', game('wiffle_whalers', 'swing_mafia', 1, 2)),
      entry('po_c', game('nuke_squad', 'swing_mafia', 2, 4)),
      entry('po_d', game('trash_pandas', 'base_invaders', 6, 1)),
      entry('po_e', game('trash_pandas', 'swing_mafia', 3, 7)),
    ])
    expect(done.champion?.teamId).toBe('swing_mafia')
  })

  it('a live (unfinalized) game marks the slot live without picking a winner', () => {
    const b = resolveBracket(BRACKET_2026, [entry('po_a', game('base_invaders', 'yellow_bat_yetis', 2, 1, { finalized: false }))])
    expect(b.slots.qf36.status).toBe('live')
    expect(b.slots.qf36.winner).toBeNull()
    expect(b.slots.qf36.gameId).toBe('po_a')
  })

  it('a producer override beats the game result and advances the team', () => {
    const b = resolveBracket(
      { ...BRACKET_2026, slots: { ...BRACKET_2026.slots, qf36: { ...BRACKET_2026.slots!.qf36, winnerOverride: 'yellow_bat_yetis' } } },
      [entry('po_a', game('base_invaders', 'yellow_bat_yetis', 9, 1))],
    )
    expect(b.slots.qf36.winner?.teamId).toBe('yellow_bat_yetis')
    expect(b.slots.qf36.overridden).toBe(true)
    expect(b.slots.sf2.away?.teamId).toBe('yellow_bat_yetis')
  })

  it('ignores playoff games from other seasons', () => {
    const b = resolveBracket(BRACKET_2026, [entry('po_old', game('base_invaders', 'yellow_bat_yetis', 1, 9, { date: '2025-10-15' }))])
    expect(b.slots.qf36.winner).toBeNull()
  })

  it('slotForMatchup finds the open slot regardless of home/away order', () => {
    const b = resolveBracket(BRACKET_2026, [])
    expect(slotForMatchup(b, 'yellow_bat_yetis', 'base_invaders')?.id).toBe('qf36')
    expect(slotForMatchup(b, 'nuke_squad', 'trash_pandas')).toBeNull()
  })

  it('formats the schedule line', () => {
    expect(slotWhen(BRACKET_2026.slots!.qf36!)).toBe('Thu, Oct 15 · 4:30 PM · Bittersweet Park')
    expect(slotWhen(BRACKET_2026.slots!.qf45!)).toBe('Fri, Oct 16 · 9:00 PM · Soccer City Park')
  })
})

describe('computePostseasonFinalization', () => {
  const players: PlayersMap = {
    b1: { name: 'Batter One', teamId: 'away', stats: { hitting: { ab: 50, h: 20 } } },
    p_home: { name: 'Pitcher Home', teamId: 'home', stats: {} },
    p_away: { name: 'Pitcher Away', teamId: 'away', stats: {} },
  }
  const ab = (batterId: string, result: AtBatRecord['result'], batterAdvancedTo: AtBatRecord['batterAdvancedTo'], outsOnPlay = 0): AtBatRecord => ({
    batterId, pitcherId: 'p_home', isSub: false, inning: 1, isTopInning: true, timestamp: 1,
    runnersOnBase: { first: null, second: null, third: null }, runnerOutcomes: {}, runnersScored: [],
    outsOnPlay, rbiCount: batterAdvancedTo === 'home' ? 1 : 0, result, batterAdvancedTo,
  })

  const run = () => computePostseasonFinalization({
    gameId: 'po_2026-10-18_home_away',
    game: game('home', 'away', 0, 1, { finalized: false, date: '2026-10-18' }),
    currentGameAtBats: [ab('b1', 'home_run', 'home'), ab('b1', 'strikeout', 'out', 1)],
    previousAtBats: [
      { ...ab('b1', 'single', 'first'), gameId: 'po_2026-10-15_home_away' },
      { ...ab('b1', 'double', 'second'), gameId: 'po_2025-10-12_home_away' },
    ],
    previousGames: {
      'po_2026-10-15_home_away': game('home', 'away', 1, 0, { date: '2026-10-15' }),
      'po_2025-10-12_home_away': game('home', 'away', 1, 0, { date: '2025-10-12' }),
    },
    players,
    season: 2026,
  })

  it('never writes a regular-season path', () => {
    for (const path of Object.keys(run().updates)) expect(path.startsWith('postseason/')).toBe(true)
  })

  it('writes lifetime totals across seasons and a per-season split', () => {
    const u = run().updates as Record<string, { h?: number; ab?: number; hr?: number; gp?: number }>
    expect(u['postseason/players/b1/stats/hitting']).toMatchObject({ ab: 4, h: 3, hr: 1, gp: 3 })
    expect(u['postseason/players/b1/seasons/2026/hitting']).toMatchObject({ ab: 3, h: 2, hr: 1, gp: 2 })
    expect(u['postseason/players/b1/name']).toBe('Batter One')
    expect(u['postseason/players/b1/seasons/2026/teamId']).toBe('away')
  })

  it('finalizes the playoff game record and box score under /postseason', () => {
    const u = run().updates
    expect(u['postseason/games/po_2026-10-18_home_away/finalized']).toBe(true)
    expect(u['postseason/games/po_2026-10-18_home_away/awayScore']).toBe(1)
    expect(u['postseason/gameSummaries/po_2026-10-18_home_away/b1']).toBeTruthy()
  })
})
