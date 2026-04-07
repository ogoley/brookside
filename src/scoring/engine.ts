/**
 * scoring/engine.ts
 *
 * Pure scoring functions — no Firebase, no React.
 * Takes an at-bat record + current runner state and returns the next game state
 * along with a plain-English narration log for dev debugging.
 *
 * All functions are deterministic: same inputs always produce the same outputs.
 */

import type { AtBatRecord, RunnersState, RunnerOutcomes, AtBatResult, HittingStats, PitchingStats } from '../types'

// ── Result classification helpers ──────────────────────────────────────────

/** Results that count as an official at-bat (AB) */
const AB_RESULTS = new Set<AtBatResult>([
  'single', 'double', 'triple', 'home_run',
  'strikeout', 'strikeout_looking',
  'groundout', 'popout',
  // legacy
  'flyout', 'fielders_choice', 'pitchers_poison',
])

/** Results where the batter is the credited out (batterAdvancedTo drives actual out counting) */
const BATTER_OUT_RESULTS = new Set<AtBatResult>([
  'strikeout', 'strikeout_looking',
  'groundout', 'popout',
  // legacy
  'flyout', 'sacrifice_fly', 'sacrifice_bunt', 'pitchers_poison',
])

export function isAtBat(result: AtBatResult): boolean {
  return AB_RESULTS.has(result)
}

export function isBatterOut(result: AtBatResult): boolean {
  return BATTER_OUT_RESULTS.has(result)
}

// ── Play log entry ─────────────────────────────────────────────────────────

export interface PlayLogEntry {
  timestamp: number
  inning: number
  isTopInning: boolean
  batterName: string
  result: AtBatResult
  lines: string[]        // narration lines in order
  warnings: string[]     // logical contradictions or unexpected states
}

// ── Core: apply a submitted at-bat to current runner state ─────────────────

export interface ApplyAtBatInput {
  record: AtBatRecord
  currentRunners: RunnersState
  batterName: string
  getPlayerName: (id: string) => string  // lookup fn so engine stays pure
  homeScore: number
  awayScore: number
  isHomeTeamBatting: boolean
}

export interface ApplyAtBatResult {
  nextRunners: RunnersState
  outsOnPlay: number
  runsScored: number
  rbiCount: number
  logEntry: PlayLogEntry
}

