// Display helpers shared by the overlay scene, the ticker and the public
// stats page. Pure; tested alongside the engine.
import { outlookLine, statusTag, type TeamOutlook, type TeamLine, type ScheduledGame } from './engine'

export function fmtPct(l: TeamLine): string {
  if (l.gp === 0) return '.000'
  return ((l.w + 0.5 * l.t) / l.gp).toFixed(3).replace(/^0/, '')
}

export function fmtRecord(l: TeamLine): string {
  return l.t > 0 ? `${l.w}-${l.l}-${l.t}` : `${l.w}-${l.l}`
}

export function fmtDiff(l: TeamLine): string {
  const d = l.rf - l.ra
  return d > 0 ? `+${d}` : String(d)
}

/** "IN" / "OUT" / "97%" — rounded, never shows 100% or 0% unless decided. */
export function oddsLabel(t: TeamOutlook): string {
  if (t.clinchedPlayoff) return 'IN'
  if (t.eliminated) return 'OUT'
  if (t.playoffOdds == null) return '—'
  const pct = t.playoffOdds * 100
  if (pct >= 99.5) return '>99%'
  if (pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}

/** The one line worth saying about a team right now (tag beats outlook). */
export function outlookText(t: TeamOutlook): string {
  const tag = statusTag(t)
  const line = outlookLine(t)
  if (tag && line) return `${tag.text} · ${line}`
  return tag?.text ?? line ?? 'In the hunt'
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-12" → "Sat, Sep 12" (date-only math, no timezone drift). */
export function fmtGameDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "14:00" → "2:00 PM"; "" → "" */
export function fmtGameTime(time: string | undefined): string {
  if (!time) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!m) return time
  const h = Number(m[1]); const min = m[2]
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${suffix}`
}

/** "Sat, Sep 12 · 2:00 PM" — a postponed game reads "Makeup · date TBD" */
export function fmtGameWhen(g: Pick<ScheduledGame, 'date' | 'time'> & { status?: ScheduledGame['status'] }): string {
  if (g.status === 'postponed') return 'Makeup · date TBD'
  const t = fmtGameTime(g.time)
  return t ? `${fmtGameDate(g.date)} · ${t}` : fmtGameDate(g.date)
}

/** Seed range as "1-2" or "4" when locked. */
export function fmtSeedRange(t: TeamOutlook): string {
  return t.bestSeed === t.worstSeed ? String(t.bestSeed) : `${t.bestSeed}–${t.worstSeed}`
}
