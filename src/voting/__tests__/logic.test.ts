import { describe, it, expect } from 'vitest'
import type { AwardsMap, BallotsMap, PlayersMap, TeamsMap, VotersMap } from '../../types'
import {
  voteLink, sortedAwards, rosterPlayerIds, ballotTeamIds, optionsForAward, cleanPicks,
  buildBallotUpdates, linksByPlayer, newVoterUpdates, linksCsv, inviteMessage,
  turnoutByTeam, tallyAward, revealTopRows,
  VOTING_DEADLINE_2026, votingAccepting, formatDeadline, easternLocalToEpoch, epochToEasternLocal, reissueAllUpdates,
} from '../logic'

const PLAYERS = {
  alice: { name: 'Alice A', teamId: 'red', stats: {} },
  bob:   { name: 'Bob B',   teamId: 'red', stats: {} },
  cara:  { name: 'Cara C',  teamId: 'blue', stats: {} },
  sub_1: { name: 'Sub S',   teamId: 'blue', stats: {}, isSub: true },
  stale: { teamId: 'blue', stats: {} },
} as unknown as PlayersMap

const TEAMS: TeamsMap = {
  red:        { name: 'Red', shortName: 'RD', primaryColor: '', secondaryColor: '', logoUrl: '/r.svg' },
  blue:       { name: 'Blue', shortName: 'BL', primaryColor: '', secondaryColor: '', logoUrl: '/b.svg' },
  stars:      { name: 'Stars', shortName: 'ST', primaryColor: '', secondaryColor: '', logoUrl: '', isExhibition: true },
  team_rist:  { name: 'Team Risty', shortName: 'TR', primaryColor: '', secondaryColor: '', logoUrl: '' },
}

const AWARDS: AwardsMap = {
  team:   { name: 'Best Team', kind: 'team', order: 2 },
  mvp:    { name: 'MVP', kind: 'player', order: 1 },
  rookie: { name: 'Rookie', kind: 'player', order: 3, candidates: { cara: true, bob: true } },
}

describe('voteLink', () => {
  it('puts the token in the path on www (the bare-domain redirect drops query strings)', () => {
    expect(voteLink('abc-123')).toBe('https://www.ogoley.com/vote/abc-123')
  })
})

describe('sortedAwards', () => {
  it('orders by order, then name, and drops nameless nodes', () => {
    const awards = { ...AWARDS, junk: {} } as unknown as AwardsMap
    expect(sortedAwards(awards).map(a => a.id)).toEqual(['mvp', 'team', 'rookie'])
  })
})

describe('pools', () => {
  it('roster = named non-sub players, alphabetical', () => {
    expect(rosterPlayerIds(PLAYERS)).toEqual(['alice', 'bob', 'cara'])
  })

  it('excluded players leave the voter pool, the ballot, cleanPicks and turnout', () => {
    const excluded = { bob: true as const }
    expect(rosterPlayerIds(PLAYERS, excluded)).toEqual(['alice', 'cara'])
    expect(optionsForAward(AWARDS.mvp, PLAYERS, TEAMS, 'alice', excluded).map(o => o.id)).toEqual(['cara'])
    expect(cleanPicks({ mvp: 'bob' }, AWARDS, PLAYERS, TEAMS, 'alice', excluded)).toEqual({})
    const red = turnoutByTeam(PLAYERS, TEAMS, {}, {}, excluded).find(t => t.teamId === 'red')!
    expect([red.total, red.players.map(p => p.playerId)]).toEqual([1, ['alice']])
  })

  it('team ballot excludes exhibition teams (flagged or legacy all-star ids)', () => {
    expect(ballotTeamIds(TEAMS)).toEqual(['blue', 'red'])
  })
})

describe('optionsForAward', () => {
  it('player award: everyone but the voter', () => {
    expect(optionsForAward(AWARDS.mvp, PLAYERS, TEAMS, 'alice').map(o => o.id)).toEqual(['bob', 'cara'])
  })

  it('player award carries team name + logo (dropdown) and team id (browse by team)', () => {
    expect(optionsForAward(AWARDS.mvp, PLAYERS, TEAMS, null)[0]).toEqual({ id: 'alice', name: 'Alice A', sub: 'Red', logo: '/r.svg', teamId: 'red' })
  })

  it('browse-by-team groups only eligible players: finalists, minus the voter', () => {
    const teamsShown = new Set(optionsForAward(AWARDS.rookie, PLAYERS, TEAMS, 'bob').map(o => o.teamId))
    expect([...teamsShown]).toEqual(['blue'])
  })

  it('restricted award: only candidates, still minus the voter', () => {
    expect(optionsForAward(AWARDS.rookie, PLAYERS, TEAMS, 'bob').map(o => o.id)).toEqual(['cara'])
  })

  it("team award: every league team but the voter's own", () => {
    expect(optionsForAward(AWARDS.team, PLAYERS, TEAMS, 'alice').map(o => o.id)).toEqual(['blue'])
    expect(optionsForAward(AWARDS.team, PLAYERS, TEAMS, null).map(o => o.id)).toEqual(['blue', 'red'])
  })
})

