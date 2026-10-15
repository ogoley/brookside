/**
 * BracketScene — full-screen live playoff bracket (fixed bracket, no reseed).
 *
 *   QF 4v5 ──► SF 1 v (4/5) ─┐
 *                            ├──► FINAL ──► champion
 *   QF 3v6 ──► SF 2 v (3/6) ─┘
 *
 * Pure render of the resolved bracket: winners light their connector gold,
 * losers dim, the round being played glows. Read-only like every scene.
 */
import { motion } from 'framer-motion'
import type { TeamsMap } from '../types'
import { ROUND_LABEL, slotWhen, type ResolvedBracket, type ResolvedSlot, type BracketTeam } from '../postseason/bracket'

const FONT = 'var(--font-score)'
const GOLD = '#fbbf24'
const LINE = 'rgba(255,255,255,0.16)'

const CARD_W = 520
const HEAD_H = 36
const ROW_H = 68
const CARD_H = HEAD_H + ROW_H * 2
const FINAL_W = 540

// Top-left corners on the 1920×1080 canvas. SF cards sit so their lower row
// (the QF winner) lines up with the centre of the feeding QF card.
const POS = {
  qf45: { x: 60, y: 250 },
  qf36: { x: 60, y: 660 },
  sf1: { x: 660, y: 216 },
  sf2: { x: 660, y: 626 },
  final: { x: 1320, y: 421 },
} as const

function Logo({ teams, teamId, size }: { teams: TeamsMap; teamId: string; size: number }) {
  const team = teams[teamId]
  const color = team?.primaryColor ?? '#555'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `${color}33`, border: `2px solid ${color}88`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {team?.logoUrl
        ? <img src={team.logoUrl} alt="" style={{ width: size * 0.68, height: size * 0.68, objectFit: 'contain' }} />
        : <span style={{ fontFamily: FONT, fontSize: size * 0.3, fontWeight: 900, color }}>{team?.shortName?.slice(0, 2) ?? '?'}</span>}
    </div>
  )
}

function TeamRow({ teams, side, score, slot, placeholder, big }: {
  teams: TeamsMap
  side: BracketTeam | null
  score: number | null
  slot: ResolvedSlot
  placeholder: string
  big?: boolean
}) {
  const team = side ? teams[side.teamId] : undefined
  const decided = !!slot.winner
  const won = decided && side?.teamId === slot.winner?.teamId
  const lost = decided && !won
  return (
    <div style={{
      height: ROW_H, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px 0 0',
      background: won ? 'rgba(251,191,36,0.10)' : 'transparent',
      opacity: lost ? 0.38 : 1,
      borderLeft: `6px solid ${team?.primaryColor ?? 'rgba(255,255,255,0.08)'}`,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 24, fontWeight: 900, color: GOLD, width: 34, textAlign: 'right', flexShrink: 0 }}>
        {side?.seed ?? ''}
      </span>
      {side ? <Logo teams={teams} teamId={side.teamId} size={46} /> : <div style={{ width: 46, height: 46, borderRadius: '50%', border: `2px dashed ${LINE}`, flexShrink: 0 }} />}
      <span style={{
        flex: 1, minWidth: 0, fontFamily: FONT, fontSize: big ? 32 : 28, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: side ? '#fff' : 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {team?.name ?? (side?.teamId ?? placeholder)}
      </span>
      {score !== null && (
        <span style={{ fontFamily: FONT, fontSize: 36, fontWeight: 900, color: won ? GOLD : '#fff', minWidth: 40, textAlign: 'right' }}>{score}</span>
      )}
      {won && score === null && <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 900, color: GOLD }}>W</span>}
    </div>
  )
}

function scoreFor(slot: ResolvedSlot, side: BracketTeam | null): number | null {
  const g = slot.game
  if (!g || !side) return null
  if (g.homeTeamId === side.teamId) return g.homeScore ?? 0
  if (g.awayTeamId === side.teamId) return g.awayScore ?? 0
  return null
}

function MatchCard({ teams, slot, current, delay, width = CARD_W, label, placeholders }: {
  teams: TeamsMap
  slot: ResolvedSlot
  current: boolean
  delay: number
  width?: number
  label: string
  placeholders: [string, string]
}) {
  const pos = POS[slot.id]
  const g = slot.game
  const status = slot.status === 'final' ? 'Final'
    : slot.status === 'live' && g ? `● Live · ${g.isTopInning ? '▲' : '▼'}${g.inning}`
    : slotWhen(slot.config)
  return (
    <motion.div
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', damping: 22, stiffness: 200, delay }}
      style={{
        position: 'absolute', left: pos.x, top: pos.y, width, height: CARD_H,
        background: 'rgba(14,20,34,0.96)', borderRadius: 14, overflow: 'hidden',
        border: `2px solid ${current ? GOLD : 'rgba(255,255,255,0.10)'}`,
        boxShadow: current ? '0 0 36px rgba(251,191,36,0.25)' : '0 10px 30px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{
        height: HEAD_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
        background: current ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.05)',
        fontFamily: FONT, fontSize: 15, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap', gap: 12,
      }}>
        <span style={{ color: current ? GOLD : 'rgba(255,255,255,0.55)', flexShrink: 0 }}>{label}</span>
        <span style={{ color: slot.status === 'live' ? '#4ade80' : slot.status === 'final' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</span>
      </div>
      <TeamRow teams={teams} side={slot.high} score={scoreFor(slot, slot.high)} slot={slot} placeholder={placeholders[0]} big={width > CARD_W} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
      <TeamRow teams={teams} side={slot.low} score={scoreFor(slot, slot.low)} slot={slot} placeholder={placeholders[1]} big={width > CARD_W} />
    </motion.div>
  )
}

/** Connector path; gold when the team travelling along it has advanced. */
function Wire({ d, lit, delay }: { d: string; lit: boolean; delay: number }) {
  return (
    <motion.path
      d={d} fill="none" stroke={lit ? GOLD : LINE} strokeWidth={lit ? 4 : 3} strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay, duration: 0.6, ease: 'easeOut' }}
    />
  )
}

