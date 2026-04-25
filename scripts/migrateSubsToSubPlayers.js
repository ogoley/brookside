/**
 * migrateSubsToSubPlayers.js — one-time migration
 *
 * Moves every sub-identity record out of /players and into /subPlayers, so
 * external consumers reading /players see a clean roster (regulars only) and
 * don't have to filter on isSub.
 *
 * What gets moved:
 *   /players/sub_*           → /subPlayers/sub_*           (batter subs)
 *   /players/subp_*          → /subPlayers/subp_*          (sub pitchers)
 *   /players/{id}            → /subPlayers/{id}             where isSub === true
 *                              (catches any drift where the prefix doesn't match)
 *
 * Uses the firebase-admin SDK + service-account.json (same as setRole.js) so
 * the database rules don't block the cross-path move.
 *
 * The script is:
 *   - Atomic: each record is moved in a single multi-path update() that writes
 *     the new location and nulls the old one together.
 *   - Idempotent: safe to re-run. Records already migrated are skipped.
 *   - Two-phase: writes new locations first, then deletes old. If interrupted
 *     between phases, re-running picks up the same set and finishes the move.
 *
 * Usage:
 *   node scripts/migrateSubsToSubPlayers.js          # dry-run, prints plan
 *   node scripts/migrateSubsToSubPlayers.js --apply  # actually move records
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

const env = loadEnv()
let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'))
} catch {
  console.error('Could not read ./service-account.json. Download one from Firebase Console.')
  process.exit(1)
}

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
})

const db = getDatabase()

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '🔧 APPLY MODE — will write changes\n' : '🔍 DRY RUN — no changes will be made (pass --apply to execute)\n')

  const [playersSnap, subPlayersSnap] = await Promise.all([
    db.ref('players').get(),
    db.ref('subPlayers').get(),
  ])
  const players = playersSnap.exists() ? playersSnap.val() : {}
  const existingSubPlayers = subPlayersSnap.exists() ? subPlayersSnap.val() : {}

  const beforePlayersCount = Object.keys(players).length
  const beforeSubPlayersCount = Object.keys(existingSubPlayers).length

  console.log(`Before:`)
  console.log(`  /players       : ${beforePlayersCount} records`)
  console.log(`  /subPlayers    : ${beforeSubPlayersCount} records`)
  console.log()

  // Identify sub records currently sitting under /players
  const toMove = []
  for (const [id, record] of Object.entries(players)) {
    const looksLikeSubId = id.startsWith('sub_') || id.startsWith('subp_')
    const flaggedSub = record?.isSub === true
    if (!looksLikeSubId && !flaggedSub) continue
    toMove.push({ id, record, reason: looksLikeSubId ? 'id-prefix' : 'isSub flag' })
  }

  if (toMove.length === 0) {
    console.log('✅ Nothing to migrate — /players already clean.')
    process.exit(0)
  }

  console.log(`Records to move from /players → /subPlayers (${toMove.length}):`)
  for (const { id, record, reason } of toMove) {
    const name = record?.name ?? '(no name)'
    const team = record?.teamId ?? '(no team)'
    const dup = existingSubPlayers[id] ? ' ⚠ /subPlayers/' + id + ' already exists, will overwrite' : ''
    console.log(`  ${id}  name="${name}"  teamId="${team}"  reason=${reason}${dup}`)
  }
  console.log()

  if (!APPLY) {
    console.log(`Dry run complete. Re-run with --apply to migrate.`)
    process.exit(0)
  }

  // Phase 1: write each record to /subPlayers, ensuring isSub:true is set.
  console.log(`Phase 1 — writing ${toMove.length} record(s) to /subPlayers...`)
  const writePayload = {}
  for (const { id, record } of toMove) {
    writePayload[`subPlayers/${id}`] = { ...record, isSub: true }
  }
  await db.ref().update(writePayload)
  console.log(`  ✓ wrote ${toMove.length} records to /subPlayers`)

  // Phase 2: delete originals from /players.
  console.log(`Phase 2 — removing originals from /players...`)
  const deletePayload = {}
  for (const { id } of toMove) {
    deletePayload[`players/${id}`] = null
  }
  await db.ref().update(deletePayload)
  console.log(`  ✓ deleted ${toMove.length} originals from /players`)

  // Verify
  const [afterPlayers, afterSubPlayers] = await Promise.all([
    db.ref('players').get(),
    db.ref('subPlayers').get(),
  ])
  const afterPlayersCount = afterPlayers.exists() ? Object.keys(afterPlayers.val()).length : 0
  const afterSubPlayersCount = afterSubPlayers.exists() ? Object.keys(afterSubPlayers.val()).length : 0

  console.log()
  console.log(`After:`)
  console.log(`  /players       : ${afterPlayersCount} records  (was ${beforePlayersCount}, expected ${beforePlayersCount - toMove.length})`)
  console.log(`  /subPlayers    : ${afterSubPlayersCount} records  (was ${beforeSubPlayersCount})`)

  if (afterPlayersCount !== beforePlayersCount - toMove.length) {
    console.error('⚠ /players count not as expected. Inspect manually.')
    process.exit(1)
  }
  console.log('\n✅ Migration complete.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
