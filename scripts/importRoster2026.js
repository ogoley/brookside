/**
 * importRoster2026.js — One-off: wipe all players, import 2026 roster from CSV
 *
 * Usage:  node scripts/importRoster2026.js
 *
 * - Reads BrooksideRoster2026_withNumbers.csv
 * - Maps CSV team names to existing Firebase team IDs (does NOT rename teams)
 * - Deletes all existing players from /players
 * - Writes new players with empty stats
 * - Then run `npm run snapshot` to capture the clean state
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set, remove } from 'firebase/database'

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_')
}

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

// CSV team name → Firebase team ID
const TEAM_MAP = {
  'Space Invaders':  'base_invaders',
  'Gamecocks':       'gamecocks',
  'Mooseknucklers':  'moose_knucklers',
  'Nuke Squad':      'nuke_squad',
  'Swing Mafia':     'swing_mafia',
  'Trash Pandas':    'trash_pandas',
  'Whalers':         'wiffle_whalers',
  'Yetis':           'yellow_bat_yetis',
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

async function main() {
  // Read CSV
  const csv = readFileSync(new URL('../BrooksideRoster2026_withNumbers.csv', import.meta.url), 'utf8')
  const lines = csv.trim().split('\n').slice(1) // skip header

  const players = lines.map(line => {
    const [team, name, number] = line.split(',').map(s => s.trim())
    const teamId = TEAM_MAP[team]
    if (!teamId) throw new Error(`Unknown team in CSV: "${team}"`)
    return { name, teamId, jerseyNumber: number || '', playerId: slugify(name) }
  })

  console.log(`Parsed ${players.length} players from CSV\n`)

  // Wipe all existing players
  console.log('Wiping /players...')
  await remove(ref(db, 'players'))
  console.log('Done.\n')

  // Write new players with empty stats
  for (const p of players) {
    await set(ref(db, `players/${p.playerId}`), {
      name: p.name,
      teamId: p.teamId,
      jerseyNumber: p.jerseyNumber,
      stats: {},
    })
    console.log(`  ${p.playerId.padEnd(25)} → ${p.teamId} (#${p.jerseyNumber})`)
  }

  console.log(`\n✅  ${players.length} players imported. Now run: npm run snapshot`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
