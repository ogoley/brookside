import { describe, it, expect } from 'vitest'
import type { GameRecord, Player, PlayersMap, TeamsMap, TickerState } from '../../types'
import {
  shortName, shortDate, readableOn, crawlDurationSec,
  standingsItems, battingItems, homeRunItems, pitchingItems, resultsItems,
  sponsorItems, messageItems, buildTickerSections, SECTION_ORDER,
  type TickerSources,
} from '../items'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const teams: TeamsMap = {
  swing_mafia: { name: 'Swing Mafia', shortName: 'SM', primaryColor: '#1c7d23', secondaryColor: '#fff', logoUrl: '/sm.png' },
  gamecocks: { name: 'Gamecocks', shortName: 'GC', primaryColor: '#e11414', secondaryColor: '#fff', logoUrl: '' },
  trash_pandas: { name: 'Trash Pandas', shortName: 'TP', primaryColor: '#189ed8', secondaryColor: '#fff', logoUrl: '/tp.png' },
  team_rist: { name: 'Team Risty', shortName: 'RISTY', primaryColor: '#c8102e', secondaryColor: '#fff', logoUrl: '', isExhibition: true },
}

const hitter = (name: string, teamId: string, h: Player['stats']['hitting'], extra: Partial<Player> = {}): Player => ({
  name, teamId, stats: { hitting: h }, ...extra,
})
const pitcher = (name: string, teamId: string, p: Player['stats']['pitching']): Player => ({
  name, teamId, stats: { pitching: p },
})

// Standings say every team has played 10 games → min 20 AB, min 21 IP
const standings = [
  { teamId: 'swing_mafia', w: 8, l: 2, t: 0, streak: 'W3' },
  { teamId: 'gamecocks', w: 5, l: 4, t: 1, streak: 'L1' },
  { teamId: 'trash_pandas', w: 2, l: 8, t: 0, streak: '—' },
  { teamId: 'team_rist', w: 1, l: 0, t: 0, streak: 'W1' },
]

const players: PlayersMap = {
  spring: hitter('Jonathan Spring', 'swing_mafia', { ab: 40, avg: 0.512, ops: 1.4, hr: 9, rbi: 31 }),
  bishop: hitter('Al Bishop', 'gamecocks', { ab: 30, avg: 0.480, ops: 1.2, hr: 12, rbi: 28 }),
  witek: hitter('Jeff Witek', 'trash_pandas', { ab: 25, avg: 0.480, ops: 1.3, hr: 3, rbi: 10 }),
  short: hitter('Casey Edgar', 'gamecocks', { ab: 5, avg: 0.800, ops: 2.0, hr: 2, rbi: 4 }),          // under min AB
  sub: hitter('Ringer Guy', 'gamecocks', { ab: 50, avg: 0.900, ops: 3, hr: 20, rbi: 50 }, { isSub: true }), // sub → excluded
  noname: { name: '', teamId: 'gamecocks', stats: { hitting: { ab: 50, avg: 0.9, hr: 30 } } },      // stale node
  ace: pitcher('Rick Hastings', 'swing_mafia', { era: 1.85, k: 40, inningsPitched: 30 }),
  closer: pitcher('Jay Hayes', 'gamecocks', { era: 0.5, k: 5, inningsPitched: 4 }),                 // under min IP
  workhorse: pitcher('Gary Wright', 'trash_pandas', { era: 3.2, k: 22, inningsPitched: 28.2 }),
}

const game = (id: string, over: Partial<GameRecord>): { gameId: string; game: GameRecord } => ({
  gameId: id,
  game: {
    homeTeamId: 'swing_mafia', awayTeamId: 'gamecocks', date: '2026-08-28', isStreamed: false,
    finalized: true, startedAt: 1, inning: 7, isTopInning: false, outs: 3, homeScore: 6, awayScore: 5,
    ...over,
  },
})

const games = [
  game('g1', { date: '2026-08-28', homeScore: 6, awayScore: 5 }),
  game('g2', { date: '2026-08-21', homeTeamId: 'trash_pandas', awayTeamId: 'gamecocks', homeScore: 2, awayScore: 9 }),
  game('g3', { date: '2026-08-14', homeScore: 4, awayScore: 4 }),
  game('open', { date: '2026-09-11', finalized: false }),
  game('allstar', { date: '2026-09-05', homeTeamId: 'team_rist', isExhibition: true }),
]

