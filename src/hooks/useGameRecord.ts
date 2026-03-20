import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { GameRecord } from '../types'

export function useGameRecord(gameId: string | null) {
  const [game, setGame] = useState<GameRecord | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gameId) { setGame(null); setLoading(false); return }
    setLoading(true)
    const unsub = onValue(ref(db, `games/${gameId}`), (snap) => {
      setGame(snap.exists() ? snap.val() : null)
      setLoading(false)
    })
    return unsub
  }, [gameId])

  return { game, loading }
}
