/**
 * RunnerDiamond — scorekeeper-only base diamond showing runner initials.
 * Takes RunnersState (player IDs) and a name lookup function.
 * The existing BaseDiamond (boolean Bases) is used by the overlay and is unchanged.
 */

import type { RunnersState } from '../types'

interface Props {
  runners: RunnersState
  getPlayerName: (id: string) => string
  size?: number
}

function initials(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function BaseNode({ runnerId, label, getPlayerName }: {
  runnerId: string | null
  label: string
  getPlayerName: (id: string) => string
}) {
  const occupied = !!runnerId
  const text = occupied ? initials(getPlayerName(runnerId!)) : ''

  return (
    <div
      aria-label={label}
      className="rotate-45 flex items-center justify-center transition-all duration-200"
      style={{
        width: 32,
        height: 32,
        background: occupied ? '#facc15' : 'transparent',
        border: `2px solid ${occupied ? '#facc15' : 'rgba(255,255,255,0.35)'}`,
        borderRadius: 4,
      }}
    >
      {occupied && (
        <span
          className="-rotate-45 font-black text-black select-none"
          style={{ fontSize: 10, lineHeight: 1, letterSpacing: '-0.5px' }}
        >
          {text}
        </span>
      )}
    </div>
  )
}

export function RunnerDiamond({ runners, getPlayerName, size = 96 }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ width: size, height: size, gap: 4 }}
    >
      {/* 2nd base — top */}
      <div className="flex justify-center">
        <BaseNode runnerId={runners.second} label="Second base" getPlayerName={getPlayerName} />
      </div>
      {/* 3rd and 1st — middle row */}
      <div className="flex justify-between" style={{ width: size }}>
        <BaseNode runnerId={runners.third} label="Third base" getPlayerName={getPlayerName} />
        <BaseNode runnerId={runners.first} label="First base" getPlayerName={getPlayerName} />
      </div>
      {/* Home — bottom (visual anchor, never occupied) */}
      <div className="flex justify-center">
        <div
          className="rotate-45"
          style={{ width: 32, height: 32, border: '2px solid rgba(255,255,255,0.15)', borderRadius: 4 }}
        />
      </div>
    </div>
  )
}
