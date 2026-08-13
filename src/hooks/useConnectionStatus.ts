import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

/**
 * Tracks the SDK's live connection to the Realtime Database via the special
 * `.info/connected` path. Returns false only after the connection has been
 * down for `graceMs` so the initial handshake (which always starts
 * disconnected) doesn't flash an offline warning on page load.
 */
export function useConnectionStatus(graceMs = 2500): boolean {
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = onValue(ref(db, '.info/connected'), snap => {
      if (snap.val() === true) {
        if (timer) { clearTimeout(timer); timer = null }
        setConnected(true)
      } else if (!timer) {
        timer = setTimeout(() => setConnected(false), graceMs)
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [graceMs])

  return connected
}
