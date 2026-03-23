import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

export interface LeagueConfig {
  leagueLogo: string
}

const DEFAULT: LeagueConfig = { leagueLogo: '' }

export function useLeagueConfig() {
  const [config, setConfig] = useState<LeagueConfig>(DEFAULT)

  useEffect(() => {
    const unsub = onValue(ref(db, 'config'), snap => {
      const data = snap.val() ?? {}
      setConfig({ leagueLogo: data.leagueLogo ?? '' })
    })
    return () => unsub()
  }, [])

  return { config }
}
