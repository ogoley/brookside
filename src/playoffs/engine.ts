// Playoff picture engine — pure functions, no Firebase/React.
//
// Format (2026): 6 of 8 teams qualify, seeds 1–2 get a first-round bye,
// quarterfinals are 3v6 and 4v5, semifinals RESEED (the 1 seed gets the
// lowest surviving seed), then a final.
//
// Clinch/elimination is EXACT: with ≤ MAX_EXACT_GAMES regular-season games
// left we enumerate every win/loss outcome, rank each one with the full
// tiebreak procedure, and record each team's best/worst possible seed. Above
// that we fall back to max-wins bounds (safe, never over-claims a clinch).

export type Tiebreaker = 'headToHead' | 'runDiff' | 'runsAllowed' | 'runsFor'

export interface PlayoffConfig {
  spots: number
  byes: number
  tiebreakers: Tiebreaker[]
  /**
   * League policy: a postponed game WILL be made up, so it counts as a
   * remaining game (a team cannot clinch "for free" by never playing it).
   * Set false only if the league formally cancels a game.
   */
  countPostponed: boolean
}

export const DEFAULT_PLAYOFF_CONFIG: PlayoffConfig = {
  spots: 6,
  byes: 2,
  tiebreakers: ['headToHead', 'runDiff', 'runsAllowed'],
  countPostponed: true,
}

/** Enumerate outcomes exactly up to 2^16 = 65,536 seasons. */
export const MAX_EXACT_GAMES = 16

export interface GameResult {
  homeTeamId: string
  awayTeamId: string
  homeScore: number
  awayScore: number
}

export interface ScheduledGame {
  id: string
  date: string            // YYYY-MM-DD
  time?: string           // HH:MM (24h) local
  homeTeamId: string
  awayTeamId: string
  status: 'scheduled' | 'postponed' | 'cancelled'
  venue?: string
}

export interface TeamLine {
  teamId: string
  w: number
  l: number
  t: number
  gp: number
  rf: number
  ra: number
}

export interface TieNote {
  teamIds: string[]
  resolvedBy: Tiebreaker | 'coinFlip'
}

export interface Ranking {
  order: string[]
  tieNotes: TieNote[]
}

export interface TeamOutlook {
  teamId: string
  line: TeamLine
  seed: number                 // current seed (1-based)
  remaining: number            // scheduled games left (postponed excluded)
  maxWins: number
  bestSeed: number
  worstSeed: number
  clinchedPlayoff: boolean
  clinchedBye: boolean
  clinchedTopSeed: boolean
  eliminated: boolean
  /** Bye still mathematically possible */
  byeAlive: boolean
  topSeedAlive: boolean
  /** Share of remaining outcomes in which the team qualifies (exact mode only) */
  playoffOdds: number | null
  /**
   * Exact "control your own destiny" numbers from the enumeration: the fewest
   * of its OWN remaining wins that guarantee the outcome no matter what anyone
   * else does. null = already decided, or cannot be guaranteed by own results
   * alone (needs help). Non-exact mode: always null.
   */
  winsToClinch: number | null
  winsToBye: number | null
  winsToTop: number | null
  /** Fewest of its own remaining losses that guarantee elimination */
  lossesToElimination: number | null
  status: 'clinched-top' | 'clinched-bye' | 'clinched' | 'alive' | 'eliminated'
}

export interface PlayoffPicture {
  config: PlayoffConfig
  order: string[]
  tieNotes: TieNote[]
  teams: TeamOutlook[]         // in current seed order
  /** Games still to be played, dated ones first; includes makeups when countPostponed */
  remainingGames: ScheduledGame[]
  /** Postponed games (also present in remainingGames when countPostponed) — for the "to be made up" note */
  postponedGames: ScheduledGame[]
  exact: boolean
  outcomesEvaluated: number
}

// ── Lines ────────────────────────────────────────────────────────────────────

