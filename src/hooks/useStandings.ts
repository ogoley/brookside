import { useMemo } from 'react'
import { useGames } from './useGames'
import type { StandingsData } from '../types'

export function useStandings(): { standings: StandingsData; loading: boolean } {
  const { games, loading } = useGames()

  const standings = useMemo(() => {
    const finalized = games
      .filter(({ game }) => game.finalized)
      // chronological order (oldest first) for streak calculation
      .sort((a, b) => (a.game.startedAt ?? 0) - (b.game.startedAt ?? 0))

    // Accumulate W/L/T and ordered results per team
    const record: Record<string, { w: number; l: number; t: number; results: ('W' | 'L' | 'T')[] }> = {}

    const ensure = (teamId: string) => {
      if (!record[teamId]) record[teamId] = { w: 0, l: 0, t: 0, results: [] }
    }

    for (const { game } of finalized) {
      const { homeTeamId, awayTeamId, homeScore, awayScore } = game
      ensure(homeTeamId)
      ensure(awayTeamId)

      if (homeScore > awayScore) {
        record[homeTeamId].w++; record[homeTeamId].results.push('W')
        record[awayTeamId].l++; record[awayTeamId].results.push('L')
      } else if (awayScore > homeScore) {
        record[awayTeamId].w++; record[awayTeamId].results.push('W')
        record[homeTeamId].l++; record[homeTeamId].results.push('L')
      } else {
        record[homeTeamId].t++; record[homeTeamId].results.push('T')
        record[awayTeamId].t++; record[awayTeamId].results.push('T')
      }
    }

    const rows: StandingsData = Object.entries(record).map(([teamId, { w, l, t, results }]) => {
      // Streak: count trailing consecutive identical results
      const last = results[results.length - 1]
      let count = 0
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === last) count++
        else break
      }
      const streak = last ? `${last}${count}` : '—'
      return { teamId, w, l, t, streak }
    })

    // Sort: wins desc, then losses asc, then PCT desc
    rows.sort((a, b) => {
      const wDiff = b.w - a.w
      if (wDiff !== 0) return wDiff
      const lDiff = a.l - b.l
      if (lDiff !== 0) return lDiff
      const pctA = (a.w + a.t * 0.5) / (a.w + a.l + a.t || 1)
      const pctB = (b.w + b.t * 0.5) / (b.w + b.l + b.t || 1)
      return pctB - pctA
    })

    return rows
  }, [games])

  return { standings, loading }
}
