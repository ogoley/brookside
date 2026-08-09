import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { DerbyState } from '../types'

export function useDerby() {
  const [derby, setDerby] = useState<DerbyState>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'derby'), snap => {
      setDerby((snap.val() as DerbyState) ?? {})
      setLoading(false)
    })
    return () => unsub()
  }, [])

  return { derby, loading }
}