export function computeLines(teamIds: string[], results: GameResult[]): Map<string, TeamLine> {
  const lines = new Map<string, TeamLine>()
  for (const id of teamIds) lines.set(id, { teamId: id, w: 0, l: 0, t: 0, gp: 0, rf: 0, ra: 0 })
  const ensure = (id: string) => {
    let l = lines.get(id)
    if (!l) { l = { teamId: id, w: 0, l: 0, t: 0, gp: 0, rf: 0, ra: 0 }; lines.set(id, l) }
    return l
  }
  for (const g of results) {
    const h = ensure(g.homeTeamId)
    const a = ensure(g.awayTeamId)
    h.gp++; a.gp++
    h.rf += g.homeScore; h.ra += g.awayScore
    a.rf += g.awayScore; a.ra += g.homeScore
    if (g.homeScore > g.awayScore) { h.w++; a.l++ }
    else if (g.awayScore > g.homeScore) { a.w++; h.l++ }
    else { h.t++; a.t++ }
  }
  return lines
}

export function winPct(l: TeamLine): number {
  return l.gp === 0 ? 0 : (l.w + 0.5 * l.t) / l.gp
}

// ── Ranking with tiebreakers ─────────────────────────────────────────────────

function groupBy<T>(items: T[], key: (t: T) => number): T[][] {
  const groups: T[][] = []
  let cur: T[] = []
  let curKey: number | null = null
  for (const it of items) {
    const k = key(it)
    if (curKey === null || Math.abs(k - curKey) < 1e-9) {
      cur.push(it)
    } else {
      groups.push(cur)
      cur = [it]
    }
    curKey = k
  }
  if (cur.length) groups.push(cur)
  return groups
}

/** Head-to-head win pct restricted to games among `group`. */
function headToHeadPct(teamId: string, group: Set<string>, results: GameResult[]): number | null {
  let w = 0, l = 0, t = 0
  for (const g of results) {
    const isHome = g.homeTeamId === teamId
    const isAway = g.awayTeamId === teamId
    if (!isHome && !isAway) continue
    const opp = isHome ? g.awayTeamId : g.homeTeamId
    if (!group.has(opp)) continue
    const mine = isHome ? g.homeScore : g.awayScore
    const theirs = isHome ? g.awayScore : g.homeScore
    if (mine > theirs) w++
    else if (mine < theirs) l++
    else t++
  }
  const gp = w + l + t
  return gp === 0 ? null : (w + 0.5 * t) / gp
}

function metricFor(tb: Tiebreaker, line: TeamLine, group: Set<string>, results: GameResult[]): number {
  switch (tb) {
    case 'headToHead': {
      const p = headToHeadPct(line.teamId, group, results)
      return p ?? -1   // no games among the group → cannot separate
    }
    case 'runDiff': return line.rf - line.ra
    case 'runsAllowed': return -line.ra   // fewer allowed is better → higher metric
    case 'runsFor': return line.rf
  }
}

/**
 * Break a tie among `tied` (all equal win pct). Applies tiebreakers in order;
 * whenever one splits the group, the subgroups restart from the FIRST
 * tiebreaker (standard multi-team procedure). Unresolvable → coin flip
 * (alphabetical by teamId, flagged in notes).
 */
function breakTie(tied: TeamLine[], results: GameResult[], tiebreakers: Tiebreaker[], notes: TieNote[]): TeamLine[] {
  if (tied.length <= 1) return tied
  const group = new Set(tied.map(t => t.teamId))
  for (const tb of tiebreakers) {
    const scored = tied.map(t => ({ t, m: metricFor(tb, t, group, results) }))
    // headToHead with no games among the group cannot separate anyone
    if (tb === 'headToHead' && scored.every(s => s.m === -1)) continue
    scored.sort((a, b) => b.m - a.m)
    const subgroups = groupBy(scored, s => s.m).map(g => g.map(s => s.t))
    if (subgroups.length === 1) continue   // no separation — next tiebreaker
    notes.push({ teamIds: tied.map(t => t.teamId), resolvedBy: tb })
    return subgroups.flatMap(sg => breakTie(sg, results, tiebreakers, notes))
  }
  notes.push({ teamIds: tied.map(t => t.teamId), resolvedBy: 'coinFlip' })
  return [...tied].sort((a, b) => a.teamId.localeCompare(b.teamId))
}

