import type { Team } from '../types'

interface Props {
  team?: Team
  score: number
  side: 'home' | 'away'
}

export function TeamBug({ team, score, side }: Props) {
  const primary = side === 'home' ? 'var(--team-home-primary)' : 'var(--team-away-primary)'
  const secondary = side === 'home' ? 'var(--team-home-secondary)' : 'var(--team-away-secondary)'

  return (
    <div className="flex items-center gap-0">
      {/* Logo / color block */}
      <div
        className="w-10 h-10 flex items-center justify-center overflow-hidden shrink-0"
        style={{ background: primary }}
      >
        {team?.logoUrl ? (
          <img src={team.logoUrl} alt={team.name} className="w-8 h-8 object-contain" />
        ) : (
          <span
            className="text-sm font-bold leading-none"
            style={{ fontFamily: 'var(--font-score)', color: secondary }}
          >
            {team?.shortName?.slice(0, 1) ?? '?'}
          </span>
        )}
      </div>

      {/* Team short name */}
      <div
        className="px-3 h-10 flex items-center"
        style={{ background: primary }}
      >
        <span
          className="text-lg font-bold tracking-wide leading-none"
          style={{ fontFamily: 'var(--font-score)', color: secondary }}
        >
          {team?.shortName ?? '---'}
        </span>
      </div>

      {/* Score */}
      <div
        className="w-12 h-10 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}
      >
        <span
          className="text-2xl font-black leading-none"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          {score}
        </span>
      </div>
    </div>
  )
}
