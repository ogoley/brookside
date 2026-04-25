import { useState, useEffect } from 'react'
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
  const players: PlayersMap = { ...regulars, ...subs }
  const loading = !regularsLoaded || !subsLoaded
  return { players, loading }
}