export function rankTeams(
  lines: Map<string, TeamLine>,
  results: GameResult[],
  config: PlayoffConfig = DEFAULT_PLAYOFF_CONFIG,
): Ranking {
  const notes: TieNote[] = []
  const sorted = [...lines.values()].sort((a, b) => winPct(b) - winPct(a))
  const groups = groupBy(sorted, winPct)
  const order = groups.flatMap(g => breakTie(g, results, config.tiebreakers, notes)).map(l => l.teamId)
  return { order, tieNotes: notes }
}

// ── Season simulation ────────────────────────────────────────────────────────

/** Smallest index w such that flags[w..] are all true; null if none. */
function threshold(flags: boolean[] | undefined): number | null {
  if (!flags) return null
  let w = flags.length
  for (let i = flags.length - 1; i >= 0; i--) {
    if (flags[i]) w = i
    else break
  }
  return w >= flags.length ? null : w
}

export function buildPlayoffPicture(
  teamIds: string[],
  results: GameResult[],
  schedule: ScheduledGame[],
  config: PlayoffConfig = DEFAULT_PLAYOFF_CONFIG,
): PlayoffPicture {
  const ids = [...new Set(teamIds)]
  const lines = computeLines(ids, results)
  const current = rankTeams(lines, results, config)

  const known = (g: ScheduledGame) => lines.has(g.homeTeamId) && lines.has(g.awayTeamId)
  const counts = (g: ScheduledGame) => g.status === 'scheduled' || (g.status === 'postponed' && config.countPostponed)
  // Dated games first, makeups (postponed, date TBD) at the end.
  const remaining = schedule.filter(g => known(g) && counts(g))
    .sort((a, b) => Number(a.status === 'postponed') - Number(b.status === 'postponed'))
  const postponed = schedule.filter(g => g.status === 'postponed')
  const n = remaining.length
  const exact = n <= MAX_EXACT_GAMES

  const remainingCount = new Map<string, number>()
  for (const id of ids) remainingCount.set(id, 0)
  for (const g of remaining) {
    remainingCount.set(g.homeTeamId, (remainingCount.get(g.homeTeamId) ?? 0) + 1)
    remainingCount.set(g.awayTeamId, (remainingCount.get(g.awayTeamId) ?? 0) + 1)
  }

  const best = new Map<string, number>()
  const worst = new Map<string, number>()
  const inCount = new Map<string, number>()
  // Per team, indexed by its own number of simulated wins: does EVERY such
  // outcome qualify / earn a bye / take the top seed? Indexed by its own
  // simulated losses: does ANY such outcome still qualify?
  const allIn = new Map<string, boolean[]>()
  const allBye = new Map<string, boolean[]>()
  const allTop = new Map<string, boolean[]>()
  const anyInByLosses = new Map<string, boolean[]>()
  for (const id of ids) {
    best.set(id, Infinity); worst.set(id, 0); inCount.set(id, 0)
    const rem = remainingCount.get(id) ?? 0
    allIn.set(id, Array<boolean>(rem + 1).fill(true))
    allBye.set(id, Array<boolean>(rem + 1).fill(true))
    allTop.set(id, Array<boolean>(rem + 1).fill(true))
    anyInByLosses.set(id, Array<boolean>(rem + 1).fill(false))
  }
  const simWins = new Map<string, number>()

  let outcomes = 0
  if (exact) {
    const total = 1 << n
    // Simulated games get a 1-run margin so they never disturb run-diff
    // tiebreakers more than necessary; head-to-head still counts.
    const sim: GameResult[] = remaining.map(g => ({ homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, homeScore: 0, awayScore: 0 }))
    for (let mask = 0; mask < total; mask++) {
      for (let i = 0; i < n; i++) {
        const homeWins = (mask >> i) & 1
        sim[i].homeScore = homeWins ? 1 : 0
        sim[i].awayScore = homeWins ? 0 : 1
      }
      const all = results.concat(sim)
      const { order } = rankTeams(computeLines(ids, all), all, config)
      for (const id of ids) simWins.set(id, 0)
      for (const sg of sim) {
        const winner = sg.homeScore > sg.awayScore ? sg.homeTeamId : sg.awayTeamId
        simWins.set(winner, simWins.get(winner)! + 1)
      }
      order.forEach((id, idx) => {
        const seed = idx + 1
        if (seed < best.get(id)!) best.set(id, seed)
        if (seed > worst.get(id)!) worst.set(id, seed)
        const w = simWins.get(id)!
        const l = (remainingCount.get(id) ?? 0) - w
        if (seed <= config.spots) {
          inCount.set(id, inCount.get(id)! + 1)
          anyInByLosses.get(id)![l] = true
        } else {
          allIn.get(id)![w] = false
        }
        if (seed > config.byes) allBye.get(id)![w] = false
        if (seed > 1) allTop.get(id)![w] = false
      })
      outcomes++
    }
  } else {
    // Bounds only: a team's best seed is limited by rivals whose CURRENT wins
    // already exceed its max wins; its worst seed by rivals whose max wins
    // can't reach its current wins. Never over-claims a clinch.
    for (const id of ids) {
      const me = lines.get(id)!
      const myMax = me.w + (remainingCount.get(id) ?? 0)
      let surelyAhead = 0, surelyBehind = 0
      for (const other of ids) {
        if (other === id) continue
        const o = lines.get(other)!
        const oMax = o.w + (remainingCount.get(other) ?? 0)
        if (o.w > myMax) surelyAhead++
        if (oMax < me.w) surelyBehind++
      }
      best.set(id, surelyAhead + 1)
      worst.set(id, ids.length - surelyBehind)
    }
  }

  const teams: TeamOutlook[] = current.order.map((id, idx) => {
    const line = lines.get(id)!
    const rem = remainingCount.get(id) ?? 0
    const maxWins = line.w + rem
    const bestSeed = best.get(id)!
    const worstSeed = worst.get(id)!
    const clinchedPlayoff = worstSeed <= config.spots
    const clinchedBye = worstSeed <= config.byes
    const clinchedTopSeed = worstSeed <= 1
    const eliminated = bestSeed > config.spots
    const status: TeamOutlook['status'] =
      clinchedTopSeed ? 'clinched-top'
        : clinchedBye ? 'clinched-bye'
          : clinchedPlayoff ? 'clinched'
            : eliminated ? 'eliminated'
              : 'alive'
    return {
      teamId: id,
      line,
      seed: idx + 1,
      remaining: rem,
      maxWins,
      bestSeed,
      worstSeed,
      clinchedPlayoff,
      clinchedBye,
      clinchedTopSeed,
      eliminated,
      byeAlive: bestSeed <= config.byes,
      topSeedAlive: bestSeed <= 1,
      playoffOdds: exact && outcomes > 0 ? inCount.get(id)! / outcomes : null,
      winsToClinch: !exact || clinchedPlayoff || eliminated ? null : threshold(allIn.get(id)),
      winsToBye: !exact || clinchedBye || bestSeed > config.byes ? null : threshold(allBye.get(id)),
      winsToTop: !exact || clinchedTopSeed || bestSeed > 1 ? null : threshold(allTop.get(id)),
      lossesToElimination: !exact || clinchedPlayoff || eliminated
        ? null
        : threshold(anyInByLosses.get(id)?.map(v => !v)),
      status,
    }
  })

  return {
    config,
    order: current.order,
    tieNotes: current.tieNotes,
    teams,
    remainingGames: remaining,
    postponedGames: postponed,
    exact,
    outcomesEvaluated: outcomes,
  }
}

