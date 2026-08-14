import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { DerbyEntry, DerbyResult } from '../types'

/**
 * The 50/50 side of the derby: who bet what, and the posted result.
 *
 * Deliberately narrower than `useDerby` (which watches all of `/derby`) — the
 * broadcast overlay needs only these two paths, and `/derby/broadcast` churns
 * on every home run.
 */
export function useDerbyBets() {
  const [entries, setEntries] = useState<Record<string, DerbyEntry>>({})
  const [result, setResult] = useState<DerbyResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubEntries = onValue(ref(db, 'derby/entries'), snap => {
      setEntries((snap.val() as Record<string, DerbyEntry>) ?? {})
      setLoading(false)
    })
    const unsubResult = onValue(ref(db, 'derby/result'), snap => {
      setResult((snap.val() as DerbyResult) ?? null)
    })
    return () => { unsubEntries(); unsubResult() }
  }, [])

  return { entries, result, loading }
}
