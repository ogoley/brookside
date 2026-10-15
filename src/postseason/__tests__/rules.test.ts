/// <reference types="node" />
// Security-rules tests for /postseason against the RTDB emulator. Skipped in
// the normal `npm test` run; `npm run test:rules` boots the emulator (with
// database.rules.json) and runs this file. Uses a demo- project.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getDatabase, connectDatabaseEmulator, ref, set, update, type Database } from 'firebase/database'

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST
const PROJECT = 'demo-wiffle'
const NS = `${PROJECT}-default-rtdb`
const apps: FirebaseApp[] = []

function client(name: string, mockUserToken?: { sub: string; role?: string }): Database {
  const app = initializeApp({ projectId: PROJECT, databaseURL: `https://${NS}.firebaseio.com` }, `ps-${name}`)
  apps.push(app)
  const db = getDatabase(app)
  const [host, port] = HOST!.split(':')
  connectDatabaseEmulator(db, host, Number(port), mockUserToken ? { mockUserToken } : undefined)
  return db
}

async function seed(data: unknown) {
  const res = await fetch(`http://${HOST}/.json?ns=${NS}`, {
    method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`seed failed: ${res.status}`)
}

const GAME = { homeTeamId: 'a', awayTeamId: 'b', date: '2026-10-15', finalized: false, homeScore: 0, awayScore: 0 }

describe.skipIf(!HOST)('/postseason rules', () => {
  let anon: Database, scorer: Database, admin: Database
  beforeAll(() => {
    anon = client('anon')
    scorer = client('scorer', { sub: 'scorer1', role: 'scorer' })
    admin = client('admin', { sub: 'admin1', role: 'admin' })
  })

  beforeEach(() => seed({ players: { p1: { name: 'P', teamId: 'a' } } }))
  afterAll(async () => { await Promise.all(apps.map(a => deleteApp(a))) })

  it('scorers can create and score playoff games', async () => {
    await expect(set(ref(scorer, 'postseason/games/po_x'), GAME)).resolves.toBeUndefined()
    await expect(set(ref(scorer, 'postseason/gameStats/po_x/ab1'), { batterId: 'p1' })).resolves.toBeUndefined()
    await expect(set(ref(scorer, 'postseason/liveRunners/po_x'), { first: 'p1' })).resolves.toBeUndefined()
    await expect(set(ref(scorer, 'postseason/meta'), { active: true, season: 2026 })).resolves.toBeUndefined()
    await expect(set(ref(scorer, 'postseason/brackets/2026/slots/qf36/winnerOverride'), 'a')).resolves.toBeUndefined()
  })

  it('only admins can write playoff stats and box scores', async () => {
    await expect(set(ref(scorer, 'postseason/players/p1/stats/hitting'), { h: 1 })).rejects.toThrow()
    await expect(set(ref(scorer, 'postseason/gameSummaries/po_x/p1'), { h: 1 })).rejects.toThrow()
    await expect(set(ref(scorer, 'postseason/subPlayers/s1/stats/hitting'), { h: 1 })).rejects.toThrow()
    await expect(set(ref(admin, 'postseason/players/p1/stats/hitting'), { h: 1 })).resolves.toBeUndefined()
  })

  it('a playoff finalize (one multi-path update) succeeds for an admin and fails for a scorer', async () => {
    const updates = {
      'postseason/games/po_x/finalized': true,
      'postseason/players/p1/stats/hitting': { h: 2 },
      'postseason/players/p1/seasons/2026/hitting': { h: 2 },
      'postseason/gameSummaries/po_x/p1': { h: 2 },
    }
    await expect(update(ref(scorer), updates)).rejects.toThrow()
    await expect(update(ref(admin), updates)).resolves.toBeUndefined()
  })

  it('signed-out users cannot write anything under /postseason', async () => {
    await expect(set(ref(anon, 'postseason/games/po_x'), GAME)).rejects.toThrow()
    await expect(set(ref(anon, 'postseason/meta/active'), true)).rejects.toThrow()
  })

  it('scorers still cannot write regular-season /players', async () => {
    await expect(set(ref(scorer, 'players/p1/stats/hitting'), { h: 1 })).rejects.toThrow()
  })
})
