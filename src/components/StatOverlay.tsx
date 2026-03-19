import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ref, update } from 'firebase/database'
import { db } from '../firebase'
import type { StatOverlayState, PlayersMap, TeamsMap } from '../types'

interface Props {
  statOverlay: StatOverlayState
  players: PlayersMap
  teams: TeamsMap
}

export function StatOverlay({ statOverlay, players, teams }: Props) {
  const { visible, playerId, type, dismissAfterMs } = statOverlay
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss timer — starts when visible flips true
  useEffect(() => {
    if (visible && dismissAfterMs > 0) {
      timerRef.current = setTimeout(() => {
        update(ref(db, 'overlay/statOverlay'), { visible: false })
      }, dismissAfterMs)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible, dismissAfterMs, playerId])

  const player = players[playerId]
  const team = player ? teams[player.teamId] : undefined

  const isPitcher = type === 'pitcher'
  const stats = player?.stats

  return (
    <AnimatePresence>
      {visible && player && (
        <motion.div
          key="stat-overlay"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="absolute bottom-0 left-0 right-0 flex items-center px-6 py-3"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', borderTop: '2px solid ' + (team?.primaryColor ?? '#fff') }}
        >
          {/* Accent bar */}
          <div
            className="w-1 self-stretch rounded-full mr-4 shrink-0"
            style={{ background: team?.primaryColor ?? '#fff' }}
          />

          {/* Player name + team */}
          <div className="mr-6">
            <p
              className="text-white/60 text-xs uppercase tracking-widest leading-none"
              style={{ fontFamily: 'var(--font-score)' }}
            >
              {team?.shortName ?? ''} · {isPitcher ? 'Pitcher' : 'Batter'}
            </p>
            <p
              className="text-white text-2xl font-black leading-tight uppercase"
              style={{ fontFamily: 'var(--font-score)' }}
            >
              {player.name}
            </p>
          </div>

          {/* Divider */}
          <div className="w-px h-8 bg-white/20 mr-6" />

          {/* Stats */}
          <div className="flex gap-6 flex-1">
            {!isPitcher && (
              <>
                <StatChip label="AVG" value={stats?.avg !== undefined ? stats.avg.toFixed(3).replace(/^0/, '') : '---'} />
                <StatChip label="HR" value={stats?.hr ?? 0} />
                <StatChip label="RBI" value={stats?.rbi ?? 0} />
              </>
            )}
            {isPitcher && (
              <>
                <StatChip label="ERA" value={stats?.era !== undefined ? stats.era.toFixed(2) : '---'} />
                <StatChip label="K" value={stats?.strikeouts ?? 0} />
                <StatChip label="BB" value={stats?.walks ?? 0} />
                <StatChip label="IP" value={stats?.inningsPitched ?? 0} />
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span
        className="text-white/50 text-xs uppercase tracking-widest leading-none"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        {label}
      </span>
      <span
        className="text-white text-xl font-bold leading-tight"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        {value}
      </span>
    </div>
  )
}
