/**
 * AwardsScene — season awards night.
 *
 *   Board:     every award as a card; sealed ("?") until revealed, then the
 *              winner's name + team logo + votes.
 *   Spotlight: one award blown up centre-screen. Before its reveal it reads
 *              "And the winner is…"; on reveal the winner lands with a gold
 *              burst, then 2nd/3rd (ties share a place) fade in beneath.
 *
 * Read-only like every scene: driven by /overlay/awardsReveal, which the
 * controller fills (results only for revealed awards).
 */
import { motion, AnimatePresence } from 'framer-motion'
import type { AwardRevealCard, AwardRevealResult, AwardRevealRow, AwardsRevealState, TeamsMap } from '../types'

const FONT = 'var(--font-score)'
const GOLD = '#fbbf24'
const GOLD_DEEP = '#b45309'

const COLS = 4
const CARD_W = 410
const CARD_H = 300
const GAP = 28

function ordinalPlace(rank: number, tied: boolean) {
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'
  return `${tied ? 'T-' : ''}${rank}${suffix}`
}

function TeamLogo({ teams, teamId, size }: { teams: TeamsMap; teamId: string; size: number }) {
  const team = teams[teamId]
  const color = team?.primaryColor ?? '#555'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `${color}40`, border: `2px solid ${color}aa`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {team?.logoUrl
        ? <img src={team.logoUrl} alt="" style={{ width: size * 0.7, height: size * 0.7, objectFit: 'contain' }} />
        : <span style={{ fontFamily: FONT, fontSize: size * 0.32, fontWeight: 900, color: '#fff' }}>{team?.shortName?.slice(0, 2) ?? ''}</span>}
    </div>
  )
}

function Badge({ card, size }: { card: AwardRevealCard; size: number }) {
  return card.icon
    ? <img src={card.icon} alt="" style={{ width: size, height: size, objectFit: 'contain', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.5))' }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: `radial-gradient(circle, ${GOLD}, ${GOLD_DEEP})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5 }}>🏆</div>
}

function votesLabel(n: number) {
  return `${n} vote${n === 1 ? '' : 's'}`
}

// ── Board ───────────────────────────────────────────────────────────────────

function BoardCard({ card, result, teams, index }: { card: AwardRevealCard; result?: AwardRevealResult; teams: TeamsMap; index: number }) {
  const winners = result?.top.filter(r => r.rank === 1) ?? []
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.06, duration: 0.4, ease: 'easeOut' }}
      style={{
        width: CARD_W, height: CARD_H, borderRadius: 20, position: 'relative', overflow: 'hidden',
        background: result ? 'linear-gradient(170deg, rgba(251,191,36,0.16), rgba(10,14,26,0.92) 55%)' : 'linear-gradient(170deg, rgba(255,255,255,0.07), rgba(10,14,26,0.9) 60%)',
        border: `2px solid ${result ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.12)'}`,
        boxShadow: result ? '0 0 40px rgba(251,191,36,0.18)' : '0 10px 30px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 18px 0',
      }}
    >
      <Badge card={card} size={92} />
      <div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 10, textAlign: 'center', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
        {card.name}
      </div>
      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AnimatePresence mode="wait">
          {result ? (
            <motion.div
              key="winner"
              initial={{ rotateX: 90, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}
            >
              {winners.map(w => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: '100%' }}>
                  <TeamLogo teams={teams} teamId={w.teamId} size={44} />
                  <span style={{ fontFamily: FONT, fontSize: winners.length > 1 ? 28 : 38, fontWeight: 900, color: GOLD, textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.name}
                  </span>
                </div>
              ))}
              {winners[0] && (
                <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  {votesLabel(winners[0].votes)}
                </span>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="sealed"
              exit={{ rotateX: -90, opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                width: 120, height: 84, borderRadius: 14,
                background: 'repeating-linear-gradient(135deg, rgba(251,191,36,0.10) 0 10px, rgba(251,191,36,0.04) 10px 20px)',
                border: '2px dashed rgba(251,191,36,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <motion.span
                animate={{ opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: index * 0.3 }}
                style={{ fontFamily: FONT, fontSize: 56, fontWeight: 900, color: GOLD, lineHeight: 1 }}
              >
                ?
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ── Spotlight ───────────────────────────────────────────────────────────────

function Burst() {
  const pieces = Array.from({ length: 36 }, (_, i) => i)
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
      <motion.div
        initial={{ scale: 0, opacity: 0.9 }}
        animate={{ scale: 6, opacity: 0 }}
        transition={{ duration: 1.1, ease: 'easeOut' }}
        style={{ position: 'absolute', left: -80, top: -80, width: 160, height: 160, borderRadius: '50%', border: `6px solid ${GOLD}` }}
      />
      {pieces.map(i => {
        const angle = (i / pieces.length) * Math.PI * 2
        const dist = 380 + (i % 5) * 70
        return (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.6, opacity: 0, scale: 0.4, rotate: i * 40 }}
            transition={{ duration: 1.4 + (i % 4) * 0.15, ease: 'easeOut' }}
            style={{ position: 'absolute', width: i % 3 ? 14 : 22, height: i % 3 ? 6 : 10, borderRadius: 2, background: i % 2 ? GOLD : '#fff7d6' }}
          />
        )
      })}
    </div>
  )
}

function RunnerUp({ row, tied, teams, index }: { row: AwardRevealRow; tied: boolean; teams: TeamsMap; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.3 + index * 0.25, duration: 0.4 }}
      style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 22px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.5)', width: 74, letterSpacing: '0.06em' }}>
        {ordinalPlace(row.rank, tied).toUpperCase()}
      </span>
      <TeamLogo teams={teams} teamId={row.teamId} size={44} />
      <span style={{ fontFamily: FONT, fontSize: 34, fontWeight: 800, color: '#fff', textTransform: 'uppercase', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.name}
      </span>
      <span style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {votesLabel(row.votes)}
      </span>
    </motion.div>
  )
}

