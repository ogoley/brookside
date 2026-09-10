import { describe, it, expect } from 'vitest'
import { buildAllstarArchiveUpdates, buildAllstarRestoreUpdates, ALLSTAR_SEED_TEAMS, type AllstarArchive } from '../allstar'
import type { TeamsMap } from '../types'

const teams: TeamsMap = {
  swing_mafia: { name: 'Swing Mafia', shortName: 'SM', primaryColor: '#1c7d23', secondaryColor: '#fff', logoUrl: '' },
  team_rist: ALLSTAR_SEED_TEAMS.team_rist,
  team_hiller: ALLSTAR_SEED_TEAMS.team_hiller,
}
const rosters = { team_rist: ['david_rist', 'mark_davis'], team_hiller: ['eric_hiller'] }

describe('all-star season archive', () => {
  it('moves only the exhibition teams + rosters into config/allstarArchive/{year} and clears the live nodes', () => {
    const u = buildAllstarArchiveUpdates(2026, teams, rosters, 1_700_000_000_000)
    expect(u['config/allstarArchive/2026']).toEqual({
      year: 2026,
      archivedAt: 1_700_000_000_000,
      teams: { team_rist: ALLSTAR_SEED_TEAMS.team_rist, team_hiller: ALLSTAR_SEED_TEAMS.team_hiller },
      rosters,
    })
    expect(u['teams/team_rist']).toBeNull()
    expect(u['teams/team_hiller']).toBeNull()
    expect(u['config/allstar']).toBeNull()
    expect(u).not.toHaveProperty('teams/swing_mafia')   // season teams untouched
  })

  it('archives a team even if its roster is missing (empty list, never undefined)', () => {
    const u = buildAllstarArchiveUpdates(2026, teams, null)
    expect((u['config/allstarArchive/2026'] as AllstarArchive).rosters).toEqual({ team_rist: [], team_hiller: [] })
  })

  it('refuses to archive when there is nothing all-star on the live app', () => {
    expect(() => buildAllstarArchiveUpdates(2026, { swing_mafia: teams.swing_mafia }, null)).toThrow(/nothing|No all-star/i)
  })

  it('restore puts the same teams and rosters back, flagged exhibition, and keeps the archive', () => {
    const archive = buildAllstarArchiveUpdates(2026, teams, rosters)['config/allstarArchive/2026'] as AllstarArchive
    const r = buildAllstarRestoreUpdates(archive)
    expect(r['teams/team_rist']).toEqual({ ...ALLSTAR_SEED_TEAMS.team_rist, isExhibition: true })
    expect(r['config/allstar/rosters/team_rist']).toEqual(['david_rist', 'mark_davis'])
    expect(r['config/allstar/rosters/team_hiller']).toEqual(['eric_hiller'])
    expect(r).not.toHaveProperty('config/allstarArchive/2026')
  })

  it('archive → restore round-trips the live shape', () => {
    const archive = buildAllstarArchiveUpdates(2026, teams, rosters)['config/allstarArchive/2026'] as AllstarArchive
    const restored = buildAllstarRestoreUpdates(archive)
    const again = buildAllstarArchiveUpdates(2026, {
      team_rist: restored['teams/team_rist'] as TeamsMap[string],
      team_hiller: restored['teams/team_hiller'] as TeamsMap[string],
    }, { team_rist: restored['config/allstar/rosters/team_rist'] as string[], team_hiller: restored['config/allstar/rosters/team_hiller'] as string[] }, archive.archivedAt)
    expect(again['config/allstarArchive/2026']).toEqual(archive)
  })
})
