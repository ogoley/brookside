import { useState, useEffect, useMemo } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { PlayersMap } from '../types'

/**
 * Returns a merged map of all players (regulars + ephemeral one-game subs).
 *
 * Storage is split:
 *   /players        — regular roster (clean for external consumers)
 *   /subPlayers     — ephemeral one-game subs, all with isSub: true
 *
 * Internal app code reads through this hook, so all callsites see a unified
 * PlayersMap and can filter on `player.isSub` when they want regulars only.
 */
export function usePlayers() {
  const [regulars, setRegulars] = useState<PlayersMap>({})
  const [subs, setSubs] = useState<PlayersMap>({})
  const [regularsLoaded, setRegularsLoaded] = useState(false)
  const [subsLoaded, setSubsLoaded] = useState(false)

  useEffect(() => {
    const unsubReg = onValue(ref(db, 'players'), (snap) => {
      const raw = snap.exists() ? (snap.val() as Record<string, Record<string, unknown>>) : {}
      const normalized: PlayersMap = {}
      for (const [id, data] of Object.entries(raw)) {
        normalized[id] = { ...data, stats: data.stats ?? {} } as PlayersMap[string]
      }
      setRegulars(normalized)
      setRegularsLoaded(true)
    })
    const unsubSubs = onValue(ref(db, 'subPlayers'), (snap) => {
      const raw = snap.exists() ? (snap.val() as Record<string, Record<string, unknown>>) : {}
      const normalized: PlayersMap = {}
      for (const [id, data] of Object.entries(raw)) {
        // Force isSub:true here — the storage path itself encodes sub identity,
        // so the in-memory shape is consistent even if a record happens to omit the flag.
        normalized[id] = { ...data, stats: data.stats ?? {}, isSub: true } as PlayersMap[string]
      }
      setSubs(normalized)
      setSubsLoaded(true)
    })
    return () => { unsubReg(); unsubSubs() }
  }, [])

  // Subs spread last — if an ID collision ever occurs, sub identity wins
  // (sub-IDs are timestamped; collision should be impossible in practice).
  //
  // MUST be memoised. Returning a fresh object every render makes `players` an
  // unstable dependency, and callers chain off it: useDerbyContestants memoises
  // `contestants` on [players], the derby controller memoises `order` on the
  // resulting map, and syncs local drag state from `order` in an effect. With a
  // new object each render that chain never settles — every render invalidates
  // the next one and React aborts with "Maximum update depth exceeded".
  const players: PlayersMap = useMemo(() => ({ ...regulars, ...subs }), [regulars, subs])
  const loading = !regularsLoaded || !subsLoaded
  return { players, loading }
}