export function BracketScene({ teams, bracket }: { teams: TeamsMap; bracket: ResolvedBracket | null }) {
  if (!bracket) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#080d18' }}>
        <span style={{ fontFamily: FONT, fontSize: 28, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Bracket not set up yet
        </span>
      </div>
    )
  }
  const s = bracket.slots
  const cur = (slot: ResolvedSlot) => !bracket.champion && slot.round === bracket.currentRound && !slot.winner
  const champ = bracket.champion ? teams[bracket.champion.teamId] : undefined

  // Connector geometry (see POS)
  const qfOut = (y: number) => y + HEAD_H + ROW_H            // QF card vertical centre
  const sfMid = (y: number) => y + HEAD_H + ROW_H            // SF card vertical centre
  const fHigh = POS.final.y + HEAD_H + ROW_H / 2
  const fLow = POS.final.y + HEAD_H + ROW_H * 1.5
  const elbowX = 1250
  const right = POS.qf45.x + CARD_W

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#080d18' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 1100px 520px at 72% 50%, rgba(251,191,36,0.07), transparent 70%)' }} />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', damping: 24, stiffness: 220 }}
        style={{ position: 'absolute', left: 60, right: 60, top: 52, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}
      >
        <div>
          <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: GOLD, letterSpacing: '0.3em', textTransform: 'uppercase' }}>
            {bracket.season} Brookside Wiffle Ball
          </div>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 900, color: '#fff', letterSpacing: '0.08em', lineHeight: 1, textTransform: 'uppercase' }}>
            Playoff Bracket
          </div>
        </div>
        <div style={{
          fontFamily: FONT, fontSize: 26, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: '#111', background: GOLD, borderRadius: 10, padding: '10px 22px',
        }}>
          {bracket.champion ? 'Champions crowned' : ROUND_LABEL[bracket.currentRound]}
        </div>
      </motion.div>

      {/* Column labels */}
      {([['Quarterfinals', POS.qf45.x, CARD_W], ['Semifinals', POS.sf1.x, CARD_W], ['Championship', POS.final.x, FINAL_W]] as const).map(([t, x, w], i) => (
        <motion.div key={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 + i * 0.05 }}
          style={{ position: 'absolute', left: x, width: w, top: 176, textAlign: 'center', fontFamily: FONT, fontSize: 14, fontWeight: 800, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
          {t}
        </motion.div>
      ))}

      {/* Wires */}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Wire d={`M ${right} ${qfOut(POS.qf45.y)} H ${POS.sf1.x}`} lit={!!s.qf45.winner} delay={0.5} />
        <Wire d={`M ${right} ${qfOut(POS.qf36.y)} H ${POS.sf2.x}`} lit={!!s.qf36.winner} delay={0.55} />
        <Wire d={`M ${POS.sf1.x + CARD_W} ${sfMid(POS.sf1.y)} H ${elbowX} V ${fHigh} H ${POS.final.x}`} lit={!!s.sf1.winner} delay={0.7} />
        <Wire d={`M ${POS.sf2.x + CARD_W} ${sfMid(POS.sf2.y)} H ${elbowX} V ${fLow} H ${POS.final.x}`} lit={!!s.sf2.winner} delay={0.75} />
      </svg>

      <MatchCard teams={teams} slot={s.qf45} current={cur(s.qf45)} delay={0.15} label="QF · 4 v 5" placeholders={['4 seed', '5 seed']} />
      <MatchCard teams={teams} slot={s.qf36} current={cur(s.qf36)} delay={0.2} label="QF · 3 v 6" placeholders={['3 seed', '6 seed']} />
      <MatchCard teams={teams} slot={s.sf1} current={cur(s.sf1)} delay={0.3} label="SF · 1 v 4/5" placeholders={['1 seed', 'Winner 4 / 5']} />
      <MatchCard teams={teams} slot={s.sf2} current={cur(s.sf2)} delay={0.35} label="SF · 2 v 3/6" placeholders={['2 seed', 'Winner 3 / 6']} />
      <MatchCard teams={teams} slot={s.final} current={cur(s.final)} delay={0.45} width={FINAL_W} label="Championship" placeholders={['Semifinal winner', 'Semifinal winner']} />

      {/* Champion / trophy block above the final */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', damping: 16, stiffness: 200, delay: 0.6 }}
        style={{ position: 'absolute', left: POS.final.x, width: FINAL_W, top: 236, height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <span style={{ fontSize: 64, lineHeight: 1, filter: champ ? 'drop-shadow(0 0 18px rgba(251,191,36,0.6))' : 'grayscale(0.6) opacity(0.5)' }}>🏆</span>
        {champ ? (
          <>
            <span style={{ fontFamily: FONT, fontSize: 40, fontWeight: 900, color: GOLD, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1, textAlign: 'center' }}>{champ.name}</span>
            <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.3em', textTransform: 'uppercase' }}>{bracket.season} Champions</span>
          </>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            {slotWhen(s.final.config) || 'Championship'}
          </span>
        )}
      </motion.div>

      {/* Format footnote */}
      <div style={{ position: 'absolute', left: 60, right: 60, bottom: 44, fontFamily: FONT, fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        Single elimination · higher seed hosts · 1 and 2 seeds earn a first-round bye · no reseeding
      </div>
    </div>
  )
}