const sponsors = {
  pafumis: { name: "Pafumi's on Main", logoUrl: '/p.svg', website: 'https://pafumis-on-main.webflow.io/', order: 2, enabled: true },
  pintus: { name: "Pintu's Indian Palace", logoUrl: '/pi.jpg', website: 'https://pintus.website/', tagline: 'Indian cuisine', order: 1, enabled: true, accentColor: '#f2a33a' },
  off: { name: 'Gone Co', logoUrl: '/g.png', order: 0, enabled: false },
}

const sources: TickerSources = { teams, players, standings, games, sponsors }

const allOn: TickerState = {
  visible: true, speed: 120, accentColor: '#fbbf24',
  sections: { standings: true, playoffs: true, batting: true, homeRuns: true, pitching: true, results: true, upcoming: true, sponsors: true, messages: true },
  messages: { '-b': 'Second message', '-a': 'First message', '-c': '   ' },
}

// ── Formatting helpers ───────────────────────────────────────────────────────

describe('shortName', () => {
  it('abbreviates to initial + surname(s)', () => {
    expect(shortName('Jonathan Spring')).toBe('J. Spring')
    expect(shortName('Mike  LaFleur Jr')).toBe('M. LaFleur Jr')
    expect(shortName('Madonna')).toBe('Madonna')
    expect(shortName('   ')).toBe('')
  })
})

describe('shortDate', () => {
  it('formats ISO dates without timezone shifts', () => {
    expect(shortDate('2026-08-28')).toBe('AUG 28')
    expect(shortDate('2026-01-05')).toBe('JAN 5')
    expect(shortDate('2026-13-05')).toBe('')
    expect(shortDate('garbage')).toBe('')
  })
})

describe('readableOn', () => {
  it('picks dark text on light accents and white on dark ones', () => {
    expect(readableOn('#fbbf24')).toBe('#080d18')
    expect(readableOn('#ffffff')).toBe('#080d18')
    expect(readableOn('#1e40af')).toBe('#ffffff')
    expect(readableOn('#000')).toBe('#ffffff')
    expect(readableOn('not-a-colour')).toBe('#ffffff')
  })
})

describe('crawlDurationSec', () => {
  it('is distance over speed with a 1s floor and a sane default speed', () => {
    expect(crawlDurationSec(1620, 2400, 120)).toBeCloseTo(33.5)
    expect(crawlDurationSec(0, 0, 120)).toBe(1)
    expect(crawlDurationSec(1200, 1200, 0)).toBeCloseTo(20)   // falls back to 120
    expect(crawlDurationSec(1200, 1200, Number.NaN)).toBeCloseTo(20)
  })
})

// ── Sections ─────────────────────────────────────────────────────────────────

describe('standingsItems', () => {
  it('lists teams in standings order with records, streaks and logos, skipping exhibition teams', () => {
    const items = standingsItems(sources)
    expect(items.map(i => i.text)).toEqual(['Swing Mafia', 'Gamecocks', 'Trash Pandas'])
    expect(items.map(i => i.lead)).toEqual(['1', '2', '3'])
    expect(items[0].value).toBe('8-2')
    expect(items[1].value).toBe('5-4-1')          // ties shown only when present
    expect(items[0].detail).toBe('W3')
    expect(items[2].detail).toBeUndefined()       // "—" streak suppressed
    expect(items[0].logoUrl).toBe('/sm.png')
    expect(items[1].logoUrl).toBeUndefined()      // empty logoUrl → no logo
    expect(items[0].color).toBe('#1c7d23')
  })
})

describe('battingItems', () => {
  it('applies the AB minimum, excludes subs/stale nodes, sorts AVG then OPS', () => {
    const items = battingItems(sources)
    expect(items.map(i => i.text)).toEqual(['J. Spring', 'J. Witek', 'A. Bishop'])
    expect(items[0].value).toBe('.512 AVG')
    expect(items[0].detail).toBe('9 HR · 31 RBI')
    expect(items[0].lead).toBe('1')
  })
})

