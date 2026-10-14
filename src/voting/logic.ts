// Pure season-awards voting rules — no Firebase, no React. The database rules
// (database.rules.json → /voting) enforce the same constraints server-side;
// these helpers keep the ballot page and admin screen in agreement with them.

import { isExhibitionTeam } from '../allstar'
import type {
  Award, AwardsMap, Ballot, BallotsMap, PlayersMap, TeamsMap, VotersMap, VotingExcluded,
} from '../types'

/** Links go out on the league domain. Use www: the bare ogoley.com redirect
 *  drops query strings, and starting at www skips a hop. */
export const VOTE_LINK_BASE = 'https://www.ogoley.com'

export const DEFAULT_VOTING_TITLE = `${new Date().getFullYear()} Season Awards`

export function voteLink(token: string, base = VOTE_LINK_BASE): string {
  return `${base}/vote/${token}`
}

export const STARTER_AWARDS: AwardsMap = {
  mvp:                { name: 'Most Valuable Player', kind: 'player', order: 1, description: 'The player who meant the most to their team this season' },
  cy_young:           { name: 'Cy Young',             kind: 'player', order: 2, description: 'Best pitcher in the league' },
  hitter_of_the_year: { name: 'Hitter of the Year',   kind: 'player', order: 3, description: 'Best bat in the league' },
  rookie_of_the_year: { name: 'Rookie of the Year',   kind: 'player', order: 4, description: 'Best first-year player' },
  best_captain:       { name: 'Best Captain',         kind: 'player', order: 5, description: 'Best team captain' },
}

// ── Awards ───────────────────────────────────────────────────────────────────

export interface AwardEntry extends Award {
  id: string
}

export function sortedAwards(awards: AwardsMap): AwardEntry[] {
  return Object.entries(awards)
    .filter(([, a]) => a && a.name)
    .map(([id, a]) => ({ ...a, id }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}

export function candidateIds(award: Award): string[] {
  return Object.keys(award.candidates ?? {})
}

// ── Who can vote / who can be voted for ──────────────────────────────────────

/** Regular roster players with a name, minus anyone excluded from voting —
 *  the voter pool and the player ballot. Subs live in /subPlayers and stale
 *  nameless nodes exist in /players. */
export function rosterPlayerIds(players: PlayersMap, excluded: VotingExcluded = {}): string[] {
  return Object.entries(players)
    .filter(([id, p]) => p && p.name && !p.isSub && !excluded[id])
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id]) => id)
}

export function ballotTeamIds(teams: TeamsMap): string[] {
  return Object.entries(teams)
    .filter(([id, t]) => t && t.name && !isExhibitionTeam(id, teams))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id]) => id)
}

export interface VoteOption {
  id: string
  name: string
  sub: string     // team name for players, short name for teams
  logo: string
}

export function playerOption(id: string, players: PlayersMap, teams: TeamsMap): VoteOption {
  const p = players[id]
  const team = p ? teams[p.teamId] : undefined
  return { id, name: p?.name ?? id, sub: team?.name ?? '', logo: team?.logoUrl ?? '' }
}

export function teamOption(id: string, teams: TeamsMap): VoteOption {
  const t = teams[id]
  return { id, name: t?.name ?? id, sub: t?.shortName ?? '', logo: t?.logoUrl ?? '' }
}

export function optionLabel(award: Award, id: string, players: PlayersMap, teams: TeamsMap): VoteOption {
  return award.kind === 'team' ? teamOption(id, teams) : playerOption(id, players, teams)
}

/** Everything a given voter may pick for an award: the candidate list (or the
 *  whole roster / league), minus themselves, excluded players and — for team
 *  awards — their own team. Mirrors the /voting/ballots/$playerId/picks rule. */
export function optionsForAward(
  award: Award,
  players: PlayersMap,
  teams: TeamsMap,
  voterId?: string | null,
  excluded: VotingExcluded = {},
): VoteOption[] {
  const restricted = award.candidates ? new Set(candidateIds(award)) : null
  if (award.kind === 'team') {
    const ownTeam = voterId ? players[voterId]?.teamId : undefined
    return ballotTeamIds(teams)
      .filter(id => id !== ownTeam && (!restricted || restricted.has(id)))
      .map(id => teamOption(id, teams))
  }
  return rosterPlayerIds(players, excluded)
    .filter(id => id !== voterId && (!restricted || restricted.has(id)))
    .map(id => playerOption(id, players, teams))
}

/** Drops blanks, picks for awards that no longer exist, and picks that are no
 *  longer valid for this voter — what's left is safe to write. */
