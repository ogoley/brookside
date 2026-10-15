/**
 * scoring/gameId.ts
 *
 * Game ID generation and collision handling.
 * Format: {YYYY-MM-DD}_{homeTeamId}_{awayTeamId}
 * Doubleheaders: append _g2, _g3, etc.
 * Playoff games: po_ prefix, stored under /postseason/games.
 * Date is always Eastern Time (America/New_York), never UTC.
 */

import { ref, get } from 'firebase/database'
import { db } from '../firebase'
import { POSTSEASON_GAME_PREFIX } from '../postseason/paths'

/** Get today's date string in Eastern Time — "YYYY-MM-DD" */
export function getEasternDateString(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Build the base game ID (no collision suffix) */
function baseGameId(homeTeamId: string, awayTeamId: string): string {
  return `${getEasternDateString()}_${homeTeamId}_${awayTeamId}`
}

/**
 * Generate a unique game ID, checking Firebase for collisions.
 * Returns the base ID if unused, otherwise appends _g2, _g3, etc.
 */
export async function generateGameId(homeTeamId: string, awayTeamId: string, opts: { postseason?: boolean } = {}): Promise<string> {
  // Playoff games get a po_ prefix and live under /postseason (see postseason/paths.ts)
  const base = (opts.postseason ? POSTSEASON_GAME_PREFIX : '') + baseGameId(homeTeamId, awayTeamId)
  const root = opts.postseason ? 'postseason/games' : 'games'

  const firstSnap = await get(ref(db, `${root}/${base}`))
  if (!firstSnap.exists()) return base

  // Collision — find next available suffix
  for (let n = 2; n <= 9; n++) {
    const candidate = `${base}_g${n}`
    const snap = await get(ref(db, `${root}/${candidate}`))
    if (!snap.exists()) return candidate
  }

  // Extremely unlikely to hit this
  throw new Error(`Could not generate a unique game ID for ${base} — too many games today.`)
}
