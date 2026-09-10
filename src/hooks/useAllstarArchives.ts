import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { AllstarArchive, AllstarArchives } from '../allstar'

/** /config/allstarArchive listener — past all-star seasons, newest first. */
export function useAllstarArchives(): { archives: [string, AllstarArchive][] } {
  const [archives, setArchives] = useState<[string, AllstarArchive][]>([])
  useEffect(() => {
    const unsub = onValue(ref(db, 'config/allstarArchive'), snap => {
      const raw = (snap.exists() ? snap.val() : {}) as AllstarArchives
      setArchives(Object.entries(raw).sort(([a], [b]) => b.localeCompare(a)))
    })
    return unsub
  }, [])
  return { archives }
}