export function applyAtBat(input: ApplyAtBatInput): ApplyAtBatResult {
  const { record, batterName, getPlayerName, homeScore, awayScore, isHomeTeamBatting } = input
  const { result, runnersOnBase, runnerOutcomes, batterAdvancedTo } = record

  const lines: string[] = []
  const warnings: string[] = []

  lines.push(`${isHomeTeamBatting ? '🏠' : '✈️'} Inning ${record.inning} ${record.isTopInning ? 'Top' : 'Bot'} — ${batterName} — ${formatResult(result)}`)

  // ── Pitcher's Poison special handling ─────────────────────────────────
  if (result === 'pitchers_poison') {
    lines.push(`  Pitcher's Poison triggered — checking for connected chain from 1st base...`)
    const chain = getConnectedChain(runnersOnBase)
    if (chain.length > 0) {
      const leadBase = chain[chain.length - 1]
      const leadRunnerId = runnersOnBase[leadBase]!
      lines.push(`  Connected chain found: ${chain.join(' → ')}. Lead runner is ${getPlayerName(leadRunnerId)} on ${leadBase}.`)
      lines.push(`  → ${getPlayerName(leadRunnerId)} (${leadBase}) is OUT — sits down for the Poison.`)
      lines.push(`  → ${batterName} (batter) STAYS on 1st — safe.`)
    } else {
      lines.push(`  No connected chain from 1st — batter sits down normally.`)
      lines.push(`  → ${batterName} (batter) is OUT.`)
    }
  }

  // ── Runner outcomes ────────────────────────────────────────────────────
  const bases: Array<'first' | 'second' | 'third'> = ['first', 'second', 'third']
  let runsScored = 0
  let rbiCount = 0

  const presentRunners = bases.filter(b => runnersOnBase[b] !== null)

  if (presentRunners.length === 0 && result !== 'pitchers_poison') {
    lines.push(`  No runners on base.`)
  }

  for (const base of presentRunners) {
    const runnerId = runnersOnBase[base]!
    const runnerName = getPlayerName(runnerId)
    const outcome = runnerOutcomes[base]

    if (outcome === undefined) {
      warnings.push(`⚠ Runner ${runnerName} was on ${base} but has no outcome recorded. This is a bug — all present runners must have an outcome.`)
      continue
    }

    if (outcome === 'stayed') {
      lines.push(`  → ${runnerName} (${base}): stayed put.`)
    } else if (outcome === 'scored') {
      runsScored++
      rbiCount++
      lines.push(`  → ${runnerName} (${base}): SCORED ✓ — run awarded to ${isHomeTeamBatting ? 'home' : 'away'} team. RBI credited to ${batterName}.`)
    } else if (outcome === 'out') {
      lines.push(`  → ${runnerName} (${base}): OUT on the play.`)
    } else if (outcome === 'sits') {
      lines.push(`  → ${runnerName} (${base}): sits down (chain rule — leaves bases, batter's out).`)
    } else {
      lines.push(`  → ${runnerName} (${base}): advanced to ${outcome}.`)
    }
  }

  // ── Batter outcome ─────────────────────────────────────────────────────
  if (result === 'home_run') {
    runsScored++   // batter scores themselves
    rbiCount++     // batter drives themselves in
    lines.push(`  → ${batterName} (batter): HOME RUN — scores! Total RBI this play: ${rbiCount}.`)
  } else if (batterAdvancedTo === 'out') {
    lines.push(`  → ${batterName} (batter): OUT.`)
  } else if (batterAdvancedTo === 'first' && result === 'pitchers_poison') {
    lines.push(`  → ${batterName} (batter): safe on 1st via Pitcher's Poison.`)
  } else if (batterAdvancedTo) {
    lines.push(`  → ${batterName} (batter): advanced to ${batterAdvancedTo}.`)
  }

  // ── No-RBI cases ───────────────────────────────────────────────────────
  if (result === 'strikeout' || result === 'strikeout_looking' || result === 'pitchers_poison') {
    rbiCount = 0
    if (runsScored > 0) {
      warnings.push(`⚠ ${runsScored} run(s) scored on a ${formatResult(result)} — RBI zeroed out (not credited on this result type).`)
    }
  }

  // ── outsOnPlay ─────────────────────────────────────────────────────────
  const batterIsOut = batterAdvancedTo === 'out'
  const runnersOut = bases.filter(b => runnerOutcomes[b] === 'out' || runnerOutcomes[b] === 'sits').length
  const outsOnPlay = (batterIsOut ? 1 : 0) + runnersOut

  lines.push(`  outsOnPlay = ${outsOnPlay} (batter ${batterIsOut ? 'out' : 'safe'} + ${runnersOut} runner(s) out/sits).`)

  if (outsOnPlay > 3) {
    warnings.push(`⚠ outsOnPlay is ${outsOnPlay} — cannot exceed 3. Check runner outcomes.`)
  }

  // ── Compute next runner state ──────────────────────────────────────────
  const nextRunners = computeNextRunners(runnersOnBase, runnerOutcomes, batterAdvancedTo, record.batterId)

  // ── Collision check ────────────────────────────────────────────────────
  const occupiedBases = bases.map(b => nextRunners[b]).filter(Boolean)
  const uniqueOccupied = new Set(occupiedBases)
  if (occupiedBases.length !== uniqueOccupied.size) {
    warnings.push(`⚠ Two players ended up on the same base after this play. Check runner outcomes and batterAdvancedTo.`)
  }

  // ── Score update ───────────────────────────────────────────────────────
  const newHomeScore = isHomeTeamBatting ? homeScore + runsScored : homeScore
  const newAwayScore = !isHomeTeamBatting ? awayScore + runsScored : awayScore
  if (runsScored > 0) {
    lines.push(`  Score: ${isHomeTeamBatting ? `Home ${homeScore} → ${newHomeScore}` : `Away ${awayScore} → ${newAwayScore}`}. RBI: ${batterName} +${rbiCount}.`)
  }

  lines.push(`  liveRunners after: { first: ${nextRunners.first ?? 'empty'}, second: ${nextRunners.second ?? 'empty'}, third: ${nextRunners.third ?? 'empty'} }`)

  if (warnings.length > 0) {
    lines.push(`  ─── ${warnings.length} warning(s) above ───`)
  }

  return {
    nextRunners,
    outsOnPlay,
    runsScored,
    rbiCount,
    logEntry: {
      timestamp: record.timestamp,
      inning: record.inning,
      isTopInning: record.isTopInning,
      batterName,
      result,
      lines,
      warnings,
    },
  }
}

