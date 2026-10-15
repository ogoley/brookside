/**
 * postseason/finalizeGame.ts — Firebase side of playoff finalization.
 * Reads every finalized playoff game + at-bats, computes with
 * computePostseasonFinalization, and writes one multi-path update that only
 * touches /postseason (plus clearing game/meta when it was the streamed game).
 */

import { ref, get, update } from 'firebase/database'
import { db } from '../firebase'
import { computePostseasonFinalization, seasonOfGame } from './finalize'
import type { AtBatRecord, GameRecord, PlayersMap } from '../types'

export async function finalizePostseasonGame(gameId: string, players: PlayersMap): Promise<void> {
  const gamesSnap = await get(ref(db, 'postseason/games'))
  const allGames = (gamesSnap.val() ?? {}) as Record<string, GameRecord & { postseason?: { season: number } }>
  const thisGame = allGames[gameId]
  if (!thisGame) throw new Error(`Playoff game ${gameId} not found`)

  const previousGames: Record<string, GameRecord> = {}
  const previousAtBats: Array<AtBatRecord & { gameId: string }> = []
  for (const [gId, g] of Object.entries(allGames)) {
    if (!g.finalized || gId === gameId) continue
    previousGames[gId] = g
    const snap = await get(ref(db, `postseason/gameStats/${gId}`))
    for (const ab of Object.values((snap.val() ?? {}) as Record<string, AtBatRecord>)) {
      previousAtBats.push({ ...ab, gameId: gId })
    }
  }

  const currentSnap = await get(ref(db, `postseason/gameStats/${gameId}`))
  const currentGameAtBats = Object.values((currentSnap.val() ?? {}) as Record<string, AtBatRecord>)

  const { updates, summary } = computePostseasonFinalization({
    gameId,
    game: { ...thisGame, finalized: false, finalizedAt: undefined },
    currentGameAtBats,
    previousAtBats,
    previousGames,
    players,
    season: seasonOfGame(thisGame),
  })

  if (import.meta.env.DEV) {
    console.group('[Finalization — playoffs]')
    summary.forEach(line => console.log(line))
    console.groupEnd()
  }

  if (thisGame.isStreamed) updates['game/meta/currentGameId'] = null
  await update(ref(db), updates)
}
