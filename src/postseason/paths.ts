/**
 * postseason/paths.ts
 *
 * Playoff games live in their own database section so nothing that reads the
 * regular-season roots (our own standings/stats, and brooksidewiffle.com's
 * server, which imports /games, /gameStats and /gameSummaries) ever sees them:
 *
 *   /postseason/games/{gameId}          — GameRecord (same shape as /games)
 *   /postseason/gameStats/{gameId}      — at-bat log
 *   /postseason/gameSummaries/{gameId}  — per-game box score
 *   /postseason/liveRunners/{gameId}    — current base state
 *   /postseason/players/{playerId}      — lifetime playoff stats + per-season
 *   /postseason/subPlayers/{playerId}   — playoff stats for one-game subs
 *
 * A playoff game is identified by its id prefix alone, so every read/write of
 * a game path goes through `gameRoot(gameId)` and lands in the right place.
 */

export const POSTSEASON_GAME_PREFIX = 'po_'

export function isPostseasonGameId(gameId: string | null | undefined): boolean {
  return !!gameId && gameId.startsWith(POSTSEASON_GAME_PREFIX)
}

/** '' for regular-season games, 'postseason/' for playoff games. Prefix any
 *  games/ gameStats/ gameSummaries/ liveRunners/ path with this. */
export function gameRoot(gameId: string | null | undefined): '' | 'postseason/' {
  return isPostseasonGameId(gameId) ? 'postseason/' : ''
}
