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
        setPlayers(snap.val())
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { players, loading }
}
