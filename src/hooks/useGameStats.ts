import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { gameRoot } from '../postseason/paths'
import type { AtBatRecord } from '../types'

export function useGameStats(gameId: string | null) {
  const [atBats, setAtBats] = useState<Record<string, AtBatRecord>>({})

  useEffect(() => {
    if (!gameId) { setAtBats({}); return }
    const unsub = onValue(ref(db, `${gameRoot(gameId)}gameStats/${gameId}`), (snap) => {
      setAtBats(snap.exists() ? snap.val() : {})
    })
    return unsub
  }, [gameId])

  return { atBats }
}
