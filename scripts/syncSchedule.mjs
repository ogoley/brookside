/**
 * syncSchedule.mjs — Pull the remaining regular-season schedule from the
 * public league site (brooksidewiffle.com/api/games) into /config/schedule.
 *
 * Usage:  node scripts/syncSchedule.mjs            # season = current per /api/seasons
 *         node scripts/syncSchedule.mjs --season 2026
 *
 * Why a script and not the overlay: the site's API has no CORS header, so the
 * browser can't read it; and per ARCHITECTURE, Firebase is the app's only data
 * source. The script is idempotent — it writes every non-final game (scheduled
 * / postponed) keyed by the site's game id, deletes entries that have since
 * gone final or vanished from the site, and stamps /config/scheduleMeta.
 *
 * Verified 2026-09-10 against Spond (the league's operational source): the
 * site's remaining slate matched Spond game-for-game. Re-run after any
 * schedule change on the site (or add a game by hand in /config/schedule).
 *
 * Prereqs: ./service-account.json and VITE_FIREBASE_DATABASE_URL in .env.local
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const SITE = 'https://brooksidewiffle.com'

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

async function getJson(path) {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': 'brookside-overlay-sync' } })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

const argSeason = process.argv.indexOf('--season')
const season = argSeason > -1 ? Number(process.argv[argSeason + 1]) : (await getJson('/api/seasons')).current
console.log(`Season ${season}`)

const [teams, games] = await Promise.all([
  getJson(`/api/teams?season=${season}`),
  getJson(`/api/games?season=${season}&order=asc`),
])
const slug = Object.fromEntries(teams.map(t => [t.id, t.firebaseTeamSlug]).filter(([, s]) => !!s))

const env = loadEnv()
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'))
initializeApp({ credential: cert(serviceAccount), databaseURL: env.VITE_FIREBASE_DATABASE_URL })
const db = getDatabase()

const existingSnap = await db.ref('config/schedule').get()
const existing = existingSnap.exists() ? existingSnap.val() : {}

const updates = {}
const keep = new Set()
let scheduled = 0, postponed = 0, skipped = 0
for (const g of games) {
  if (g.status === 'final') continue
  const home = slug[g.homeTeamId], away = slug[g.awayTeamId]
  if (!home || !away) { skipped++; console.warn(`! skipping ${g.id}: unmapped team`); continue }
  const status = g.status === 'scheduled' ? 'scheduled' : g.status === 'postponed' ? 'postponed' : 'cancelled'
  keep.add(g.id)
  updates[`config/schedule/${g.id}`] = {
    date: g.date,
    time: (g.time ?? '').slice(0, 5) || null,
    homeTeamId: home,
    awayTeamId: away,
    status,
    venue: g.venue || null,
    source: 'brooksidewiffle.com',
  }
  if (status === 'scheduled') scheduled++
  else if (status === 'postponed') postponed++
  console.log(`${existing[g.id] ? '~' : '+'} ${g.date} ${(g.time ?? '').slice(0, 5)}  ${away} @ ${home}  [${status}]`)
}
for (const id of Object.keys(existing)) {
  if (!keep.has(id) && existing[id]?.source === 'brooksidewiffle.com') {
    updates[`config/schedule/${id}`] = null
    console.log(`- removed ${id} (${existing[id].date} ${existing[id].awayTeamId} @ ${existing[id].homeTeamId})`)
  }
}
updates['config/scheduleMeta'] = { syncedAt: Date.now(), source: SITE, season, scheduled, postponed }

await db.ref().update(updates)
console.log(`Done: ${scheduled} scheduled, ${postponed} postponed, ${skipped} skipped.`)
process.exit(0)
