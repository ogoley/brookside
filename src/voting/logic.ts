// Pure season-awards voting rules — no Firebase, no React. The database rules
// (database.rules.json → /voting) enforce the same constraints server-side;
// these helpers keep the ballot page and admin screen in agreement with them.

import { isExhibitionTeam } from '../allstar'
import type {
  Award, AwardKind, AwardsMap, Ballot, BallotsMap, PlayersMap, TeamsMap, VotersMap, VotingExcluded,
} from '../types'

/** Links go out on the league domain. Use www: the bare ogoley.com redirect
 *  drops query strings, and starting at www skips a hop. */
export const VOTE_LINK_BASE = 'https://www.ogoley.com'

export const DEFAULT_VOTING_TITLE = `${new Date().getFullYear()} Season Awards`

export function voteLink(token: string, base = VOTE_LINK_BASE): string {
  return `${base}/vote/${token}`
}

// ── Deadline ─────────────────────────────────────────────────────────────────

/** 2026 deadline: first pitch of semifinal game one, Sun Oct 18, 11:00 AM Eastern. */
export const VOTING_DEADLINE_2026 = Date.parse('2026-10-18T11:00:00-04:00')

/** Whether a ballot would be accepted right now. Mirrors the database rule
 *  (which uses server time, so this is only the UI's best guess). */
export function votingAccepting(meta: { open?: boolean; closesAt?: number } | null | undefined, now: number): boolean {
  return !!meta?.open && (meta.closesAt == null || now < meta.closesAt)
}

/** "Sunday, Oct 18 at 11:00 AM ET" */
export function formatDeadline(ms: number): string {
  const tz = 'America/New_York'
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(ms)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms)
  return `${day} at ${time} ET`
}

/** Eastern wall-clock "YYYY-MM-DDTHH:MM" (a datetime-local value) → epoch ms,
 *  handling EDT/EST. Returns null for a malformed value. */
export function easternLocalToEpoch(local: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  for (const offset of ['-04:00', '-05:00']) {
    const ms = Date.parse(`${local}:00${offset}`)
    if (epochToEasternLocal(ms) === local) return ms
  }
  return null
}

/** epoch ms → Eastern wall-clock "YYYY-MM-DDTHH:MM" (for a datetime-local input). */
export function epochToEasternLocal(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ms)
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

// 2026 ballot as agreed by the commissioners (2026-10-14). Rookie, Best Value
// Pick and Best Ump need a finalists list (`candidates`) set in /vote-admin.
export const STARTER_AWARDS: AwardsMap = {
  mvp:                { name: 'Most Valuable Player', kind: 'player', order: 1, description: 'The player who meant the most to their team this season' },
  cy_young:           { name: 'Cy Young',             kind: 'player', order: 2, description: 'Best pitcher in the league' },
  hitter_of_the_year: { name: 'Hitter of the Year',   kind: 'player', order: 3, description: 'Best bat in the league' },
  gold_glove:         { name: 'Gold Glove',           kind: 'player', order: 4, description: 'Best fielder in the league' },
  rookie_of_the_year: { name: 'Rookie of the Year',   kind: 'player', order: 5, description: 'Best first-year player' },
  best_value_pick:    { name: 'Best Value Pick',      kind: 'player', order: 6, description: 'Best player compared to where they were drafted' },
  best_ump:           { name: 'Best Ump',             kind: 'player', order: 7, description: 'Best umpire of the season' },
  papa_fushuego:      { name: 'Papa Fushuego Award',  kind: 'player', order: 8, description: 'Fun, energy, promoting the league, and all-around good vibes' },
}

/** Award ids with a bundled badge in public/awards/{id}.svg */
const BUNDLED_ICONS = new Set(['mvp', 'cy_young', 'hitter_of_the_year', 'gold_glove', 'rookie_of_the_year', 'best_value_pick', 'best_ump', 'papa_fushuego'])

/** Badge for an award: its own `icon`, else the bundled one for known ids, else null. */
export function awardIcon(award: { id: string; icon?: string }): string | null {
  return award.icon ?? (BUNDLED_ICONS.has(award.id) ? `/awards/${award.id}.svg` : null)
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
  teamId: string  // the player's team (players) or the team itself (teams) — groups "browse by team"
}

export function playerOption(id: string, players: PlayersMap, teams: TeamsMap): VoteOption {
  const p = players[id]
  const team = p ? teams[p.teamId] : undefined
  return { id, name: p?.name ?? id, sub: team?.name ?? '', logo: team?.logoUrl ?? '', teamId: p?.teamId ?? '' }
}

export function teamOption(id: string, teams: TeamsMap): VoteOption {
  const t = teams[id]
  return { id, name: t?.name ?? id, sub: t?.shortName ?? '', logo: t?.logoUrl ?? '', teamId: id }
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

/** Writes that replace EVERY link for the given players with a fresh one
 *  (old links stop working). A player who already has a ballot keeps
 *  "already voted" on the new link. */
export function reissueAllUpdates(
  voters: VotersMap,
  playerIds: string[],
  ballots: Record<string, { submittedAt: number }>,
  makeToken: () => string,
  now: number,
): Record<string, unknown> {
  const wanted = new Set(playerIds)
  const updates: Record<string, unknown> = {}
  for (const [token, v] of Object.entries(voters)) {
    if (v?.playerId && wanted.has(v.playerId)) updates[`voting/voters/${token}`] = null
  }
  for (const playerId of playerIds) {
    const fresh: Record<string, unknown> = { playerId, createdAt: now }
    if (ballots[playerId]) fresh.votedAt = ballots[playerId].submittedAt
    updates[`voting/voters/${makeToken()}`] = fresh
  }
  return updates
}

/** The per-player Spond DM. Keep in sync with scripts/voteLinks.mjs. */
export function inviteMessage(name: string, link: string, title = DEFAULT_VOTING_TITLE, closesAt?: number | null): string {
  const first = name.trim().split(/\s+/)[0] || name
  return [
    `Hey ${first}! 🏆 ${title} voting is open.`,
    `This is your own personal ballot. The link only works for you, so please don't share it:`,
    link,
    ...(closesAt != null ? [`⏰ Voting closes ${formatDeadline(closesAt)}. After that, the link stops taking votes.`] : []),
    `It's 8 awards and takes a couple of minutes on your phone. We strongly encourage everyone to vote on every award you have a preference on. Skip any you don't. You can't vote for yourself, and once you submit, your ballot is final.`,
    `Thanks for a great season!`,
  ].join('\n\n')
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

// ── Awards night ─────────────────────────────────────────────────────────────

/** The rows revealed on air for one award: everyone ranked 1st–3rd (ties share
 *  a rank, so a tie for 3rd can make it four rows), with names and team ids
 *  denormalised so the overlay can draw them without reading /voting. */
export function revealTopRows(
  award: { id: string; kind: AwardKind },
  ballots: BallotsMap,
  players: PlayersMap,
  teams: TeamsMap,
): { top: { id: string; name: string; teamId: string; votes: number; rank: number }[]; counted: number } {
  const { rows, counted } = tallyAward(award.id, ballots)
  const top = rows.filter(r => r.rank <= 3).slice(0, 4).map(r => award.kind === 'team'
    ? { id: r.id, name: teams[r.id]?.name ?? r.id, teamId: r.id, votes: r.votes, rank: r.rank }
    : { id: r.id, name: players[r.id]?.name ?? r.id, teamId: players[r.id]?.teamId ?? '', votes: r.votes, rank: r.rank })
  return { top, counted }
}
