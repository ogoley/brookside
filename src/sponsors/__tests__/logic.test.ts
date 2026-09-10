import { describe, it, expect } from 'vitest'
import type { Sponsor, SponsorsMap } from '../../types'
import {
  inningsFromMap, inningsToMap, normalizeSponsor, sortedSponsors,
  sponsorsForInning, pickSponsorForInning, inningAssignments,
  ordinal, displayWebsite, sponsorStillActive,
} from '../logic'

const sponsor = (over: Partial<Sponsor> = {}): Sponsor => ({
  name: 'Sponsor',
  logoUrl: '/sponsors/x.svg',
  enabled: true,
  ...over,
})

const MAP: SponsorsMap = {
  pintus: sponsor({ name: "Pintu's Indian Palace", innings: { '1': true, '3': true }, order: 1 }),
  pafumis: sponsor({ name: "Pafumi's on Main", innings: { '2': true }, order: 2 }),
  ghost: sponsor({ name: 'Disabled Co', innings: { '1': true, '2': true }, order: 0, enabled: false }),
}

describe('inningsFromMap / inningsToMap', () => {
  it('returns sorted unique positive integers and drops falsy / junk keys', () => {
    expect(inningsFromMap({ '3': true, '1': true, '2': false, 'x': true, '0': true, '-1': true, '2.5': true })).toEqual([1, 3])
  })

  it('tolerates the array RTDB hands back for small integer keys ({"1":true} → [null,true])', () => {
    expect(inningsFromMap([null, true] as unknown as Record<string, boolean>)).toEqual([1])
    expect(inningsFromMap([null, true, null, true] as unknown as Record<string, boolean>)).toEqual([1, 3])
  })

  it('handles missing maps', () => {
    expect(inningsFromMap(undefined)).toEqual([])
    expect(inningsFromMap(null)).toEqual([])
  })

  it('round-trips through inningsToMap', () => {
    expect(inningsToMap([2, 5, 2, 0, -3, 1.5])).toEqual({ '2': true, '5': true })
    expect(inningsFromMap(inningsToMap([7, 1, 4]))).toEqual([1, 4, 7])
  })
})

