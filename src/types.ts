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
  // TODO: Replace playerName with playerId and resolve from /players once the player roster feature is built out
  playerName: string
  logoUrl: string
  runsScored: number
  triggeredAt: number
}

export interface OverlayState {
  activeScene: 'game' | 'statCard' | 'matchup' | 'idle'
  statOverlay: StatOverlayState
  timer: TimerState
  homerun: HomrunState
}

export type SceneName = 'game' | 'statCard' | 'matchup' | 'idle'

export interface PlayerStats {
  avg?: number
  hr?: number
  rbi?: number
  era?: number
  strikeouts?: number
  walks?: number
  inningsPitched?: number
}

export interface Player {
  name: string
  teamId: string
  position: 'pitcher' | 'hitter' | 'both'
  stats: PlayerStats
}

export interface PlayersMap {
  [playerId: string]: Player
}
