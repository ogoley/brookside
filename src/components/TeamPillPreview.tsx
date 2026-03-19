import type { Team } from '../types'

interface Props {
  team?: Partial<Team>
  score?: number
}

/** Renders a scoreboard pill using direct color props (not CSS vars).
 *  Used anywhere a preview is needed outside the live overlay context. */
export function TeamPillPreview({ team, score = 0 }: Props) {
  const primary = team?.primaryColor || '#1a3a6b'
  const secondary = team?.secondaryColor || '#ffffff'

  return (
    <div className="flex items-stretch rounded-full overflow-hidden shrink-0" style={{ height: 40 }}>
      <div className="flex items-center gap-2 pl-4 pr-3" style={{ background: primary }}>
        {team?.logoUrl && (
          <img src={team.logoUrl} alt="" className="w-5 h-5 object-contain shrink-0" onError={e => (e.currentTarget.style.display = 'none')} />
        )}
        <span
          className="font-bold tracking-wide leading-none"
          style={{ fontFamily: 'var(--font-score)', color: secondary, fontSize: 14 }}
        >
          {team?.shortName || '---'}
        </span>
      </div>
      <div className="flex items-center px-3" style={{ background: 'rgba(0,0,0,0.75)' }}>
        <span
          className="font-black leading-none tabular-nums"
          style={{ fontFamily: 'var(--font-score)', color: '#fff', fontSize: 20 }}
        >
          {score}
        </span>
      </div>
    </div>
  )
}
