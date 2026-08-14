import { useState, useEffect, useMemo } from 'react'
import {
  buildDerbyOddsModel, newOddsAcc, runOddsChunk, finalizeOdds,
  derbyOddsSignature, DEFAULT_ODDS_TRIALS,
  type DerbyOddsInput, type DerbyOddsResult, type DerbyOddsModel,
} from '../derby/odds'
import { derbyTimerRemainingMs, resolveDerbyTimer, type DerbyBetEntry } from '../derby/logic'
import type { DerbyBroadcastState, DerbyEntry, DerbyTimerState } from '../types'
import type { DerbyContestant } from './useDerbyContestants'

/**
 * Trials per slice of work. The whole run is ~12k trials — around a fifth of a
 * second of solid arithmetic, which as one blocking call would drop a dozen
 * frames on the overlay. Slicing it keeps each turn of the loop near a
 * millisecond, well inside a frame's budget.
 */
const CHUNK = 750

/**
 * Hand control back to the browser, then run `fn`.
 *
 * Deliberately NOT `setTimeout(…, 0)`: a backgrounded tab clamps timers to
 * roughly one a second, which stretches a sixteen-slice run into a quarter of a
 * minute — and the producer's control tab spends most of the derby behind
 * something else. A MessageChannel message still yields to the event loop, so
 * the browser paints between slices, but isn't subject to that clamp.
 */
function scheduleSlice(fn: () => void): () => void {
  if (typeof MessageChannel === 'undefined') {
    const id = setTimeout(fn, 0)
    return () => clearTimeout(id)
  }
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    fn()
  }
  channel.port2.postMessage(null)
  return () => {
    channel.port1.onmessage = null
    channel.port1.close()
  }
}

/** How far into their turn the hitter at the plate is, 0..1. */
export function turnFractionOf(timer: DerbyTimerState, now: number): number {
  const resolved = resolveDerbyTimer(timer, now)
  const duration = resolved.durationMs || 1
  // A timeout freezes the turn clock, so the fraction holds while it runs.
  const left = resolved.phase === 'timeout'
    ? resolved.remainingMs
    : derbyTimerRemainingMs(resolved, now)
  return Math.min(1, Math.max(0, 1 - left / duration))
}

/** The 50/50 entries in the shape the bet logic and the model both want. */
export function betEntriesFrom(entries: Record<string, DerbyEntry>): DerbyBetEntry[] {
  return Object.entries(entries).map(([id, e]) => ({
    id, name: e.name, playerId: e.playerId, totalHr: e.totalHr,
  }))
}

interface Options {
  /**
   * Compute at all. The overlay passes false while the board is off, so an
   * OBS source that never shows odds never pays for them.
   */
  enabled?: boolean
  trials?: number
  /**
   * How far through their turn the hitter at the plate is, 0..1 — from
   * `turnFractionOf`. Passed in rather than derived here because the caller
   * already owns a tick; it is quantised to eighths before it reaches the
   * model, so handing over a value that changes every frame is safe.
   */
  turnFraction?: number
}

/**
 * Live 50/50 win probabilities, recomputed only when something that moves them
 * actually moves.
 *
 * Two things keep this off the critical path. The recompute key is
 * `derbyOddsSignature`, which quantises the turn clock to eighths — the clock
 * ticks ten times a second and must not drag a Monte Carlo along with it. And
 * the run itself is sliced across timeouts, so the overlay keeps animating
 * while the numbers are being worked out; the previous result stays on screen
 * until the new one is ready, so the board never blanks mid-shot.
 */
export function useDerbyOdds(
  broadcast: DerbyBroadcastState,
  contestants: DerbyContestant[],
  entries: Record<string, DerbyEntry>,
  { enabled = true, trials = DEFAULT_ODDS_TRIALS, turnFraction = 0 }: Options = {},
): { odds: DerbyOddsResult | null; computing: boolean } {
  // Eighths of a turn — ~11 seconds of hitting, about the finest granularity at
  // which a part-finished turn tells you anything, and coarse enough that the
  // clock can't drag a Monte Carlo along behind it.
  const turnEighths = Math.round(Math.min(1, Math.max(0, turnFraction)) * 8)

  const liveHitterId = useMemo(() => {
    const order = broadcast.battingOrder.filter(id => contestants.some(c => c.id === id))
    const i = Math.min(broadcast.currentBatterIndex, Math.max(0, order.length - 1))
    return order[i] ?? null
  }, [broadcast.battingOrder, broadcast.currentBatterIndex, contestants])

  const input: DerbyOddsInput = useMemo(() => ({
    eligibleIds: contestants.map(c => c.id),
    seasonHr: Object.fromEntries(contestants.map(c => [c.id, c.seasonHr])),
    scores: broadcast.scores,
    activeRound: broadcast.activeRound,
    locks: broadcast.advancers,
    liveHitterId,
    turnFraction: turnEighths / 8,
    moneyBallTaken: broadcast.timer.moneyBallAt != null,
    entries: betEntriesFrom(entries),
    trials,
  }), [
    contestants, broadcast.scores, broadcast.activeRound, broadcast.advancers,
    liveHitterId, turnEighths, broadcast.timer.moneyBallAt, entries, trials,
  ])

  const signature = useMemo(() => derbyOddsSignature(input), [input])

  const [odds, setOdds] = useState<DerbyOddsResult | null>(null)
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let cancelSlice: (() => void) | undefined
    let firstChunk = true

    const model: DerbyOddsModel = buildDerbyOddsModel(input)
    const acc = newOddsAcc(model.seed)

    const step = () => {
      if (cancelled) return
      // Flagged from the first slice, not from the effect body — a synchronous
      // setState there would cascade a second render before any work is done.
      if (firstChunk) { firstChunk = false; setComputing(true) }
      runOddsChunk(model, acc, Math.min(CHUNK, model.trials - acc.trials))
      if (acc.trials >= model.trials) {
        setOdds(finalizeOdds(model, acc))
        setComputing(false)
        return
      }
      cancelSlice = scheduleSlice(step)
    }
    cancelSlice = scheduleSlice(step)

    return () => {
      cancelled = true
      cancelSlice?.()
      // A superseded run leaves the last finished result on screen, not a
      // spinner that never clears.
      setComputing(false)
    }
    // Keyed on the signature, NOT on `input`: the input object is rebuilt on
    // every tick, and re-running a Monte Carlo for an identical signature is
    // exactly what the signature exists to prevent. Closing over `input` is
    // safe because `input` is memoised on the same data the signature is built
    // from — an `input` that changes identity without changing the signature
    // would produce byte-identical output anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled])

  return { odds, computing }
}
