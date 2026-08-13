import { useState, useEffect, useMemo, useRef } from 'react'
import { Reorder } from 'framer-motion'
import { ref, set, update, remove } from 'firebase/database'
import { db } from '../firebase'
import { useDerbyBroadcast } from '../hooks/useDerbyBroadcast'
import { useDerbyContestants, type DerbyContestant } from '../hooks/useDerbyContestants'
import {
  ROUND_KEY, ROUND_LABEL, ADVANCE_COUNT,
  roundScore, derbyTotal, participantsForRound, advancersFromRound,
} from '../derby/logic'
import type { DerbyBroadcastView, DerbyRoundNum } from '../types'

// Same front-end gate as the /derby admin footer — the /derby path is
// intentionally open at the rules layer, so this is a convenience lock only.
const ADMIN_PASSWORD = 'dingers'

const ROUNDS: DerbyRoundNum[] = [1, 2, 3]

const VIEWS: { key: DerbyBroadcastView; label: string; icon: string }[] = [
  { key: 'hidden', label: 'Hidden', icon: '🚫' },
  { key: 'player', label: 'Player Card', icon: '👤' },
  { key: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { key: 'upNext', label: 'Up Next', icon: '📋' },
]

const bcastRef = (path?: string) => ref(db, path ? `derby/broadcast/${path}` : 'derby/broadcast')

export function DerbyControllerRoute() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('derbyAdmin') === '1')

  useEffect(() => { document.title = 'Derby Control' }, [])

  if (!unlocked) {
    return <GateScreen onUnlock={() => { sessionStorage.setItem('derbyAdmin', '1'); setUnlocked(true) }} />
  }
  return <ControlPanel />
}

