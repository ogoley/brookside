import { describe, it, expect } from 'vitest'
import { fmtPct, fmtRecord, fmtDiff, oddsLabel, outlookText, fmtGameDate, fmtGameTime, fmtGameWhen, fmtSeedRange } from '../format'
import type { TeamOutlook } from '../engine'

const line = { teamId: 'a', w: 9, l: 2, t: 0, gp: 11, rf: 107, ra: 65 }
const base: TeamOutlook = {
  teamId: 'a', line, seed: 2, remaining: 3, maxWins: 12, bestSeed: 1, worstSeed: 3,
  clinchedPlayoff: true, clinchedBye: false, clinchedTopSeed: false, eliminated: false,
  byeAlive: true, topSeedAlive: true, playoffOdds: 1,
  winsToClinch: null, winsToBye: 1, winsToTop: 3, lossesToElimination: null, status: 'clinched',
}

describe('format helpers', () => {
  it('formats record, pct and diff', () => {
    expect(fmtPct(line)).toBe('.818')
    expect(fmtPct({ ...line, w: 0, l: 0, gp: 0 })).toBe('.000')
    expect(fmtRecord(line)).toBe('9-2')
    expect(fmtRecord({ ...line, t: 1 })).toBe('9-2-1')
    expect(fmtDiff(line)).toBe('+42')
    expect(fmtDiff({ ...line, rf: 10, ra: 30 })).toBe('-20')
  })

  it('odds label collapses decided teams and rounds the rest', () => {
    expect(oddsLabel(base)).toBe('IN')
    expect(oddsLabel({ ...base, clinchedPlayoff: false, eliminated: true, playoffOdds: 0 })).toBe('OUT')
    expect(oddsLabel({ ...base, clinchedPlayoff: false, playoffOdds: 0.969 })).toBe('97%')
    expect(oddsLabel({ ...base, clinchedPlayoff: false, playoffOdds: 0.998 })).toBe('>99%')
    expect(oddsLabel({ ...base, clinchedPlayoff: false, playoffOdds: 0.002 })).toBe('<1%')
    expect(oddsLabel({ ...base, clinchedPlayoff: false, playoffOdds: null })).toBe('—')
  })

  it('outlook text combines the tag and the next goal', () => {
    expect(outlookText(base)).toBe('Clinched playoff spot · Clinches bye with 1 more win')
    expect(outlookText({ ...base, status: 'alive', clinchedPlayoff: false, winsToClinch: 1, playoffOdds: 0.9 })).toBe('Clinches with 1 more win')
    expect(outlookText({ ...base, status: 'eliminated', clinchedPlayoff: false, eliminated: true })).toBe('Eliminated')
  })

  it('formats game dates and times without timezone drift', () => {
    expect(fmtGameDate('2026-09-12')).toBe('Sat, Sep 12')
    expect(fmtGameDate('2026-09-20')).toBe('Sun, Sep 20')
    expect(fmtGameDate('garbage')).toBe('garbage')
    expect(fmtGameTime('14:00')).toBe('2:00 PM')
    expect(fmtGameTime('00:30')).toBe('12:30 AM')
    expect(fmtGameTime('12:05')).toBe('12:05 PM')
    expect(fmtGameTime(undefined)).toBe('')
    expect(fmtGameWhen({ date: '2026-09-12', time: '14:00' })).toBe('Sat, Sep 12 · 2:00 PM')
    expect(fmtGameWhen({ date: '2026-09-12' })).toBe('Sat, Sep 12')
  })

  it('formats seed ranges', () => {
    expect(fmtSeedRange(base)).toBe('1–3')
    expect(fmtSeedRange({ ...base, bestSeed: 4, worstSeed: 4 })).toBe('4')
  })
})
