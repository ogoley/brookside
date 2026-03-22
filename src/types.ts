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
  currentGameId?: string
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

export interface TeamStanding {
  teamId: string
  w: number
  l: number
  streak: string  // e.g. "W3" or "L1"
}

// /standings — ordered array, index 0 = first place
export type StandingsData = TeamStanding[]

export interface OverlayState {
  activeScene: 'game' | 'statCard' | 'matchup' | 'standings' | 'leaderboard' | 'idle'
  statOverlay: StatOverlayState
  timer: TimerState
  homerun: HomrunState
  scoreboardBorder: boolean
  scoreboardScale: number
}

export type SceneName = 'game' | 'statCard' | 'matchup' | 'standings' | 'leaderboard' | 'idle'

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
  jerseyNumber?: string
  stats: PlayerStats
}

export interface PlayersMap {
  [playerId: string]: Player
}

// ── Scorekeeper / game log types ──

// Active results (the only options scorekeepers can select):
//   single | double | triple | home_run | walk | strikeout | strikeout_looking
//   groundout  — ground out or tag out; connected-chain rule applies (lead runner leaves, batter stays on 1st)
//   popout     — ball caught in the air; no chain rule; runners may tag and advance
// Legacy values kept in the type so historical records still deserialize correctly:
//   flyout | hbp | sacrifice_fly | sacrifice_bunt | fielders_choice | pitchers_poison
export type AtBatResult =
  | 'single' | 'double' | 'triple' | 'home_run'
  | 'walk' | 'strikeout' | 'strikeout_looking'
  | 'groundout' | 'popout'
  | 'flyout' | 'hbp' | 'sacrifice_fly' | 'sacrifice_bunt'
  | 'fielders_choice' | 'pitchers_poison'

// What happened to a runner already on base during a play.
// If a runner was present on a base, their outcome key MUST be set.
// Omitting a key means no runner occupied that base — never use omission to mean 'stayed'.
export interface RunnerOutcomes {
  // 'sits': chain rule — runner leaves the basepath as a consequence of a ground/tag out;
  //         not a genuine out on the runner, but counts toward outsOnPlay the same as 'out'.
  first?:  'scored' | 'second' | 'third' | 'stayed' | 'out' | 'sits'
  second?: 'scored' | 'third'  | 'stayed' | 'out' | 'sits'
  third?:  'scored' | 'stayed' | 'out' | 'sits'
}

export interface RunnersState {
  first: string | null
  second: string | null
  third: string | null
}

export interface AtBatRecord {
  batterId: string
  pitcherId: string
  isSub: boolean           // denormalized from lineup at write time; excluded from season stats on finalization
  inning: number
  isTopInning: boolean
  timestamp: number
  result: AtBatResult
  runnersOnBase: RunnersState   // snapshot of who was on base BEFORE this play
  runnerOutcomes: RunnerOutcomes // what happened to each runner during this play
  runnersScored: string[]        // playerIds who scored (derived from runnerOutcomes + HR batter)
  outsOnPlay: number             // total outs on this play: (1 if batter out) + (runners marked 'out' or 'sits')
  rbiCount: number
  batterAdvancedTo: 'first' | 'second' | 'third' | 'home' | 'out' | null
  notes?: string
}

// One entry in a team's batting lineup
export interface LineupEntry {
  playerId: string
  isSub: boolean
}

export interface GameRecord {
  homeTeamId: string
  awayTeamId: string
  date: string              // "YYYY-MM-DD" in Eastern Time
  isStreamed: boolean       // true = mirrors state to /game/meta for scorebug
  finalized: boolean
  finalizedAt?: number
  startedAt: number         // epoch ms — used for 90-min game completion check
  inning: number
  isTopInning: boolean
  outs: number
  homeScore: number         // cached running total — source of truth is still /gameStats
  awayScore: number
  matchup?: {
    pitcherId?: string | null
    batterId?: string | null
    lastPitcherHome?: string | null
    lastPitcherAway?: string | null
  }
}

// /games/{gameId}/lineups/{teamId} — ordered batting lineup
export type GameLineup = LineupEntry[]

// /liveRunners/{gameId} — current base runners by player ID
export type LiveRunners = RunnersState

// /gameSummaries/{gameId}/{playerId} — per-game box score written on finalization
export interface GameSummary {
  playerId: string
  teamId: string
  ab: number
  pa: number
  h: number
  doubles: number
  triples: number
  hr: number
  r: number
  rbi: number
  bb: number
  k: number
  inningsPitched: number
}
