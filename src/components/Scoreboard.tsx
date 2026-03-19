import type { GameMeta, Team } from '../types'
import { TeamBug } from './TeamBug'
import { OutIndicator } from './OutIndicator'
import { BaseDiamond } from './BaseDiamond'

interface Props {
  game: GameMeta
  homeTeam?: Team
  awayTeam?: Team
}

export function Scoreboard({ game, homeTeam, awayTeam }: Props) {
  return (
    <div
      className="flex items-center justify-between px-4 h-12"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
    >
      {/* Away team (typically shown first/left) */}
      <TeamBug team={awayTeam} score={game.awayScore} side="away" />

      {/* Center: inning + game state */}
      <div className="flex items-center gap-5 px-6">
        {/* Inning arrow + number */}
        <div className="flex flex-col items-center leading-none" style={{ fontFamily: 'var(--font-score)' }}>
          {game.isTopInning && (
            <span className="text-white text-xs leading-none">▲</span>
          )}
          <span className="text-white text-sm font-semibold">{game.inning}</span>
          {!game.isTopInning && (
            <span className="text-white text-xs leading-none">▼</span>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/20" />

        {/* Bases */}
        <BaseDiamond bases={game.bases} />

        {/* Divider */}
        <div className="w-px h-6 bg-white/20" />

        {/* Outs */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="text-white/50 text-xs uppercase tracking-widest leading-none"
            style={{ fontFamily: 'var(--font-score)' }}
          >
            Out{game.outs !== 1 ? 's' : ''}
          </span>
          <OutIndicator outs={game.outs} />
        </div>
      </div>

      {/* Home team */}
      <TeamBug team={homeTeam} score={game.homeScore} side="home" />
    </div>
  )
}
