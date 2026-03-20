import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { GameLineup } from '../types'

export function useGameLineup(gameId: string | null, teamId: string | null) {
  const [lineup, setLineup] = useState<GameLineup>([])

  useEffect(() => {
    if (!gameId || !teamId) { setLineup([]); return }
    const unsub = onValue(ref(db, `games/${gameId}/lineups/${teamId}`), (snap) => {
      setLineup(snap.exists() ? snap.val() : [])
    })
    return unsub
  }, [gameId, teamId])

  return { lineup }
}
