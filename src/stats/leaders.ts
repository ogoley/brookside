// Season leader queries shared by the Leaders scene and the bottom-line
// ticker. Pure functions over /players + standings — no Firebase, no React.
import type { Player, PlayersMap, StandingsData } from '../types'

// ── Qualification thresholds ─────────────────────────────────────────────────
export const MIN_AB_PER_GAME = 2   // AB per team game to qualify for AVG
export const MIN_IP_PCTG   = 0.30  // pitcher must have thrown in ≥30% of team games
export const GAME_INNINGS  = 7     // regulation innings — scales the IP minimum

export interface LeaderEntry {
  id: string
  player: Player
}

/** teamId → games played, derived from standings rows (W+L+T). */
export function teamGamesFromStandings(standings: StandingsData): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of standings) out[s.teamId] = s.w + s.l + s.t
  return out
}

function isSeasonPlayer(p: Player | undefined): p is Player {
  return !!p && typeof p.name === 'string' && p.name.trim() !== '' && !p.isSub
}

/** Batting-average leaders (min 2 AB per team game), tie-break OPS. */
export function battingLeaders(players: PlayersMap, teamGames: Record<string, number>, limit = 10): LeaderEntry[] {
  return Object.entries(players)
    .filter(([, p]) => {
      if (!isSeasonPlayer(p)) return false
      const games = teamGames[p.teamId] ?? 0
      const minAb = Math.max(1, games * MIN_AB_PER_GAME)
      return (p.stats?.hitting?.ab ?? 0) >= minAb && p.stats?.hitting?.avg !== undefined
    })
    .sort(([, a], [, b]) => {
      const avgDiff = (b.stats.hitting!.avg ?? 0) - (a.stats.hitting!.avg ?? 0)
      if (avgDiff !== 0) return avgDiff
      return (b.stats.hitting!.ops ?? 0) - (a.stats.hitting!.ops ?? 0)
    })
    .slice(0, limit)
    .map(([id, player]) => ({ id, player }))
}

/** Home-run leaders — no qualification (a homer is a homer), tie-break RBI. */
export function homeRunLeaders(players: PlayersMap, limit = 5): LeaderEntry[] {
  return Object.entries(players)
    .filter(([, p]) => isSeasonPlayer(p) && (p.stats?.hitting?.hr ?? 0) > 0)
    .sort(([, a], [, b]) => {
      const hrDiff = (b.stats.hitting!.hr ?? 0) - (a.stats.hitting!.hr ?? 0)
      if (hrDiff !== 0) return hrDiff
      return (b.stats.hitting!.rbi ?? 0) - (a.stats.hitting!.rbi ?? 0)
    })
    .slice(0, limit)
    .map(([id, player]) => ({ id, player }))
}

/** ERA leaders (min IP = 30% of team games × 7), tie-break K desc. */
export function pitchingLeaders(players: PlayersMap, teamGames: Record<string, number>, limit = 6): LeaderEntry[] {
  return Object.entries(players)
    .filter(([, p]) => {
      if (!isSeasonPlayer(p)) return false
      const ip = p.stats?.pitching?.inningsPitched ?? 0
      const games = teamGames[p.teamId] ?? 0
      const minIp = games * MIN_IP_PCTG * GAME_INNINGS
      return ip >= minIp && p.stats?.pitching?.era !== undefined
    })
    .sort(([, a], [, b]) => {
      const eraDiff = (a.stats.pitching!.era ?? 0) - (b.stats.pitching!.era ?? 0)
      if (eraDiff !== 0) return eraDiff
      return (b.stats.pitching!.k ?? 0) - (a.stats.pitching!.k ?? 0)
    })
    .slice(0, limit)
    .map(([id, player]) => ({ id, player }))
}

/** ".512" — broadcast style, no leading zero. */
export function fmtAvg(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '---'
  return v.toFixed(3).replace(/^0/, '')
}

export function fmtEra(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '---'
  return v.toFixed(2)
}
