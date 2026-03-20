/**
 * seedPlayers.js — One-time player data import
 *
 * Usage:  npm run seed
 *
 * What it does:
 *   1. Reads Firebase config from .env.local
 *   2. Fetches /teams from Firebase to build a name→id map
 *   3. Remaps old season team names to new season team names
 *   4. Duplicates two rosters to fill the two new teams (Moose Knucklers, Yetis)
 *   5. Pushes all players to /players
 *
 * ⚠️  TEAM_MAP values must match EXACTLY what you typed in /config.
 *     If a team name doesn't match, that player is skipped with a warning.
 *
 * Run once. If you need to re-run, delete /players in Firebase first.
 */

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, push } from 'firebase/database'

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

// ── Team name mapping: old season → new season ───────────────────────────────
// ⚠️  Right-hand values must match team names exactly as entered in /config
const TEAM_MAP = {
  'Mariners':      'Wiffle Whalers',
  "Banana's":      'Swing Mafia',
  "A's":           'Nuke Squad',
  'Indians':       'Gamecocks',
  'Padres':        'Base Invaders',
  'Diamondbacks':  'Trash Pandas',
}

// Two new teams — each gets a copy of an existing (new-named) team's roster
const DUPLICATE_ROSTERS = [
  { newTeam: 'Moose Knucklers', copyFrom: 'Wiffle Whalers' },
  { newTeam: 'Yellow Bat Yetis', copyFrom: 'Gamecocks' },
]

