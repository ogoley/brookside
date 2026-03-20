/**
 * duplicatePitchingStats.js — Copy pitching stats to duplicated team rosters
 *
 * Usage:  node scripts/duplicatePitchingStats.js
 *
 * Context:
 *   Two teams (Moose Knucklers, Yellow Bat Yetis) were seeded by duplicating
 *   rosters from existing teams (Wiffle Whalers, Gamecocks). The pitching seed
 *   only wrote stats for the original teams, so those duplicate players are
 *   missing pitching data.
 *
 * What it does:
 *   For each (sourceTeam → targetTeam) pair, finds players on the source team
 *   who have stats.pitching, then finds the matching player by name on the
 *   target team and copies the pitching stats over (setting position to 'both'
 *   if needed).
 *
 * Run AFTER migratePlayers.js.
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, update, push } from 'firebase/database'

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

// Source team → duplicate team
const DUPLICATE_PAIRS = [
  { copyFrom: 'Wiffle Whalers', newTeam: 'Moose Knucklers' },
  { copyFrom: 'Gamecocks',      newTeam: 'Yellow Bat Yetis' },
]

async function main() {
  // 1. Fetch teams to build name → id map
  const teamsSnap = await get(ref(db, 'teams'))
  if (!teamsSnap.exists()) {
    console.error('❌  No teams found in Firebase.')
    process.exit(1)
  }
  const nameToId = {}
  teamsSnap.forEach(child => { nameToId[child.val().name] = child.key })
  console.log('Teams found:', Object.keys(nameToId).join(', '), '\n')

  // 2. Fetch all players
  const playersSnap = await get(ref(db, 'players'))
  if (!playersSnap.exists()) {
    console.error('❌  No players found in Firebase.')
    process.exit(1)
  }
  const allPlayers = []
  playersSnap.forEach(child => allPlayers.push({ id: child.key, ...child.val() }))

  let copied = 0
  let skipped = 0

  for (const { copyFrom, newTeam } of DUPLICATE_PAIRS) {
    const sourceTeamId = nameToId[copyFrom]
    const targetTeamId = nameToId[newTeam]

    if (!sourceTeamId || !targetTeamId) {
      console.warn(`⚠️  Could not find team IDs for "${copyFrom}" or "${newTeam}" — skipping pair`)
      continue
    }

    // Players on the source team who have pitching stats
    const sourcePitchers = allPlayers.filter(
      p => p.teamId === sourceTeamId && p.stats?.pitching
    )

    // All players on the target team, keyed by name for quick lookup
    const targetByName = {}
    allPlayers
      .filter(p => p.teamId === targetTeamId)
      .forEach(p => { targetByName[p.name] = p })

    console.log(`\n${copyFrom} → ${newTeam}`)
    console.log(`  ${sourcePitchers.length} pitcher(s) to copy`)

    for (const src of sourcePitchers) {
      const target = targetByName[src.name]

      if (!target) {
        // Player was lost during migration (name collision across teams) — recreate them
        const position = src.stats.hitting ? 'both' : 'pitcher'
        await push(ref(db, 'players'), {
          name:         src.name,
          teamId:       targetTeamId,
          position,
          jerseyNumber: src.jerseyNumber || '',
          stats: {
            ...(src.stats.hitting  && { hitting:  src.stats.hitting }),
            ...(src.stats.pitching && { pitching: src.stats.pitching }),
          },
        })
        console.log(`  ➕  ${src.name.padEnd(22)} recreated on ${newTeam} (position → ${position})`)
        copied++
        continue
      }

      const newPosition =
        target.position === 'hitter' ? 'both' :
        target.position === 'both'   ? 'both' :
        'pitcher'

      await update(ref(db, `players/${target.id}`), {
        position: newPosition,
        'stats/pitching': src.stats.pitching,
      })

      console.log(`  ✓  ${src.name.padEnd(22)} pitching stats copied (position → ${newPosition})`)
      copied++
    }
  }

  console.log(`\n✅  Done: ${copied} copied, ${skipped} skipped.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