describe('cleanPicks', () => {
  it('keeps valid picks and drops blanks, unknown awards, self-votes and off-list picks', () => {
    const picks = { mvp: 'alice', team: 'blue', rookie: 'alice', gone: 'cara', blank: '' }
    expect(cleanPicks(picks, AWARDS, PLAYERS, TEAMS, 'alice')).toEqual({ team: 'blue' })
    expect(cleanPicks({ mvp: 'cara', rookie: 'bob' }, AWARDS, PLAYERS, TEAMS, 'alice')).toEqual({ mvp: 'cara', rookie: 'bob' })
  })
})

describe('buildBallotUpdates', () => {
  it('writes the ballot under the player and stamps the link in one update', () => {
    expect(buildBallotUpdates('tok', 'alice', { mvp: 'cara' }, 'TS')).toEqual({
      'voting/ballots/alice': { token: 'tok', picks: { mvp: 'cara' }, submittedAt: 'TS' },
      'voting/voters/tok/votedAt': 'TS',
    })
  })
})

describe('links', () => {
  it('maps players to their newest token', () => {
    const voters: VotersMap = {
      old: { playerId: 'alice', createdAt: 1 },
      new: { playerId: 'alice', createdAt: 5, votedAt: 9 },
      b:   { playerId: 'bob', createdAt: 2 },
    }
    const links = linksByPlayer(voters)
    expect(links.get('alice')).toEqual({ token: 'new', createdAt: 5, votedAt: 9 })
    expect(links.get('bob')?.token).toBe('b')
  })

  it('newVoterUpdates mints one token per player', () => {
    let n = 0
    expect(newVoterUpdates(['alice', 'bob'], () => `t${++n}`, 100)).toEqual({
      'voting/voters/t1': { playerId: 'alice', createdAt: 100 },
      'voting/voters/t2': { playerId: 'bob', createdAt: 100 },
    })
  })

  it('invite message: first name, the link on its own line, the deadline, and the nudge to vote', () => {
    const msg = inviteMessage('Adam Sapowsky', 'https://x/vote/t', '2026 Season Awards', VOTING_DEADLINE_2026)
    expect(msg.startsWith('Hey Adam! 🏆 2026 Season Awards voting is open.')).toBe(true)
    expect(msg.split('\n')).toContain('https://x/vote/t')
    expect(msg).toContain('Voting closes Sunday, Oct 18 at 11:00 AM ET')
    expect(msg).toContain('strongly encourage')
    expect(inviteMessage('Adam Sapowsky', 'https://x/vote/t')).not.toContain('closes')
  })

  it('csv quotes cells with commas/quotes', () => {
    const csv = linksCsv([{ team: 'Red', name: 'Alice "Ace" A', playerId: 'alice', link: 'L', voted: true, message: 'a, b' }])
    expect(csv).toBe('team,name,playerId,link,voted,message\nRed,"Alice ""Ace"" A",alice,L,yes,"a, b"\n')
  })
})

describe('turnoutByTeam', () => {
  it('counts ballots per team over the roster (subs/stale excluded)', () => {
    const voters: VotersMap = { t1: { playerId: 'alice', createdAt: 1 } }
    const ballots = { alice: { token: 't1', picks: { mvp: 'cara' }, submittedAt: 1 } } as BallotsMap
    const rows = turnoutByTeam(PLAYERS, TEAMS, voters, ballots)
    expect(rows.map(r => [r.teamId, r.voted, r.total])).toEqual([['blue', 0, 1], ['red', 1, 2]])
    expect(rows[1].players).toEqual([
      { playerId: 'alice', name: 'Alice A', voted: true, hasLink: true },
      { playerId: 'bob', name: 'Bob B', voted: false, hasLink: false },
    ])
  })
})

