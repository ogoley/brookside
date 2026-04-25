/**
 * scoring/finalization.ts
 *
 * Computes final season stats and game summaries from all at-bat records.
 * Pure function — no Firebase calls, no React.
 *
 * Called from ControllerRoute when "Finalize Game" is confirmed.
 */

import type {
  AtBatRecord,
  HittingStats,
  PitchingStats,
  GameRecord,
  PlayersMap,
  GameSummary,
} from '../types'
import { AUTO_OUT_BATTER_ID } from '../types'

export interface FinalizeInput {
  /** The game being finalized */
  gameId: string
  game: GameRecord
  /** All at-bats from the game being finalized */
  currentGameAtBats: AtBatRecord[]
  /** All at-bats from previously-finalized games */
  previousAtBats: Array<AtBatRecord & { gameId: string }>
  /** Game records for previously-finalized games — used for W/L derivation */
  previousGames: Record<string, GameRecord>
  /** Full players map — used for teamId lookups */
  players: PlayersMap
}

export interface FinalizeOutput {
  /** Multi-path update object ready to pass to Firebase update() */
  updates: Record<string, unknown>
  /** Human-readable summary lines for dev logging */
  summary: string[]
}

// ── Internal accumulators ──────────────────────────────────────────────────

interface BatAcc {
  pa: number; ab: number; h: number
  doubles: number; triples: number; hr: number
  rbi: number; bb: number; k: number
  games: Set<string>
}

interface RunAcc {
  [playerId: string]: number
}

interface PitchAcc {
  outs: number; k: number; bb: number; runs: number
  games: Set<string>
}

// ── Main export ────────────────────────────────────────────────────────────

