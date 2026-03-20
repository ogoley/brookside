/**
 * useLivePlayerStats
 *
 * Returns merged hitting + pitching stats for a player:
 *   season totals (from /players/{id}/stats) + current in-progress game (from /gameStats/{gameId})
 *
 * Falls back to season-only stats if no gameId is provided or the game has no at-bats yet.
 */

import { useMemo } from 'react'
import { useGameStats } from './useGameStats'
import { computeGameStats, mergeHittingStats, mergePitchingStats } from '../scoring/engine'
import type { HittingStats, PitchingStats, Player } from '../types'

export interface LivePlayerStats {
  hitting: HittingStats | null
  pitching: PitchingStats | null
}

export function useLivePlayerStats(
  playerId: string | null,
  player: Player | undefined,
  gameId: string | null,
): LivePlayerStats {
  const { atBats } = useGameStats(gameId)

  return useMemo(() => {
    if (!player || !playerId) return { hitting: null, pitching: null }

    const seasonHitting = player.stats?.hitting ?? null
    const seasonPitching = player.stats?.pitching ?? null

    const atBatList = Object.values(atBats)

    if (!gameId || atBatList.length === 0) {
      return { hitting: seasonHitting, pitching: seasonPitching }
    }

    const { hitting: gameHitting, pitching: gamePitching } = computeGameStats(atBatList, playerId)

    const hitting: HittingStats | null = gameHitting
      ? seasonHitting ? mergeHittingStats(seasonHitting, gameHitting) : gameHitting
      : seasonHitting

    const pitching: PitchingStats | null = gamePitching
      ? seasonPitching ? mergePitchingStats(seasonPitching, gamePitching) : gamePitching
      : seasonPitching

    return { hitting, pitching }
  }, [playerId, player, gameId, atBats])
}
