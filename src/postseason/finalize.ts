/**
 * postseason/finalize.ts — playoff-game finalization (pure, no Firebase).
 *
 * Reuses the regular-season engine (`computeFinalization`) and re-points its
 * output into /postseason, so playoff numbers are computed exactly the same
 * way but can never land in /players, /games or /gameSummaries:
 *
 *   players/{id}/stats/{hitting|pitching}  → postseason/players/{id}/stats/…            (lifetime, every season)
 *                                          → postseason/players/{id}/seasons/{year}/…   (this season only)
 *   subPlayers/{id}/stats/…                → postseason/subPlayers/{id}/…               (same split)
 *   games/{gameId}/…                       → postseason/games/{gameId}/…
 *   gameSummaries/{gameId}/…               → postseason/gameSummaries/{gameId}/…
 *
 * Like the regular-season finalize it is idempotent: totals are rebuilt from
 * every finalized playoff game's at-bats, so re-finalizing is safe.
 */

import { computeFinalization, type FinalizeInput } from '../scoring/finalization'
import type { GameRecord } from '../types'

export interface PostseasonFinalizeInput extends FinalizeInput {
  /** Season this game belongs to (from its postseason tag or date). */
  season: number
}

export function seasonOfGame(game: GameRecord & { postseason?: { season: number } }): number {
  return game.postseason?.season ?? Number(game.date.slice(0, 4))
}

const STATS_KEY = /^(players|subPlayers)\/([^/]+)\/stats\/(hitting|pitching)$/

export function computePostseasonFinalization(input: PostseasonFinalizeInput): { updates: Record<string, unknown>; summary: string[] } {
  const { season, previousAtBats, previousGames, players } = input

  // Lifetime: every finalized playoff game, all seasons.
  const lifetime = computeFinalization(input)

  // This season only: same engine, previous games filtered to the season.
  const seasonGames: Record<string, GameRecord> = {}
  for (const [id, g] of Object.entries(previousGames)) {
    if (seasonOfGame(g) === season) seasonGames[id] = g
  }
  const seasonOnly = computeFinalization({
    ...input,
    previousGames: seasonGames,
    previousAtBats: previousAtBats.filter(ab => ab.gameId in seasonGames),
  })

  const updates: Record<string, unknown> = {}
  const touched = new Set<string>()

  for (const [path, value] of Object.entries(lifetime.updates)) {
    const m = path.match(STATS_KEY)
    if (m) {
      const [, root, id, kind] = m
      updates[`postseason/${root}/${id}/stats/${kind}`] = value
      touched.add(`${root}/${id}`)
    } else if (path.startsWith('games/') || path.startsWith('gameSummaries/')) {
      updates[`postseason/${path}`] = value
    } else {
      throw new Error(`Unexpected finalize path for a playoff game: ${path}`)
    }
  }

  for (const [path, value] of Object.entries(seasonOnly.updates)) {
    const m = path.match(STATS_KEY)
    if (!m) continue
    const [, root, id, kind] = m
    updates[`postseason/${root}/${id}/seasons/${season}/${kind}`] = value
  }

  // Denormalize name + this season's team so /postseason/players reads on
  // its own (lifetime lists, future seasons where players change teams).
  for (const key of touched) {
    const [root, id] = key.split('/')
    const p = players[id]
    if (!p) continue
    if (p.name) updates[`postseason/${root}/${id}/name`] = p.name
    if (p.teamId) updates[`postseason/${root}/${id}/seasons/${season}/teamId`] = p.teamId
  }

  return { updates, summary: [`[Playoffs ${season}]`, ...lifetime.summary] }
}