describe('normalizeSponsor', () => {
  it('defaults enabled to true and order to a large number', () => {
    const e = normalizeSponsor('a', sponsor({ enabled: undefined, order: undefined }))
    expect(e.enabled).toBe(true)
    expect(e.order).toBe(Number.MAX_SAFE_INTEGER)
    expect(e.innings).toEqual([])
  })

  it('honours explicit enabled=false and numeric order', () => {
    const e = normalizeSponsor('a', sponsor({ enabled: false, order: 3 }))
    expect(e.enabled).toBe(false)
    expect(e.order).toBe(3)
  })

  it('ignores non-finite order values', () => {
    const e = normalizeSponsor('a', sponsor({ order: Number.NaN }))
    expect(e.order).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('sortedSponsors', () => {
  it('orders by order, then name, then id', () => {
    const map: SponsorsMap = {
      z: sponsor({ name: 'Zed', order: 2 }),
      b: sponsor({ name: 'Bravo' }),          // no order → last
      a: sponsor({ name: 'Alpha' }),          // no order → last, before Bravo by name
      m: sponsor({ name: 'Mike', order: 1 }),
      m2: sponsor({ name: 'Mike', order: 1 }), // same order+name → id tie-break
    }
    expect(sortedSponsors(map).map(s => s.id)).toEqual(['m', 'm2', 'z', 'a', 'b'])
  })

  it('includes disabled sponsors (admin needs to see them) and skips malformed nodes', () => {
    const map = { ...MAP, junk: { logoUrl: 'x' } as unknown as Sponsor, nul: null as unknown as Sponsor }
    expect(sortedSponsors(map).map(s => s.id)).toEqual(['ghost', 'pintus', 'pafumis'])
  })

  it('handles empty input', () => {
    expect(sortedSponsors(undefined)).toEqual([])
    expect(sortedSponsors({})).toEqual([])
  })
})

describe('sponsorsForInning / pickSponsorForInning', () => {
  it('returns only enabled sponsors that claim the inning', () => {
    expect(sponsorsForInning(MAP, 1).map(s => s.id)).toEqual(['pintus'])
    expect(sponsorsForInning(MAP, 2).map(s => s.id)).toEqual(['pafumis'])
    expect(sponsorsForInning(MAP, 3).map(s => s.id)).toEqual(['pintus'])
    expect(sponsorsForInning(MAP, 4)).toEqual([])
  })

  it('a sponsor can present several innings', () => {
    expect(pickSponsorForInning(MAP, 1)?.id).toBe('pintus')
    expect(pickSponsorForInning(MAP, 3)?.id).toBe('pintus')
  })

  it('never fires a disabled sponsor even if it is first in order', () => {
    // 'ghost' has order 0 and claims inning 2, but is disabled
    expect(pickSponsorForInning(MAP, 2)?.id).toBe('pafumis')
  })

  it('resolves a shared inning to the first sponsor by order', () => {
    const map: SponsorsMap = {
      late: sponsor({ name: 'Late', innings: { '5': true }, order: 9 }),
      early: sponsor({ name: 'Early', innings: { '5': true }, order: 1 }),
    }
    expect(pickSponsorForInning(map, 5)?.id).toBe('early')
  })

  it('returns null / [] for innings nobody owns or invalid innings', () => {
    expect(pickSponsorForInning(MAP, 9)).toBeNull()
    expect(pickSponsorForInning(MAP, 0)).toBeNull()
    expect(pickSponsorForInning(MAP, 1.5)).toBeNull()
    expect(pickSponsorForInning(undefined, 1)).toBeNull()
  })
})

describe('inningAssignments', () => {
  it('maps every inning to its enabled claimants in order', () => {
    const map: SponsorsMap = {
      ...MAP,
      dup: sponsor({ name: 'Dup', innings: { '1': true }, order: 5 }),
    }
    const a = inningAssignments(map)
    expect(a.get(1)).toEqual(['pintus', 'dup'])
    expect(a.get(2)).toEqual(['pafumis'])
    expect(a.get(3)).toEqual(['pintus'])
    expect(a.has(4)).toBe(false)
  })
})

describe('ordinal', () => {
  it('formats English ordinals including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
  })
})

describe('displayWebsite', () => {
  it('strips protocol, www and trailing slashes', () => {
    expect(displayWebsite('https://pintus.website/')).toBe('pintus.website')
    expect(displayWebsite('http://www.example.com///')).toBe('example.com')
    expect(displayWebsite('  https://pafumis-on-main.webflow.io/ ')).toBe('pafumis-on-main.webflow.io')
  })

  it('handles empty input', () => {
    expect(displayWebsite('')).toBe('')
    expect(displayWebsite(undefined)).toBe('')
    expect(displayWebsite(null)).toBe('')
  })
})

describe('sponsorStillActive', () => {
  it('is false when inactive regardless of time', () => {
    expect(sponsorStillActive({ active: false, triggeredAt: 0, durationMs: 10_000 }, 5)).toBe(false)
  })

  it('is true inside the window and false once it elapses', () => {
    const s = { active: true, triggeredAt: 1_000, durationMs: 10_000 }
    expect(sponsorStillActive(s, 1_000)).toBe(true)
    expect(sponsorStillActive(s, 10_999)).toBe(true)
    expect(sponsorStillActive(s, 11_000)).toBe(false)
    expect(sponsorStillActive(s, 99_999)).toBe(false)
  })

  it('trusts the flag when there is no timing info (manual show without timer)', () => {
    expect(sponsorStillActive({ active: true, triggeredAt: 0, durationMs: 10_000 }, Date.now())).toBe(true)
    expect(sponsorStillActive({ active: true, triggeredAt: 5, durationMs: 0 }, Date.now())).toBe(true)
  })
})
