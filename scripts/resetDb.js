/**
 * resetDb.js — Wipe Firebase and restore from snapshot
 *
 * Usage:  npm run reset
 *
 * Deletes ALL data in the Firebase Realtime Database and replaces it with
 * the contents of firebase-snapshot.json. This is a full destructive reset —
 * all games, at-bat logs, and live state are permanently deleted.
 *
 * Safe to run repeatedly — it is fully idempotent.
 *
 * To update the snapshot after making changes:  npm run snapshot
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set } from 'firebase/database'

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

async function main() {
  const snapshotPath = new URL('../firebase-snapshot.json', import.meta.url)
  let snapshot

  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  } catch {
    console.error('❌  firebase-snapshot.json not found. Run "npm run snapshot" first.')
    process.exit(1)
  }

  const teamCount   = Object.keys(snapshot.teams   ?? {}).length
  const playerCount = Object.keys(snapshot.players ?? {}).length

  console.log(`⚠️   This will WIPE all Firebase data and restore from snapshot.`)
  console.log(`    ${teamCount} teams, ${playerCount} players will be restored.`)
  console.log(`    Games, at-bat logs, and live state will be deleted.\n`)
  console.log('Writing snapshot to Firebase...')

  await set(ref(db, '/'), snapshot)

  console.log('✅  Database reset complete.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
