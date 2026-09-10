import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { ScheduledGame } from '../playoffs/engine'

/** Raw node shape at /config/schedule/{id} (synced by scripts/syncSchedule.mjs). */
interface ScheduleNode {
  date: string
  time?: string | null
  homeTeamId: string
  awayTeamId: string
  status?: string
  venue?: string | null
  source?: string
}

export interface ScheduleMeta {
  syncedAt: number
  source: string
  season?: number
}

/** /config/schedule listener — remaining regular-season games, date/time ordered. */
export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduledGame[]>([])
  const [meta, setMeta] = useState<ScheduleMeta | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'config/schedule'), snap => {
      const raw = (snap.exists() ? snap.val() : {}) as Record<string, ScheduleNode>
      const list: ScheduledGame[] = Object.entries(raw)
        .filter(([, g]) => g && typeof g.date === 'string' && g.homeTeamId && g.awayTeamId)
        .map(([id, g]): ScheduledGame => ({
          id,
          date: g.date,
          time: g.time || undefined,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          status: g.status === 'postponed' ? 'postponed' : g.status === 'cancelled' ? 'cancelled' : 'scheduled',
          venue: g.venue || undefined,
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id))
      setSchedule(list)
      setLoading(false)
    })
    const unsubMeta = onValue(ref(db, 'config/scheduleMeta'), snap => {
      setMeta(snap.exists() ? (snap.val() as ScheduleMeta) : null)
    })
    return () => { unsub(); unsubMeta() }
  }, [])

  return { schedule, meta, loading }
}