// ── Last season's hitting stats ───────────────────────────────────────────────
const RAW_PLAYERS = [
  { Name: 'Dave Rist',          Team: 'Mariners',      number: '11', GP:'7',  PA:'39', AB:'35', H:'24', '2B':'0', '3B':'0', HR:'6',  R:'19', RBI:'19', BB:'4',  K:'1',  AVG:'0.686', OBP:'0.718', SLG:'1.2',   OPS:'1.918' },
  { Name: 'Michael Verteramo',  Team: 'Mariners',      number: '',   GP:'9',  PA:'56', AB:'47', H:'29', '2B':'0', '3B':'0', HR:'4',  R:'17', RBI:'19', BB:'9',  K:'6',  AVG:'0.617', OBP:'0.679', SLG:'0.872', OPS:'1.551' },
  { Name: 'Rob Holden',         Team: 'Mariners',      number: '',   GP:'8',  PA:'47', AB:'44', H:'25', '2B':'0', '3B':'0', HR:'2',  R:'15', RBI:'15', BB:'3',  K:'7',  AVG:'0.568', OBP:'0.596', SLG:'0.705', OPS:'1.3'   },
  { Name: "Kris O'Connor",      Team: 'Mariners',      number: '23', GP:'9',  PA:'51', AB:'49', H:'24', '2B':'0', '3B':'0', HR:'3',  R:'14', RBI:'21', BB:'2',  K:'7',  AVG:'0.49',  OBP:'0.51',  SLG:'0.673', OPS:'1.183' },
  { Name: 'Michael Schoen',     Team: 'Mariners',      number: '',   GP:'7',  PA:'35', AB:'31', H:'10', '2B':'0', '3B':'0', HR:'0',  R:'5',  RBI:'1',  BB:'4',  K:'6',  AVG:'0.323', OBP:'0.4',   SLG:'0.323', OPS:'0.723' },
  { Name: 'Joe Hutch',          Team: 'Mariners',      number: '55', GP:'5',  PA:'29', AB:'26', H:'6',  '2B':'0', '3B':'0', HR:'0',  R:'4',  RBI:'3',  BB:'3',  K:'7',  AVG:'0.231', OBP:'0.31',  SLG:'0.231', OPS:'0.541' },

  { Name: 'Mark Davis',         Team: "Banana's",      number: '',   GP:'7',  PA:'43', AB:'41', H:'25', '2B':'0', '3B':'0', HR:'6',  R:'15', RBI:'14', BB:'2',  K:'4',  AVG:'0.61',  OBP:'0.628', SLG:'1.049', OPS:'1.677' },
  { Name: 'Thai Bui',           Team: "Banana's",      number: '',   GP:'4',  PA:'21', AB:'18', H:'10', '2B':'0', '3B':'0', HR:'1',  R:'4',  RBI:'3',  BB:'3',  K:'4',  AVG:'0.556', OBP:'0.619', SLG:'0.722', OPS:'1.341' },
  { Name: 'Jaye Hayes',         Team: "Banana's",      number: '',   GP:'5',  PA:'32', AB:'26', H:'13', '2B':'0', '3B':'0', HR:'0',  R:'6',  RBI:'8',  BB:'6',  K:'8',  AVG:'0.5',   OBP:'0.594', SLG:'0.5',   OPS:'1.094' },
  { Name: 'Chris Spring',       Team: "Banana's",      number: '',   GP:'8',  PA:'47', AB:'43', H:'18', '2B':'0', '3B':'0', HR:'2',  R:'8',  RBI:'11', BB:'4',  K:'9',  AVG:'0.419', OBP:'0.468', SLG:'0.558', OPS:'1.026' },
  { Name: 'Joey Lafluer',       Team: "Banana's",      number: '24', GP:'6',  PA:'35', AB:'34', H:'11', '2B':'0', '3B':'0', HR:'2',  R:'4',  RBI:'4',  BB:'1',  K:'10', AVG:'0.324', OBP:'0.343', SLG:'0.5',   OPS:'0.843' },
  { Name: 'Josh Griffith',      Team: "Banana's",      number: '4',  GP:'3',  PA:'16', AB:'16', H:'4',  '2B':'0', '3B':'0', HR:'0',  R:'3',  RBI:'0',  BB:'0',  K:'9',  AVG:'0.25',  OBP:'0.25',  SLG:'0.25',  OPS:'0.5'   },
  { Name: 'John Chappel',       Team: "Banana's",      number: '11', GP:'7',  PA:'37', AB:'33', H:'5',  '2B':'0', '3B':'0', HR:'0',  R:'3',  RBI:'2',  BB:'4',  K:'23', AVG:'0.152', OBP:'0.243', SLG:'0.152', OPS:'0.395' },

  { Name: 'Kyle Venancio',      Team: "A's",           number: '',   GP:'8',  PA:'50', AB:'47', H:'28', '2B':'3', '3B':'0', HR:'0',  R:'8',  RBI:'5',  BB:'3',  K:'9',  AVG:'0.596', OBP:'0.62',  SLG:'0.66',  OPS:'1.28'  },
  { Name: 'Brian Lenahan',      Team: "A's",           number: '4',  GP:'8',  PA:'48', AB:'44', H:'20', '2B':'0', '3B':'0', HR:'2',  R:'12', RBI:'9',  BB:'4',  K:'8',  AVG:'0.455', OBP:'0.5',   SLG:'0.591', OPS:'1.091' },
  { Name: 'Lids Venancio',      Team: "A's",           number: '10', GP:'9',  PA:'57', AB:'49', H:'19', '2B':'0', '3B':'0', HR:'0',  R:'8',  RBI:'14', BB:'8',  K:'11', AVG:'0.388', OBP:'0.474', SLG:'0.388', OPS:'0.861' },
  { Name: 'Gary Wright',        Team: "A's",           number: '',   GP:'6',  PA:'37', AB:'31', H:'12', '2B':'0', '3B':'0', HR:'3',  R:'8',  RBI:'8',  BB:'6',  K:'9',  AVG:'0.387', OBP:'0.486', SLG:'0.677', OPS:'1.164' },
  { Name: 'Brian Bergeron',     Team: "A's",           number: '',   GP:'7',  PA:'40', AB:'34', H:'11', '2B':'0', '3B':'0', HR:'1',  R:'6',  RBI:'6',  BB:'6',  K:'12', AVG:'0.324', OBP:'0.425', SLG:'0.412', OPS:'0.837' },
  { Name: 'Dwayne Lapinski',    Team: "A's",           number: '25', GP:'3',  PA:'12', AB:'11', H:'2',  '2B':'0', '3B':'0', HR:'0',  R:'0',  RBI:'0',  BB:'1',  K:'3',  AVG:'0.182', OBP:'0.25',  SLG:'0.182', OPS:'0.432' },

  { Name: 'Joe Ogoley',         Team: 'Indians',       number: '',   GP:'8',  PA:'43', AB:'42', H:'23', '2B':'0', '3B':'0', HR:'4',  R:'10', RBI:'12', BB:'1',  K:'10', AVG:'0.548', OBP:'0.558', SLG:'0.833', OPS:'1.391' },
  { Name: 'Keith Venancio',     Team: 'Indians',       number: '8',  GP:'9',  PA:'55', AB:'54', H:'27', '2B':'0', '3B':'0', HR:'1',  R:'12', RBI:'11', BB:'1',  K:'7',  AVG:'0.5',   OBP:'0.509', SLG:'0.556', OPS:'1.065' },
  { Name: 'Casey Edgar',        Team: 'Indians',       number: '',   GP:'6',  PA:'29', AB:'24', H:'10', '2B':'0', '3B':'0', HR:'0',  R:'7',  RBI:'5',  BB:'5',  K:'3',  AVG:'0.417', OBP:'0.517', SLG:'0.417', OPS:'0.934' },
  { Name: 'Jordan Pitzer',      Team: 'Indians',       number: '',   GP:'6',  PA:'34', AB:'30', H:'12', '2B':'0', '3B':'0', HR:'2',  R:'8',  RBI:'10', BB:'4',  K:'5',  AVG:'0.4',   OBP:'0.471', SLG:'0.6',   OPS:'1.071' },
  { Name: 'Dennis Nelson',      Team: 'Indians',       number: '',   GP:'9',  PA:'44', AB:'43', H:'12', '2B':'0', '3B':'0', HR:'1',  R:'12', RBI:'12', BB:'1',  K:'14', AVG:'0.279', OBP:'0.295', SLG:'0.349', OPS:'0.644' },
  { Name: 'Brian Stromwall',    Team: 'Indians',       number: '',   GP:'4',  PA:'20', AB:'18', H:'4',  '2B':'0', '3B':'0', HR:'1',  R:'3',  RBI:'4',  BB:'2',  K:'3',  AVG:'0.222', OBP:'0.3',   SLG:'0.389', OPS:'0.689' },

  { Name: 'Brendan McDonald',   Team: 'Padres',        number: '',   GP:'9',  PA:'45', AB:'42', H:'21', '2B':'0', '3B':'0', HR:'1',  R:'7',  RBI:'10', BB:'3',  K:'6',  AVG:'0.5',   OBP:'0.533', SLG:'0.571', OPS:'1.105' },
  { Name: 'Rick Holden',        Team: 'Padres',        number: '',   GP:'7',  PA:'33', AB:'30', H:'14', '2B':'0', '3B':'0', HR:'1',  R:'8',  RBI:'2',  BB:'3',  K:'6',  AVG:'0.467', OBP:'0.515', SLG:'0.567', OPS:'1.082' },
  { Name: 'Eric Hiller',        Team: 'Padres',        number: '',   GP:'6',  PA:'24', AB:'22', H:'9',  '2B':'0', '3B':'0', HR:'1',  R:'2',  RBI:'2',  BB:'2',  K:'5',  AVG:'0.409', OBP:'0.458', SLG:'0.545', OPS:'1.004' },
  { Name: 'Anthony Mazzaferro', Team: 'Padres',        number: '18', GP:'6',  PA:'30', AB:'28', H:'10', '2B':'0', '3B':'0', HR:'1',  R:'2',  RBI:'9',  BB:'2',  K:'7',  AVG:'0.357', OBP:'0.4',   SLG:'0.464', OPS:'0.864' },
  { Name: 'Chris Frapp',        Team: 'Padres',        number: '',   GP:'8',  PA:'39', AB:'39', H:'11', '2B':'0', '3B':'0', HR:'0',  R:'5',  RBI:'3',  BB:'0',  K:'8',  AVG:'0.282', OBP:'0.282', SLG:'0.282', OPS:'0.564' },
  { Name: 'Jon Spring',         Team: 'Padres',        number: '',   GP:'8',  PA:'37', AB:'35', H:'9',  '2B':'0', '3B':'0', HR:'2',  R:'5',  RBI:'6',  BB:'2',  K:'8',  AVG:'0.257', OBP:'0.297', SLG:'0.429', OPS:'0.726' },

  { Name: 'Dom Pellegrino',     Team: 'Diamondbacks',  number: '',   GP:'5',  PA:'25', AB:'25', H:'12', '2B':'0', '3B':'0', HR:'2',  R:'5',  RBI:'5',  BB:'0',  K:'6',  AVG:'0.48',  OBP:'0.48',  SLG:'0.72',  OPS:'1.2'   },
  { Name: 'Tom Ogoley',         Team: 'Diamondbacks',  number: '',   GP:'7',  PA:'44', AB:'41', H:'18', '2B':'0', '3B':'0', HR:'5',  R:'11', RBI:'15', BB:'3',  K:'5',  AVG:'0.439', OBP:'0.477', SLG:'0.805', OPS:'1.282' },
  { Name: 'Brian Harrigan',     Team: 'Diamondbacks',  number: '',   GP:'8',  PA:'50', AB:'45', H:'17', '2B':'0', '3B':'0', HR:'0',  R:'13', RBI:'9',  BB:'5',  K:'11', AVG:'0.378', OBP:'0.44',  SLG:'0.378', OPS:'0.818' },
  { Name: 'Matt Wrisley',       Team: 'Diamondbacks',  number: '24', GP:'7',  PA:'39', AB:'39', H:'13', '2B':'0', '3B':'0', HR:'5',  R:'7',  RBI:'7',  BB:'0',  K:'9',  AVG:'0.333', OBP:'0.333', SLG:'0.718', OPS:'1.051' },
  { Name: 'Jason Menard',       Team: 'Diamondbacks',  number: '7',  GP:'8',  PA:'51', AB:'46', H:'12', '2B':'0', '3B':'0', HR:'2',  R:'10', RBI:'8',  BB:'5',  K:'11', AVG:'0.261', OBP:'0.333', SLG:'0.391', OPS:'0.725' },
  { Name: 'Mark Pafumi',        Team: 'Diamondbacks',  number: '13', GP:'2',  PA:'9',  AB:'9',  H:'2',  '2B':'0', '3B':'0', HR:'0',  R:'0',  RBI:'0',  BB:'0',  K:'1',  AVG:'0.222', OBP:'0.222', SLG:'0.222', OPS:'0.444' },
]

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Fetch teams from Firebase
  const teamsSnap = await get(ref(db, 'teams'))
  if (!teamsSnap.exists()) {
    console.error('❌  No teams found in Firebase. Create all teams in /config first.')
    process.exit(1)
  }

  // Build name → Firebase ID map
  const nameToId = {}
  teamsSnap.forEach(child => {
    nameToId[child.val().name] = child.key
  })
  console.log('Teams found in Firebase:', Object.keys(nameToId).join(', '), '\n')

  // 2. Remap old team names to new team names
  let players = RAW_PLAYERS.map(p => ({
    ...p,
    Team: TEAM_MAP[p.Team] ?? p.Team,
  }))

  // 3. Duplicate rosters for the two new teams
  for (const { newTeam, copyFrom } of DUPLICATE_ROSTERS) {
    const source = players.filter(p => p.Team === copyFrom)
    players = [...players, ...source.map(p => ({ ...p, Team: newTeam }))]
    console.log(`Duplicated ${source.length} players from "${copyFrom}" → "${newTeam}"`)
  }

  // 4. Push each player to /players
  let pushed = 0
  let skipped = 0

  for (const p of players) {
    const teamId = nameToId[p.Team]
    if (!teamId) {
      console.warn(`⚠️  No Firebase team found for "${p.Team}" — skipping ${p.Name}`)
      skipped++
      continue
    }

    await push(ref(db, 'players'), {
      name:         p.Name,
      teamId,
      position:     'hitter',
      jerseyNumber: p.number || '',
      stats: {
        hitting: {
          gp:      Number(p.GP),
          pa:      Number(p.PA),
          ab:      Number(p.AB),
          h:       Number(p.H),
          doubles: Number(p['2B']),
          triples: Number(p['3B']),
          hr:      Number(p.HR),
          r:       Number(p.R),
          rbi:     Number(p.RBI),
          bb:      Number(p.BB),
          k:       Number(p.K),
          avg:     Number(p.AVG),
          obp:     Number(p.OBP),
          slg:     Number(p.SLG),
          ops:     Number(p.OPS),
        },
      },
    })

    console.log(`✓  ${p.Name.padEnd(22)} → ${p.Team}`)
    pushed++
  }

  console.log(`\n✅  Done: ${pushed} players pushed, ${skipped} skipped.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
