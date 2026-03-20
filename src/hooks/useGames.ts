import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { GameRecord } from '../types'

export interface GameEntry {
  gameId: string
  game: GameRecord
}

export function useGames() {
  const [games, setGames] = useState<GameEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'games'), (snap) => {
      if (!snap.exists()) { setGames([]); setLoading(false); return }
      const raw = snap.val() as Record<string, GameRecord>
      const entries = Object.entries(raw).map(([gameId, game]) => ({ gameId, game }))
      // Most recently started first
      entries.sort((a, b) => (b.game.startedAt ?? 0) - (a.game.startedAt ?? 0))
      setGames(entries)
      setLoading(false)
    })
    return unsub
  }, [])

  return { games, loading }
}
