/**
 * seedPitchers.js — One-time pitching stats import
 *
 * Usage:  node scripts/seedPitchers.js
 *
 * What it does:
 *   1. Reads Firebase config from .env.local
 *   2. Reads pitching data from brookside-11361-default-rtdb-pitchingStats-export.json
 *   3. Fetches /teams from Firebase to build a name→id map
 *   4. Remaps old season team names to new season team names (same map as seedPlayers.js)
 *   5. Pushes all pitchers to /players with position: 'pitcher'
 *
 * ⚠️  TEAM_MAP values must match EXACTLY what you typed in /config.
 *     If a team name doesn't match, that player is skipped with a warning.
 *
 * Run once. If you need to re-run, delete the pitcher entries in Firebase first.
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, push } from 'firebase/database'

// ── Load .env.local ──────────────────────────────────────────────────────────
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

// ── Team name mapping: old season → new season ───────────────────────────────
// Same map as seedPlayers.js — right-hand values must match /config exactly
const TEAM_MAP = {
  'Mariners':      'Wiffle Whalers',
  "Banana's":      'Swing Mafia',
  "A's":           'Nuke Squad',
  'Indians':       'Gamecocks',
  'Padres':        'Base Invaders',
  'Diamondbacks':  'Trash Pandas',
}

// ── Load pitching data from exported JSON ─────────────────────────────────────
const RAW_PITCHERS = JSON.parse(
  readFileSync(new URL('../brookside-11361-default-rtdb-pitchingStats-export.json', import.meta.url), 'utf8')
)

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Fetch teams from Firebase
  const teamsSnap = await get(ref(db, 'teams'))
  if (!teamsSnap.exists()) {
    console.error('❌  No teams found in Firebase. Create all teams in /config first.')
    process.exit(1)
  }

  // Build name → Firebase ID map
  const nameToId = {}
  teamsSnap.forEach(child => {
    nameToId[child.val().name] = child.key
  })
  console.log('Teams found in Firebase:', Object.keys(nameToId).join(', '), '\n')

  // 2. Remap old team names to new team names
  const pitchers = RAW_PITCHERS.map(p => ({
    ...p,
    Team: TEAM_MAP[p.Team] ?? p.Team,
  }))

  // 3. Push each pitcher to /players
  let pushed = 0
  let skipped = 0

  for (const p of pitchers) {
    const teamId = nameToId[p.Team]
    if (!teamId) {
      console.warn(`⚠️  No Firebase team found for "${p.Team}" — skipping ${p.Name}`)
      skipped++
      continue
    }

    await push(ref(db, 'players'), {
      name:         p.Name,
      teamId,
      position:     'pitcher',
      jerseyNumber: p.number || '',
      stats: {
        pitching: {
          gp:             Number(p.GP),
          era:            Number(p.ERA),
          k:              Number(p.K),
          bb:             Number(p.BB),
          inningsPitched: Number(p.IP),
          w:              Number(p.W),
          l:              Number(p.L),
          cg:             Number(p.CG),
          sv:             Number(p.S),
        },
      },
    })

    console.log(`✓  ${p.Name.padEnd(22)} → ${p.Team}`)
    pushed++
  }

  console.log(`\n✅  Done: ${pushed} pitchers pushed, ${skipped} skipped.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
