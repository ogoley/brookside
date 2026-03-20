import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { MatchupState } from '../types'

const DEFAULT_MATCHUP: MatchupState = {
  batterId: null,
  pitcherId: null,
  lastPitcherHome: null,
  lastPitcherAway: null,
}

export function useMatchup() {
  const [matchup, setMatchup] = useState<MatchupState>(DEFAULT_MATCHUP)

  useEffect(() => {
    const unsub = onValue(ref(db, 'game/matchup'), (snap) => {
      if (snap.exists()) {
        const d = snap.val()
        setMatchup({
          batterId:        d.batterId        ?? null,
          pitcherId:       d.pitcherId       ?? null,
          lastPitcherHome: d.lastPitcherHome ?? null,
          lastPitcherAway: d.lastPitcherAway ?? null,
        })
      } else {
        setMatchup(DEFAULT_MATCHUP)
      }
    })
    return unsub
  }, [])

  return { matchup }
}
