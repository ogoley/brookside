/**
 * migratePlayers.js — One-time migration script
 *
 * Usage:  node scripts/migratePlayers.js
 *
 * What it does:
 *   1. Fetches all players from Firebase
 *   2. Groups them by name
 *   3. For players with TWO entries (hitter + pitcher duplicate):
 *      - Merges stats into { hitting: {...}, pitching: {...} }
 *      - Sets position to 'both'
 *      - Keeps one entry (the hitter's ID), deletes the other
 *   4. For players with ONE entry:
 *      - Migrates flat stats into the correct bucket (stats.hitting or stats.pitching)
 *
 * Safe to run multiple times — already-migrated players (with stats.hitting/pitching)
 * are skipped automatically.
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, update, remove } from 'firebase/database'

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

// Pull hitting fields out of a flat stats object
function extractHitting(s) {
  return {
    ...(s.gp      !== undefined && { gp:      s.gp }),
    ...(s.pa      !== undefined && { pa:      s.pa }),
    ...(s.ab      !== undefined && { ab:      s.ab }),
    ...(s.h       !== undefined && { h:       s.h }),
    ...(s.doubles !== undefined && { doubles: s.doubles }),
    ...(s.triples !== undefined && { triples: s.triples }),
    ...(s.hr      !== undefined && { hr:      s.hr }),
    ...(s.r       !== undefined && { r:       s.r }),
    ...(s.rbi     !== undefined && { rbi:     s.rbi }),
    ...(s.bb      !== undefined && { bb:      s.bb }),
    ...(s.k       !== undefined && { k:       s.k }),
    ...(s.avg     !== undefined && { avg:     s.avg }),
    ...(s.obp     !== undefined && { obp:     s.obp }),
    ...(s.slg     !== undefined && { slg:     s.slg }),
    ...(s.ops     !== undefined && { ops:     s.ops }),
  }
}

// Pull pitching fields out of a flat stats object
function extractPitching(s) {
  return {
    ...(s.gp             !== undefined && { gp:             s.gp }),
    ...(s.era            !== undefined && { era:            s.era }),
    ...(s.k              !== undefined && { k:              s.k }),
    ...(s.bb             !== undefined && { bb:             s.bb }),
    ...(s.inningsPitched !== undefined && { inningsPitched: s.inningsPitched }),
    ...(s.w              !== undefined && { w:              s.w }),
    ...(s.l              !== undefined && { l:              s.l }),
    ...(s.cg             !== undefined && { cg:             s.cg }),
    ...(s.sv             !== undefined && { sv:             s.sv }),
  }
}

async function main() {
  const snap = await get(ref(db, 'players'))
  if (!snap.exists()) {
    console.error('❌  No players found in Firebase.')
    process.exit(1)
  }

  // Build list of all entries
  const allPlayers = []
  snap.forEach(child => {
    allPlayers.push({ id: child.key, ...child.val() })
  })
  console.log(`Found ${allPlayers.length} player entries.\n`)

  // Group by name+teamId — players on different teams with the same name are NOT duplicates
  const byName = {}
  for (const p of allPlayers) {
    const key = `${p.name}__${p.teamId}`
    if (!byName[key]) byName[key] = []
    byName[key].push(p)
  }

  let merged = 0
  let migrated = 0
  let skipped = 0

  for (const [name, entries] of Object.entries(byName)) {

    if (entries.length === 1) {
      const p = entries[0]
      const s = p.stats ?? {}

      // Already migrated if stats has hitting or pitching key
      if (s.hitting !== undefined || s.pitching !== undefined) {
        console.log(`⏭   ${name} — already migrated, skipping`)
        skipped++
        continue
      }

      // Migrate flat stats into the right bucket
      const bucket = p.position === 'pitcher' ? 'pitching' : 'hitting'
      const newStats = bucket === 'hitting' ? { hitting: extractHitting(s) } : { pitching: extractPitching(s) }

      await update(ref(db, `players/${p.id}`), { stats: newStats })
      console.log(`✓   ${name.padEnd(24)} migrated flat stats → stats.${bucket}`)
      migrated++

    } else if (entries.length === 2) {
      // Find hitter and pitcher entries
      const hitterEntry  = entries.find(e => e.position === 'hitter')  ?? entries[0]
      const pitcherEntry = entries.find(e => e.position === 'pitcher') ?? entries[1]
      const keepId   = hitterEntry.id
      const deleteId = pitcherEntry.id

      const hs = hitterEntry.stats  ?? {}
      const ps = pitcherEntry.stats ?? {}

      // Build merged stats, handling both flat and already-bucketed formats
      const mergedStats = {
        hitting:  hs.hitting  ?? extractHitting(hs),
        pitching: ps.pitching ?? extractPitching(ps),
      }

      await update(ref(db, `players/${keepId}`), { position: 'both', stats: mergedStats })
      await remove(ref(db, `players/${deleteId}`))
      console.log(`🔀  ${name.padEnd(24)} merged (kept ${keepId}, deleted ${deleteId})`)
      merged++

    } else {
      console.warn(`⚠️  ${name} has ${entries.length} entries — skipping, manual review needed`)
      skipped++
    }
  }

  console.log(`\n✅  Done: ${migrated} migrated, ${merged} merged, ${skipped} skipped.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