function ControlPanel() {
  const { broadcast, loading } = useDerbyBroadcast()
  const { contestants, contestantById, teams } = useDerbyContestants()

  const eligibleIds = useMemo(() => contestants.map(c => c.id), [contestants])
  const { view, activeRound, leaderboardRound, scores, battingOrder, featuredPlayerId } = broadcast
  const roundKey = ROUND_KEY[activeRound]

  // Order may reference players who've since been toggled OUT — keep the raw
  // array for writes, but only work with resolvable entries in the UI
  const order = useMemo(
    () => battingOrder.filter(id => contestantById.has(id)),
    [battingOrder, contestantById],
  )
  const currentIndex = Math.min(broadcast.currentBatterIndex, Math.max(0, order.length - 1))
  const currentBatterId = order[currentIndex]
  const currentBatter = currentBatterId ? contestantById.get(currentBatterId) : undefined
  const currentScore = currentBatterId ? roundScore(scores, currentBatterId, activeRound) : undefined

  const participants = useMemo(
    () => participantsForRound(eligibleIds, scores, activeRound),
    [eligibleIds, scores, activeRound],
  )
  const advancers = useMemo(
    () => advancersFromRound(participants, scores, activeRound),
    [participants, scores, activeRound],
  )

  // ── Writes ────────────────────────────────────────────────────────────
  const setView = (v: DerbyBroadcastView) => set(bcastRef('view'), v)
  const setLeaderboardRound = (r: DerbyRoundNum) => set(bcastRef('leaderboardRound'), r)
  const setFeatured = (id: string | null) => set(bcastRef('featuredPlayerId'), id)

  const setActiveRound = (r: DerbyRoundNum) =>
    update(bcastRef(), { activeRound: r, leaderboardRound: r })

  const setScore = (playerId: string, round: DerbyRoundNum, n: number | null) => {
    const scoreRef = ref(db, `derby/broadcast/scores/${playerId}/${ROUND_KEY[round]}`)
    return n === null ? remove(scoreRef) : set(scoreRef, n)
  }

  const bumpCurrent = (delta: number) => {
    if (!currentBatterId) return
    setScore(currentBatterId, activeRound, Math.max(0, (currentScore ?? 0) + delta))
  }

  // Greatest → least: round 1 seeds by season HR, later rounds by prior-round score
  const buildSeededOrder = () => {
    const prevRound = activeRound > 1 ? (activeRound - 1) as DerbyRoundNum : null
    return [...participants].sort((a, b) => {
      const aSeed = prevRound ? roundScore(scores, a, prevRound) ?? 0 : contestantById.get(a)?.seasonHr ?? 0
      const bSeed = prevRound ? roundScore(scores, b, prevRound) ?? 0 : contestantById.get(b)?.seasonHr ?? 0
      return bSeed - aSeed
        || (contestantById.get(b)?.seasonHr ?? 0) - (contestantById.get(a)?.seasonHr ?? 0)
        || (contestantById.get(a)?.name ?? '').localeCompare(contestantById.get(b)?.name ?? '')
    })
  }

  const loadOrder = () => {
    if (participants.length === 0) return
    if (order.length > 0 && !window.confirm(`Replace the batting order with the ${participants.length} hitters of ${ROUND_LABEL[activeRound]}? (Most home runs hits first — drag rows after to fine-tune.)`)) return
    const seeded = buildSeededOrder()
    update(bcastRef(), { battingOrder: seeded, currentBatterIndex: 0, featuredPlayerId: seeded[0] ?? null })
  }

  // Auto-fill: if the order is empty once everything has loaded, seed it with
  // every hitter of the active round so the producer only dismisses/drags.
  // Guarded per-session so deliberately emptying the list doesn't refill it.
  const autoSeededRef = useRef(false)
  useEffect(() => {
    if (loading || autoSeededRef.current) return
    if (order.length > 0) { autoSeededRef.current = true; return }
    if (participants.length === 0) return
    autoSeededRef.current = true
    const seeded = buildSeededOrder()
    const updates: Record<string, unknown> = { battingOrder: seeded, currentBatterIndex: 0 }
    if (!featuredPlayerId) updates['featuredPlayerId'] = seeded[0] ?? null
    update(bcastRef(), updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, order.length, participants.length])

  const goToBatter = (i: number) => {
    const clamped = Math.max(0, Math.min(i, order.length - 1))
    update(bcastRef(), { currentBatterIndex: clamped, featuredPlayerId: order[clamped] ?? null })
  }

  const nextBatter = () => {
    if (order.length === 0) return
    const updates: Record<string, unknown> = {}
    // The outgoing batter is done — a missing score becomes a real 0
    if (currentBatterId && currentScore === undefined) {
      updates[`scores/${currentBatterId}/${roundKey}`] = 0
    }
    const newIdx = Math.min(currentIndex + 1, order.length - 1)
    updates['currentBatterIndex'] = newIdx
    updates['featuredPlayerId'] = order[newIdx] ?? null
    update(bcastRef(), updates)
  }

  // ── Drag-and-drop order: local mirror while dragging, commit on drop ──
  const [localOrder, setLocalOrder] = useState<string[]>(order)
  const localOrderRef = useRef(localOrder)
  localOrderRef.current = localOrder
  const draggingRef = useRef(false)
  useEffect(() => {
    if (!draggingRef.current) setLocalOrder(order)
  }, [order])

  const commitOrder = (next: string[]) => {
    // currentBatterIndex follows the current batter's new position
    const curId = order[currentIndex]
    const idx = curId ? Math.max(0, next.indexOf(curId)) : 0
    update(bcastRef(), { battingOrder: next, currentBatterIndex: idx })
  }

  const selectBatter = (id: string) => {
    const i = order.indexOf(id)
    if (i >= 0) update(bcastRef(), { currentBatterIndex: i, featuredPlayerId: id })
  }

  const removeFromOrder = (id: string) => {
    const next = order.filter(x => x !== id)
    const curId = order[currentIndex]
    const idx = curId && curId !== id
      ? Math.max(0, next.indexOf(curId))
      : Math.max(0, Math.min(currentIndex, next.length - 1))
    update(bcastRef(), { battingOrder: next, currentBatterIndex: idx })
  }

  const addToOrder = (id: string) => {
    if (!id || order.includes(id)) return
    set(bcastRef('battingOrder'), [...order, id])
  }

  // ── Derived display bits ──────────────────────────────────────────────
  const notInOrder = contestants.filter(c => !order.includes(c.id))
  const featured = featuredPlayerId ? contestantById.get(featuredPlayerId) : undefined
  const advanceCount = ADVANCE_COUNT[activeRound]

  const [scoresOpen, setScoresOpen] = useState(false)
  const [addPick, setAddPick] = useState('')

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'var(--font-ui)', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 12px 48px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
          <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            🎥 Derby Control
          </h1>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            drives <code style={{ color: '#94a3b8' }}>/derby-overlay</code>
          </span>
        </div>

        {/* ── Broadcast view ── */}
        <Section title="Broadcast view" accent="#fbbf24">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {VIEWS.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  ...bigBtn,
                  background: view === v.key ? '#fbbf24' : '#1e293b',
                  color: view === v.key ? '#0f172a' : '#cbd5e1',
                  border: `2px solid ${view === v.key ? '#fbbf24' : '#334155'}`,
                }}
              >
                <span style={{ fontSize: 18, display: 'block' }}>{v.icon}</span>
                {v.label}
              </button>
            ))}
          </div>
          {view === 'leaderboard' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={smallLabel}>Showing round</span>
              {ROUNDS.map(r => (
                <Chip key={r} active={leaderboardRound === r} onClick={() => setLeaderboardRound(r)}>
                  {ROUND_LABEL[r]}
                </Chip>
              ))}
            </div>
          )}
          {view === 'player' && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8' }}>
              Showing: <strong style={{ color: '#fbbf24' }}>{featured?.name ?? 'nobody — pick a player below'}</strong>
            </div>
          )}
        </Section>

        {/* ── Round ── */}
        <Section title="Derby round" accent="#60a5fa">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {ROUNDS.map(r => (
              <Chip key={r} active={activeRound === r} onClick={() => setActiveRound(r)} big>
                {ROUND_LABEL[r]}
              </Chip>
            ))}
            <button onClick={loadOrder} disabled={participants.length === 0} style={{
              ...smallBtn, marginLeft: 'auto',
              background: participants.length === 0 ? '#334155' : '#2563eb',
              color: '#ffffff', border: 'none',
              cursor: participants.length === 0 ? 'not-allowed' : 'pointer',
            }}>
              Load {ROUND_LABEL[activeRound]} order ({participants.length})
            </button>
          </div>
          {advanceCount !== null && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
              Top {advanceCount} advance (ties move up).{' '}
              {advancers.length > 0 && (
                <>
                  Currently in: <span style={{ color: '#4ade80', fontWeight: 600 }}>
                    {advancers.map(id => contestantById.get(id)?.name ?? '?').join(', ')}
                  </span>
                </>
              )}
            </div>
          )}
        </Section>

        {/* ── Now batting ── */}
        <Section title="Now batting" accent="#4ade80">
          {!currentBatter ? (
            <div style={{ fontSize: 14, color: '#64748b', padding: '8px 0' }}>
              No batting order yet — load the round order or add players below.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontFamily: 'var(--font-score)', fontSize: 30, fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                    {currentBatter.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {teams[currentBatter.teamId]?.shortName ?? ''} · {currentBatter.seasonHr} season HR
                    · batter {currentIndex + 1} of {order.length}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {ROUND_LABEL[activeRound]} HR
                  </div>
                  <div style={{ fontFamily: 'var(--font-score)', fontSize: 52, fontWeight: 900, color: currentScore === undefined ? '#475569' : '#fbbf24', lineHeight: 1 }}>
                    {currentScore ?? '–'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => bumpCurrent(1)} style={{ ...bigBtn, flex: '2 1 140px', fontSize: 18, background: '#16a34a', color: '#ffffff', border: 'none' }}>
                  +1 HOME RUN 💣
                </button>
                <button onClick={() => bumpCurrent(-1)} style={{ ...bigBtn, flex: '1 1 70px', background: '#1e293b', color: '#cbd5e1', border: '2px solid #334155' }}>
                  −1
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => goToBatter(currentIndex - 1)} disabled={currentIndex === 0} style={{ ...smallBtn, flex: 1, background: '#1e293b', color: currentIndex === 0 ? '#475569' : '#cbd5e1', border: '1px solid #334155' }}>
                  ◀ Prev batter
                </button>
                <button onClick={nextBatter} disabled={currentIndex >= order.length - 1} style={{ ...smallBtn, flex: 2, background: currentIndex >= order.length - 1 ? '#334155' : '#2563eb', color: '#ffffff', border: 'none', fontWeight: 800 }}>
                  Done — next batter ▶
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                “Next batter” locks in the current score (blank becomes 0) and features the next hitter.
              </div>
            </>
          )}
        </Section>

        {/* ── Batting order ── */}
        <Section title={`Batting order — ${ROUND_LABEL[activeRound]}`} accent="#c084fc">
          {localOrder.length === 0 ? (
            <div style={{ fontSize: 14, color: '#64748b', padding: '4px 0 8px' }}>
              The order fills itself with every eligible hitter once they load — or press “Load {ROUND_LABEL[activeRound]} order” above.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                Drag rows to reorder · double-click (or ▶) to make someone the current batter
              </div>
              <Reorder.Group
                axis="y"
                values={localOrder}
                onReorder={setLocalOrder}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, listStyle: 'none', padding: 0, margin: '0 0 10px' }}
              >
                {localOrder.map(id => {
                  const c = contestantById.get(id)
                  if (!c) return null
                  const s = roundScore(scores, id, activeRound)
                  const isCurrent = id === currentBatterId
                  const pos = localOrder.indexOf(id)
                  return (
                    <Reorder.Item
                      key={id}
                      value={id}
                      onDragStart={() => { draggingRef.current = true }}
                      onDragEnd={() => { draggingRef.current = false; commitOrder(localOrderRef.current) }}
                      onDoubleClick={() => selectBatter(id)}
                      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        background: isCurrent ? 'rgba(251,191,36,0.12)' : '#1e293b',
                        border: `1px solid ${isCurrent ? '#fbbf24' : '#334155'}`,
                        borderRadius: 8, cursor: 'grab', position: 'relative',
                        touchAction: 'none',
                      }}
                    >
                      <span style={{ color: '#475569', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⠿</span>
                      <span style={{ width: 22, textAlign: 'center', fontFamily: 'var(--font-score)', fontWeight: 800, color: isCurrent ? '#fbbf24' : '#64748b', fontSize: 14, flexShrink: 0 }}>
                        {pos + 1}
                      </span>
                      <span style={{
                        flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 14, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        userSelect: 'none',
                      }}>
                        {c.name}
                        <span style={{ color: '#64748b', fontWeight: 400, fontSize: 12 }}> · {teams[c.teamId]?.shortName ?? ''}</span>
                        {isCurrent && <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700, marginLeft: 6 }}>● NOW</span>}
                      </span>
                      <ScoreInput value={s} onCommit={n => setScore(id, activeRound, n)} />
                      <button
                        onClick={() => selectBatter(id)}
                        title="Make current batter"
                        style={{
                          ...smallBtn, padding: '4px 10px', flexShrink: 0,
                          background: isCurrent ? '#fbbf24' : '#0f172a',
                          color: isCurrent ? '#0f172a' : '#94a3b8',
                          border: `1px solid ${isCurrent ? '#fbbf24' : '#334155'}`,
                        }}
                      >
                        ▶
                      </button>
                      <button onClick={() => setFeatured(id)} title="Show on player card" style={{ ...iconBtn, color: featuredPlayerId === id ? '#fbbf24' : '#64748b' }}>👁</button>
                      <button onClick={() => removeFromOrder(id)} style={{ ...iconBtn, color: '#f87171' }}>✕</button>
                    </Reorder.Item>
                  )
                })}
              </Reorder.Group>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={addPick}
              onChange={e => setAddPick(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: 13, fontFamily: 'var(--font-ui)' }}
            >
              <option value="">Add player to order…</option>
              {notInOrder.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.seasonHr} HR)</option>
              ))}
            </select>
            <button
              onClick={() => { addToOrder(addPick); setAddPick('') }}
              disabled={!addPick}
              style={{ ...smallBtn, background: addPick ? '#2563eb' : '#334155', color: '#ffffff', border: 'none' }}
            >
              Add
            </button>
          </div>
          {contestants.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#fbbf24' }}>
              No eligible players found — players need ≥1 season HR and must be marked IN on the /derby admin grid.
            </div>
          )}
        </Section>

        {/* ── All scores ── */}
        <Section
          title={`All scores (${contestants.length} eligible)`}
          accent="#f87171"
          collapsible
          open={scoresOpen}
          onToggle={() => setScoresOpen(o => !o)}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #334155' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Player</th>
                  <th style={thStyle}>Season</th>
                  <th style={thStyle}>R1</th>
                  <th style={thStyle}>R2</th>
                  <th style={thStyle}>Final</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {contestants.map(c => (
                  <ScoreRow
                    key={c.id}
                    contestant={c}
                    scores={scores[c.id] ?? {}}
                    total={derbyTotal(scores, c.id)}
                    onCommit={(round, n) => setScore(c.id, round, n)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            Blank = hasn't hit that round. The winner's Total is the number the 50/50 pays out on.
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── All-scores table row ─────────────────────────────────────────────────────

function ScoreRow({ contestant, scores, total, onCommit }: {
  contestant: DerbyContestant
  scores: { r1?: number; r2?: number; r3?: number }
  total: number
  onCommit: (round: DerbyRoundNum, n: number | null) => void
}) {
  return (
    <tr style={{ borderBottom: '1px solid #1e293b' }}>
      <td style={{ padding: '7px 6px', fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{contestant.name}</td>
      <td style={{ padding: '7px 6px', textAlign: 'center', color: '#64748b' }}>{contestant.seasonHr}</td>
      {ROUNDS.map(r => (
        <td key={r} style={{ padding: '7px 6px', textAlign: 'center' }}>
          <ScoreInput value={scores[ROUND_KEY[r]]} onCommit={n => onCommit(r, n)} />
        </td>
      ))}
      <td style={{ padding: '7px 6px', textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 800, color: '#fbbf24' }}>
        {total}
      </td>
    </tr>
  )
}

// ── Blur-commit score input (blank = not hit yet) ────────────────────────────

function ScoreInput({ value, onCommit }: { value: number | undefined; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setDraft(value === undefined ? '' : String(value)) }, [value])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== undefined) onCommit(null)
      return
    }
    const n = parseInt(trimmed, 10)
    if (!isNaN(n) && n >= 0) {
      if (n !== value) onCommit(n)
    } else {
      setDraft(value === undefined ? '' : String(value))
    }
  }

  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      placeholder="–"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 52, padding: '5px 4px', textAlign: 'center', borderRadius: 6,
        background: '#0f172a', color: value === undefined ? '#64748b' : '#fbbf24',
        border: '1px solid #334155', fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700,
      }}
    />
  )
}

