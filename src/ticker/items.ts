// Bottom-line ticker content — pure functions. The overlay feeds these live
// Firebase snapshots and renders whatever comes back; nothing here touches
// Firebase or React so every section can be unit-tested.
import type { GameRecord, PlayersMap, SponsorsMap, StandingsData, TeamsMap, TickerSectionId, TickerState } from '../types'
import {
  battingLeaders, homeRunLeaders, pitchingLeaders,
  teamGamesFromStandings, fmtAvg, fmtEra,
} from '../stats/leaders'
import { sortedSponsors, displayWebsite } from '../sponsors/logic'
import type { PlayoffPicture, ScheduledGame } from '../playoffs/engine'
import { fmtGameWhen, oddsLabel, outlookText } from '../playoffs/format'

export interface TickerItem {
  key: string
  /** Rank / date / bullet — small muted lead-in */
  lead?: string
  /** Main text, rendered uppercase */
  text: string
  /** Highlighted figure in the accent colour (".512", "11-3") */
  value?: string
  /** Muted trailing detail ("9 HR · 31 RBI") */
  detail?: string
  logoUrl?: string
  color?: string
}

export interface TickerSection {
  id: TickerSectionId
  label: string
  items: TickerItem[]
}

export interface TickerSources {
  teams: TeamsMap
  players: PlayersMap
  standings: StandingsData
  games: { gameId: string; game: GameRecord }[]
  sponsors: SponsorsMap
  /** Remaining regular-season games (already deduped against results) */
  schedule?: ScheduledGame[]
  /** Exact clinch/elimination picture — see src/playoffs/engine.ts */
  picture?: PlayoffPicture | null
}

export const SECTION_LABELS: Record<TickerSectionId, string> = {
  standings: 'Standings',
  playoffs: 'Playoff Picture',
  batting: 'Batting Leaders',
  homeRuns: 'Home Run Leaders',
  pitching: 'Pitching Leaders',
  results: 'Recent Results',
  upcoming: 'Coming Up',
  sponsors: 'Our Sponsors',
  messages: 'League Wire',
}

/** Fixed on-air order — independent of how the toggles are stored. */
export const SECTION_ORDER: TickerSectionId[] = [
  'standings', 'playoffs', 'batting', 'homeRuns', 'pitching', 'results', 'upcoming', 'sponsors', 'messages',
]

const MAX_RESULTS = 6
const MAX_MESSAGE_LEN = 140

/** Last name with a first initial: "Jonathan Spring" → "J. Spring". */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

/** "2026-08-28" → "AUG 28" (date-only string, no timezone drift). */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return ''
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const month = months[Number(m[2]) - 1]
  if (!month) return ''
  return `${month} ${Number(m[3])}`
}

function teamName(teams: TeamsMap, id: string): string {
  return teams[id]?.name ?? teams[id]?.shortName ?? id
}

export function standingsItems({ teams, standings }: TickerSources): TickerItem[] {
  return standings
    .filter(s => !teams[s.teamId]?.isExhibition)
    .map((s, i) => {
      const t = teams[s.teamId]
      return {
        key: `st-${s.teamId}`,
        lead: String(i + 1),
        text: teamName(teams, s.teamId),
        value: s.t > 0 ? `${s.w}-${s.l}-${s.t}` : `${s.w}-${s.l}`,
        detail: s.streak && s.streak !== '—' ? s.streak : undefined,
        logoUrl: t?.logoUrl || undefined,
        color: t?.primaryColor,
      }
    })
}

export function battingItems({ teams, players, standings }: TickerSources): TickerItem[] {
  const teamGames = teamGamesFromStandings(standings)
  return battingLeaders(players, teamGames, 5).map(({ id, player }, i) => {
    const h = player.stats.hitting!
    const t = teams[player.teamId]
    return {
      key: `ba-${id}`,
      lead: String(i + 1),
      text: shortName(player.name),
      value: `${fmtAvg(h.avg)} AVG`,
      detail: `${h.hr ?? 0} HR · ${h.rbi ?? 0} RBI`,
      logoUrl: t?.logoUrl || undefined,
      color: t?.primaryColor,
    }
  })
}

export function homeRunItems({ teams, players }: TickerSources): TickerItem[] {
  return homeRunLeaders(players, 5).map(({ id, player }, i) => {
    const h = player.stats.hitting!
    const t = teams[player.teamId]
    return {
      key: `hr-${id}`,
      lead: String(i + 1),
      text: shortName(player.name),
      value: `${h.hr ?? 0} HR`,
      detail: `${h.rbi ?? 0} RBI · ${fmtAvg(h.avg)}`,
      logoUrl: t?.logoUrl || undefined,
      color: t?.primaryColor,
    }
  })
}

export function pitchingItems({ teams, players, standings }: TickerSources): TickerItem[] {
  const teamGames = teamGamesFromStandings(standings)
  return pitchingLeaders(players, teamGames, 5).map(({ id, player }, i) => {
    const p = player.stats.pitching!
    const t = teams[player.teamId]
    return {
      key: `pi-${id}`,
      lead: String(i + 1),
      text: shortName(player.name),
      value: `${fmtEra(p.era)} ERA`,
      detail: `${p.k ?? 0} K · ${Math.floor(p.inningsPitched ?? 0)} IP`,
      logoUrl: t?.logoUrl || undefined,
      color: t?.primaryColor,
    }
  })
}

