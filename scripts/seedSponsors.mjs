/**
 * seedSponsors.mjs — Seed the starter inning sponsors into /config/sponsors.
 *
 * Usage:  node scripts/seedSponsors.mjs           # adds any starter not yet present
 *         node scripts/seedSponsors.mjs --force   # overwrites the starters
 *
 * Idempotent: existing sponsor ids are left alone unless --force is passed, so
 * admin edits made in /config → Sponsors survive a re-run. The same data is
 * available as a one-tap "Add starter sponsors" button in the admin panel
 * (src/sponsors/starter.ts) — keep the two in sync.
 *
 * Prereqs: ./service-account.json (see scripts/setRole.js) and
 *          VITE_FIREBASE_DATABASE_URL in .env.local
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const STARTER_SPONSORS = {
  pintus: {
    name: "Pintu's Indian Palace",
    tagline: 'Authentic Indian cuisine · Dine in, takeout & catering',
    logoUrl: '/sponsors/pintus.jpg',
    website: 'https://pintus.website/',
    accentColor: '#f2a33a',
    lightPlate: true,
    innings: { 1: true },
    enabled: true,
    order: 1,
  },
  pafumis: {
    name: "Pafumi's on Main",
    tagline: 'Neighborhood dining on Main Street',
    logoUrl: '/sponsors/pafumis.svg',
    website: 'https://pafumis-on-main.webflow.io/',
    accentColor: '#a3182f',
    lightPlate: false,
    innings: { 2: true },
    enabled: true,
    order: 2,
  },
  guilty_grape: {
    name: 'The Guilty Grape',
    tagline: 'Beer, wine & provisions · Main St Market, Wilbraham',
    logoUrl: '/sponsors/guilty-grape.png',
    website: 'https://www.guiltygrape.com/',
    accentColor: '#6d2a6e',
    lightPlate: true,
    innings: { 3: true },
    enabled: true,
    order: 3,
  },
  evergreen_financial: {
    // Logo not received yet — the card needs one, so this stays disabled
    // until it's uploaded in /config → Sponsors and switched on.
    name: 'Evergreen Financial',
    logoUrl: '',
    accentColor: '#2f7d4f',
    lightPlate: true,
    innings: { 4: true },
    enabled: false,
    order: 4,
  },
}

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const force = process.argv.includes('--force')
const env = loadEnv()
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'))

initializeApp({ credential: cert(serviceAccount), databaseURL: env.VITE_FIREBASE_DATABASE_URL })
const db = getDatabase()

const snap = await db.ref('config/sponsors').get()
const existing = snap.exists() ? snap.val() : {}

const updates = {}
for (const [id, sponsor] of Object.entries(STARTER_SPONSORS)) {
  if (existing[id] && !force) {
    console.log(`= ${id}: already present, leaving as-is`)
    continue
  }
  updates[`config/sponsors/${id}`] = sponsor
  console.log(`${existing[id] ? '~' : '+'} ${id}: ${sponsor.name} → inning(s) ${Object.keys(sponsor.innings).join(', ')}`)
}

if (Object.keys(updates).length === 0) {
  console.log('Nothing to write.')
} else {
  await db.ref().update(updates)
  console.log(`Wrote ${Object.keys(updates).length} sponsor(s).`)
}
process.exit(0)
