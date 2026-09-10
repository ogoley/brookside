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
  /** Exhibition (all-star) team — hidden from season pickers; games involving
   *  it are never finalized into season stats. */
  isExhibition?: boolean
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
  t: number       // ties
  streak: string  // e.g. "W3" or "L1"
}

// /standings — ordered array, index 0 = first place
export type StandingsData = TeamStanding[]

export interface InsightsState {
  title: string
  point1: string
  point2: string
  point3: string
  point4: string
  visibleCount: number // 0–4: how many points are currently revealed
}

// ── Sponsors ─────────────────────────────────────────────────────────────────

// /config/sponsors/{sponsorId} — admin-managed (the /config path is
// admin-writable), read by the overlay + controller.
export interface Sponsor {
  name: string
  /** Short line under the name, e.g. "Authentic Indian cuisine · Springfield, MA" */
  tagline?: string
  /** Same-origin path (/sponsors/x.svg) or Firebase Storage URL */
  logoUrl: string
  /** Shown as a pill on the interstitial + in the ticker, e.g. "pintus.website" */
  website?: string
  /** Brand accent used for the interstitial edge/pill and ticker chip */
  accentColor?: string
  /** Render the logo on a white plate — for logos that are not dark-background safe */
  lightPlate?: boolean
  /** Innings this sponsor presents (a sponsor may own several). Stored as a
   *  map so RTDB never has to hold a sparse array. */
  innings?: Record<string, boolean>
  enabled?: boolean
  /** Display order in admin + tie-break when several sponsors share an inning */
  order?: number
}

export type SponsorsMap = Record<string, Sponsor>

// /overlay/sponsor — written ONLY by the controller. `active` is ephemeral
// (dismissed by the controller's timer, like homerun); `autoShow` and
// `durationMs` are producer settings that survive a dismiss.
export interface SponsorOverlayState {
  active: boolean
  sponsorId: string
  /** Inning the card is presenting (drives the "2ND INNING PRESENTED BY" line) */
  inning: number
  triggeredAt: number
  durationMs: number
  /** Fire automatically when the scorebug inning advances */
  autoShow: boolean
}

// ── Bottom-line ticker ───────────────────────────────────────────────────────

export type TickerSectionId =
  | 'standings' | 'playoffs' | 'batting' | 'homeRuns' | 'pitching' | 'results' | 'upcoming' | 'sponsors' | 'messages'

// /overlay/ticker — producer settings; the overlay computes the content itself
// from /players, /games, /teams, /config/sponsors (read-only, no writes).
export interface TickerState {
  visible: boolean
  /** Crawl speed in px/s at 1920 wide */
  speed: number
  /** Cap + highlight colour — swap to fit the broadcast theme */
  accentColor: string
  sections: Record<TickerSectionId, boolean>
  /** Free-text producer messages ("NEXT WEEK: ...") — keyed map, ordered by key */
  messages: Record<string, string>
}

export interface OverlayState {
  activeScene: 'game' | 'statCard' | 'matchup' | 'standings' | 'leaderboard' | 'playoffs' | 'insights' | 'allstarLineups' | 'idle'
  statOverlay: StatOverlayState
  timer: TimerState
  homerun: HomrunState
  insights: InsightsState
  sponsor: SponsorOverlayState
  ticker: TickerState
  scoreboardBorder: boolean
  scoreboardScale: number
}

export type SceneName = 'game' | 'statCard' | 'matchup' | 'standings' | 'leaderboard' | 'playoffs' | 'insights' | 'allstarLineups' | 'idle'

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
  runsAllowed?: number
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
  /** Ephemeral one-game sub. Stats accumulate normally on finalization but
   *  season-stat consumers (leaderboards, standings, totals) must filter
   *  out players where isSub === true. */
  isSub?: boolean
}

export interface PlayersMap {
  [playerId: string]: Player
}

// ── Scorekeeper / game log types ──

// Sentinel batter ID for auto-outs (Forceful Actions). Auto-outs are not tied
// to a real player — using a sentinel keeps AtBatRecord.batterId non-nullable
// while ensuring the value won't match any real player ID in lookups (batting
// stats, season finalization, lineup-pointer walk-back, etc.).
// Any code that iterates at-bats and accumulates per-batter stats MUST guard
// against this value, or it will write phantom records keyed by the sentinel.
export const AUTO_OUT_BATTER_ID = '__auto_out__'