/** Most recent finalized regular-season games, winner listed first. */
export function resultsItems({ teams, games }: TickerSources): TickerItem[] {
  return games
    .filter(({ game }) => game.finalized && !game.isExhibition
      && !teams[game.homeTeamId]?.isExhibition && !teams[game.awayTeamId]?.isExhibition)
    .sort((a, b) => {
      const byDate = (b.game.date ?? '').localeCompare(a.game.date ?? '')
      if (byDate !== 0) return byDate
      return (b.game.finalizedAt ?? b.game.startedAt ?? 0) - (a.game.finalizedAt ?? a.game.startedAt ?? 0)
    })
    .slice(0, MAX_RESULTS)
    .map(({ gameId, game }) => {
      const homeWon = game.homeScore > game.awayScore
      const tie = game.homeScore === game.awayScore
      const winId = homeWon ? game.homeTeamId : game.awayTeamId
      const loseId = homeWon ? game.awayTeamId : game.homeTeamId
      const winScore = Math.max(game.homeScore, game.awayScore)
      const loseScore = Math.min(game.homeScore, game.awayScore)
      const w = teams[winId]
      return {
        key: `rs-${gameId}`,
        lead: shortDate(game.date) || undefined,
        text: tie
          ? `${teamName(teams, game.awayTeamId)} ${game.awayScore}, ${teamName(teams, game.homeTeamId)} ${game.homeScore}`
          : `${teamName(teams, winId)} ${winScore}, ${teamName(teams, loseId)} ${loseScore}`,
        value: tie ? 'TIE' : 'FINAL',
        logoUrl: w?.logoUrl || undefined,
        color: w?.primaryColor,
      }
    })
}

/** One line per team: seed, name, clinch status / next goal, record, odds. */
export function playoffItems({ teams, picture }: TickerSources): TickerItem[] {
  if (!picture) return []
  return picture.teams.map(t => {
    const team = teams[t.teamId]
    return {
      key: `po-${t.teamId}`,
      lead: String(t.seed),
      text: teamName(teams, t.teamId),
      value: outlookText(t),
      detail: `${t.line.w}-${t.line.l}${t.line.t ? '-' + t.line.t : ''} · ${oddsLabel(t)}`,
      logoUrl: team?.logoUrl || undefined,
      color: team?.primaryColor,
    }
  })
}

const MAX_UPCOMING = 6

/** Next games on the schedule, soonest first. */
export function upcomingItems({ teams, schedule }: TickerSources): TickerItem[] {
  if (!schedule) return []
  // Dated games first; a makeup (postponed, date TBD) rides at the end
  return [...schedule.filter(g => g.status === 'scheduled'), ...schedule.filter(g => g.status === 'postponed')]
    .slice(0, MAX_UPCOMING)
    .map(g => {
      const away = teams[g.awayTeamId]
      return {
        key: `up-${g.id}`,
        lead: fmtGameWhen(g),
        text: `${teamName(teams, g.awayTeamId)} at ${teamName(teams, g.homeTeamId)}`,
        detail: g.venue || undefined,
        logoUrl: away?.logoUrl || undefined,
        color: away?.primaryColor,
      }
    })
}

export function sponsorItems({ sponsors }: TickerSources): TickerItem[] {
  return sortedSponsors(sponsors)
    .filter(s => s.enabled)
    .map(s => ({
      key: `sp-${s.id}`,
      lead: 'Presented by',
      text: s.sponsor.name,
      value: displayWebsite(s.sponsor.website) || undefined,
      detail: s.sponsor.tagline || undefined,
      logoUrl: s.sponsor.logoUrl || undefined,
      color: s.sponsor.accentColor,
    }))
}

/** Producer messages, ordered by key (push keys sort chronologically). */
export function messageItems(messages: Record<string, string> | undefined | null): TickerItem[] {
  if (!messages) return []
  return Object.entries(messages)
    .filter(([, text]) => typeof text === 'string' && text.trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, text]) => ({
      key: `msg-${key}`,
      text: text.trim().slice(0, MAX_MESSAGE_LEN),
    }))
}

/**
 * Every enabled section that actually has content, in on-air order. Empty
 * sections are dropped so the crawl never shows a bare header.
 */
export function buildTickerSections(sources: TickerSources, ticker: TickerState): TickerSection[] {
  const builders: Record<TickerSectionId, () => TickerItem[]> = {
    standings: () => standingsItems(sources),
    playoffs: () => playoffItems(sources),
    batting: () => battingItems(sources),
    homeRuns: () => homeRunItems(sources),
    pitching: () => pitchingItems(sources),
    results: () => resultsItems(sources),
    upcoming: () => upcomingItems(sources),
    sponsors: () => sponsorItems(sources),
    messages: () => messageItems(ticker.messages),
  }
  const out: TickerSection[] = []
  for (const id of SECTION_ORDER) {
    if (!ticker.sections?.[id]) continue
    const items = builders[id]()
    if (items.length === 0) continue
    out.push({ id, label: SECTION_LABELS[id], items })
  }
  return out
}

/** Crawl duration for a track of `trackPx` entering from `viewportPx` away. */
export function crawlDurationSec(viewportPx: number, trackPx: number, speedPxPerSec: number): number {
  const speed = speedPxPerSec > 0 && Number.isFinite(speedPxPerSec) ? speedPxPerSec : 120
  const distance = Math.max(0, viewportPx) + Math.max(0, trackPx)
  return Math.max(1, distance / speed)
}

/** "#000" or "#fff" — whichever reads better on a solid `hex` background. */
export function readableOn(hex: string): '#080d18' | '#ffffff' {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return '#ffffff'
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return lum > 0.4 ? '#080d18' : '#ffffff'
}
