import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { DERBY_TURN_MS, DERBY_TIMEOUT_MS } from '../derby/logic'
import { DERBY_ODDS_INTERVAL_MS, DERBY_ODDS_DURATION_MS } from '../derby/odds'
import type { DerbyBroadcastState, DerbyTimerState, DerbyOddsState } from '../types'

export const DEFAULT_DERBY_ODDS: DerbyOddsState = {
  // On by default, but in bursts rather than parked on screen: 45 seconds away,
  // 15 seconds up. The producer can pin it permanently from the controller.
  // The overlay hides the board anyway while there are no entries, so an "on"
  // default can't put an empty panel on air.
  enabled: true,
  mode: 'timer',
  startedAt: 0,
  intervalMs: DERBY_ODDS_INTERVAL_MS,
  durationMs: DERBY_ODDS_DURATION_MS,
}

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
  odds: DEFAULT_DERBY_ODDS,
  pitchers: {},
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
        odds: { ...DEFAULT_DERBY_ODDS, ...(data.odds ?? {}) },
      })
      setLoading(false)
    })
    return () => unsub()
  }, [])

  return { broadcast, loading }
}