export function computeFinalization(input: FinalizeInput): FinalizeOutput {
  const { gameId, game, currentGameAtBats, previousAtBats, previousGames, players } = input
  const summary: string[] = []

  // All at-bats across all games (prev finalized + current)
  const allAtBats: Array<AtBatRecord & { gameId: string }> = [
    ...previousAtBats,
    ...currentGameAtBats.map(ab => ({ ...ab, gameId })),
  ]

  summary.push(`Finalizing game ${gameId} (${game.awayTeamId} @ ${game.homeTeamId})`)
  summary.push(`  Total at-bats to process: ${allAtBats.length} (${previousAtBats.length} from prev games + ${currentGameAtBats.length} current)`)

  // ── Season stats accumulators ────────────────────────────────────────────
  // We accumulate stats for EVERY player who batted, pitched, or scored —
  // including subs. The sub players' stats end up written to their own
  // /players/{subId} record (which has isSub:true), and downstream consumers
  // filter on that flag. This makes finalize idempotent: a sub batter's
  // at-bat no longer erases the regular runners who scored on that play.
  const batting: Record<string, BatAcc> = {}
  const runs: RunAcc = {}
  const pitching: Record<string, PitchAcc> = {}

  for (const ab of allAtBats) {
    const { batterId, pitcherId, result, rbiCount, batterAdvancedTo, outsOnPlay } = ab

    // ── Hitting (skip auto-out sentinel batter — not a real player) ─────
    if (batterId !== AUTO_OUT_BATTER_ID) {
      if (!batting[batterId]) batting[batterId] = { pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0, games: new Set() }
      const b = batting[batterId]
      b.games.add(ab.gameId)
      b.pa++
      if (!['walk', 'hbp', 'sacrifice_fly', 'sacrifice_bunt'].includes(result)) b.ab++
      if (['single', 'double', 'triple', 'home_run'].includes(result)) b.h++
      if (result === 'double') b.doubles++
      if (result === 'triple') b.triples++
      if (result === 'home_run') b.hr++
      if (result === 'walk') b.bb++
      if (result === 'strikeout' || result === 'strikeout_looking') b.k++
      b.rbi += rbiCount
      if (batterAdvancedTo === 'home') runs[batterId] = (runs[batterId] ?? 0) + 1
    }

    // Runs scored by runners on base — derive from the source of truth
    // (runnersOnBase + runnerOutcomes), NOT from the cached runnersScored
    // array. runnersScored has writer-convention drift (sometimes contains
    // the batter spuriously, sometimes correctly excludes them) and cannot
    // distinguish a genuine ghost-of-self score from a stale cache entry.
    // onBase + outcomes are the ground truth for what happened on the play.
    const onBase = ab.runnersOnBase ?? { first: null, second: null, third: null }
    const outcomes = ab.runnerOutcomes ?? {}
    let runnerRunsThisPlay = 0
    for (const base of ['first', 'second', 'third'] as const) {
      if (outcomes[base] === 'scored' && onBase[base]) {
        runs[onBase[base]!] = (runs[onBase[base]!] ?? 0) + 1
        runnerRunsThisPlay++
      }
    }

    // ── Pitching ─────────────────────────────────────────────────────────
    if (pitcherId) {
      if (!pitching[pitcherId]) pitching[pitcherId] = { outs: 0, k: 0, bb: 0, runs: 0, games: new Set() }
      const p = pitching[pitcherId]
      p.games.add(ab.gameId)
      p.outs += outsOnPlay
      if (result === 'strikeout' || result === 'strikeout_looking') p.k++
      if (result === 'walk' || result === 'hbp') p.bb++
      // All runs allowed (no earned/unearned distinction in wiffle ball).
      // Use the same onBase+outcomes derivation as hitting runs.
      p.runs += runnerRunsThisPlay
      if (batterAdvancedTo === 'home') p.runs++
    }
  }

  // ── W/L determination (fully event-sourced across all games) ────────────────
  // For each game (previous + current), determine the W/L pitcher from that game's
  // at-bats and scores. This makes W/L safe to recompute on re-finalization.
  const wlTally: Record<string, { w: number; l: number }> = {}

  // Group previous at-bats by gameId for per-game W/L computation
  const prevAtBatsByGame: Record<string, AtBatRecord[]> = {}
  for (const ab of previousAtBats) {
    if (!prevAtBatsByGame[ab.gameId]) prevAtBatsByGame[ab.gameId] = []
    prevAtBatsByGame[ab.gameId].push(ab)
  }

  // Compute W/L for each previously-finalized game
  for (const [gId, gRecord] of Object.entries(previousGames) as [string, GameRecord][]) {
    const gAtBats = prevAtBatsByGame[gId] ?? []
    const gWinner = gRecord.homeScore > gRecord.awayScore ? gRecord.homeTeamId
      : gRecord.awayScore > gRecord.homeScore ? gRecord.awayTeamId : null
    if (!gWinner) continue
    const gLoserTeam = gWinner === gRecord.homeTeamId ? gRecord.awayTeamId : gRecord.homeTeamId
    const gW = findWinningPitcher(gAtBats, gWinner, players)
    const gL = findWinningPitcher(gAtBats, gLoserTeam, players)
    if (gW) { if (!wlTally[gW]) wlTally[gW] = { w: 0, l: 0 }; wlTally[gW].w++ }
    if (gL) { if (!wlTally[gL]) wlTally[gL] = { w: 0, l: 0 }; wlTally[gL].l++ }
  }

  // Compute W/L for the current game
  const { homeScore, awayScore, homeTeamId, awayTeamId } = game
  const winnerTeamId = homeScore > awayScore ? homeTeamId : homeScore < awayScore ? awayTeamId : null
  const wPitcherId = winnerTeamId ? findWinningPitcher(currentGameAtBats, winnerTeamId, players) : null
  const loserTeamId = winnerTeamId === homeTeamId ? awayTeamId : winnerTeamId === awayTeamId ? homeTeamId : null
  const lPitcherId = loserTeamId ? findWinningPitcher(currentGameAtBats, loserTeamId, players) : null
  if (wPitcherId) { if (!wlTally[wPitcherId]) wlTally[wPitcherId] = { w: 0, l: 0 }; wlTally[wPitcherId].w++ }
  if (lPitcherId) { if (!wlTally[lPitcherId]) wlTally[lPitcherId] = { w: 0, l: 0 }; wlTally[lPitcherId].l++ }

  if (wPitcherId) summary.push(`  W → ${players[wPitcherId]?.name ?? wPitcherId}`)
  if (lPitcherId) summary.push(`  L → ${players[lPitcherId]?.name ?? lPitcherId}`)
  if (!winnerTeamId) summary.push(`  Tie game — no W/L awarded`)

  // ── Game summaries (includes isSub — full box score) ─────────────────────
  const gameSummaryUpdates = computeGameSummaries(currentGameAtBats, gameId, players, game)

  // ── Build Firebase update object ─────────────────────────────────────────
  const updates: Record<string, unknown> = {}

  // Stats live under /players/{id}/stats/* for regulars and /subPlayers/{id}/stats/*
  // for ephemeral one-game subs, so external readers of /players get a clean
  // roster without needing to filter on isSub.
  const statsRoot = (playerId: string): 'players' | 'subPlayers' =>
    players[playerId]?.isSub ? 'subPlayers' : 'players'

  // Season hitting stats
  for (const [playerId, b] of Object.entries(batting)) {
    const r = runs[playerId] ?? 0
    const singles = b.h - b.doubles - b.triples - b.hr
    const tb = singles + b.doubles * 2 + b.triples * 3 + b.hr * 4
    const avg = b.ab > 0 ? Math.round((b.h / b.ab) * 1000) / 1000 : 0
    const obp = b.pa > 0 ? Math.round(((b.h + b.bb) / b.pa) * 1000) / 1000 : 0
    const slg = b.ab > 0 ? Math.round((tb / b.ab) * 1000) / 1000 : 0
    const hs: HittingStats = {
      gp: b.games.size, pa: b.pa, ab: b.ab, h: b.h,
      doubles: b.doubles, triples: b.triples, hr: b.hr,
      r, rbi: b.rbi, bb: b.bb, k: b.k,
      avg, obp, slg, ops: Math.round((obp + slg) * 1000) / 1000,
    }
    updates[`${statsRoot(playerId)}/${playerId}/stats/hitting`] = hs
    summary.push(`  Hitting → ${players[playerId]?.name ?? playerId}: ${b.ab}AB ${b.h}H .${String(Math.round(avg * 1000)).padStart(3, '0')}`)
  }

  // Season pitching stats — W/L is fully event-sourced from wlTally
  for (const [playerId, p] of Object.entries(pitching)) {
    const ip = Math.round((p.outs / 3) * 100) / 100
    const era = p.outs > 0 ? Math.round((p.runs / (p.outs / 3)) * 7 * 100) / 100 : 0
    const wl = wlTally[playerId] ?? { w: 0, l: 0 }
    const ps: PitchingStats = {
      gp: p.games.size, k: p.k, bb: p.bb, inningsPitched: ip, era,
      runsAllowed: p.runs,
      w: wl.w,
      l: wl.l,
    }
    updates[`${statsRoot(playerId)}/${playerId}/stats/pitching`] = ps
    summary.push(`  Pitching → ${players[playerId]?.name ?? playerId}: ${ip}IP ${era}ERA ${p.k}K ${wl.w}W-${wl.l}L`)
  }

  // Game summaries
  for (const [path, value] of Object.entries(gameSummaryUpdates)) {
    updates[path] = value
  }

  // Re-derive the team scores from the at-bat log so re-finalize is the
  // authoritative recovery tool. (Past versions of the GameEditor "Save"
  // flow could write incorrect homeScore/awayScore if sub gameSummaries
  // had blank teamIds — re-finalize must repair that.)
  let derivedHomeScore = 0
  let derivedAwayScore = 0
  for (const ab of currentGameAtBats) {
    // Derive runs from the source of truth: which bases had a runner whose
    // outcome was 'scored', plus the batter if they advanced home. This
    // ignores the unreliable runnersScored cache entirely and correctly
    // handles ghost-of-self runners.
    const onBase = ab.runnersOnBase ?? { first: null, second: null, third: null }
    const outcomes = ab.runnerOutcomes ?? {}
    let plays = 0
    for (const base of ['first', 'second', 'third'] as const) {
      if (outcomes[base] === 'scored' && onBase[base]) plays++
    }
    if (ab.batterAdvancedTo === 'home') plays++
    if (ab.isTopInning) derivedAwayScore += plays
    else derivedHomeScore += plays
  }
  updates[`games/${gameId}/homeScore`] = derivedHomeScore
  updates[`games/${gameId}/awayScore`] = derivedAwayScore
  summary.push(`  Recomputed score: away ${derivedAwayScore}, home ${derivedHomeScore}`)

  // Finalize flags
  updates[`games/${gameId}/finalized`] = true
  updates[`games/${gameId}/finalizedAt`] = Date.now()

  summary.push(`  Total Firebase paths to write: ${Object.keys(updates).length}`)

  return { updates, summary }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the pitcher from `teamId` with the most outs in the given at-bats,
 * provided they pitched at least 9 outs (3 innings). Returns null if nobody qualifies.
 */
function findWinningPitcher(
  atBats: AtBatRecord[],
  teamId: string,
  players: PlayersMap,
): string | null {
  const outsByPitcher: Record<string, number> = {}

  for (const ab of atBats) {
    if (!ab.pitcherId) continue
    // Sub pitchers are not eligible for W/L — players[id].isSub is the
    // canonical source of truth; ab.pitcherIsSub is a denormalized fallback.
    if (players[ab.pitcherId]?.isSub || ab.pitcherIsSub) continue
    const pitcherTeam = players[ab.pitcherId]?.teamId
    if (pitcherTeam !== teamId) continue
    outsByPitcher[ab.pitcherId] = (outsByPitcher[ab.pitcherId] ?? 0) + ab.outsOnPlay
  }

  let bestId: string | null = null
  let bestOuts = 0

  for (const [pid, outs] of Object.entries(outsByPitcher)) {
    if (outs > bestOuts) {
      bestOuts = outs
      bestId = pid
    }
  }

  // Minimum 9 outs (3 innings) to qualify for W/L
  return bestOuts >= 9 ? bestId : null
}

/**
 * Compute per-player game summaries from the at-bats of a single game.
 * Includes sub at-bats (full game box score, not season stats).
 */
function computeGameSummaries(
  atBats: AtBatRecord[],
  gameId: string,
  players: PlayersMap,
  game: GameRecord,
): Record<string, GameSummary> {
  const summaries: Record<string, GameSummary> = {}
  const pitchingOuts: Record<string, number> = {}

  const ensureBatter = (playerId: string, fallbackTeamId = '') => {
    if (!summaries[playerId]) {
      summaries[playerId] = {
        playerId,
        teamId: players[playerId]?.teamId ?? fallbackTeamId,
        ab: 0, pa: 0, h: 0, doubles: 0, triples: 0, hr: 0,
        r: 0, rbi: 0, bb: 0, k: 0, inningsPitched: 0,
      }
    } else if (!summaries[playerId].teamId && fallbackTeamId) {
      summaries[playerId].teamId = fallbackTeamId
    }
    return summaries[playerId]
  }

  for (const ab of atBats) {
    // Fallback the batter's team to the team that was batting on this at-bat,
    // in case /players doesn't have a record for them (legacy sub IDs from
    // before sub players were promoted to first-class /players entries).
    const battingTeamId = ab.isTopInning ? game.awayTeamId : game.homeTeamId

    // Skip the batter section entirely for auto-outs — there's no real batter
    // to credit. The sentinel ID isn't in /players, so writing it as a key
    // would create a phantom box-score entry. The pitcher block below still
    // runs (auto-outs DO credit the pitcher with an out recorded).
    let runnerRunsThisPlay = 0
    if (ab.batterId !== AUTO_OUT_BATTER_ID) {
      const b = ensureBatter(ab.batterId, battingTeamId)
      b.pa++
      if (!['walk', 'hbp', 'sacrifice_fly', 'sacrifice_bunt'].includes(ab.result)) b.ab++
      if (['single', 'double', 'triple', 'home_run'].includes(ab.result)) b.h++
      if (ab.result === 'double') b.doubles++
      if (ab.result === 'triple') b.triples++
      if (ab.result === 'home_run') b.hr++
      if (ab.result === 'walk') b.bb++
      if (ab.result === 'strikeout' || ab.result === 'strikeout_looking') b.k++
      b.rbi += ab.rbiCount
      if (ab.batterAdvancedTo === 'home') b.r++

      // Runs scored by runners on base — derive from runnersOnBase + outcomes
      // (the source of truth) instead of the unreliable runnersScored cache.
      const onBase = ab.runnersOnBase ?? { first: null, second: null, third: null }
      const outcomes = ab.runnerOutcomes ?? {}
      for (const base of ['first', 'second', 'third'] as const) {
        if (outcomes[base] === 'scored' && onBase[base]) {
          const s = ensureBatter(onBase[base]!, battingTeamId)
          s.r++
          runnerRunsThisPlay++
        }
      }
    }

    if (ab.pitcherId) {
      // Sub pitchers aren't in /players — their team is the fielding team for this at-bat.
      const fieldingTeamId = ab.isTopInning ? game.homeTeamId : game.awayTeamId
      const ps = ensureBatter(ab.pitcherId, fieldingTeamId)
      pitchingOuts[ab.pitcherId] = (pitchingOuts[ab.pitcherId] ?? 0) + ab.outsOnPlay
      if (ab.result === 'strikeout' || ab.result === 'strikeout_looking') ps.pitchingK = (ps.pitchingK ?? 0) + 1
      if (ab.result === 'walk' || ab.result === 'hbp') ps.pitchingBb = (ps.pitchingBb ?? 0) + 1
      ps.runsAllowed = (ps.runsAllowed ?? 0) + runnerRunsThisPlay + (ab.batterAdvancedTo === 'home' ? 1 : 0)
    }
  }

  // Convert raw outs to innings pitched once at the end to avoid floating point drift
  for (const [playerId, outs] of Object.entries(pitchingOuts)) {
    summaries[playerId].inningsPitched = Math.floor(outs / 3) + (outs % 3) / 3
  }

  const result: Record<string, GameSummary> = {}
  for (const [playerId, s] of Object.entries(summaries)) {
    result[`gameSummaries/${gameId}/${playerId}`] = s
  }
  return result
}
