/**
 * exportSeason.mjs — Read-only end-of-season archive
 *
 * Usage:  node scripts/exportSeason.mjs [label]      (label defaults to "<year>-regular-season")
 *
 * Writes ./backups/season-<label>/ containing:
 *   full-database.json  — every root, verbatim (includes /voting tokens — keep private)
 *   hitting.csv         — /players/{id}/stats/hitting, one row per player
 *   pitching.csv        — /players/{id}/stats/pitching, one row per player
 *   standings.csv       — W/L/T, runs for/against from finalized non-exhibition games
 *   games.csv           — every game record (date, teams, score, finalized, flags)
 *   teams.csv           — team ids → names
 *
 * The database is publicly readable, so this uses the REST API and needs no
 * credentials. Nothing is written back to Firebase.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] }),
)
const DB = env.VITE_FIREBASE_DATABASE_URL.replace(/\/$/, '')

const label = process.argv[2] ?? `${new Date().getFullYear()}-regular-season`
const outDir = new URL(`../backups/season-${label}/`, import.meta.url)
mkdirSync(outDir, { recursive: true })

const res = await fetch(`${DB}/.json`)
if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
const root = await res.json()
const players = root.players ?? {}
const teams = root.teams ?? {}
const games = root.games ?? {}

const csvCell = v => {
  if (v === undefined || v === null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n'
const teamName = id => teams[id]?.name ?? id ?? ''

const named = Object.entries(players)
  .filter(([, p]) => p?.name && !p.isSub)
  .sort(([, a], [, b]) => teamName(a.teamId).localeCompare(teamName(b.teamId)) || a.name.localeCompare(b.name))

const HIT = ['gp', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr', 'r', 'rbi', 'bb', 'k', 'avg', 'obp', 'slg', 'ops']
const PITCH = ['gp', 'inningsPitched', 'era', 'k', 'bb', 'runsAllowed', 'w', 'l', 'cg', 'sv']

const hitting = named.filter(([, p]) => p.stats?.hitting)
  .map(([id, p]) => ({ playerId: id, name: p.name, team: teamName(p.teamId), ...p.stats.hitting }))
const pitching = named.filter(([, p]) => p.stats?.pitching)
  .map(([id, p]) => ({ playerId: id, name: p.name, team: teamName(p.teamId), ...p.stats.pitching }))

// Standings: finalized, non-exhibition games only (same rule as the app).
const exhibitionTeams = new Set(Object.entries(teams).filter(([, t]) => t.isExhibition).map(([id]) => id))
const table = {}
const line = id => (table[id] ??= { team: teamName(id), gp: 0, w: 0, l: 0, t: 0, rf: 0, ra: 0 })
for (const g of Object.values(games)) {
  if (!g.finalized || g.isExhibition || exhibitionTeams.has(g.homeTeamId) || exhibitionTeams.has(g.awayTeamId)) continue
  const h = line(g.homeTeamId), a = line(g.awayTeamId)
  h.gp++; a.gp++
  h.rf += g.homeScore; h.ra += g.awayScore; a.rf += g.awayScore; a.ra += g.homeScore
  if (g.homeScore > g.awayScore) { h.w++; a.l++ } else if (g.awayScore > g.homeScore) { a.w++; h.l++ } else { h.t++; a.t++ }
}
const standings = Object.values(table)
  .map(r => ({ ...r, pct: ((r.w + r.t / 2) / r.gp).toFixed(3), diff: r.rf - r.ra }))
  .sort((x, y) => y.pct - x.pct || y.diff - x.diff)

const gameRows = Object.entries(games)
  .map(([id, g]) => ({
    gameId: id, date: g.date, away: teamName(g.awayTeamId), home: teamName(g.homeTeamId),
    awayScore: g.awayScore, homeScore: g.homeScore, finalized: !!g.finalized,
    exhibition: !!g.isExhibition, forfeit: g.forfeit ? `${teamName(g.forfeit.forfeitingTeamId)} forfeited` : '',
    atBats: Object.keys(root.gameStats?.[id] ?? {}).length,
  }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId))

const write = (name, body) => writeFileSync(new URL(name, outDir), body)
write('full-database.json', JSON.stringify(root, null, 2))
write('hitting.csv', toCsv(['playerId', 'name', 'team', ...HIT], hitting))
write('pitching.csv', toCsv(['playerId', 'name', 'team', ...PITCH], pitching))
write('standings.csv', toCsv(['team', 'gp', 'w', 'l', 't', 'pct', 'rf', 'ra', 'diff'], standings))
write('games.csv', toCsv(['gameId', 'date', 'away', 'awayScore', 'home', 'homeScore', 'finalized', 'exhibition', 'forfeit', 'atBats'], gameRows))
write('teams.csv', toCsv(['teamId', 'name', 'shortName'], Object.entries(teams).map(([id, t]) => ({ teamId: id, ...t }))))

console.log(`Wrote ${outDir.pathname}`)
console.log(`  ${hitting.length} hitters, ${pitching.length} pitchers, ${standings.length} teams, ${gameRows.length} games`)
console.log(`  Unfinalized games: ${gameRows.filter(g => !g.finalized).map(g => g.gameId).join(', ') || 'none'}`)
