/**
 * voteLinks.mjs — Season-awards voting links: create + export with the Spond mapping.
 *
 * Usage:  node scripts/voteLinks.mjs                     # export only
 *         node scripts/voteLinks.mjs --create            # mint links for every eligible player without one, then export
 *         node scripts/voteLinks.mjs --exclude mark_gee  # exclude a player (removes their link), then export
 *
 * Writes vote-links/vote-links.csv (gitignored — every row is a live ballot
 * credential): team, name, playerId, spondGroup, spondName, link, voted, message.
 * Never opens voting and never sends anything; the same create/exclude actions
 * exist in /vote-admin. Eligible = named, non-sub /players minus
 * /voting/excluded (mirrors rosterPlayerIds in src/voting/logic.ts).
 *
 * Prereqs: ./service-account.json and VITE_FIREBASE_DATABASE_URL in .env.local
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

// Keep in sync with VOTE_LINK_BASE / inviteMessage in src/voting/logic.ts.
const VOTE_LINK_BASE = 'https://www.ogoley.com'
const DEFAULT_TITLE = `${new Date().getFullYear()} Season Awards`

// Spond: one group "Brookside Athletics Wiffle Ball" with a subgroup per team.
// Subgroup names that differ from our team names (verified 2026-10-06).
const SPOND_GROUP = { base_invaders: "Big Ol' Hitties", wiffle_whalers: 'Whalers' }
// Spond display names that differ from /players (case only, verified 2026-10-06).
const SPOND_NAME = {
  '-OtHHi8_0L8Ht_9i3Ian': 'hywel brown',
  kris_oconnor: 'Kris oconnor',
  matthew_wrisley: 'matthew wrisley',
  kyle_venancio: 'kyle venancio',
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

const args = process.argv.slice(2)
const create = args.includes('--create')
const excludeIdx = args.indexOf('--exclude')
const excludeId = excludeIdx >= 0 ? args[excludeIdx + 1] : null

const env = loadEnv()
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'))
initializeApp({ credential: cert(serviceAccount), databaseURL: env.VITE_FIREBASE_DATABASE_URL })
const db = getDatabase()

const [playersSnap, teamsSnap, votingSnap] = await Promise.all([db.ref('players').get(), db.ref('teams').get(), db.ref('voting').get()])
const players = playersSnap.val() ?? {}
const teams = teamsSnap.val() ?? {}
const voting = votingSnap.val() ?? {}
const voters = voting.voters ?? {}
const excluded = voting.excluded ?? {}

const tokensFor = playerId => Object.entries(voters).filter(([, v]) => v.playerId === playerId).map(([t]) => t)

if (excludeId) {
  if (!players[excludeId]) throw new Error(`No player ${excludeId}`)
  const updates = { [`voting/excluded/${excludeId}`]: true }
  for (const t of tokensFor(excludeId)) { updates[`voting/voters/${t}`] = null; delete voters[t] }
  await db.ref().update(updates)
  excluded[excludeId] = true
  console.log(`- excluded ${players[excludeId].name} (${excludeId})`)
}

const eligible = Object.entries(players)
  .filter(([id, p]) => p && p.name && !p.isSub && !excluded[id])
  .map(([id]) => id)

if (create) {
  const linked = new Set(Object.values(voters).map(v => v.playerId))
  const missing = eligible.filter(id => !linked.has(id))
  const now = Date.now()
  const updates = {}
  for (const playerId of missing) {
    const token = randomUUID()
    updates[`voting/voters/${token}`] = { playerId, createdAt: now }
    voters[token] = { playerId, createdAt: now }
  }
  if (missing.length) await db.ref().update(updates)
  console.log(`+ created ${missing.length} link(s)`)
}

const title = voting.meta?.title || DEFAULT_TITLE
const linkFor = new Map()
for (const [token, v] of Object.entries(voters)) {
  const prev = linkFor.get(v.playerId)
  if (!prev || (v.createdAt ?? 0) > prev.createdAt) linkFor.set(v.playerId, { token, createdAt: v.createdAt ?? 0 })
}

const cell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const rows = eligible
  .map(id => ({ id, p: players[id], team: teams[players[id].teamId]?.name ?? players[id].teamId }))
  .sort((a, b) => a.team.localeCompare(b.team) || a.p.name.localeCompare(b.p.name))
  .map(({ id, p, team }) => {
    const l = linkFor.get(id)
    const link = l ? `${VOTE_LINK_BASE}/vote/${l.token}` : ''
    const first = p.name.trim().split(/\s+/)[0]
    const message = link
      ? `Hey ${first}! ${title} voting is open. Here's your personal ballot — the link is yours alone, please don't share it: ${link}`
      : ''
    return [team, p.name, id, SPOND_GROUP[p.teamId] ?? team, SPOND_NAME[id] ?? p.name, link, voting.ballots?.[id] ? 'yes' : 'no', message]
  })

mkdirSync(new URL('../vote-links/', import.meta.url), { recursive: true })
const out = new URL('../vote-links/vote-links.csv', import.meta.url)
writeFileSync(out, ['team,name,playerId,spondGroup,spondName,link,voted,message', ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n')
console.log(`Wrote ${rows.length} row(s) (${rows.filter(r => r[5]).length} with links) to vote-links/vote-links.csv`)
console.log(`Voting is ${voting.meta?.open ? 'OPEN' : 'closed'}; excluded: ${Object.keys(excluded).join(', ') || 'none'}`)
process.exit(0)
