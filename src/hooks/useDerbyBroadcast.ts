import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { DERBY_TURN_MS, DERBY_TIMEOUT_MS } from '../derby/logic'
import type { DerbyBroadcastState, DerbyTimerState } from '../types'

export const DEFAULT_DERBY_TIMER: DerbyTimerState = {
  phase: 'main',
  running: false,
  startedAt: null,
  remainingMs: DERBY_TURN_MS,
  timeoutRemainingMs: DERBY_TIMEOUT_MS,
  durationMs: DERBY_TURN_MS,
  timeoutDurationMs: DERBY_TIMEOUT_MS,
  timeoutUsed: false,
  playerId: null,
  visible: true,
  moneyBallAt: null,
}

export const DEFAULT_DERBY_BROADCAST: DerbyBroadcastState = {
  view: 'hidden',
  activeRound: 1,
  leaderboardRound: 1,
  featuredPlayerId: null,
  battingOrder: [],
  currentBatterIndex: 0,
  scores: {},
  ticker: false,
  miniBoard: true,
  timer: DEFAULT_DERBY_TIMER,
  advancers: {},
}

export function useDerbyBroadcast() {
  const [broadcast, setBroadcast] = useState<DerbyBroadcastState>(DEFAULT_DERBY_BROADCAST)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'derby/broadcast'), snap => {
      const data = (snap.val() as Partial<DerbyBroadcastState>) ?? {}
      // Firebase drops empty arrays/objects and nulled-out keys — merge over
      // defaults at both levels so a partial timer write can't leave holes
      setBroadcast({
        ...DEFAULT_DERBY_BROADCAST,
        ...data,
        timer: { ...DEFAULT_DERBY_TIMER, ...(data.timer ?? {}) },
      })
      setLoading(false)
    })
    return () => unsub()
  }, [])

  return { broadcast, loading }
}
