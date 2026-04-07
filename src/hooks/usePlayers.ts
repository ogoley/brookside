import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { PlayersMap } from '../types'

export function usePlayers() {
  const [players, setPlayers] = useState<PlayersMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const playersRef = ref(db, 'players')
    const unsub = onValue(playersRef, (snap) => {
      if (snap.exists()) {
        const raw = snap.val() as Record<string, Record<string, unknown>>
        // Ensure every player has a `stats` object — Firebase omits it when empty
        const normalized: PlayersMap = {}
        for (const [id, data] of Object.entries(raw)) {
          normalized[id] = { ...data, stats: data.stats ?? {} } as PlayersMap[string]
        }
        setPlayers(normalized)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { players, loading }
}
