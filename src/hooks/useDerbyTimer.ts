import { useState, useEffect } from 'react'
import { derbyTimerRemainingMs, resolveDerbyTimer } from '../derby/logic'
import type { DerbyTimerState } from '../types'

/**
 * The live derby turn clock: the stored state resolved to *now* (a finished
 * timeout has already rolled back into the turn clock) plus its remaining ms.
 * Re-renders on an interval only while the clock is running — a stopped clock
 * reads straight off state, so overlay and controller show the same number.
 */
export function useDerbyClock(timer: DerbyTimerState, intervalMs = 100): {
  timer: DerbyTimerState
  remainingMs: number
} {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!timer.running || timer.startedAt == null) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [timer.running, timer.startedAt, intervalMs])

  const resolved = resolveDerbyTimer(timer, now)
  return { timer: resolved, remainingMs: derbyTimerRemainingMs(resolved, now) }
}
