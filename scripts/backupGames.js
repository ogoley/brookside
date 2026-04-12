/**
 * backupGames.js — Read-only snapshot of all game data
 *
 * Usage:  npm run backup
 *
 * Pulls /games, /gameStats, /gameSummaries, /liveRunners, /game, /overlay,
 * /teams, /players, and /config from Firebase and writes them to a
 * timestamped JSON file in ./backups/. Does NOT write anything back to the
 * database. Intended as a safety net before a live game.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
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

const PATHS = [
  'games',
  'gameStats',
  'gameSummaries',
  'liveRunners',
  'game',
  'overlay',
  'teams',
  'players',
  'config',
]

function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

async function main() {
  console.log('Pulling read-only snapshot from Firebase...\n')

  const snaps = await Promise.all(
    PATHS.map(p => get(ref(db, p)).then(s => [p, s.exists() ? s.val() : null]))
  )

  const full = Object.fromEntries(snaps)

  // Also build a compact "summary" view: for every game, a list of the
  // at-bats keyed under it (count + basic result breakdown), so the summary
  // file is human-readable at a glance.
  const games = full.games || {}
  const gameStats = full.gameStats || {}
  const summaries = {}
  for (const [gameId, game] of Object.entries(games)) {
    const atBats = gameStats[gameId] ? Object.values(gameStats[gameId]) : []
    const resultCounts = {}
    for (const ab of atBats) {
      resultCounts[ab.result] = (resultCounts[ab.result] || 0) + 1
    }
    summaries[gameId] = {
      date:       game.date        ?? null,
      homeTeamId: game.homeTeamId  ?? null,
      awayTeamId: game.awayTeamId  ?? null,
      homeScore:  game.homeScore   ?? null,
      awayScore:  game.awayScore   ?? null,
      inning:     game.inning      ?? null,
      outs:       game.outs        ?? null,
      finalized:  game.finalized   ?? false,
      atBatCount: atBats.length,
      resultCounts,
    }
  }

  const outDir = new URL('../backups/', import.meta.url)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const ts = timestamp()
  const detailedPath = new URL(`./games-detailed-${ts}.json`, outDir)
  const summaryPath  = new URL(`./games-summary-${ts}.json`,  outDir)

  writeFileSync(detailedPath, JSON.stringify(full, null, 2))
  writeFileSync(summaryPath,  JSON.stringify(summaries, null, 2))

  const gameCount    = Object.keys(games).length
  const atBatTotal   = Object.values(gameStats).reduce(
    (n, g) => n + Object.keys(g || {}).length, 0
  )
  const teamCount    = Object.keys(full.teams   || {}).length
  const playerCount  = Object.keys(full.players || {}).length

  console.log(`✅  Detailed backup:  backups/games-detailed-${ts}.json`)
  console.log(`✅  Summary backup:   backups/games-summary-${ts}.json`)
  console.log(
    `    ${gameCount} games, ${atBatTotal} at-bats, ${teamCount} teams, ${playerCount} players`
  )
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
