// Live 50/50 win probabilities — pure, no Firebase, no React.
//
// THE QUESTION: with the derby half-finished, which *bettor* is most likely to
// take the pot? That is not "who's leading" — an entry only pays if it named
// the player who actually wins AND lands closest to that player's three-round
// total (`derbyBetWinners`). So the answer needs a joint distribution over
// (who wins, what they finish on), which is what this file produces.
//
// THE APPROACH: a Monte Carlo of the rest of the derby.
//
//   1. Fit each hitter a home-run rate per turn — a Gamma-Poisson posterior
//      whose prior comes from their season HR and whose data is the rounds
//      they've already hit tonight (including the turn in progress, pro-rated
//      by the clock).
//   2. Replay the remaining rounds thousands of times: unfinished turns are
//      drawn from that posterior, cuts are taken, swing-off ties are coin
//      flips, and a champion falls out with a three-round total.
//   3. Settle the 50/50 against every simulated ending and count how often
//      each entry is holding the winning ticket.
//
// WHY SIMULATE rather than solve: the bet couples two random things (identity
// and total) through a bracket with ties, producer locks, and a money ball.
// There is no closed form worth writing, and a simulation stays correct when
// the bracket rules change.
//
// The whole thing is deterministic given a seed, so the controller's preview
// and the overlay's graphic show the same numbers to the decimal, and a
// re-render doesn't make the percentages twitch on air.

import {
  ADVANCE_COUNT, ROUND_KEY, DERBY_MONEY_BALL_HR,
  type DerbyScoresMap, type DerbyBetEntry,
} from './logic'
import type { DerbyRoundNum, DerbyAdvancerLocks, DerbyOddsState } from '../types'

// ── When the board is on screen ──────────────────────────────────────────────

export const DERBY_ODDS_INTERVAL_MS = 150_000  // 2.5 minutes
export const DERBY_ODDS_DURATION_MS = 22_000

/**
 * Is the odds board up right now?
 *
 * In 'always' mode this is just `enabled` — the board lives on screen for the
 * whole derby and updates in place. In 'timer' mode the overlay is read-only,
 * so nothing writes "showing" / "hidden": the cycle is a pure function of the
 * clock against `startedAt`, exactly like the turn clock derives its remaining
 * time. Controller and overlay therefore agree without a round trip, and a
 * reloaded overlay drops straight back into phase.
 */
export function derbyOddsWindow(odds: DerbyOddsState, now: number) {
  const interval = Math.max(10_000, odds.intervalMs)
  const duration = Math.min(interval, Math.max(3_000, odds.durationMs))
  if (!odds.enabled) return { visible: false, msLeft: 0, msUntilNext: 0 }
  if (odds.mode !== 'timer') return { visible: true, msLeft: Infinity, msUntilNext: 0 }
  // "Show now" stamps `startedAt` from the producer's clock. If the overlay
  // machine's clock is a few seconds behind, that stamp is in the future, and
  // wrapping the negative phase round would hide the board for a whole cycle
  // instead of showing it. Treat anything not yet started as just-started.
  const elapsed = now - odds.startedAt
  if (elapsed < 0) return { visible: true, msLeft: duration, msUntilNext: 0 }
  const phase = elapsed % interval
  return phase < duration
    ? { visible: true, msLeft: duration - phase, msUntilNext: 0 }
    : { visible: false, msLeft: 0, msUntilNext: interval - phase }
}

// ── Model constants ──────────────────────────────────────────────────────────
// Every one of these is a prior that live data washes out. They only matter
// before the first few hitters have gone.

/**
 * Expected HR in a full turn for an average-power hitter, before tonight's
 * data. Deliberately a whole-round number (money ball included) — see
 * `MONEY_BALL_P` for why it isn't modelled separately in the fit.
 */
export const PRIOR_ROUND_MEAN = 6

/** How many rounds' worth of evidence `PRIOR_ROUND_MEAN` is worth league-wide. */
const PRIOR_LEAGUE_WEIGHT = 3

/**
 * Season HR shrinkage. A player's power weight is `(hr + K) / (avgHr + K)`, so
 * K controls how far apart the model lets hitters start. Season HR is a small,
 * noisy sample and derby pitching is grooved — the gap between the best and
 * worst bat in a *derby* is much narrower than their season lines suggest. At
 * K = 6 the top of a typical league field opens at roughly 2.5× the bottom
 * rather than the 10× the raw counts would give.
 */
