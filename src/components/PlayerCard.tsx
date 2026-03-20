import type { Player, Team } from '../types'

interface Props {
  player: Player
  team?: Team
}

export function PlayerCard({ player, team }: Props) {
  const { stats } = player

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      {/* Header */}
      <div
        className="px-4 py-2"
        style={{ background: team ? team.primaryColor : '#1a1a2e' }}
      >
        <p className="text-xs uppercase tracking-widest opacity-60" style={{ fontFamily: 'var(--font-score)', color: team?.secondaryColor ?? '#fff' }}>
          {team?.shortName ?? '---'}
        </p>
        <p className="text-xl font-bold leading-tight" style={{ fontFamily: 'var(--font-score)', color: team?.secondaryColor ?? '#fff' }}>
          {player.name}
        </p>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 flex gap-5">
        {stats.hitting && (
          <>
            <Stat label="AVG" value={stats.hitting.avg !== undefined ? stats.hitting.avg.toFixed(3).replace(/^0/, '') : '---'} />
            <Stat label="HR" value={stats.hitting.hr ?? 0} />
            <Stat label="RBI" value={stats.hitting.rbi ?? 0} />
          </>
        )}
        {stats.pitching && (
          <>
            <Stat label="ERA" value={stats.pitching.era !== undefined ? stats.pitching.era.toFixed(2) : '---'} />
            <Stat label="K" value={stats.pitching.k ?? 0} />
            <Stat label="IP" value={stats.pitching.inningsPitched ?? 0} />
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
        {label}
      </span>
      <span className="text-white text-lg font-bold leading-tight" style={{ fontFamily: 'var(--font-score)' }}>
        {value}
      </span>
    </div>
  )
}
