/// <reference types="node" />
// Security-rules tests for /voting against the RTDB emulator. Skipped in the
// normal `npm test` run; `npm run test:rules` boots the emulator (with
// database.rules.json) and runs this file. Uses a demo- project, so nothing
// here can touch the real database.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  getDatabase, connectDatabaseEmulator, ref, set, update, remove, get, serverTimestamp, type Database,
} from 'firebase/database'
import { buildBallotUpdates } from '../logic'

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST
const PROJECT = 'demo-wiffle'
const NS = `${PROJECT}-default-rtdb`

const apps: FirebaseApp[] = []

function client(name: string, mockUserToken?: { sub: string; role?: string }): Database {
  const app = initializeApp({ projectId: PROJECT, databaseURL: `https://${NS}.firebaseio.com` }, name)
  apps.push(app)
  const db = getDatabase(app)
  const [host, port] = HOST!.split(':')
  connectDatabaseEmulator(db, host, Number(port), mockUserToken ? { mockUserToken } : undefined)
  return db
}

/** Rules-bypassing reset (emulator "owner" credential). */
async function seed(data: unknown) {
  const res = await fetch(`http://${HOST}/.json?ns=${NS}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`)
}

const BASE = {
  game: { meta: { homeScore: 3, awayScore: 1 } },
  games: { g1: { homeScore: 3, finalized: true } },
  config: { leagueLogo: 'x' },
  players: {
    alice: { name: 'Alice A', teamId: 'red' },
    bob:   { name: 'Bob B',   teamId: 'red' },
    cara:  { name: 'Cara C',  teamId: 'blue' },
    gone:  { name: 'Gone G',  teamId: 'blue' },
  },
  teams: {
    red:   { name: 'Red' },
    blue:  { name: 'Blue' },
    stars: { name: 'Stars', isExhibition: true },
  },
  voting: {
    meta: { open: true },
    awards: {
      mvp:    { name: 'MVP', kind: 'player', order: 1 },
      team:   { name: 'Best Team', kind: 'team', order: 2 },
      rookie: { name: 'Rookie', kind: 'player', order: 3, candidates: { cara: true } },
    },
    voters: {
      'tok-alice': { playerId: 'alice', createdAt: 1 },
      'tok-bob':   { playerId: 'bob',   createdAt: 1 },
      // a link left behind for a player who has since been excluded
      'tok-gone':  { playerId: 'gone',  createdAt: 1 },
    },
    excluded: { gone: true },
  },
}

const vote = (db: Database, token: string, playerId: string, picks: Record<string, string>) =>
  update(ref(db), buildBallotUpdates(token, playerId, picks, serverTimestamp()))