const SEASON_HR_SHRINK = 6

/**
 * Prior strength per player, in rounds. One completed round moves a hitter's
 * rate most of the way to what they just did (weight 1 / (1 + 1.5)), two rounds
 * nearly all the way. Derby form beats season form fast, and the broadcast
 * needs the number to react to what the audience just watched.
 */
const PLAYER_PRIOR_ROUNDS = 1.5

/**
 * Round-to-round dispersion. Hitters run hot and cold within a night far more
 * than Poisson allows, so each turn's rate is multiplied by a mean-1
 * Gamma(φ, φ) draw. φ = 6 gives a ~41% coefficient of variation on the round
 * rate — a good round is roughly half again a bad one, which matches how derby
 * rounds actually scatter. Without this the sim is over-confident and the
 * leader's win probability comes out far too high.
 */
const ROUND_DISPERSION = 6

/**
 * Chance an average-power hitter homers the money ball, scaled by power
 * weight. It's the one pitch every hitter is sitting dead-red on, so it lands
 * well above their per-pitch rate.
 *
 * The money ball is NOT separated out when fitting rates: recorded round totals
 * have it baked in and nothing stores whether a past turn's went out. It is
 * only split back out for the turn in progress, where we know from
 * `moneyBallTaken` whether it's still to come.
 */
const MONEY_BALL_P = 0.3

export const DEFAULT_ODDS_TRIALS = 12_000

// ── Seeded RNG ───────────────────────────────────────────────────────────────
// Seeded, not Math.random: identical inputs must give identical percentages on
// the controller and the overlay, and must not drift between re-renders.

