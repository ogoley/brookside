import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { GameMeta } from '../types'

const DEFAULT_GAME: GameMeta = {
  homeTeamId: '',
  awayTeamId: '',
  inning: 1,
  isTopInning: true,
  outs: 0,
  bases: { first: false, second: false, third: false },
  homeScore: 0,
  awayScore: 0,
  isActive: false,
}

export function useGameData() {
  const [game, setGame] = useState<GameMeta>(DEFAULT_GAME)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const gameRef = ref(db, 'game/meta')
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        setGame({ ...DEFAULT_GAME, ...snap.val() })
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { game, loading }
}