describe('homeRunItems', () => {
  it('ranks by HR (no AB minimum) but still excludes subs and nameless nodes', () => {
    const items = homeRunItems(sources)
    expect(items.map(i => i.text)).toEqual(['A. Bishop', 'J. Spring', 'J. Witek', 'C. Edgar'])
    expect(items[0].value).toBe('12 HR')
    expect(items[0].detail).toBe('28 RBI · .480')
  })
})

describe('pitchingItems', () => {
  it('applies the IP minimum and sorts by ERA', () => {
    const items = pitchingItems(sources)
    expect(items.map(i => i.text)).toEqual(['R. Hastings', 'G. Wright'])
    expect(items[0].value).toBe('1.85 ERA')
    expect(items[0].detail).toBe('40 K · 30 IP')
    expect(items[1].detail).toBe('22 K · 28 IP')  // IP floored for display
  })
})

describe('resultsItems', () => {
  it('shows finalized regular-season games newest first, winner listed first', () => {
    const items = resultsItems(sources)
    expect(items.map(i => i.key)).toEqual(['rs-g1', 'rs-g2', 'rs-g3'])
    expect(items[0].lead).toBe('AUG 28')
    expect(items[0].text).toBe('Swing Mafia 6, Gamecocks 5')
    expect(items[0].value).toBe('FINAL')
    expect(items[0].logoUrl).toBe('/sm.png')
    // away team won g2 → listed first
    expect(items[1].text).toBe('Gamecocks 9, Trash Pandas 2')
    expect(items[1].color).toBe('#e11414')
  })

  it('labels ties and keeps away-then-home order for them', () => {
    const tie = resultsItems(sources)[2]
    expect(tie.value).toBe('TIE')
    expect(tie.text).toBe('Gamecocks 4, Swing Mafia 4')
  })

  it('never includes open games or exhibitions', () => {
    const keys = resultsItems(sources).map(i => i.key)
    expect(keys).not.toContain('rs-open')
    expect(keys).not.toContain('rs-allstar')
  })

  it('caps at six results', () => {
    const many = Array.from({ length: 10 }, (_, i) => game(`m${i}`, { date: `2026-07-${String(i + 1).padStart(2, '0')}` }))
    expect(resultsItems({ ...sources, games: many })).toHaveLength(6)
  })
})

describe('sponsorItems', () => {
  it('lists enabled sponsors in order with website and tagline', () => {
    const items = sponsorItems(sources)
    expect(items.map(i => i.text)).toEqual(["Pintu's Indian Palace", "Pafumi's on Main"])
    expect(items[0].lead).toBe('Presented by')
    expect(items[0].value).toBe('pintus.website')
    expect(items[0].detail).toBe('Indian cuisine')
    expect(items[0].color).toBe('#f2a33a')
    expect(items[1].detail).toBeUndefined()
  })
})

describe('messageItems', () => {
  it('orders by key, drops blanks, trims and caps length', () => {
    const items = messageItems({ ...allOn.messages, '-d': 'x'.repeat(200) })
    expect(items.map(i => i.text)).toEqual(['First message', 'Second message', 'x'.repeat(140)])
    expect(items[0].key).toBe('msg--a')
    expect(messageItems(undefined)).toEqual([])
  })
})

// ── Assembly ─────────────────────────────────────────────────────────────────

