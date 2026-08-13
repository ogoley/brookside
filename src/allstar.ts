import type { Player, PlayersMap, Team, TeamsMap } from './types'

// ── 2026 Brookside All-Star Game ─────────────────────────────────────────────
// Team Rist and Team Hiller are exhibition teams whose players keep their
// regular-season teamId in /players. Membership lives in a roster mapping at
// /config/allstar/rosters (admin-writable), seeded from the constants below
// via the "All-Star Game" section in /config. All player-by-team filtering
// must go through playerOnTeam()/buildPlayerTeamMap() so rostered players
// show up under their all-star team when an all-star team is selected.

export const ALLSTAR_TEAM_IDS = ['team_rist', 'team_hiller'] as const
export type AllstarTeamId = (typeof ALLSTAR_TEAM_IDS)[number]

// teamId → ordered playerId[] (draft order; scorekeeper lineups override order)
export type AllstarRosters = Record<string, string[]>

export const ALLSTAR_SEED_TEAMS: Record<AllstarTeamId, Team> = {
  team_rist: {
    name: 'Team Rist',
    shortName: 'RIST',
    primaryColor: '#c8102e',
    secondaryColor: '#ffffff',
    logoUrl: '/logos/team-rist.svg',
    isExhibition: true,
  },
  team_hiller: {
    name: 'Team Hiller',
    shortName: 'HILLER',
    primaryColor: '#1e40af',
    secondaryColor: '#ffffff',
    logoUrl: '/logos/team-hiller.svg',
    isExhibition: true,
  },
}

export const ALLSTAR_SEED_ROSTERS: Record<AllstarTeamId, string[]> = {
  team_rist: [
    'david_rist',            // Dave Rist (Nuke Squad)
    'mark_davis',            // Mark Davis (Base Invaders)
    'michael_verteramo',     // Mike Verteramo (Wiffle Whalers)
    'rob_holden',            // Rob Holden (Trash Pandas)
    'tom_ogoley',            // Tom Ogoley (Trash Pandas)
    'joseph_lafleur',        // Joey LaFleur (Moose Knucklers)
    'keith_venancio',        // Keith Venancio (Swing Mafia)
    'jonathan_spring',       // Jon Spring (Yellow Bat Yetis)
    'rick_holden',           // Rick Holden (Yellow Bat Yetis)
    'kris_oconnor',          // Kris O'Connor (Moose Knucklers)
  ],
  team_hiller: [
    'eric_hiller',           // Eric Hiller (Wiffle Whalers)
    'dragon_ogoley',         // Joe "Dragon" Ogoley (Nuke Squad)
    'casey_edgar',           // Casey Edgar (Base Invaders)
    'jake_mastorakis',       // Jake Mastorakis (Swing Mafia)
    'denny_nelson',          // Denny Nelson (Gamecocks)
    'brendan_mcdonald',      // Macker / Brendan (Yellow Bat Yetis)
    'gary_wright',           // Gary Wright (Gamecocks)
    'chris_spring',          // Chris Spring (Wiffle Whalers)
    'brian_harrigan',        // Brian Harrigan (Base Invaders)
    '-OtHHZTZG-3lDFkt196W',  // Mike LaFleur (Moose Knucklers)
  ],
}

// Year-independent filename — the generator rewrites this file each year, so
// no code change is needed when the lockup's year text changes.
export const ALLSTAR_LOGO_URL = '/logos/allstar-weekend.svg'

// The 2026 teams predate the isExhibition flag and may be deleted after the
// event — historical game records referencing these ids must stay exhibition
// forever, so they are baked in as a fallback. Future years' teams are
// detected purely by their `isExhibition: true` team-record flag (set by the
// seed) and the `isExhibition` flag stamped on game records at creation.
const LEGACY_EXHIBITION_TEAM_IDS: ReadonlySet<string> = new Set(['team_rist', 'team_hiller'])

export function isExhibitionTeam(teamId: string | null | undefined, teams?: TeamsMap): boolean {
  if (!teamId) return false
  if (LEGACY_EXHIBITION_TEAM_IDS.has(teamId)) return true
  return teams?.[teamId]?.isExhibition === true
}

/** An all-star matchup is an exhibition — never finalized into season stats
 *  and excluded from live season-stat merges. Checks, in order: the flag
 *  denormalized onto the game record at creation, then either team's
 *  isExhibition flag, then the legacy 2026 ids. */
export function isExhibitionGame(
  g: { homeTeamId?: string; awayTeamId?: string; isExhibition?: boolean } | null | undefined,
  teams?: TeamsMap,
): boolean {
  if (!g) return false
  if (g.isExhibition === true) return true
  return isExhibitionTeam(g.homeTeamId, teams) || isExhibitionTeam(g.awayTeamId, teams)
}

/** Roster-aware replacement for `player.teamId === teamId`. When `teamId` has
 *  an all-star roster, membership comes from that roster; otherwise it falls
 *  back to the player's league team. `rosters` may be null before seeding —
 *  behavior is then identical to the plain teamId check. */
export function playerOnTeam(
  playerId: string,
  player: Player | undefined,
  teamId: string,
  rosters: AllstarRosters | null,
): boolean {
  const roster = rosters?.[teamId]
  if (roster) return roster.includes(playerId)
  return player?.teamId === teamId
}

/** Which side of THIS game a player belongs to (or undefined if neither).
 *  Checks all-star rosters first so league teammates split across Rist/Hiller
 *  land on the right side. */
export function effectiveGameTeamId(
  playerId: string,
  player: Player | undefined,
  homeTeamId: string,
  awayTeamId: string,
  rosters: AllstarRosters | null,
): string | undefined {
  if (playerOnTeam(playerId, player, homeTeamId, rosters)) return homeTeamId
  if (playerOnTeam(playerId, player, awayTeamId, rosters)) return awayTeamId
  return undefined
}

/** playerId → teamId map for the scoring engine (computeLineupPosition etc.).
 *  Starts from league teamIds, then overrides rostered players with their
 *  all-star team for the two teams in this game. */
export function buildPlayerTeamMap(
  players: PlayersMap,
  homeTeamId: string,
  awayTeamId: string,
  rosters: AllstarRosters | null,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [id, p] of Object.entries(players)) map[id] = p.teamId
  for (const teamId of [homeTeamId, awayTeamId]) {
    const roster = rosters?.[teamId]
    if (!roster) continue
    for (const pid of roster) map[pid] = teamId
  }
  return map
}