describe('tallyAward', () => {
  it('counts picks, ranks with ties sharing a rank, and reports ballots counted', () => {
    const ballots = {
      a: { token: '', picks: { mvp: 'cara', team: 'red' }, submittedAt: 1 },
      b: { token: '', picks: { mvp: 'cara' }, submittedAt: 1 },
      c: { token: '', picks: { mvp: 'bob' }, submittedAt: 1 },
      d: { token: '', picks: { mvp: 'alice' }, submittedAt: 1 },
      e: { token: '', picks: { team: 'blue' }, submittedAt: 1 },
    } as BallotsMap
    expect(tallyAward('mvp', ballots)).toEqual({
      counted: 4,
      rows: [
        { id: 'cara', votes: 2, rank: 1 },
        { id: 'alice', votes: 1, rank: 2 },
        { id: 'bob', votes: 1, rank: 2 },
      ],
    })
    expect(tallyAward('rookie', ballots)).toEqual({ counted: 0, rows: [] })
  })
})

describe('voting deadline', () => {
  it('2026 deadline is Sun Oct 18, 11:00 AM Eastern (15:00 UTC, daylight time)', () => {
    expect(new Date(VOTING_DEADLINE_2026).toISOString()).toBe('2026-10-18T15:00:00.000Z')
    expect(formatDeadline(VOTING_DEADLINE_2026)).toBe('Sunday, Oct 18 at 11:00 AM ET')
  })

  it('accepts only while open AND before the deadline', () => {
    const t = VOTING_DEADLINE_2026
    expect(votingAccepting({ open: true, closesAt: t }, t - 1)).toBe(true)
    expect(votingAccepting({ open: true, closesAt: t }, t)).toBe(false)
    expect(votingAccepting({ open: false, closesAt: t }, t - 1)).toBe(false)
    expect(votingAccepting({ open: true }, t + 1e9)).toBe(true)
    expect(votingAccepting(null, 0)).toBe(false)
  })

  it('round-trips Eastern wall-clock times through datetime-local values (EDT and EST)', () => {
    expect(easternLocalToEpoch('2026-10-18T11:00')).toBe(VOTING_DEADLINE_2026)
    expect(epochToEasternLocal(VOTING_DEADLINE_2026)).toBe('2026-10-18T11:00')
    expect(easternLocalToEpoch('2026-12-01T09:30')).toBe(Date.parse('2026-12-01T14:30:00Z'))
    expect(easternLocalToEpoch('nope')).toBeNull()
  })
})

describe('reissueAllUpdates', () => {
  it('deletes every old link for the players and mints one fresh link each, keeping voted status', () => {
    let n = 0
    const u = reissueAllUpdates(
      { old1: { playerId: 'alice', createdAt: 1 }, old2: { playerId: 'alice', createdAt: 2 }, old3: { playerId: 'bob', createdAt: 1 }, keep: { playerId: 'gone', createdAt: 1 } },
      ['alice', 'bob'],
      { bob: { submittedAt: 99 } },
      () => `new${++n}`,
      500,
    )
    expect(u['voting/voters/old1']).toBeNull()
    expect(u['voting/voters/old2']).toBeNull()
    expect(u['voting/voters/old3']).toBeNull()
    expect(u).not.toHaveProperty('voting/voters/keep')
    expect(u['voting/voters/new1']).toEqual({ playerId: 'alice', createdAt: 500 })
    expect(u['voting/voters/new2']).toEqual({ playerId: 'bob', createdAt: 500, votedAt: 99 })
  })
})

describe('revealTopRows', () => {
  it('top 3 ranks with names + team ids; a tie for a place keeps both', () => {
    const ballots = {
      a: { token: '', picks: { mvp: 'cara' }, submittedAt: 1 },
      b: { token: '', picks: { mvp: 'cara' }, submittedAt: 1 },
      c: { token: '', picks: { mvp: 'bob' }, submittedAt: 1 },
      d: { token: '', picks: { mvp: 'alice', team: 'red' }, submittedAt: 1 },
    } as BallotsMap
    expect(revealTopRows({ id: 'mvp', kind: 'player' }, ballots, PLAYERS, TEAMS)).toEqual({
      counted: 4,
      top: [
        { id: 'cara', name: 'Cara C', teamId: 'blue', votes: 2, rank: 1 },
        { id: 'alice', name: 'Alice A', teamId: 'red', votes: 1, rank: 2 },
        { id: 'bob', name: 'Bob B', teamId: 'red', votes: 1, rank: 2 },
      ],
    })
    expect(revealTopRows({ id: 'team', kind: 'team' }, ballots, PLAYERS, TEAMS).top).toEqual([{ id: 'red', name: 'Red', teamId: 'red', votes: 1, rank: 1 }])
  })
})
