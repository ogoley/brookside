import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { RunnersState } from '../types'

const DEFAULT_RUNNERS: RunnersState = { first: null, second: null, third: null }

export function useLiveRunners(gameId: string | null) {
  const [liveRunners, setLiveRunners] = useState<RunnersState>(DEFAULT_RUNNERS)

  useEffect(() => {
    if (!gameId) { setLiveRunners(DEFAULT_RUNNERS); return }
    const unsub = onValue(ref(db, `liveRunners/${gameId}`), (snap) => {
      setLiveRunners(snap.exists() ? { ...DEFAULT_RUNNERS, ...snap.val() } : DEFAULT_RUNNERS)
    })
    return unsub
  }, [gameId])

  return { liveRunners }
}
