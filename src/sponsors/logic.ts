// Pure sponsor helpers — no Firebase, no React. Everything the overlay,
// controller and admin panel need to agree on about "who presents inning N"
// lives here so it can be unit-tested in isolation.
import type { Sponsor, SponsorsMap } from '../types'

export interface SponsorEntry {
  id: string
  sponsor: Sponsor
  /** Sorted ascending, deduped, only positive integers */
  innings: number[]
  enabled: boolean
  order: number
}

/** Innings offered in the admin picker. Regulation is 7; extras happen. */
export const SPONSOR_INNING_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** Innings map → sorted unique positive integers. Tolerates bad keys. */
export function inningsFromMap(map: Record<string, boolean> | undefined | null): number[] {
  if (!map) return []
  const out = new Set<number>()
  for (const [k, v] of Object.entries(map)) {
    if (!v) continue
    const n = Number(k)
    if (Number.isInteger(n) && n > 0) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/** Inverse of inningsFromMap — what the admin panel writes. */
export function inningsToMap(innings: readonly number[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const n of innings) {
    if (Number.isInteger(n) && n > 0) out[String(n)] = true
  }
  return out
}

export function normalizeSponsor(id: string, raw: Sponsor): SponsorEntry {
  return {
    id,
    sponsor: raw,
    innings: inningsFromMap(raw.innings),
    enabled: raw.enabled !== false,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : Number.MAX_SAFE_INTEGER,
  }
}

/** All sponsors (enabled or not) sorted by order, then name, then id. Stable
 *  ordering matters: it decides which sponsor wins a shared inning. */
export function sortedSponsors(map: SponsorsMap | null | undefined): SponsorEntry[] {
  if (!map) return []
  return Object.entries(map)
    .filter(([, s]) => s && typeof s === 'object' && typeof s.name === 'string')
    .map(([id, s]) => normalizeSponsor(id, s))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      const byName = a.sponsor.name.localeCompare(b.sponsor.name)
      if (byName !== 0) return byName
      return a.id.localeCompare(b.id)
    })
}

/** Enabled sponsors that present the given inning, in display order. */
export function sponsorsForInning(map: SponsorsMap | null | undefined, inning: number): SponsorEntry[] {
  if (!Number.isInteger(inning) || inning <= 0) return []
  return sortedSponsors(map).filter(s => s.enabled && s.innings.includes(inning))
}

/**
 * The sponsor to show when the scorebug reaches `inning`.
 * If several enabled sponsors claim the same inning the first by order wins —
 * the admin panel surfaces the conflict so it's a deliberate choice.
 */
export function pickSponsorForInning(map: SponsorsMap | null | undefined, inning: number): SponsorEntry | null {
  return sponsorsForInning(map, inning)[0] ?? null
}

/** inning → sponsor ids claiming it (enabled only). Used for the admin
 *  conflict warning and the controller's inning strip. */
export function inningAssignments(map: SponsorsMap | null | undefined): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const s of sortedSponsors(map)) {
    if (!s.enabled) continue
    for (const n of s.innings) {
      const list = out.get(n) ?? []
      list.push(s.id)
      out.set(n, list)
    }
  }
  return out
}

/** 1 → "1st", 2 → "2nd", 11 → "11th" */
export function ordinal(n: number): string {
  const abs = Math.abs(n)
  const mod100 = abs % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (abs % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** "pintus.website" from "https://pintus.website/" — what goes on air. */
export function displayWebsite(url: string | undefined | null): string {
  if (!url) return ''
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

/**
 * Should the interstitial still be on screen? Mirrors the controller's
 * dismiss timer so a stale `active: true` (controller tab died mid-card)
 * never leaves a sponsor frozen on the broadcast.
 */
export function sponsorStillActive(
  state: { active: boolean; triggeredAt: number; durationMs: number },
  now: number,
): boolean {
  if (!state.active) return false
  if (!state.triggeredAt || state.durationMs <= 0) return state.active
  return now - state.triggeredAt < state.durationMs
}
