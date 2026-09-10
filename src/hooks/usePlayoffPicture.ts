import { useMemo } from 'react'
import { useTeams } from './useTeams'
import { useGames } from './useGames'
import { useSchedule } from './useSchedule'
import { isExhibitionGame } from '../allstar'
import { buildPlayoffPicture, dedupeSchedule, DEFAULT_PLAYOFF_CONFIG, type PlayoffPicture } from '../playoffs/engine'

/**
 * Live playoff picture: finalized regular-season /games + /config/schedule →
 * exact clinch / elimination math (see src/playoffs/engine.ts). Exhibition
 * teams and games never enter. Recomputes only when its inputs change.
 */
export function usePlayoffPicture(): { picture: PlayoffPicture | null; loading: boolean } {
  const { teams } = useTeams()
  const { games, loading: gamesLoading } = useGames()
  const { schedule, loading: scheduleLoading } = useSchedule()

  const picture = useMemo(() => {
    const teamIds = Object.entries(teams).filter(([, t]) => !t.isExhibition).map(([id]) => id)
    if (teamIds.length === 0) return null
    const results = games
      .filter(({ game }) => game.finalized && !isExhibitionGame(game, teams))
      .map(({ game }) => ({
        date: game.date,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: game.homeScore ?? 0,
        awayScore: game.awayScore ?? 0,
      }))
    const remaining = dedupeSchedule(schedule, results)
    return buildPlayoffPicture(teamIds, results, remaining, DEFAULT_PLAYOFF_CONFIG)
  }, [teams, games, schedule])

  return { picture, loading: gamesLoading || scheduleLoading }
}
