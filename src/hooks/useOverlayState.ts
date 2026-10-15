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
  timer: {
    durationMs: 3_600_000, // 60 minutes default
    startedAt: null,
    running: false,
    visible: false,
  },
  homerun: {
    active: false,
    teamSide: 'away',
    playerId: '',
    logoUrl: '',
    runsScored: 1,
    triggeredAt: 0,
  },
  insights: {
    title: 'Game Insights',
    point1: '',
    point2: '',
    point3: '',
    point4: '',
    visibleCount: 0,
  },
  sponsor: {
    active: false,
    sponsorId: '',
    inning: 1,
    triggeredAt: 0,
    durationMs: 30_000,
    autoShow: true,
  },
  ticker: {
    visible: false,
    speed: 120,
    accentColor: '#fbbf24',
    sections: {
      standings: true,
      playoffs: true,
      batting: true,
      homeRuns: true,
      pitching: true,
      results: true,
      upcoming: true,
      sponsors: true,
      messages: true,
    },
    messages: {},
  },
  scoreboardBorder: true,
  scoreboardScale: 0.75,
  roundTag: 'off',
}

export { DEFAULT_OVERLAY }

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
          timer: {
            ...DEFAULT_OVERLAY.timer,
            ...(data.timer ?? {}),
          },
          homerun: {
            ...DEFAULT_OVERLAY.homerun,
            ...(data.homerun ?? {}),
          },
          insights: {
            ...DEFAULT_OVERLAY.insights,
            ...(data.insights ?? {}),
          },
          sponsor: {
            ...DEFAULT_OVERLAY.sponsor,
            ...(data.sponsor ?? {}),
          },
          ticker: {
            ...DEFAULT_OVERLAY.ticker,
            ...(data.ticker ?? {}),
            sections: {
              ...DEFAULT_OVERLAY.ticker.sections,
              ...(data.ticker?.sections ?? {}),
            },
            messages: data.ticker?.messages ?? {},
          },
          scoreboardBorder: data.scoreboardBorder ?? DEFAULT_OVERLAY.scoreboardBorder,
          scoreboardScale: data.scoreboardScale ?? DEFAULT_OVERLAY.scoreboardScale,
          roundTag: data.roundTag ?? DEFAULT_OVERLAY.roundTag,
        })
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { overlay, loading }
}
