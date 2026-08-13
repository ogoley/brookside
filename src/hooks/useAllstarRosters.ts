import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { AllstarRosters } from '../allstar'

/**
 * All-star roster mapping at /config/allstar/rosters — teamId → playerId[].
 * Returns null until seeded (or while loading), which makes every roster-aware
 * helper fall back to plain league-teamId matching, so the regular season is
 * unaffected before the all-star teams exist.
 */
export function useAllstarRosters(): AllstarRosters | null {
  const [rosters, setRosters] = useState<AllstarRosters | null>(null)

  useEffect(() => {
    const unsub = onValue(ref(db, 'config/allstar/rosters'), snap => {
      setRosters(snap.exists() ? (snap.val() as AllstarRosters) : null)
    })
    return () => unsub()
  }, [])

  return rosters
}
