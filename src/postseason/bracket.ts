/**
 * postseason/bracket.ts — pure playoff bracket logic (no Firebase, no React).
 *
 * Format (fixed bracket, NO reseeding):
 *   QF  qf36: 3 v 6          qf45: 4 v 5
 *   SF  sf2:  2 v winner(qf36)   sf1: 1 v winner(qf45)
 *   F   final: winner(sf1) v winner(sf2)
 * Every round is a single game. The higher seed (lower number) is home.
 *
 * Winners come from the finalized playoff game for a slot, unless the
 * producer set `winnerOverride` on the slot (wins over the game result).
 */

import type { GameRecord, RoundTagMode } from '../types'

export type RoundKey = 'qf' | 'sf' | 'final'
export type SlotId = 'qf36' | 'qf45' | 'sf1' | 'sf2' | 'final'

export const ROUND_ORDER: RoundKey[] = ['qf', 'sf', 'final']
export const ROUND_LABEL: Record<RoundKey, string> = {
  qf: 'Quarterfinals',
  sf: 'Semifinals',
  final: 'Championship',
}
export const ROUND_SHORT: Record<RoundKey, string> = { qf: 'QF', sf: 'SF', final: 'F' }

export interface BracketSlotConfig {
  date?: string        // "YYYY-MM-DD"
  time?: string        // "HH:MM" 24h, Eastern
  venue?: string
  /** Producer override — beats whatever the game result says. */
  winnerOverride?: string | null
}

/** /postseason/brackets/{season} */
export interface BracketConfig {
  season: number
  /** seeds[0] = 1 seed … seeds[5] = 6 seed (teamIds) */
  seeds: string[]
  slots?: Partial<Record<SlotId, BracketSlotConfig>>
}

/** /postseason/meta */
export interface PostseasonMeta {
  /** Global playoff switch: stamps new games as playoff games, turns on the
   *  playoff stat row, bracket scene and round logo. */
  active: boolean
  season: number
}

/** Stamped on /postseason/games/{gameId} at creation. */
export interface PostseasonGameTag {
  season: number
  round: RoundKey
  slot: SlotId
}

export interface SlotDef {
  id: SlotId
  round: RoundKey
  /** Where each side comes from: a fixed seed, or the winner of a slot. */
  high: { seed: number } | { winnerOf: SlotId }
  low: { seed: number } | { winnerOf: SlotId }
}

export const SLOTS: SlotDef[] = [
  { id: 'qf36', round: 'qf', high: { seed: 3 }, low: { seed: 6 } },
  { id: 'qf45', round: 'qf', high: { seed: 4 }, low: { seed: 5 } },
  { id: 'sf1', round: 'sf', high: { seed: 1 }, low: { winnerOf: 'qf45' } },
  { id: 'sf2', round: 'sf', high: { seed: 2 }, low: { winnerOf: 'qf36' } },
  { id: 'final', round: 'final', high: { winnerOf: 'sf1' }, low: { winnerOf: 'sf2' } },
]

export interface BracketTeam {
  teamId: string
  seed: number
}

export type SlotStatus = 'waiting' | 'scheduled' | 'live' | 'final'

export interface ResolvedSlot {
  id: SlotId
  round: RoundKey
  /** null until the feeder slot has a winner */
  high: BracketTeam | null
  low: BracketTeam | null
  /** Higher seed (lower seed number) hosts. */
  home: BracketTeam | null
  away: BracketTeam | null
  gameId: string | null
  game: GameRecord | null
  winner: BracketTeam | null
  /** true when the winner came from the producer override */
  overridden: boolean
  status: SlotStatus
  config: BracketSlotConfig
}

export interface ResolvedBracket {
  season: number
  slots: Record<SlotId, ResolvedSlot>
  /** The round being played now (the earliest round with an undecided slot);
   *  'final' once a champion exists. */
  currentRound: RoundKey
  champion: BracketTeam | null
}

export interface PostseasonGameEntry {
  gameId: string
  game: GameRecord & { postseason?: PostseasonGameTag }
}

function seedOf(seeds: string[], teamId: string): number {
  const i = seeds.indexOf(teamId)
  return i >= 0 ? i + 1 : 99
}

function samePair(g: GameRecord, a: string, b: string): boolean {
  return (g.homeTeamId === a && g.awayTeamId === b) || (g.homeTeamId === b && g.awayTeamId === a)
}

function gameWinner(g: GameRecord): string | null {
  if (!g.finalized) return null
  if (g.homeScore > g.awayScore) return g.homeTeamId
  if (g.awayScore > g.homeScore) return g.awayTeamId
  return null
}