// ── Password gate ────────────────────────────────────────────────────────────

function GateScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  const check = () => {
    if (pw === ADMIN_PASSWORD) onUnlock()
    else { setError(true); setPw('') }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-ui)' }}>
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, width: '100%', maxWidth: 320, border: '1px solid #334155' }}>
        <div style={{ fontFamily: 'var(--font-score)', fontWeight: 900, fontSize: 18, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          🎥 Derby Control
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>Producer access</div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={e => { setPw(e.target.value); setError(false) }}
          onKeyDown={e => { if (e.key === 'Enter') check() }}
          placeholder="Password"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', fontSize: 14, marginBottom: 8, fontFamily: 'var(--font-ui)' }}
        />
        {error && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>Wrong password.</div>}
        <button onClick={check} style={{ ...smallBtn, width: '100%', padding: '10px 0', background: '#fbbf24', color: '#0f172a', border: 'none', fontSize: 14 }}>
          Enter
        </button>
      </div>
    </div>
  )
}

// ── Layout pieces ────────────────────────────────────────────────────────────

function Section({ title, accent, children, collapsible, open, onToggle }: {
  title: string
  accent: string
  children: React.ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 4, height: 16, background: accent, borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </span>
      {collapsible && <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 13 }}>{open ? '▾' : '▸'}</span>}
    </div>
  )
  return (
    <div style={{ background: '#16213a', borderRadius: 12, border: '1px solid #1e293b', padding: '14px 16px', marginBottom: 12 }}>
      {collapsible
        ? <button onClick={onToggle} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>{header}</button>
        : header}
      {(!collapsible || open) && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

function Chip({ active, onClick, children, big }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  big?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: big ? '8px 18px' : '5px 14px', borderRadius: 20,
        fontSize: big ? 13 : 12, fontWeight: 800,
        fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.05em',
        background: active ? '#fbbf24' : '#1e293b', color: active ? '#0f172a' : '#94a3b8',
        border: `1px solid ${active ? '#fbbf24' : '#334155'}`, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const bigBtn: React.CSSProperties = {
  padding: '10px 8px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.04em',
  cursor: 'pointer', lineHeight: 1.3,
}

const smallBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  fontFamily: 'var(--font-ui)', cursor: 'pointer',
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
  padding: '2px 4px', flexShrink: 0, lineHeight: 1,
}

const smallLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em',
}

const thStyle: React.CSSProperties = {
  padding: '6px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b',
}