// ── Bracket ──────────────────────────────────────────────────────────────────

export interface BracketMatchup {
  label: string        // "QF1", "QF2", "SF1", "SF2", "Final"
  highSeed: number
  lowSeed: number
}

export interface Bracket {
  byes: number[]                       // seeds that skip the first round
  quarterfinals: BracketMatchup[]      // 3v6, 4v5
  /** Semifinal pairing rule as text — actual pairing depends on QF results (reseed) */
  semifinalRule: string
}

/** Bracket "if the season ended today". Seeds are 1-based positions in `order`. */
export function projectBracket(config: PlayoffConfig = DEFAULT_PLAYOFF_CONFIG): Bracket {
  const byes = Array.from({ length: config.byes }, (_, i) => i + 1)
  const firstRoundSeeds = Array.from({ length: config.spots - config.byes }, (_, i) => config.byes + 1 + i)
  const quarterfinals: BracketMatchup[] = []
  for (let i = 0; i < firstRoundSeeds.length / 2; i++) {
    quarterfinals.push({
      label: `QF${i + 1}`,
      highSeed: firstRoundSeeds[i],
      lowSeed: firstRoundSeeds[firstRoundSeeds.length - 1 - i],
    })
  }
  return {
    byes,
    quarterfinals,
    semifinalRule: `Reseed: the ${ordinalWord(1)} seed plays the lowest remaining seed`,
  }
}

