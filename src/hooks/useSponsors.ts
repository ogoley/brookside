import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { SponsorsMap } from '../types'

/** /config/sponsors listener — admin-writable, read everywhere. */
export function useSponsors() {
  const [sponsors, setSponsors] = useState<SponsorsMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'config/sponsors'), snap => {
      setSponsors(snap.exists() ? (snap.val() as SponsorsMap) : {})
      setLoading(false)
    })
    return unsub
  }, [])

  return { sponsors, loading }
}
