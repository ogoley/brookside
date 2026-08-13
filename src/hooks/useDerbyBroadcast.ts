import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { DerbyBroadcastState } from '../types'

export const DEFAULT_DERBY_BROADCAST: DerbyBroadcastState = {
  view: 'hidden',
  activeRound: 1,
  leaderboardRound: 1,
  featuredPlayerId: null,
  battingOrder: [],
  currentBatterIndex: 0,
  scores: {},
}

export function useDerbyBroadcast() {
  const [broadcast, setBroadcast] = useState<DerbyBroadcastState>(DEFAULT_DERBY_BROADCAST)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'derby/broadcast'), snap => {
      const data = (snap.val() as Partial<DerbyBroadcastState>) ?? {}
      // Firebase drops empty arrays/objects — always merge over defaults
      setBroadcast({ ...DEFAULT_DERBY_BROADCAST, ...data })
      setLoading(false)
    })
    return () => unsub()
  }, [])

  return { broadcast, loading }
}
