/**
 * exportSnapshot.js — Capture current Firebase state as a reset snapshot
 *
 * Usage:  npm run snapshot
 *
 * Run this once after your database is in a known good state (teams created,
 * players seeded). It captures /teams and /players from Firebase, combines
 * them with clean defaults for /game and /overlay, and writes the result to
 * firebase-snapshot.json. Commit that file to the repo.
 *
 * What gets captured:
 *   /teams    — all team definitions (colors, names, logos)
 *   /players  — all player records with stats
 *
 * What gets reset to clean defaults (not read from Firebase):
 *   /game/meta     — inning 1, top, 0 outs, 0-0, no currentGameId
 *   /game/matchup  — all null
 *   /overlay       — idle scene, no stat overlay, default 60 min timer
 *
 * What is intentionally excluded (starts empty on reset):
 *   /games, /gameStats, /liveRunners, /gameSummaries
 */

import { readFileSync, writeFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get } from 'firebase/database'

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => {
        const [k, ...v] = l.split('=')
        return [k.trim(), v.join('=').trim()]
      })
  )
}

const env = loadEnv()

const app = initializeApp({
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL,
  projectId:         env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
})

const db = getDatabase(app)

const CLEAN_DEFAULTS = {
  game: {
    meta: {
      homeTeamId:    '',
      awayTeamId:    '',
      inning:        1,
      isTopInning:   true,
      outs:          0,
      bases:         { first: false, second: false, third: false },
      homeScore:     0,
      awayScore:     0,
      isActive:      false,
    },
    matchup: {
      batterId:        null,
      pitcherId:       null,
      lastPitcherHome: null,
      lastPitcherAway: null,
    },
  },
  overlay: {
    activeScene:     'idle',
    scoreboardBorder: false,
    scoreboardScale:  1,
    statOverlay: {
      visible:       false,
      type:          'hitter',
      playerId:      '',
      dismissAfterMs: 5000,
    },
    timer: {
      durationMs:  3600000,
      startedAt:   null,
      running:     false,
    },
    homerun: {
      active:      false,
      teamSide:    'home',
      playerId:    '',
      logoUrl:     '',
      runsScored:  0,
      triggeredAt: 0,
    },
  },
}

async function main() {
  console.log('Reading /teams and /players from Firebase...\n')

  const [teamsSnap, playersSnap] = await Promise.all([
    get(ref(db, 'teams')),
    get(ref(db, 'players')),
  ])

  if (!teamsSnap.exists()) {
    console.error('❌  No teams found. Set up teams in Firebase first.')
    process.exit(1)
  }
  if (!playersSnap.exists()) {
    console.error('❌  No players found. Run npm run seed first.')
    process.exit(1)
  }

  const snapshot = {
    ...CLEAN_DEFAULTS,
    teams:   teamsSnap.val(),
    players: playersSnap.val(),
  }

  const outPath = new URL('../firebase-snapshot.json', import.meta.url)
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2))

  const teamCount   = Object.keys(snapshot.teams).length
  const playerCount = Object.keys(snapshot.players).length
  console.log(`✅  Snapshot saved to firebase-snapshot.json`)
  console.log(`    ${teamCount} teams, ${playerCount} players`)
  console.log(`\n    Commit this file and run "npm run reset" to restore this state.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