export function cleanPicks(
  picks: Record<string, string>,
  awards: AwardsMap,
  players: PlayersMap,
  teams: TeamsMap,
  voterId: string | null,
  excluded: VotingExcluded = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [awardId, pick] of Object.entries(picks)) {
    const award = awards[awardId]
    if (!pick || !award) continue
    if (optionsForAward(award, players, teams, voterId, excluded).some(o => o.id === pick)) out[awardId] = pick
  }
  return out
}

/** The voter's submit: ballot + votedAt in one atomic multi-path update. The
 *  rules only accept votedAt alongside a ballot carrying the same token.
 *  `stamp` is serverTimestamp() at the call site (kept out to stay pure). */
export function buildBallotUpdates(
  token: string,
  playerId: string,
  picks: Record<string, string>,
  stamp: unknown,
): Record<string, unknown> {
  return {
    [`voting/ballots/${playerId}`]: { token, picks, submittedAt: stamp },
    [`voting/voters/${token}/votedAt`]: stamp,
  }
}

// ── Links ────────────────────────────────────────────────────────────────────

export interface VoterLink {
  token: string
  createdAt: number
  votedAt?: number
}

/** playerId → their current link. If a player somehow holds several tokens the
 *  newest wins (reissue deletes the old one, so this is belt-and-braces). */
export function linksByPlayer(voters: VotersMap): Map<string, VoterLink> {
  const out = new Map<string, VoterLink>()
  for (const [token, v] of Object.entries(voters)) {
    if (!v?.playerId) continue
    const prev = out.get(v.playerId)
    if (!prev || (v.createdAt ?? 0) > prev.createdAt) {
      out.set(v.playerId, { token, createdAt: v.createdAt ?? 0, votedAt: v.votedAt })
    }
  }
  return out
}

/** Writes that give every listed player a fresh link. `makeToken` is
 *  crypto.randomUUID at the call site (122 random bits — unguessable). */
export function newVoterUpdates(
  playerIds: string[],
  makeToken: () => string,
  now: number,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const playerId of playerIds) {
    updates[`voting/voters/${makeToken()}`] = { playerId, createdAt: now }
  }
  return updates
}

export function inviteMessage(name: string, link: string, title = DEFAULT_VOTING_TITLE): string {
  const first = name.trim().split(/\s+/)[0] || name
  return `Hey ${first}! ${title} voting is open. Here's your personal ballot — the link is yours alone, please don't share it: ${link}`
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export interface LinkRow {
  team: string
  name: string
  playerId: string
  link: string
  voted: boolean
  message: string
}

export function linksCsv(rows: LinkRow[]): string {
  const header = ['team', 'name', 'playerId', 'link', 'voted', 'message']
  const lines = rows.map(r => [r.team, r.name, r.playerId, r.link, r.voted ? 'yes' : 'no', r.message].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\n') + '\n'
}

// ── Turnout + results ────────────────────────────────────────────────────────

export interface TeamTurnout {
  teamId: string
  teamName: string
  players: { playerId: string; name: string; voted: boolean; hasLink: boolean }[]
  voted: number
  total: number
}

/** Per-team turnout over the voter pool. "Voted" = a ballot exists for the
 *  player (ballots are keyed by player, so this is the source of truth). */
export function turnoutByTeam(
  players: PlayersMap,
  teams: TeamsMap,
  voters: VotersMap,
  ballots: BallotsMap,
  excluded: VotingExcluded = {},
): TeamTurnout[] {
  const links = linksByPlayer(voters)
  const byTeam = new Map<string, TeamTurnout>()
  for (const playerId of rosterPlayerIds(players, excluded)) {
    const p = players[playerId]
    let row = byTeam.get(p.teamId)
    if (!row) {
      row = { teamId: p.teamId, teamName: teams[p.teamId]?.name ?? p.teamId, players: [], voted: 0, total: 0 }
      byTeam.set(p.teamId, row)
    }
    const voted = !!ballots[playerId]
    row.players.push({ playerId, name: p.name, voted, hasLink: links.has(playerId) })
    row.total += 1
    if (voted) row.voted += 1
  }
  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName))
}

export interface TallyRow {
  id: string
  votes: number
  rank: number    // competition ranking — ties share a rank
}

export function tallyAward(awardId: string, ballots: BallotsMap): { rows: TallyRow[]; counted: number } {
  const counts = new Map<string, number>()
  let counted = 0
  for (const b of Object.values(ballots) as Ballot[]) {
    const pick = b?.picks?.[awardId]
    if (!pick) continue
    counted += 1
    counts.set(pick, (counts.get(pick) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows: TallyRow[] = []
  sorted.forEach(([id, votes], i) => {
    const rank = i > 0 && votes === sorted[i - 1][1] ? rows[i - 1].rank : i + 1
    rows.push({ id, votes, rank })
  })
  return { rows, counted }
}
