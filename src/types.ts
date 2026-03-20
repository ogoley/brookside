export interface Bases {
  first: boolean
  second: boolean
  third: boolean
}

export interface GameMeta {
  homeTeamId: string
  awayTeamId: string
  inning: number
  isTopInning: boolean
  outs: number // 0 | 1 | 2
  bases: Bases
  homeScore: number
  awayScore: number
  isActive: boolean
}

export interface Team {
  name: string
  shortName: string
  primaryColor: string
  secondaryColor: string
  logoUrl: string
}

export interface TeamsMap {
  [teamId: string]: Team
}

export interface StatOverlayState {
  visible: boolean
  type: 'pitcher' | 'hitter'
  playerId: string
  dismissAfterMs: number
}

export interface TimerState {
  durationMs: number       // total countdown length
  startedAt: number | null // epoch ms when last started; null = not running
  running: boolean
}

export interface HomrunState {
  active: boolean
  teamSide: 'home' | 'away'
  playerId: string
  logoUrl: string
  runsScored: number
  triggeredAt: number
}

export interface MatchupState {
  batterId: string | null
  pitcherId: string | null
  lastPitcherHome: string | null
  lastPitcherAway: string | null
}

export interface OverlayState {
  activeScene: 'game' | 'statCard' | 'matchup' | 'idle'
  statOverlay: StatOverlayState
  timer: TimerState
  homerun: HomrunState
  scoreboardBorder: boolean
  scoreboardScale: number
}

export type SceneName = 'game' | 'statCard' | 'matchup' | 'idle'

export interface HittingStats {
  gp?: number       // games played
  pa?: number       // plate appearances
  ab?: number       // at bats
  h?: number        // hits
  doubles?: number  // 2B
  triples?: number  // 3B
  hr?: number       // home runs
  r?: number        // runs scored
  rbi?: number      // runs batted in
  bb?: number       // walks
  k?: number        // strikeouts
  avg?: number      // batting average
  obp?: number      // on-base percentage
  slg?: number      // slugging percentage
  ops?: number      // OPS
}

export interface PitchingStats {
  gp?: number
  era?: number
  k?: number
  bb?: number
  inningsPitched?: number
  w?: number
  l?: number
  cg?: number
  sv?: number
}

export interface PlayerStats {
  hitting?: HittingStats
  pitching?: PitchingStats
}

export interface Player {
  name: string
  teamId: string
  position: 'pitcher' | 'hitter' | 'both'
  jerseyNumber?: string
  stats: PlayerStats
}

export interface PlayersMap {
  [playerId: string]: Player
}