// ── Half-inning replay ─────────────────────────────────────────────────────
// Replays all at-bats for a half-inning in order to recompute liveRunners
// and out count from scratch. Used after any edit or delete within the current half-inning.

export interface ReplayResult {
  finalRunners: RunnersState
  totalOuts: number
  totalRuns: number
  logLines: string[]
}

export function replayHalfInning(
  atBats: AtBatRecord[],
  getPlayerName: (id: string) => string,
  isHomeTeamBatting: boolean,
  startingHomeScore: number,
  startingAwayScore: number,
): ReplayResult {
  const logLines: string[] = [`♻ Replaying half-inning (${atBats.length} at-bat(s))...`]
  let runners: RunnersState = { first: null, second: null, third: null }
  let totalOuts = 0
  let totalRuns = 0
  let homeScore = startingHomeScore
  let awayScore = startingAwayScore

  for (const record of atBats) {
    const batterName = getPlayerName(record.batterId)
    const result = applyAtBat({
      record,
      currentRunners: runners,
      batterName,
      getPlayerName,
      homeScore,
      awayScore,
      isHomeTeamBatting,
    })
    runners = result.nextRunners
    totalOuts += result.outsOnPlay
    totalRuns += result.runsScored
    homeScore = isHomeTeamBatting ? homeScore + result.runsScored : homeScore
    awayScore = !isHomeTeamBatting ? awayScore + result.runsScored : awayScore
    logLines.push(...result.logEntry.lines)
    if (result.logEntry.warnings.length > 0) {
      logLines.push(...result.logEntry.warnings)
    }
  }

  logLines.push(`♻ Replay complete — outs: ${totalOuts}, runs: ${totalRuns}, runners: { first: ${runners.first ?? 'empty'}, second: ${runners.second ?? 'empty'}, third: ${runners.third ?? 'empty'} }`)

  return { finalRunners: runners, totalOuts, totalRuns, logLines }
}

// ── Connected chain detection ──────────────────────────────────────────────
// Used for the fielded-out forced-out rule: on a ground/fly out, the lead
// runner of a consecutive chain from 1st is automatically out on the play.

function getConnectedChain(runners: RunnersState): Array<'first' | 'second' | 'third'> {
  // A connected chain starts at 1st and extends outward with no gaps.
  const chain: Array<'first' | 'second' | 'third'> = []
  if (runners.first) {
    chain.push('first')
    if (runners.second) {
      chain.push('second')
      if (runners.third) {
        chain.push('third')
      }
    }
  }
  return chain
}

// ── Next runner state computation ──────────────────────────────────────────

function computeNextRunners(
  before: RunnersState,
  outcomes: RunnerOutcomes,
  batterAdvancedTo: AtBatRecord['batterAdvancedTo'],
  batterId: string,
): RunnersState {
  const next: RunnersState = { first: null, second: null, third: null }

  // Place each runner at their new base
  const bases: Array<'first' | 'second' | 'third'> = ['first', 'second', 'third']
  for (const base of bases) {
    const runnerId = before[base]
    if (!runnerId) continue
    const outcome = outcomes[base]
    if (!outcome || outcome === 'out' || outcome === 'sits' || outcome === 'scored') continue
    if (outcome === 'stayed') {
      next[base] = runnerId
    } else if (outcome === 'second') {
      next.second = runnerId
    } else if (outcome === 'third') {
      next.third = runnerId
    }
  }

  // Place the batter
  if (batterAdvancedTo === 'first') next.first = batterId
  else if (batterAdvancedTo === 'second') next.second = batterId
  else if (batterAdvancedTo === 'third') next.third = batterId
  // 'home', 'out', null → batter does not occupy a base

  return next
}