// Active results (the only options scorekeepers can select):
//   single | double | triple | home_run | walk | strikeout | strikeout_looking
//   groundout  — ground out or tag out; connected-chain rule applies (lead runner leaves, batter stays on 1st)
//   popout     — ball caught in the air; no chain rule; runners may tag and advance
// auto_out — recorded via the Forceful Actions UI, NOT the at-bat wizard. Used
//   when a team has fewer players than required and the missing roster slot
//   must take an automatic out. The record uses a sentinel batterId
//   ('__auto_out__'); the pitcher still gets the out credit.
// Legacy values kept in the type so historical records still deserialize correctly:
//   flyout | hbp | sacrifice_fly | sacrifice_bunt | fielders_choice | pitchers_poison
export type AtBatResult =
  | 'single' | 'double' | 'triple' | 'home_run'
  | 'walk' | 'strikeout' | 'strikeout_looking'
  | 'groundout' | 'popout'
  | 'auto_out'
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
  pitcherIsSub?: boolean   // denormalized from sub-pitcher list at write time; pitcher excluded from season stats + W/L on finalization
  pitcherSubName?: string  // display name for an ephemeral sub pitcher (pitcherId is fabricated subp_<ts>)
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
  subName?: string
}

// /games/{gameId}/subPitchers/{teamId}/{pitcherId} — ephemeral per-game sub pitcher entries
// playerId is a fabricated `subp_<timestamp>` not present in /players. Stats are NOT
// rolled into season totals on finalization; they only appear in per-game box scores.
export interface SubPitcherEntry {
  playerId: string
  name: string
}

export type SubPitchersByTeam = Record<string, Record<string, SubPitcherEntry>>

// One entry in a team's batting lineup
export interface LineupEntry {
  playerId: string
  isSub: boolean
  subName?: string
}

export interface GameRecord {
  homeTeamId: string
  awayTeamId: string
  date: string              // "YYYY-MM-DD" in Eastern Time
  isStreamed: boolean       // true = mirrors state to /game/meta for scorebug
  /** Denormalized at creation when either team is an exhibition team; makes
   *  exhibition detection survive team deletion. */
  isExhibition?: boolean
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
  /** Pitcher credited with the win — set manually for paper games, auto-set on finalization */
  wPitcherId?: string | null
  /** Pitcher credited with the loss */
  lPitcherId?: string | null
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
  pitchingK?: number
  pitchingBb?: number
  runsAllowed?: number
}

// ── Home Run Derby (50/50 charity pool) ──────────────────────────────────────

// /derby/entries/{entryId}
export interface DerbyEntry {
  name: string       // person who entered
  playerId: string   // hitter they're betting on
  totalHr: number    // their guess at the winner's total HR across all 3 rounds
  paid: boolean
  createdAt: number
}

// /derby/result — set by admin after the derby ends
export interface DerbyResult {
  winnerPlayerId: string
  totalHr: number    // the winner's actual total HR across all 3 rounds
  finalized: boolean
}

// /derby/archive/{year} — frozen snapshot of a past season's derby, written by
// the admin "Archive & reset" action. Lives under /derby so it shares that
// path's open-write rule (same accepted risk as the rest of the derby).
export interface DerbyArchiveEntry {
  archivedAt: number
  entries?: Record<string, DerbyEntry>
  result?: DerbyResult
  disabledPlayers?: Record<string, true>
  broadcast?: DerbyBroadcastState
}

// /derby
export interface DerbyState {
  entries?: Record<string, DerbyEntry>
  result?: DerbyResult
  // playerIds marked as not present at the derby — hidden from the public
  // leaders grid and never selectable in entry/result dropdowns
  disabledPlayers?: Record<string, true>
  broadcast?: DerbyBroadcastState
  archive?: Record<string, DerbyArchiveEntry>
}

// ── Home Run Derby broadcast (overlay + controller) ──────────────────────────

export type DerbyRoundNum = 1 | 2 | 3
export type DerbyRoundKey = 'r1' | 'r2' | 'r3'

// A missing key means the player hasn't hit in that round yet — 0 is a real
// recorded result and must never be conflated with "not yet".
export interface DerbyRoundScores {
  r1?: number
  r2?: number
  r3?: number
}

export type DerbyBroadcastView = 'hidden' | 'player' | 'leaderboard' | 'upNext'

// /derby/broadcast — written by /derby-controller, read by /derby-overlay.
// Lives under /derby so it shares that path's open write rule (front-end
// password gate only, same accepted risk as the 50/50 page).
export interface DerbyBroadcastState {
  view: DerbyBroadcastView
  activeRound: DerbyRoundNum        // the round currently being hit
  leaderboardRound: DerbyRoundNum   // which round the leaderboard view shows
  featuredPlayerId: string | null   // who the player card shows
  battingOrder: string[]            // playerIds in hitting order for the active round
  currentBatterIndex: number        // pointer into battingOrder
  scores: Record<string, DerbyRoundScores>  // playerId → per-round HR
}