describe.skipIf(!HOST)('voting rules (emulator)', () => {
  let anon: Database
  let admin: Database
  let scorer: Database

  beforeEach(async () => {
    await seed(BASE)
    if (!anon) {
      anon = client('anon')
      admin = client('admin', { sub: 'admin-1', role: 'admin' })
      scorer = client('scorer', { sub: 'scorer-1', role: 'scorer' })
    }
  })

  afterAll(async () => { await Promise.all(apps.map(a => deleteApp(a))) })

  describe('an anonymous visitor cannot touch anything else', () => {
    it.each([
      ['game/meta/homeScore', 99],
      ['games/g1/homeScore', 99],
      ['players/alice/name', 'Hacked'],
      ['teams/red/name', 'Hacked'],
      ['config/leagueLogo', 'Hacked'],
      ['overlay/activeScene', 'idle'],
      ['gameStats/g1/ab1', { result: 'home_run' }],
      ['voting/meta/open', false],
      ['voting/awards/mvp/name', 'Hacked'],
      ['voting/voters/tok-evil', { playerId: 'alice', createdAt: 1 }],
    ])('rejects a write to %s', async (path, value) => {
      await expect(set(ref(anon, path), value)).rejects.toThrow()
    })

    it('cannot wipe the voting tree or the database root', async () => {
      await expect(remove(ref(anon, 'voting'))).rejects.toThrow()
      await expect(remove(ref(anon, 'voting/ballots'))).rejects.toThrow()
      await expect(remove(ref(anon))).rejects.toThrow()
    })
  })

  describe('casting a ballot with a link', () => {
    it('accepts a valid ballot and marks the link as used', async () => {
      await vote(anon, 'tok-alice', 'alice', { mvp: 'cara', team: 'blue', rookie: 'cara' })
      const snap = await get(ref(admin, 'voting'))
      expect(snap.child('ballots/alice/picks').val()).toEqual({ mvp: 'cara', team: 'blue', rookie: 'cara' })
      expect(typeof snap.child('voters/tok-alice/votedAt').val()).toBe('number')
    })

    it('allows skipping awards (any non-empty subset)', async () => {
      await expect(vote(anon, 'tok-alice', 'alice', { mvp: 'bob' })).resolves.toBeUndefined()
    })

    it('rejects an empty ballot', async () => {
      await expect(vote(anon, 'tok-alice', 'alice', {})).rejects.toThrow()
    })

    it('cannot vote twice — not even with different picks', async () => {
      await vote(anon, 'tok-alice', 'alice', { mvp: 'cara' })
      await expect(vote(anon, 'tok-alice', 'alice', { mvp: 'bob' })).rejects.toThrow()
      await expect(set(ref(anon, 'voting/ballots/alice/picks/mvp'), 'bob')).rejects.toThrow()
      await expect(set(ref(anon, 'voting/ballots/alice'), { token: 'tok-alice', picks: { mvp: 'bob' }, submittedAt: serverTimestamp() })).rejects.toThrow()
    })

    it('cannot delete or overwrite a ballot', async () => {
      await vote(anon, 'tok-alice', 'alice', { mvp: 'cara' })
      await expect(remove(ref(anon, 'voting/ballots/alice'))).rejects.toThrow()
      await expect(remove(ref(anon, 'voting/voters/tok-alice/votedAt'))).rejects.toThrow()
    })

    it("cannot vote as someone else with your own link", async () => {
      await expect(vote(anon, 'tok-alice', 'bob', { mvp: 'cara' })).rejects.toThrow()
    })

    it("rejects an excluded player's ballot, even with a link", async () => {
      await expect(vote(anon, 'tok-gone', 'gone', { mvp: 'cara' })).rejects.toThrow()
    })

    it('anonymous visitors cannot change the exclusion list', async () => {
      await expect(set(ref(anon, 'voting/excluded/gone'), null)).rejects.toThrow()
      await expect(set(ref(anon, 'voting/excluded/cara'), true)).rejects.toThrow()
    })

    it('rejects a made-up link', async () => {
      await expect(vote(anon, 'tok-guess', 'alice', { mvp: 'cara' })).rejects.toThrow()
    })

    it('rejects ballots while polls are closed', async () => {
      await set(ref(admin, 'voting/meta/open'), false)
      await expect(vote(anon, 'tok-alice', 'alice', { mvp: 'cara' })).rejects.toThrow()
    })

    it('rejects a client-chosen timestamp', async () => {
      await expect(update(ref(anon), buildBallotUpdates('tok-alice', 'alice', { mvp: 'cara' }, 12345))).rejects.toThrow()
    })

    it('rejects extra fields on the ballot', async () => {
      await expect(update(ref(anon), {
        'voting/ballots/alice': { token: 'tok-alice', picks: { mvp: 'cara' }, submittedAt: serverTimestamp(), note: 'hi' },
        'voting/voters/tok-alice/votedAt': serverTimestamp(),
      })).rejects.toThrow()
    })

    it('cannot mark a link used without a matching ballot', async () => {
      await expect(set(ref(anon, 'voting/voters/tok-bob/votedAt'), serverTimestamp())).rejects.toThrow()
      await expect(update(ref(anon), {
        'voting/ballots/alice': { token: 'tok-alice', picks: { mvp: 'cara' }, submittedAt: serverTimestamp() },
        'voting/voters/tok-bob/votedAt': serverTimestamp(),
      })).rejects.toThrow()
    })
  })

  describe('what can be picked', () => {
    it.each([
      ['yourself', { mvp: 'alice' }],
      ['a player who does not exist', { mvp: 'nobody' }],
      ['your own team', { team: 'red' }],
      ['an exhibition team', { team: 'stars' }],
      ['a team that does not exist', { team: 'green' }],
      ['a player on a team award', { team: 'cara' }],
      ['a team on a player award', { mvp: 'blue' }],
      ['someone outside a restricted candidate list', { rookie: 'bob' }],
      ['an award that does not exist', { cy_young: 'cara' }],
      ['a player excluded from voting', { mvp: 'gone' }],
    ])('rejects voting for %s', async (_label, picks) => {
      await expect(vote(anon, 'tok-alice', 'alice', picks)).rejects.toThrow()
    })
  })

  describe('admins', () => {
    it('can edit, enter and reset ballots, and manage the setup', async () => {
      await vote(anon, 'tok-alice', 'alice', { mvp: 'cara' })
      // edit: whole-ballot set, keeping the original submittedAt
      await set(ref(admin, 'voting/ballots/alice'), { token: 'tok-alice', picks: { mvp: 'bob' }, submittedAt: 1, editedAt: serverTimestamp() })
      // enter a ballot on someone's behalf, even with polls closed
      await set(ref(admin, 'voting/meta/open'), false)
      await set(ref(admin, 'voting/ballots/bob'), { token: 'tok-bob', picks: { mvp: 'cara' }, submittedAt: 1, editedAt: serverTimestamp() })
      // reset: they can vote again with the same link
      await update(ref(admin), { 'voting/ballots/alice': null, 'voting/voters/tok-alice/votedAt': null })
      await set(ref(admin, 'voting/awards/best_team'), { name: 'Best Team', kind: 'team', order: 4 })
      await set(ref(admin, 'voting/voters/tok-cara'), { playerId: 'cara', createdAt: 2 })
      const snap = await get(ref(admin, 'voting'))
      expect(snap.child('ballots/alice').exists()).toBe(false)
      expect(snap.child('ballots/bob/picks/mvp').val()).toBe('cara')
    })

    it('are still held to valid picks', async () => {
      await expect(set(ref(admin, 'voting/ballots/alice'), { token: 'tok-alice', picks: { mvp: 'alice' }, submittedAt: 1 })).rejects.toThrow()
    })

    it('scorers get no voting access', async () => {
      await expect(set(ref(scorer, 'voting/meta/open'), false)).rejects.toThrow()
      await expect(remove(ref(scorer, 'voting/ballots'))).rejects.toThrow()
    })
  })
})
