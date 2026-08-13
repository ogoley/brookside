import { useState, useEffect, useMemo } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { usePlayers } from './usePlayers'
import { useTeams } from './useTeams'
import { useGames } from './useGames'
import { useDerby } from './useDerby'
import { isExhibitionGame } from '../allstar'
import type { AtBatRecord } from '../types'

export interface DerbyContestant {
  id: string
  name: string
  teamId: string
  seasonHr: number
}

/**
 * The derby-eligible player pool, shared by /derby-overlay and /derby-controller.
 * Eligibility mirrors the 50/50 page: a season HR is the ticket in, and players
 * toggled OUT via derby/disabledPlayers (the /derby admin grid) are excluded.
 * Season HR merges finalized season stats with live non-finalized games.
 */
export function useDerbyContestants() {
  const { players } = usePlayers()
  const { teams } = useTeams()
  const { games } = useGames()
  const { derby } = useDerby()

  const liveGameIds = useMemo(
    () => games.filter(g => !g.game.finalized && !isExhibitionGame(g.game, teams)).map(g => g.gameId),
    [games, teams],
  )
  const [liveHr, setLiveHr] = useState<Record<string, number>>({})

  useEffect(() => {
    if (liveGameIds.length === 0) { setLiveHr({}); return }
    const perGame: Record<string, Record<string, number>> = {}
    const unsubs = liveGameIds.map(gameId =>
      onValue(ref(db, `gameStats/${gameId}`), snap => {
        const counts: Record<string, number> = {}
        if (snap.exists()) {
          for (const ab of Object.values(snap.val() as Record<string, AtBatRecord>)) {
            if (!ab.isSub && ab.result === 'home_run') {
              counts[ab.batterId] = (counts[ab.batterId] ?? 0) + 1
            }
          }
        }
        perGame[gameId] = counts
        const merged: Record<string, number> = {}
        for (const c of Object.values(perGame)) {
          for (const [pid, n] of Object.entries(c)) merged[pid] = (merged[pid] ?? 0) + n
        }
        setLiveHr(merged)
      })
    )
    return () => unsubs.forEach(u => u())
  }, [liveGameIds])

  const contestants: DerbyContestant[] = useMemo(() => {
    const disabled = derby.disabledPlayers ?? {}
    return Object.entries(players)
      .filter(([id, p]) => !p.isSub && typeof p.name === 'string' && p.name !== '' && !disabled[id])
      .map(([id, p]) => ({
        id,
        name: p.name,
        teamId: p.teamId,
        seasonHr: (p.stats?.hitting?.hr ?? 0) + (liveHr[id] ?? 0),
      }))
      .filter(c => c.seasonHr > 0)
      .sort((a, b) => b.seasonHr - a.seasonHr || a.name.localeCompare(b.name))
  }, [players, liveHr, derby.disabledPlayers])

  const contestantById = useMemo(
    () => new Map(contestants.map(c => [c.id, c])),
    [contestants],
  )

  return { contestants, contestantById, teams }
}