function Spotlight({ card, result, teams }: { card: AwardRevealCard; result?: AwardRevealResult; teams: TeamsMap }) {
  const winners = result?.top.filter(r => r.rank === 1) ?? []
  const others = result?.top.filter(r => r.rank > 1) ?? []
  const tiedAt = (rank: number) => (result?.top.filter(r => r.rank === rank).length ?? 0) > 1

  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{ background: 'radial-gradient(ellipse at center, rgba(24,28,46,0.985), rgba(4,6,12,0.995))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <motion.div
        initial={{ scale: 0.6, y: 60, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 180 }}
        style={{ width: 1240, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
      >
        <motion.div initial={{ rotate: -25, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 120, delay: 0.1 }}>
          <Badge card={card} size={200} />
        </motion.div>
        <div style={{ fontFamily: FONT, fontSize: 84, fontWeight: 900, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, marginTop: 18, textAlign: 'center', textShadow: '0 4px 30px rgba(251,191,36,0.35)' }}>
          {card.name}
        </div>
        {card.description && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 26, color: 'rgba(255,255,255,0.6)', marginTop: 12, textAlign: 'center', maxWidth: 1000 }}>
            {card.description}
          </div>
        )}

        <div style={{ marginTop: 40, minHeight: 380, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
          <AnimatePresence mode="wait">
            {!result ? (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 70 }}
              >
                <span style={{ fontFamily: FONT, fontSize: 64, fontWeight: 900, color: '#fff', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                  And the winner is
                </span>
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    animate={{ opacity: [0.15, 1, 0.15] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
                    style={{ fontFamily: FONT, fontSize: 64, fontWeight: 900, color: GOLD }}
                  >
                    .
                  </motion.span>
                ))}
              </motion.div>
            ) : (
              <motion.div key="revealed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <Burst />
                {winners.map((w, i) => (
                  <motion.div
                    key={w.id}
                    initial={{ scale: 2.2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 160, delay: i * 0.15 }}
                    style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 8 }}
                  >
                    <TeamLogo teams={teams} teamId={w.teamId} size={winners.length > 1 ? 90 : 120} />
                    <span style={{ fontFamily: FONT, fontSize: winners.length > 1 ? 84 : 120, fontWeight: 900, color: '#fff', textTransform: 'uppercase', lineHeight: 1, letterSpacing: '0.02em', textShadow: `0 0 40px rgba(251,191,36,0.55), 0 6px 0 ${GOLD_DEEP}` }}>
                      {w.name}
                    </span>
                  </motion.div>
                ))}
                {winners[0] && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    style={{ fontFamily: FONT, fontSize: 32, fontWeight: 800, color: GOLD, letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: 6 }}
                  >
                    {winners.length > 1 ? 'Co-winners · ' : ''}{votesLabel(winners[0].votes)} of {result.counted}
                  </motion.div>
                )}
                {others.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 820, marginTop: 30 }}>
                    {others.map((r, i) => <RunnerUp key={r.id} row={r} tied={tiedAt(r.rank)} teams={teams} index={i} />)}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Scene ───────────────────────────────────────────────────────────────────

export function AwardsScene({ state, teams, leagueLogo }: { state: AwardsRevealState; teams: TeamsMap; leagueLogo?: string }) {
  const cards = Object.entries(state.board).sort((a, b) => a[1].order - b[1].order || a[1].name.localeCompare(b[1].name))
  const rows = Math.max(1, Math.ceil(cards.length / COLS))
  const gridW = COLS * CARD_W + (COLS - 1) * GAP
  const spotCard = state.spotlight ? state.board[state.spotlight] : undefined

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 0%, #2a2410 0%, #0b1020 45%, #05070d 100%)' }}>
      {/* Header */}
      <div style={{ position: 'absolute', top: 50, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        {leagueLogo && <img src={leagueLogo} alt="" style={{ width: 96, height: 96, objectFit: 'contain' }} />}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: leagueLogo ? 'flex-start' : 'center' }}>
          <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, color: GOLD, letterSpacing: '0.4em', textTransform: 'uppercase' }}>Brookside Wiffle Ball</span>
          <span style={{ fontFamily: FONT, fontSize: 76, fontWeight: 900, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>
            {state.title || 'Season Awards'}
          </span>
        </div>
      </div>

      {/* Board — kept above y≈850 so the booth ID card has the bottom-right */}
      <div style={{
        position: 'absolute', top: 210, left: (1920 - gridW) / 2, width: gridW,
        display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${CARD_W}px)`, gridTemplateRows: `repeat(${rows}, ${CARD_H}px)`, gap: GAP,
      }}>
        {cards.map(([id, card], i) => <BoardCard key={id} card={card} result={state.results[id]} teams={teams} index={i} />)}
      </div>

      <AnimatePresence>
        {spotCard && state.spotlight && (
          <Spotlight key={state.spotlight} card={spotCard} result={state.results[state.spotlight]} teams={teams} />
        )}
      </AnimatePresence>
    </div>
  )
}