export function resolveBracket(config: BracketConfig, games: PostseasonGameEntry[]): ResolvedBracket {
  const seeds = config.seeds ?? []
  const seasonGames = games.filter(({ game }) =>
    (game.postseason?.season ?? Number(game.date?.slice(0, 4))) === config.season)
  const slots = {} as Record<SlotId, ResolvedSlot>

  const side = (src: SlotDef['high']): BracketTeam | null => {
    if ('seed' in src) {
      const teamId = seeds[src.seed - 1]
      return teamId ? { teamId, seed: src.seed } : null
    }
    return slots[src.winnerOf]?.winner ?? null
  }

  // SLOTS is ordered so feeders resolve before the slots that consume them.
  for (const def of SLOTS) {
    const cfg = config.slots?.[def.id] ?? {}
    const a = side(def.high)
    const b = side(def.low)
    const [high, low] = a && b && b.seed < a.seed ? [b, a] : [a, b]

    // The slot's game: one tagged with this slot, else any game between the pair.
    const tagged = seasonGames.filter(e => e.game.postseason?.slot === def.id)
    const byPair = high && low ? seasonGames.filter(e => samePair(e.game, high.teamId, low.teamId)) : []
    const candidates = tagged.length ? tagged : byPair
    // Prefer a finalized game, then the most recently started one.
    const entry = [...candidates].sort((x, y) =>
      Number(!!y.game.finalized) - Number(!!x.game.finalized) || (y.game.startedAt ?? 0) - (x.game.startedAt ?? 0))[0] ?? null

    const overrideId = cfg.winnerOverride ?? null
    const resultId = entry ? gameWinner(entry.game) : null
    const winnerId = overrideId ?? resultId
    const winner = winnerId
      ? (high?.teamId === winnerId ? high : low?.teamId === winnerId ? low : { teamId: winnerId, seed: seedOf(seeds, winnerId) })
      : null

    const status: SlotStatus = winner ? 'final'
      : entry && !entry.game.finalized ? 'live'
      : high && low ? 'scheduled'
      : 'waiting'

    slots[def.id] = {
      id: def.id, round: def.round, high, low,
      home: high, away: low,
      gameId: entry?.gameId ?? null, game: entry?.game ?? null,
      winner, overridden: !!overrideId, status, config: cfg,
    }
  }

  const champion = slots.final.winner
  const currentRound = champion ? 'final'
    : ROUND_ORDER.find(r => SLOTS.some(s => s.round === r && !slots[s.id].winner)) ?? 'final'

  return { season: config.season, slots, currentRound, champion }
}

/** Scorebug round tag: null = no tag; 'auto' follows the bracket. */
export function resolveRoundTag(mode: RoundTagMode, bracket: ResolvedBracket | null): RoundKey | null {
  if (mode === 'off') return null
  if (mode === 'auto') return bracket?.currentRound ?? 'qf'
  return mode
}

/** The bracket slot two teams are scheduled to meet in, if any (order-free). */
export function slotForMatchup(bracket: ResolvedBracket, teamA: string, teamB: string): ResolvedSlot | null {
  return SLOTS.map(s => bracket.slots[s.id]).find(s =>
    s.high && s.low && !s.winner &&
    ((s.high.teamId === teamA && s.low.teamId === teamB) || (s.high.teamId === teamB && s.low.teamId === teamA)),
  ) ?? null
}

/** "Thu Oct 15 · 4:30 PM · Bittersweet Park" — omits missing parts. */
export function slotWhen(cfg: BracketSlotConfig): string {
  const parts: string[] = []
  if (cfg.date) {
    const d = new Date(`${cfg.date}T12:00:00`)
    parts.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
  }
  if (cfg.time) {
    const [h, m] = cfg.time.split(':').map(Number)
    parts.push(`${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`)
  }
  if (cfg.venue) parts.push(cfg.venue)
  return parts.join(' · ')
}

/** The 2026 bracket as agreed with the league (seeded from final standings). */
export const BRACKET_2026: BracketConfig = {
  season: 2026,
  seeds: ['nuke_squad', 'trash_pandas', 'base_invaders', 'wiffle_whalers', 'swing_mafia', 'yellow_bat_yetis'],
  slots: {
    qf36: { date: '2026-10-15', time: '16:30', venue: 'Bittersweet Park' },
    qf45: { date: '2026-10-16', time: '21:00', venue: 'Soccer City Park' },
    sf1: { date: '2026-10-18', time: '11:00', venue: 'Bittersweet Park' },
    sf2: { date: '2026-10-18', time: '13:00', venue: 'Bittersweet Park' },
    final: { date: '2026-10-18', time: '15:00', venue: 'Bittersweet Park' },
  },
}