type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normalSample(rng: Rng): number {
  // Box–Muller. u is nudged off zero so log() stays finite.
  const u = rng() || Number.EPSILON
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Marsaglia–Tsang, with the standard boost for shape < 1. */
function gammaSample(rng: Rng, shape: number): number {
  if (shape <= 0) return 0
  if (shape < 1) return gammaSample(rng, shape + 1) * Math.pow(rng() || Number.EPSILON, 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normalSample(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u || Number.EPSILON) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function poissonSample(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0
  // Knuth is O(λ); past this the normal approximation is both faster and
  // plenty accurate for a broadcast graphic.
  if (lambda > 24) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normalSample(rng)))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

// ── Input ────────────────────────────────────────────────────────────────────

export interface DerbyOddsInput {
  /** The derby-eligible pool — round 1's field. */
  eligibleIds: string[]
  /** Season HR per player, the prior on power. */
  seasonHr: Record<string, number>
  scores: DerbyScoresMap
  activeRound: DerbyRoundNum
  locks?: DerbyAdvancerLocks
  /** Who is at the plate right now; their turn is treated as partially done. */
  liveHitterId?: string | null
  /** Fraction of the live hitter's turn clock already spent, 0..1. */
  turnFraction?: number
  /** Has the live hitter already had their money ball? */
  moneyBallTaken?: boolean
  /** Every 50/50 entry. The entry IS the payment, so none are filtered out. */
  entries: DerbyBetEntry[]
  seed?: number
  trials?: number
}

// ── Fitted model ─────────────────────────────────────────────────────────────

export interface DerbyPlayerRate {
  playerId: string
  /** Power weight from season HR, 1.0 = league-average bat. */
  weight: number
  /** Posterior mean HR per full turn, money ball included. */
  meanPerRound: number
  /** Same, minus the money ball's expected contribution. */
  swingPerRound: number
  moneyBallP: number
  /** Rounds of tonight's evidence behind the fit (the live turn counts partially). */
  observedRounds: number
  observedHr: number
  /** Gamma posterior on the rate. */
  shape: number
  rate: number
  /**
   * Where they'd finish if they ran the table: what they've banked plus the
   * projected rate for every round they haven't hit. This is the "10 in round 1
   * projects to ~30" number, and unlike the win probability it's a plain
   * arithmetic pace, not a simulation output.
   */
  paceTotal: number
  bankedTotal: number
}

export interface DerbyOddsModel {
  rates: Map<string, DerbyPlayerRate>
  /** Fitted league-average HR per turn — the prior once tonight's data is in. */
  leagueRoundMean: number
  input: DerbyOddsInput
  /** Rounds 1..3 as fields of playerIds, with everything already settled fixed. */
  round1Field: string[]
  trials: number
  seed: number
}

/** Deterministic 32-bit hash — turns an input signature into an RNG seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Everything the odds depend on, as a string. Two inputs with the same
 * signature must produce the same numbers — it doubles as the recompute key and
 * (hashed) as the RNG seed.
 */
export function derbyOddsSignature(input: DerbyOddsInput): string {
  const scores = input.eligibleIds
    .map(id => {
      const s = input.scores[id]
      return `${id}:${s?.r1 ?? ''}/${s?.r2 ?? ''}/${s?.r3 ?? ''}`
    })
    .join(',')
  const entries = input.entries
    .map(e => `${e.id}>${e.playerId}@${e.totalHr}`)
    .sort()
    .join(',')
  const locks = `${input.locks?.r1?.join('|') ?? ''}~${input.locks?.r2?.join('|') ?? ''}`
  // Quantised to eighths: the clock ticks ten times a second and the odds must
  // not re-run with it. An eighth of a 90s turn is ~11s of hitting, which is
  // the granularity at which a partial turn actually tells you anything.
  const turn = Math.round((input.turnFraction ?? 0) * 8)
  return [
    input.activeRound, scores, locks, entries,
    input.liveHitterId ?? '', turn, input.moneyBallTaken ? 1 : 0,
    input.eligibleIds.map(id => `${id}=${input.seasonHr[id] ?? 0}`).join(','),
  ].join(';')
}

/**
 * Fit every hitter's rate from season HR plus tonight's rounds.
 *
 * Two levels, both conjugate Gamma-Poisson:
 *
 *   League — a hitter's expected round is `leagueRoundMean × weight`. The
 *   league mean is re-estimated from tonight's scores divided by the weight of
 *   whoever produced them, so a round of light hitting drags everyone's
 *   projection down without punishing the big bats twice. Anchored on
 *   `PRIOR_ROUND_MEAN` so it's stable after one or two turns.
 *
 *   Player — that league expectation is the prior mean, worth
 *   `PLAYER_PRIOR_ROUNDS` rounds; tonight's actual HR are the data.
 */
export function buildDerbyOddsModel(input: DerbyOddsInput): DerbyOddsModel {
  const { eligibleIds, seasonHr, scores, activeRound } = input
  const liveId = input.liveHitterId ?? null
  const turnFraction = Math.min(1, Math.max(0, input.turnFraction ?? 0))

  const avgSeasonHr = eligibleIds.length
    ? eligibleIds.reduce((sum, id) => sum + (seasonHr[id] ?? 0), 0) / eligibleIds.length
    : 0
  const weightOf = (id: string) =>
    ((seasonHr[id] ?? 0) + SEASON_HR_SHRINK) / (avgSeasonHr + SEASON_HR_SHRINK)

  // Tonight's evidence, per player: HR and how many turns of exposure produced
  // them. A finished round is 1.0; the turn in progress is worth the fraction
  // of the clock that has run.
  const obsHr = new Map<string, number>()
  const obsRounds = new Map<string, number>()
  let totalHr = 0
  let totalWeightedExposure = 0

  for (const id of eligibleIds) {
    const w = weightOf(id)
    let hr = 0
    let rounds = 0
    for (const r of [1, 2, 3] as DerbyRoundNum[]) {
      const recorded = scores[id]?.[ROUND_KEY[r]]
      const isLiveTurn = id === liveId && r === activeRound
      if (isLiveTurn) {
        if (turnFraction <= 0) continue
        hr += recorded ?? 0
        rounds += turnFraction
      } else if (recorded !== undefined) {
        hr += recorded
        rounds += 1
      }
    }
    obsHr.set(id, hr)
    obsRounds.set(id, rounds)
    totalHr += hr
    totalWeightedExposure += w * rounds
  }

  const leagueRoundMean =
    (PRIOR_ROUND_MEAN * PRIOR_LEAGUE_WEIGHT + totalHr) / (PRIOR_LEAGUE_WEIGHT + totalWeightedExposure)

  const rates = new Map<string, DerbyPlayerRate>()
  for (const id of eligibleIds) {
    const weight = weightOf(id)
    const hr = obsHr.get(id) ?? 0
    const rounds = obsRounds.get(id) ?? 0
    const priorMean = leagueRoundMean * weight

    const shape = priorMean * PLAYER_PRIOR_ROUNDS + hr
    const rate = PLAYER_PRIOR_ROUNDS + rounds
    const meanPerRound = shape / rate

    const moneyBallP = Math.min(0.8, Math.max(0.05, MONEY_BALL_P * weight))
    const swingPerRound = Math.max(0.2, meanPerRound - DERBY_MONEY_BALL_HR * moneyBallP)

    // Pace: what's banked, plus the projected rate for each round still to come
    // (assuming they keep advancing). The live turn is pro-rated by the clock.
    const s = scores[id] ?? {}
    const bankedTotal = (s.r1 ?? 0) + (s.r2 ?? 0) + (s.r3 ?? 0)
    let pace = bankedTotal
    for (const r of [1, 2, 3] as DerbyRoundNum[]) {
      const recorded = s[ROUND_KEY[r]]
      const isLiveTurn = id === liveId && r === activeRound
      if (isLiveTurn) {
        pace += remainingTurnMean(swingPerRound, moneyBallP, turnFraction, input.moneyBallTaken)
      } else if (recorded === undefined) {
        pace += meanPerRound
      }
    }

    rates.set(id, {
      playerId: id, weight, meanPerRound, swingPerRound, moneyBallP,
      observedRounds: rounds, observedHr: hr, shape, rate,
      paceTotal: pace, bankedTotal,
    })
  }

  return {
    rates,
    leagueRoundMean,
    input,
    round1Field: eligibleIds,
    trials: input.trials ?? DEFAULT_ODDS_TRIALS,
    seed: input.seed ?? hashSeed(derbyOddsSignature(input)),
  }
}

/** Expected HR still to come in a turn that is `fraction` spent. */
function remainingTurnMean(
  swingPerRound: number, moneyBallP: number, fraction: number, moneyBallTaken?: boolean,
): number {
  return swingPerRound * (1 - fraction) + (moneyBallTaken ? 0 : DERBY_MONEY_BALL_HR * moneyBallP)
}

// ── Simulation ───────────────────────────────────────────────────────────────

export interface DerbyOddsAcc {
  trials: number
  /** entryId → trials it was among the winners. */
  entryWins: Map<string, number>
  /** entryId → summed 1/k share of the bettors' pot. */
  entryShare: Map<string, number>
  /** playerId → trials they were champion. */
  championWins: Map<string, number>
  /** playerId → summed three-round total in the trials they won. */
  championTotal: Map<string, number>
  /** Trials where nobody had backed the champion. */
  charityTrials: number
  /** Every simulated champion total, for the spread. */
  totalHistogram: Map<number, number>
  rng: Rng
}

export function newOddsAcc(seed: number): DerbyOddsAcc {
  return {
    trials: 0,
    entryWins: new Map(),
    entryShare: new Map(),
    championWins: new Map(),
    championTotal: new Map(),
    charityTrials: 0,
    totalHistogram: new Map(),
    rng: mulberry32(seed),
  }
}

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

/**
 * Take the top `n` by score, breaking ties uniformly at random.
 *
 * The random tie-break IS the swing-off. `advancersFromRound` keeps every tied
 * player above the line because the producer hasn't settled it yet; here we
 * have to commit to one outcome per trial, and a coin flip is the honest model
 * of a swing-off nobody has hit yet.
 */
function topN(field: string[], score: (id: string) => number, n: number, rng: Rng): string[] {
  if (field.length <= n) return field
  // Shuffle first, then a stable sort by score — ties land in random order.
  const shuffled = field.slice()
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.sort((a, b) => score(b) - score(a)).slice(0, n)
}

/**
 * Who moves on out of `round` in this trial. A producer lock is the authority
 * exactly as it is on the real board; otherwise the cut is taken on the
 * simulated scores with ties flipped.
 */
function advancersInTrial(
  field: string[], score: (id: string) => number, round: DerbyRoundNum,
  locks: DerbyAdvancerLocks | undefined, rng: Rng,
): string[] {
  const slots = ADVANCE_COUNT[round]
  if (slots === null) return field
  const locked = locks?.[ROUND_KEY[round] as 'r1' | 'r2']
  if (locked) {
    const kept = locked.filter(id => field.includes(id))
    if (kept.length > 0) return kept
  }
  return topN(field, score, slots, rng)
}

export function runOddsChunk(model: DerbyOddsModel, acc: DerbyOddsAcc, trials: number): void {
  const { input, rates, round1Field } = model
  const { activeRound, locks, entries, scores } = input
  const liveId = input.liveHitterId ?? null
  const turnFraction = Math.min(1, Math.max(0, input.turnFraction ?? 0))
  const rng = acc.rng

  // Bet lookup: playerId → the entries riding on them. Rebuilt per chunk is
  // cheap relative to the trial loop, and keeps the accumulator serialisable.
  const entriesByPlayer = new Map<string, DerbyBetEntry[]>()
  for (const e of entries) {
    const list = entriesByPlayer.get(e.playerId)
    if (list) list.push(e)
    else entriesByPlayer.set(e.playerId, [e])
  }

  const ability = new Map<string, number>()
  const simScores = new Map<string, number>()   // key `${id}|${round}`

  for (let t = 0; t < trials; t++) {
    acc.trials++
    ability.clear()
    simScores.clear()

    // One ability draw per player per trial: uncertainty about how good someone
    // is persists across their rounds, unlike the per-round hot/cold noise.
    for (const [id, r] of rates) ability.set(id, gammaSample(rng, r.shape) / r.rate)

    const scoreOf = (id: string, round: DerbyRoundNum) => simScores.get(`${id}|${round}`) ?? 0

    let field = round1Field
    for (const round of [1, 2, 3] as DerbyRoundNum[]) {
      for (const id of field) {
        const r = rates.get(id)
        const recorded = scores[id]?.[ROUND_KEY[round]]
        let value: number

        if (round < activeRound || (recorded !== undefined && id !== liveId)) {
          // Already in the books — a past round with no score means the hitter
          // was passed over, which the board treats as 0.
          value = recorded ?? 0
        } else if (!r) {
          value = recorded ?? 0
        } else {
          const streak = gammaSample(rng, ROUND_DISPERSION) / ROUND_DISPERSION
          const lamRound = (ability.get(id) ?? r.meanPerRound) * streak
          const lamSwing = Math.max(0, lamRound - DERBY_MONEY_BALL_HR * r.moneyBallP)

          if (id === liveId && round === activeRound) {
            // Mid-turn: only the unspent share of the clock is still to come,
            // plus the money ball if they haven't had it.
            const swings = poissonSample(rng, lamSwing * (1 - turnFraction))
            const mb = input.moneyBallTaken ? 0 : rng() < r.moneyBallP ? DERBY_MONEY_BALL_HR : 0
            value = (recorded ?? 0) + swings + mb
          } else {
            const mb = rng() < r.moneyBallP ? DERBY_MONEY_BALL_HR : 0
            value = poissonSample(rng, lamSwing) + mb
          }
        }
        simScores.set(`${id}|${round}`, value)
      }

      if (round === 3) break
      field = advancersInTrial(field, id => scoreOf(id, round), round, locks, rng)
      if (field.length === 0) break
    }

    if (field.length === 0) {
      acc.charityTrials++
      continue
    }

    // Champion: best of the final, ties flipped.
    const champion = topN(field, id => scoreOf(id, 3), 1, rng)[0]
    const total = scoreOf(champion, 1) + scoreOf(champion, 2) + scoreOf(champion, 3)

    bump(acc.championWins, champion)
    bump(acc.championTotal, champion, total)
    acc.totalHistogram.set(total, (acc.totalHistogram.get(total) ?? 0) + 1)

    // Settle the 50/50 exactly as `derbyBetWinners` does.
    const contenders = entriesByPlayer.get(champion)
    if (!contenders || contenders.length === 0) {
      acc.charityTrials++
      continue
    }
    let best = Infinity
    for (const e of contenders) {
      const d = Math.abs(e.totalHr - total)
      if (d < best) best = d
    }
    let winnerCount = 0
    for (const e of contenders) if (Math.abs(e.totalHr - total) === best) winnerCount++
    for (const e of contenders) {
      if (Math.abs(e.totalHr - total) !== best) continue
      bump(acc.entryWins, e.id)
      bump(acc.entryShare, e.id, 1 / winnerCount)
    }
  }
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface DerbyOddsEntryRow {
  entryId: string
  bettorName: string
  playerId: string
  guess: number
  /** P(this entry is among the winners) — the headline "chance to win". */
  winProb: number
  /** Expected slice of the bettors' half of the pot; splits are counted fractionally. */
  expectedShare: number
  /** P(the player they backed wins the derby) — the ceiling on winProb. */
  playerWinProb: number
  /** Model's projection for that player's three-round total. */
  playerPace: number
}

export interface DerbyOddsChampionRow {
  playerId: string
  winProb: number
  /** Expected three-round total in the trials they won. */
  totalIfWins: number
  /** Straight-line pace if they run the table. */
  pace: number
}

export interface DerbyOddsResult {
  /** Every entry, best chance first. */
  rows: DerbyOddsEntryRow[]
  champions: DerbyOddsChampionRow[]
  /** P(nobody backed the champion, so the whole pot goes to charity). */
  charityProb: number
  /** Median simulated champion total, and a 10–90 band. */
  projectedWinningTotal: { median: number; low: number; high: number }
  leagueRoundMean: number
  trials: number
}

function quantile(hist: Map<number, number>, n: number, q: number): number {
  if (n === 0) return 0
  const keys = [...hist.keys()].sort((a, b) => a - b)
  let seen = 0
  const target = q * n
  for (const k of keys) {
    seen += hist.get(k) ?? 0
    if (seen >= target) return k
  }
  return keys[keys.length - 1] ?? 0
}

export function finalizeOdds(model: DerbyOddsModel, acc: DerbyOddsAcc): DerbyOddsResult {
  const n = acc.trials || 1
  const championProb = (id: string) => (acc.championWins.get(id) ?? 0) / n

  const rows: DerbyOddsEntryRow[] = model.input.entries
    .map(e => ({
      entryId: e.id,
      bettorName: e.name,
      playerId: e.playerId,
      guess: e.totalHr,
      winProb: (acc.entryWins.get(e.id) ?? 0) / n,
      expectedShare: (acc.entryShare.get(e.id) ?? 0) / n,
      playerWinProb: championProb(e.playerId),
      playerPace: model.rates.get(e.playerId)?.paceTotal ?? 0,
    }))
    // Ties on probability are common early (everything is 0 before a pitch is
    // thrown), so fall back to the closer call, then the name — a stable order
    // stops the board reshuffling for no reason between refreshes.
    .sort((a, b) =>
      b.winProb - a.winProb ||
      b.expectedShare - a.expectedShare ||
      b.playerWinProb - a.playerWinProb ||
      a.bettorName.localeCompare(b.bettorName))

  const champions: DerbyOddsChampionRow[] = [...model.rates.keys()]
    .map(id => {
      const wins = acc.championWins.get(id) ?? 0
      return {
        playerId: id,
        winProb: wins / n,
        totalIfWins: wins > 0 ? (acc.championTotal.get(id) ?? 0) / wins : 0,
        pace: model.rates.get(id)?.paceTotal ?? 0,
      }
    })
    .filter(c => c.winProb > 0)
    .sort((a, b) => b.winProb - a.winProb)

  // The histogram only holds trials that produced a champion, which is every
  // trial unless the eligible pool is empty.
  const totalled = [...acc.totalHistogram.values()].reduce((a, b) => a + b, 0)
  return {
    rows,
    champions,
    charityProb: acc.charityTrials / n,
    projectedWinningTotal: {
      median: quantile(acc.totalHistogram, totalled, 0.5),
      low: quantile(acc.totalHistogram, totalled, 0.1),
      high: quantile(acc.totalHistogram, totalled, 0.9),
    },
    leagueRoundMean: model.leagueRoundMean,
    trials: acc.trials,
  }
}

/** Run the whole thing in one go. Chunk it via the pieces above on the UI thread. */
export function runDerbyOdds(input: DerbyOddsInput): DerbyOddsResult {
  const model = buildDerbyOddsModel(input)
  const acc = newOddsAcc(model.seed)
  runOddsChunk(model, acc, model.trials)
  return finalizeOdds(model, acc)
}
