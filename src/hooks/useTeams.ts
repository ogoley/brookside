import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { TeamsMap } from '../types'

export function useTeams() {
  const [teams, setTeams] = useState<TeamsMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const teamsRef = ref(db, 'teams')
    const unsub = onValue(teamsRef, (snap) => {
      if (snap.exists()) {
        setTeams(snap.val())
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { teams, loading }
}