describe('buildTickerSections', () => {
  it('returns every enabled non-empty section in on-air order with labels', () => {
    // Without a picture/schedule the playoff + upcoming segments have no content and drop out
    const sections = buildTickerSections(sources, allOn)
    expect(sections.map(s => s.id)).toEqual(SECTION_ORDER.filter(id => id !== 'playoffs' && id !== 'upcoming'))
    expect(sections.map(s => s.label)).toEqual([
      'Standings', 'Batting Leaders', 'Home Run Leaders', 'Pitching Leaders', 'Recent Results', 'Our Sponsors', 'League Wire',
    ])
    for (const s of sections) expect(s.items.length).toBeGreaterThan(0)
  })

  it('honours the producer toggles', () => {
    const sections = buildTickerSections(sources, {
      ...allOn,
      sections: { ...allOn.sections, batting: false, pitching: false, results: false },
    })
    expect(sections.map(s => s.id)).toEqual(['standings', 'homeRuns', 'sponsors', 'messages'])
  })

  it('drops sections that have no content instead of showing a bare header', () => {
    const empty: TickerSources = { teams: {}, players: {}, standings: [], games: [], sponsors: {} }
    expect(buildTickerSections(empty, { ...allOn, messages: {} })).toEqual([])
    const msgOnly = buildTickerSections(empty, { ...allOn, messages: { k: 'Hello' } })
    expect(msgOnly.map(s => s.id)).toEqual(['messages'])
  })

  it('item keys are unique across the whole crawl', () => {
    const keys = buildTickerSections(sources, allOn).flatMap(s => s.items.map(i => i.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

// ── Playoff picture + upcoming segments ──────────────────────────────────────

import { buildPlayoffPicture } from '../../playoffs/engine'
import { playoffItems, upcomingItems } from '../items'

describe('playoffItems / upcomingItems', () => {
  const results = [
    { homeTeamId: 'swing_mafia', awayTeamId: 'gamecocks', homeScore: 5, awayScore: 2 },
    { homeTeamId: 'trash_pandas', awayTeamId: 'swing_mafia', homeScore: 1, awayScore: 3 },
    { homeTeamId: 'gamecocks', awayTeamId: 'trash_pandas', homeScore: 4, awayScore: 6 },
  ]
  const schedule = [
    { id: 'n1', date: '2026-09-12', time: '14:00', homeTeamId: 'swing_mafia', awayTeamId: 'trash_pandas', status: 'scheduled' as const, venue: 'Bittersweet Park' },
    { id: 'pp', date: '2026-05-09', time: '15:30', homeTeamId: 'gamecocks', awayTeamId: 'swing_mafia', status: 'postponed' as const },
  ]
  const picture = buildPlayoffPicture(['swing_mafia', 'gamecocks', 'trash_pandas'], results, schedule, { spots: 2, byes: 1, tiebreakers: ['headToHead', 'runDiff'], countPostponed: true })
  const src: TickerSources = { ...sources, schedule: picture.remainingGames, picture }

  it('lists every team in seed order with status, record and odds', () => {
    const items = playoffItems(src)
    expect(items.map(i => i.text)).toEqual(['Swing Mafia', 'Trash Pandas', 'Gamecocks'])
    expect(items.map(i => i.lead)).toEqual(['1', '2', '3'])
    expect(items[0].value).toMatch(/Clinched/)
    expect(items[0].detail).toBe('2-0 · IN')
    expect(items[2].value).toBe('Eliminated')
    expect(items[2].detail).toBe('0-2 · OUT')
    expect(items[0].logoUrl).toBe('/sm.png')
  })

  it('returns nothing without a picture', () => {
    expect(playoffItems({ ...sources, picture: null })).toEqual([])
    expect(playoffItems(sources)).toEqual([])
  })

  it('lists dated games soonest first with venue, then the makeup as date TBD', () => {
    const items = upcomingItems(src)
    expect(items).toHaveLength(2)
    expect(items[0].lead).toBe('Sat, Sep 12 · 2:00 PM')
    expect(items[0].text).toBe('Trash Pandas at Swing Mafia')
    expect(items[0].detail).toBe('Bittersweet Park')
    expect(items[0].logoUrl).toBe('/tp.png')
    expect(items[1].lead).toBe('Makeup · date TBD')
    expect(items[1].text).toBe('Swing Mafia at Gamecocks')
    expect(upcomingItems(sources)).toEqual([])
  })

  it('the assembled crawl includes the new segments in on-air order', () => {
    const ids = buildTickerSections(src, allOn).map(s => s.id)
    expect(ids.indexOf('playoffs')).toBe(ids.indexOf('standings') + 1)
    expect(ids).toContain('upcoming')
    expect(ids.indexOf('upcoming')).toBeGreaterThan(ids.indexOf('results'))
    expect(ids.indexOf('upcoming')).toBeLessThan(ids.indexOf('sponsors'))
  })
})