/**
 * Semifinal pairings after the quarterfinals, with reseeding: the top bye
 * seed faces the LOWEST surviving seed, the next bye seed the next lowest.
 */
export function reseedSemifinals(byeSeeds: number[], qfWinnerSeeds: number[]): BracketMatchup[] {
  const survivors = [...qfWinnerSeeds].sort((a, b) => b - a)   // lowest seed (largest number) first
  const byes = [...byeSeeds].sort((a, b) => a - b)
  return byes.map((high, i) => ({
    label: `SF${i + 1}`,
    highSeed: high,
    lowSeed: survivors[i],
  }))
}

function ordinalWord(n: number): string {
  return n === 1 ? '1' : String(n)
}

/** Pretty "x-", "y-", "z-" style prefix for standings tags. */
export function statusTag(t: TeamOutlook): { text: string; tone: 'gold' | 'green' | 'red' | 'muted' } | null {
  switch (t.status) {
    case 'clinched-top': return { text: 'Clinched No. 1 seed', tone: 'gold' }
    case 'clinched-bye': return { text: 'Clinched bye', tone: 'gold' }
    case 'clinched': return { text: 'Clinched playoff spot', tone: 'green' }
    case 'eliminated': return { text: 'Eliminated', tone: 'red' }
    default: return null
  }
}

/**
 * One-line outlook for the next goal a team can still reach, e.g.
 * "Clinches with 1 more win", "Clinches bye with 2 more wins",
 * "Needs help to clinch". null when nothing is left to play for.
 */
export function outlookLine(t: TeamOutlook): string | null {
  const wins = (n: number) => (n === 1 ? '1 more win' : `${n} more wins`)
  switch (t.status) {
    case 'alive':
      if (t.winsToClinch != null && t.winsToClinch > 0) return `Clinches with ${wins(t.winsToClinch)}`
      if (t.lossesToElimination === 1) return 'Eliminated with next loss'
      return t.playoffOdds != null && t.playoffOdds < 0.5 ? 'Needs help to stay alive' : 'Needs help to clinch'
    case 'clinched':
      if (t.winsToBye != null && t.winsToBye > 0) return `Clinches bye with ${wins(t.winsToBye)}`
      return t.byeAlive ? 'Bye still possible' : null
    case 'clinched-bye':
      if (t.winsToTop != null && t.winsToTop > 0) return `Clinches No. 1 seed with ${wins(t.winsToTop)}`
      return t.topSeedAlive ? 'No. 1 seed still possible' : null
    default:
      return null
  }
}

/**
 * Drop scheduled games that already have a finalized result (same date and
 * matchup) — the schedule feed lags the scorekeeper until it's re-synced, and
 * a game must never count as both a result and a remaining game.
 */
export function dedupeSchedule(
  schedule: ScheduledGame[],
  results: (GameResult & { date?: string })[],
): ScheduledGame[] {
  const played = new Set(results.map(r => `${r.date ?? ''}|${r.awayTeamId}@${r.homeTeamId}`))
  return schedule.filter(g => !played.has(`${g.date}|${g.awayTeamId}@${g.homeTeamId}`))
}
