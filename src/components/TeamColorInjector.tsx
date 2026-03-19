import { useEffect } from 'react'
import type { Team } from '../types'

interface Props {
  homeTeam?: Team
  awayTeam?: Team
}

export function TeamColorInjector({ homeTeam, awayTeam }: Props) {
  useEffect(() => {
    const root = document.documentElement
    if (homeTeam) {
      root.style.setProperty('--team-home-primary', homeTeam.primaryColor)
      root.style.setProperty('--team-home-secondary', homeTeam.secondaryColor)
    }
    if (awayTeam) {
      root.style.setProperty('--team-away-primary', awayTeam.primaryColor)
      root.style.setProperty('--team-away-secondary', awayTeam.secondaryColor)
    }
  }, [homeTeam, awayTeam])

  return null
}
