import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { SubPitcherEntry } from '../types'

/**
 * Per-game sub pitchers, grouped by team.
 *
 * Sub pitchers are ephemeral roster entries used when someone fills in on the
 * mound for a single game. Their playerIds are fabricated (`subp_<timestamp>`)
 * and are NOT stored in /players. Their pitching stats are excluded from
 * season totals on finalization, and they're not eligible for W/L credit.
 *
 * Returns: subPitchers[teamId][playerId] = { playerId, name }
 */
export function useSubPitchers(gameId: string | null) {
  const [subPitchers, setSubPitchers] = useState<Record<string, Record<string, SubPitcherEntry>>>({})

  useEffect(() => {
    if (!gameId) { setSubPitchers({}); return }
    const unsub = onValue(ref(db, `games/${gameId}/subPitchers`), (snap) => {
      setSubPitchers(snap.exists() ? snap.val() : {})
    })
    return unsub
  }, [gameId])

  return { subPitchers }
}