// ── Display helpers ────────────────────────────────────────────────────────

export function formatResult(result: AtBatResult): string {
  const map: Record<AtBatResult, string> = {
    single: 'Single',
    double: 'Double',
    triple: 'Triple',
    home_run: 'Home Run',
    walk: 'Walk',
    strikeout: 'Strikeout (K)',
    strikeout_looking: 'Strikeout Looking (ꓘ)',
    groundout: 'Ground / Tag Out',
    popout: 'Pop Out',
    flyout: 'Fly Out',
    hbp: 'Hit By Pitch',
    sacrifice_fly: 'Sac Fly',
    sacrifice_bunt: 'Sac Bunt',
    fielders_choice: "Fielder's Choice",
    pitchers_poison: "Pitcher's Poison",
  }
  return map[result] ?? result
}

// ── Per-game stats computation ─────────────────────────────────────────────
// Pure function: takes a set of at-bat records for one game and a player ID,
// returns that player's hitting and pitching stats for that game only.
// Used to merge live in-progress game stats with stored season totals for the overlay.

export interface GameStatsResult {
  hitting: HittingStats | null
  pitching: PitchingStats | null
  runsScored: number  // for batting runs (R) — need separate tracking since it comes from runnersScored
}

export function computeGameStats(
  atBats: AtBatRecord[],
  playerId: string,
): GameStatsResult {
  // Hitting accumulator
  let pa = 0, atBatCount = 0, h = 0, doubles = 0, triples = 0, hr = 0
  let rbi = 0, bb = 0, k = 0, runs = 0
  let hasBatted = false

  // Pitching accumulator
  let pitchOuts = 0, pitchK = 0, pitchBb = 0, runsAllowed = 0
  let hasPitched = false

  for (const ab of atBats) {
    // Skip subs for season stats — but this function is also used for live overlay
    // where we DO want to show the player's current game performance including sub ABs.
    // Callers decide whether to pass filtered or unfiltered at-bats.

    // Hitting
    if (ab.batterId === playerId) {
      hasBatted = true
      pa++
      const isOfficialAb = !['walk', 'hbp', 'sacrifice_fly', 'sacrifice_bunt'].includes(ab.result)
      if (isOfficialAb) {
        atBatCount++
        if (['single', 'double', 'triple', 'home_run'].includes(ab.result)) h++
        if (ab.result === 'double') doubles++
        if (ab.result === 'triple') triples++
        if (ab.result === 'home_run') hr++
      }
      if (ab.result === 'walk') bb++
      if (ab.result === 'strikeout' || ab.result === 'strikeout_looking') k++
      rbi += ab.rbiCount ?? 0
      // Count run if batter scored (home run or advanced to home)
      if (ab.batterAdvancedTo === 'home') runs++
    }

    // Count runs scored by this player as a runner on base
    // Guard against missing runnersScored on older/pre-scorekeeper records
    if ((ab.runnersScored ?? []).includes(playerId)) runs++

    // Pitching
    if (ab.pitcherId === playerId) {
      hasPitched = true
      pitchOuts += ab.outsOnPlay
      if (ab.result === 'strikeout' || ab.result === 'strikeout_looking') pitchK++
      if (ab.result === 'walk' || ab.result === 'hbp') pitchBb++
      // Runs allowed: all runners who scored + batter if they scored
      runsAllowed += (ab.runnersScored ?? []).length
      if (ab.batterAdvancedTo === 'home') runsAllowed++
    }
  }

  const hitting: HittingStats | null = hasBatted ? (() => {
    const ab = atBatCount
    const singles = h - doubles - triples - hr
    const tb = singles + doubles * 2 + triples * 3 + hr * 4
    const avg = ab > 0 ? Math.round((h / ab) * 1000) / 1000 : 0
    const obp = pa > 0 ? Math.round(((h + bb) / pa) * 1000) / 1000 : 0
    const slg = ab > 0 ? Math.round((tb / ab) * 1000) / 1000 : 0
    return { gp: 1, pa, ab, h, doubles, triples, hr, r: runs, rbi, bb, k, avg, obp, slg, ops: Math.round((obp + slg) * 1000) / 1000 }
  })() : null

  const pitching: PitchingStats | null = hasPitched ? (() => {
    const ip = Math.round((pitchOuts / 3) * 100) / 100
    const era = ip > 0 ? Math.round((runsAllowed / (pitchOuts / 3)) * 7 * 100) / 100 : 0
    return { gp: 1, k: pitchK, bb: pitchBb, inningsPitched: ip, era, runsAllowed }
  })() : null

  return { hitting, pitching, runsScored: runs }
}

