/**
 * migrateTeamIds.js — One-time migration: GUID team IDs → readable slugs
 *
 * Usage:  node scripts/migrateTeamIds.js
 *
 * What it does:
 *   1. Reads all teams from /teams
 *   2. Derives a slug from each team name  (e.g. "Wiffle Whalers" → "wiffle_whalers")
 *   3. Writes team data to /teams/{slug}
 *   4. Updates every player's teamId to the new slug
 *   5. Deletes the old /teams/{guid} entries
 *
 * Safe to inspect before running — it prints a plan and asks you to confirm.
 * Run once. After this, team IDs in Firebase will match what seedPlayers.js produces.
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, set, remove, update } from 'firebase/database'

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

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_')
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
  const [teamsSnap, playersSnap] = await Promise.all([
    get(ref(db, 'teams')),
    get(ref(db, 'players')),
  ])

  if (!teamsSnap.exists()) {
    console.error('❌  No teams found in Firebase.')
    process.exit(1)
  }

  const teams = teamsSnap.val()
  const players = playersSnap.exists() ? playersSnap.val() : {}

  // Build old → new ID map
  const idMap = {}
  for (const [oldId, team] of Object.entries(teams)) {
    const newId = slugify(team.name)
    idMap[oldId] = newId
  }

  // Print plan
  console.log('Migration plan:\n')
  for (const [oldId, newId] of Object.entries(idMap)) {
    const already = oldId === newId
    console.log(`  ${oldId.padEnd(30)} → ${newId}${already ? '  (no change)' : ''}`)
  }

  const needsMigration = Object.entries(idMap).filter(([o, n]) => o !== n)
  if (needsMigration.length === 0) {
    console.log('\n✅  All team IDs are already clean slugs. Nothing to do.')
    process.exit(0)
  }

  const affectedPlayers = Object.entries(players).filter(([, p]) => idMap[p.teamId] && p.teamId !== idMap[p.teamId])
  console.log(`\n${needsMigration.length} team(s) will be renamed.`)
  console.log(`${affectedPlayers.length} player(s) will have their teamId updated.\n`)

  // Migrate
  for (const [oldId, newId] of needsMigration) {
    // Write under new ID
    await set(ref(db, `teams/${newId}`), teams[oldId])
    console.log(`✓  Created teams/${newId}`)

    // Update players referencing this team
    for (const [playerId, player] of Object.entries(players)) {
      if (player.teamId === oldId) {
        await update(ref(db, `players/${playerId}`), { teamId: newId })
        console.log(`   Updated player ${playerId} → teamId: ${newId}`)
      }
    }

    // Delete old entry
    await remove(ref(db, `teams/${oldId}`))
    console.log(`   Deleted teams/${oldId}`)
  }

  console.log('\n✅  Migration complete. Run "npm run snapshot" to update your snapshot.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
