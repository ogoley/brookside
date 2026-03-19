import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { OverlayState } from '../types'

const DEFAULT_OVERLAY: OverlayState = {
  activeScene: 'game',
  statOverlay: {
    visible: false,
    type: 'hitter',
    playerId: '',
    dismissAfterMs: 5000,
  },
}

export function useOverlayState() {
  const [overlay, setOverlay] = useState<OverlayState>(DEFAULT_OVERLAY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const overlayRef = ref(db, 'overlay')
    const unsub = onValue(overlayRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val()
        setOverlay({
          activeScene: data.activeScene ?? DEFAULT_OVERLAY.activeScene,
          statOverlay: {
            ...DEFAULT_OVERLAY.statOverlay,
            ...(data.statOverlay ?? {}),
          },
        })
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { overlay, loading }
}