/** Merge two HittingStats objects by summing all counting stats and recomputing rate stats. */
export function mergeHittingStats(season: HittingStats, game: HittingStats): HittingStats {
  const pa  = (season.pa  ?? 0) + (game.pa  ?? 0)
  const ab  = (season.ab  ?? 0) + (game.ab  ?? 0)
  const h   = (season.h   ?? 0) + (game.h   ?? 0)
  const doubles = (season.doubles ?? 0) + (game.doubles ?? 0)
  const triples = (season.triples ?? 0) + (game.triples ?? 0)
  const hr  = (season.hr  ?? 0) + (game.hr  ?? 0)
  const r   = (season.r   ?? 0) + (game.r   ?? 0)
  const rbi = (season.rbi ?? 0) + (game.rbi ?? 0)
  const bb  = (season.bb  ?? 0) + (game.bb  ?? 0)
  const k   = (season.k   ?? 0) + (game.k   ?? 0)
  const singles = h - doubles - triples - hr
  const tb = singles + doubles * 2 + triples * 3 + hr * 4
  const avg = ab > 0 ? Math.round((h / ab) * 1000) / 1000 : 0
  // OBP: (H + BB) / PA — hbp and sf are not separately tracked in stored season stats,
  // so PA is the best available denominator. Correct formula is (H+BB+HBP)/(AB+BB+HBP+SF).
  const obp = pa > 0 ? Math.round(((h + bb) / pa) * 1000) / 1000 : 0
  const slg = ab > 0 ? Math.round((tb / ab) * 1000) / 1000 : 0
  return { gp: (season.gp ?? 0) + 1, pa, ab, h, doubles, triples, hr, r, rbi, bb, k, avg, obp, slg, ops: Math.round((obp + slg) * 1000) / 1000 }
}

/** Merge two PitchingStats objects by summing counting stats and recomputing ERA. */
export function mergePitchingStats(season: PitchingStats, game: PitchingStats): PitchingStats {
  const totalOuts = Math.round(((season.inningsPitched ?? 0) + (game.inningsPitched ?? 0)) * 3)
  const ip = Math.round((totalOuts / 3) * 100) / 100
  // Use raw runsAllowed when available; fall back to ERA-based approximation for old stored stats
  const seasonRuns = season.runsAllowed ?? ((season.era ?? 0) * (season.inningsPitched ?? 0)) / 7
  const gameRuns   = game.runsAllowed   ?? ((game.era   ?? 0) * (game.inningsPitched   ?? 0)) / 7
  const combinedRuns = seasonRuns + gameRuns
  const era = ip > 0 ? Math.round((combinedRuns / ip) * 7 * 100) / 100 : 0
  return {
    gp: (season.gp ?? 0) + 1,
    k:  (season.k  ?? 0) + (game.k  ?? 0),
    bb: (season.bb ?? 0) + (game.bb ?? 0),
    inningsPitched: ip,
    era,
    runsAllowed: Math.round(combinedRuns * 100) / 100,
    w: (season.w ?? 0) + (game.w ?? 0),
    l: (season.l ?? 0) + (game.l ?? 0),
  }
}

// ── Lineup position ────────────────────────────────────────────────────────
// Recomputable from the full game log — not dependent on ordering within a half-inning.

export function computeLineupPosition(
  allAtBats: AtBatRecord[],
  teamId: string,
  playerTeamMap: Record<string, string>, // playerId → teamId
  lineupSize: number,
): number {
  const nonSubAtBats = allAtBats.filter(ab => {
    const isCorrectTeam = playerTeamMap[ab.batterId] === teamId
    return isCorrectTeam && !ab.isSub
  })
  return nonSubAtBats.length % lineupSize
}
