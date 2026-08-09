import { useState, useEffect, useMemo } from 'react'
import { ref, onValue, push, update, remove, set } from 'firebase/database'
import { db } from '../firebase'
import { useTeams } from '../hooks/useTeams'
import { usePlayers } from '../hooks/usePlayers'
import { useGames } from '../hooks/useGames'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { useDerby } from '../hooks/useDerby'
import type { AtBatRecord, DerbyEntry } from '../types'

// Front-end gate only — the /derby path is intentionally open at the rules
// layer. Worst case someone edits derby entries; nothing else is writable.
const ADMIN_PASSWORD = 'dingers'
const ENTRY_FEE = 10
const CHARITY_NAME = 'Valley Impact Project'
const VENMO_HANDLE = 'emvee311'
const VENMO_URL = `https://venmo.com/u/${VENMO_HANDLE}`

interface HitterOption {
  id: string
  name: string
  teamShort: string
  teamLogo: string
  hr: number
  enabled: boolean   // false = marked not present at the derby
}

export function DerbyRoute() {
  const { teams } = useTeams()
  const { players } = usePlayers()
  const { games } = useGames()
  const { config } = useLeagueConfig()
  const { derby } = useDerby()

  // ── Admin mode (front-end plain-text gate, per session) ──────────────
  const [adminMode, setAdminMode] = useState(() => sessionStorage.getItem('derbyAdmin') === '1')
  const [showPwPrompt, setShowPwPrompt] = useState(false)

  const enterAdmin = () => {
    sessionStorage.setItem('derbyAdmin', '1')
    setAdminMode(true)
    setShowPwPrompt(false)
  }
  const exitAdmin = () => {
    sessionStorage.removeItem('derbyAdmin')
    setAdminMode(false)
  }

  // ── Season HR totals (finalized stats + live in-progress games) ──────
  const liveGameIds = useMemo(
    () => games.filter(g => !g.game.finalized).map(g => g.gameId),
    [games],
  )
  const [liveHr, setLiveHr] = useState<Record<string, number>>({})

  useEffect(() => {
    if (liveGameIds.length === 0) { setLiveHr({}); return }
    const perGame: Record<string, Record<string, number>> = {}
    const unsubs = liveGameIds.map(gameId =>
      onValue(ref(db, `gameStats/${gameId}`), snap => {
        const counts: Record<string, number> = {}
        if (snap.exists()) {
          for (const ab of Object.values(snap.val() as Record<string, AtBatRecord>)) {
            if (!ab.isSub && ab.result === 'home_run') {
              counts[ab.batterId] = (counts[ab.batterId] ?? 0) + 1
            }
          }
        }
        perGame[gameId] = counts
        const merged: Record<string, number> = {}
        for (const c of Object.values(perGame)) {
          for (const [pid, n] of Object.entries(c)) merged[pid] = (merged[pid] ?? 0) + n
        }
        setLiveHr(merged)
      })
    )
    return () => unsubs.forEach(u => u())
  }, [liveGameIds])

  const disabledMap = derby.disabledPlayers ?? {}

  const hitters: HitterOption[] = useMemo(() =>
    Object.entries(players)
      .filter(([, p]) => !p.isSub && typeof p.name === 'string' && p.name !== '')
      .map(([id, p]) => ({
        id,
        name: p.name,
        teamShort: teams[p.teamId]?.shortName ?? '',
        teamLogo: teams[p.teamId]?.logoUrl ?? '',
        hr: (p.stats?.hitting?.hr ?? 0) + (liveHr[id] ?? 0),
        enabled: !disabledMap[id],
      }))
      .sort((a, b) => b.hr - a.hr || a.name.localeCompare(b.name)),
    [players, teams, liveHr, derby.disabledPlayers])

  // Only enabled (present) players are offered in dropdowns
  const selectableHitters = useMemo(() => hitters.filter(h => h.enabled), [hitters])

  // Number of entries betting on each player (paid or not)
  const entryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of Object.values(derby.entries ?? {})) {
      counts[e.playerId] = (counts[e.playerId] ?? 0) + 1
    }
    return counts
  }, [derby.entries])

  // Eligible-players grid: a season HR is the ticket into the derby — 0-HR
  // players never appear, even if someone bet on them.
  // Admin sees disabled players too (to toggle them); public sees enabled only.
  const [leadersSort, setLeadersSort] = useState<'hr' | 'bets'>('hr')
  const leaders = useMemo(
    () => hitters
      .filter(h => h.hr > 0 && (adminMode || h.enabled))
      .sort((a, b) => {
        const aBets = entryCounts[a.id] ?? 0
        const bBets = entryCounts[b.id] ?? 0
        return leadersSort === 'hr'
          ? b.hr - a.hr || bBets - aBets || a.name.localeCompare(b.name)
          : bBets - aBets || b.hr - a.hr || a.name.localeCompare(b.name)
      }),
    [hitters, adminMode, entryCounts, leadersSort])
  const hitterById = useMemo(() => new Map(hitters.map(h => [h.id, h])), [hitters])

  const togglePlayerEnabled = (h: HitterOption) => {
    if (h.enabled) set(ref(db, `derby/disabledPlayers/${h.id}`), true)
    else remove(ref(db, `derby/disabledPlayers/${h.id}`))
  }

  const [leadersOpen, setLeadersOpen] = useState(true)

  // ── Entries + pot ─────────────────────────────────────────────────────
  const entryList = useMemo(() =>
    Object.entries(derby.entries ?? {}).sort(([, a], [, b]) => a.createdAt - b.createdAt),
    [derby.entries])

  const paidCount = entryList.filter(([, e]) => e.paid).length
  const pot = paidCount * ENTRY_FEE
  const result = derby.result

  // Winning entries: paid, picked the right player, closest on total HR
  const winningIds = useMemo(() => {
    if (!result?.finalized) return new Set<string>()
    const eligible = entryList.filter(([, e]) => e.paid && e.playerId === result.winnerPlayerId)
    if (eligible.length === 0) return new Set<string>()
    const best = Math.min(...eligible.map(([, e]) => Math.abs(e.totalHr - result.totalHr)))
    return new Set(eligible.filter(([, e]) => Math.abs(e.totalHr - result.totalHr) === best).map(([id]) => id))
  }, [entryList, result])

  // ── Firebase writes (admin) ───────────────────────────────────────────
  const addEntry = (entry: Omit<DerbyEntry, 'createdAt'>) =>
    push(ref(db, 'derby/entries'), { ...entry, createdAt: Date.now() })
  const updateEntry = (id: string, patch: Partial<DerbyEntry>) =>
    update(ref(db, `derby/entries/${id}`), patch)
  const deleteEntry = (id: string, name: string) => {
    if (window.confirm(`Delete ${name}'s entry?`)) remove(ref(db, `derby/entries/${id}`))
  }
  const saveResult = (winnerPlayerId: string, totalHr: number) =>
    set(ref(db, 'derby/result'), { winnerPlayerId, totalHr, finalized: true })
  const clearResult = () => {
    if (window.confirm('Clear the final result?')) remove(ref(db, 'derby/result'))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header (matches /stats branding) ─────────────────────────── */}
      <div style={{ background: '#1e3a5f', borderBottom: '4px solid #c0392b' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {config.leagueLogo && (
              <img src={config.leagueLogo} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            )}
            <div>
              <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 900, color: '#ffffff', letterSpacing: '0.05em', margin: 0, textTransform: 'uppercase' }}>
                Home Run Derby
              </h1>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                50/50 Charity Event · {CHARITY_NAME}
              </p>
            </div>
            {adminMode && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin mode</span>
                <button onClick={exitAdmin} style={{ ...smallBtn, background: 'rgba(255,255,255,0.12)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.25)' }}>
                  Exit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 12px', width: '100%', boxSizing: 'border-box', flex: 1 }}>

        {/* ── Final result banner ─────────────────────────────────────── */}
        {result?.finalized && (
          <div style={{
            background: '#1e3a5f', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
            border: '2px solid #fbbf24', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
          }}>
            <span style={{ fontSize: 28 }}>🏆</span>
            <div>
              <div style={{ fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {hitterById.get(result.winnerPlayerId)?.name ?? result.winnerPlayerId} wins the derby!
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {result.totalHr} home runs across the 3 rounds
                {winningIds.size > 0
                  ? ` — ${winningIds.size === 1 ? 'the winning entry is' : `${winningIds.size} winning entries are`} highlighted below`
                  : ' — no winning entries this year, the full pot goes to charity!'}
              </div>
            </div>
          </div>
        )}

        {/* ── Venmo CTA ────────────────────────────────────────────────── */}
        <div style={{
          background: '#1e3a5f', borderRadius: 12, border: '3px solid #c0392b',
          padding: '20px 22px', marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontFamily: 'var(--font-score)', fontSize: 'clamp(19px, 5.5vw, 24px)', fontWeight: 900, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.15 }}>
            Enter now — send ${ENTRY_FEE} on Venmo to{' '}
            <a href={VENMO_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#5cb8ff', textDecoration: 'underline' }}>
              @{VENMO_HANDLE}
            </a>
          </div>
          <div style={{
            display: 'inline-block', background: 'rgba(255,255,255,0.1)', borderRadius: 8,
            padding: '10px 16px', margin: '12px 0 14px',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Your payment note must say
            </div>
            <div style={{ fontFamily: 'var(--font-score)', fontSize: 'clamp(16px, 4.5vw, 20px)', fontWeight: 800, color: '#ffffff', letterSpacing: '0.03em' }}>
              First Last&nbsp;&nbsp;Number of home runs
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              example: <span style={{ fontWeight: 700, color: '#ffffff' }}>"Mike Verteramo 25"</span>
            </div>
          </div>
          <div>
            <a
              href={VENMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', background: '#008CFF', color: '#ffffff', textDecoration: 'none',
                fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: '0.06em', borderRadius: 10, padding: '12px 32px',
                boxShadow: '0 4px 14px rgba(0,140,255,0.4)',
              }}
            >
              Pay on Venmo →
            </a>
          </div>
        </div>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-score)', fontSize: 17, fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              How it works
            </span>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 800, color: '#ffffff',
              background: '#c0392b', borderRadius: 20, padding: '3px 12px', letterSpacing: '0.06em',
            }}>
              ${ENTRY_FEE} PER ENTRY
            </span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, color: '#475569', fontSize: 14, lineHeight: 1.7 }}>
            <li>Pick the player you think <strong>wins the derby</strong>.</li>
            <li>Guess how many home runs your pick hits <strong>in total across all 3 rounds</strong>.</li>
            <li>Pick the right winner and come closest on their total — you take home <strong>half the pot</strong>.</li>
          </ol>
          <p style={{ margin: '10px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
            The other half goes to the <strong style={{ color: '#1e3a5f' }}>{CHARITY_NAME}</strong> and
            will be given directly to a family in need. Every entry supports the cause — thank you for playing!
          </p>
        </div>

        {/* ── Pot tiles ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 10, marginBottom: 16 }}>
          <PotTile label="Current pot" value={`$${pot}`} sub={`${paidCount} paid ${paidCount === 1 ? 'entry' : 'entries'}`} accent="#1e3a5f" />
          <PotTile label="Winner takes" value={`$${pot / 2}`} sub="50% of the pot" accent="#c0392b" />
          <PotTile label="To charity" value={`$${pot / 2}`} sub={CHARITY_NAME} accent="#15803d" />
        </div>

        {/* ── Home run leaders (collapsible) ───────────────────────────── */}
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 16, overflow: 'hidden' }}>
          <button
            onClick={() => setLeadersOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
              background: '#f9fafb', border: 'none', borderBottom: leadersOpen ? '1px solid #e5e7eb' : 'none', cursor: 'pointer',
            }}
          >
            <span style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
              Eligible Players
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
              {leaders.length} {leaders.length === 1 ? 'player' : 'players'}
            </span>
            {adminMode && (
              <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                tap a player to mark them in / out of the derby
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 13 }}>{leadersOpen ? '▾' : '▸'}</span>
          </button>
          {leadersOpen && (
            leaders.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                No home runs recorded yet this season.
              </div>
            ) : (
              <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px 0' }}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sort by</span>
                <SortChip active={leadersSort === 'hr'} onClick={() => setLeadersSort('hr')}>Home Runs</SortChip>
                <SortChip active={leadersSort === 'bets'} onClick={() => setLeadersSort('bets')}>Bets</SortChip>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, padding: 14 }}>
                {leaders.map((h, i) => (
                  <div
                    key={h.id}
                    onClick={adminMode ? () => togglePlayerEnabled(h) : undefined}
                    style={{
                      border: `1px solid ${!h.enabled ? '#e5e7eb' : i === 0 ? '#fbbf24' : '#e5e7eb'}`,
                      background: !h.enabled ? '#f1f5f9' : i === 0 ? 'rgba(251,191,36,0.08)' : '#f9fafb',
                      borderRadius: 10, padding: '12px 10px', textAlign: 'center', position: 'relative',
                      cursor: adminMode ? 'pointer' : 'default',
                      opacity: h.enabled ? 1 : 0.55,
                    }}
                  >
                    {adminMode && (
                      <span style={{
                        position: 'absolute', top: 6, left: 8,
                        fontFamily: 'var(--font-score)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                        borderRadius: 4, padding: '2px 6px',
                        background: h.enabled ? 'rgba(21,128,61,0.12)' : 'rgba(192,57,43,0.12)',
                        color: h.enabled ? '#15803d' : '#c0392b',
                      }}>
                        {h.enabled ? 'IN' : 'OUT'}
                      </span>
                    )}
                    {leadersSort === 'hr' && i === 0 && h.enabled && <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 12 }}>👑</span>}
                    {h.teamLogo
                      ? <img src={h.teamLogo} alt="" style={{ width: 28, height: 28, objectFit: 'contain', margin: '0 auto 6px', display: 'block', filter: h.enabled ? 'none' : 'grayscale(1)' }} />
                      : <div style={{ height: 28, marginBottom: 6 }} />}
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', lineHeight: 1.2, textDecoration: h.enabled ? 'none' : 'line-through' }}>{h.name}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>{h.teamShort}</div>
                    {(() => {
                      const bets = entryCounts[h.id] ?? 0
                      const betsText = `${bets} ${bets === 1 ? 'BET' : 'BETS'}`
                      const primary = leadersSort === 'hr'
                        ? { value: h.hr, label: 'HR', color: '#c0392b' }
                        : { value: bets, label: bets === 1 ? 'BET' : 'BETS', color: '#1e3a5f' }
                      const secondary = leadersSort === 'hr'
                        ? { text: `🔥 ${betsText}`, bg: bets > 0 ? '#1e3a5f' : '#cbd5e1' }
                        : { text: `${h.hr} HR`, bg: '#c0392b' }
                      return (
                        <>
                          <div style={{ fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 900, color: h.enabled ? primary.color : '#94a3b8', lineHeight: 1 }}>
                            {primary.value}
                          </div>
                          <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                            {primary.label}
                          </div>
                          <div style={{ marginTop: 6 }}>
                            <span style={{
                              fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em',
                              background: h.enabled ? secondary.bg : '#94a3b8', color: '#ffffff',
                              borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap',
                            }}>
                              {secondary.text}
                            </span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ))}
              </div>
              </>
            )
          )}
        </div>

        {/* ── Admin: add entry + result ────────────────────────────────── */}
        {adminMode && (
          <>
            <AddEntryForm hitters={selectableHitters} onAdd={addEntry} />
            <ResultForm hitters={selectableHitters} current={result ?? null} onSave={saveResult} onClear={clearResult} />
          </>
        )}

        {/* ── Entries ──────────────────────────────────────────────────── */}
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Entries
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{entryList.length} total</span>
          </div>
          {entryList.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              No entries yet — find us at the field to get in on the action!
            </div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: adminMode ? 560 : undefined }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1e3a5f' }}>
                    <th style={{ ...thBase, textAlign: 'left', paddingLeft: 14 }}>Name</th>
                    <th style={{ ...thBase, textAlign: 'left' }}>Betting on</th>
                    <th style={thBase}>HR Guess</th>
                    <th style={thBase}>Paid</th>
                    {adminMode && <th style={thBase} />}
                  </tr>
                </thead>
                <tbody>
                  {entryList.map(([id, entry], i) => (
                    <EntryRow
                      key={id}
                      entry={entry}
                      hitter={hitterById.get(entry.playerId)}
                      hitters={selectableHitters}
                      isWinner={winningIds.has(id)}
                      striped={i % 2 === 1}
                      adminMode={adminMode}
                      onPatch={patch => updateEntry(id, patch)}
                      onDelete={() => deleteEntry(id, entry.name)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer with small admin link ─────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '28px 0 20px' }}>
        <span style={{ fontSize: 11, color: '#cbd5e1' }}>
          Brookside Athletics · Home Run Derby
          {!adminMode && (
            <>
              {' · '}
              <button
                onClick={() => setShowPwPrompt(true)}
                aria-label="admin"
                style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'var(--font-ui)' }}
              >
                Admin
              </button>
            </>
          )}
        </span>
      </div>

      {showPwPrompt && <PasswordPrompt onSubmit={enterAdmin} onCancel={() => setShowPwPrompt(false)} />}
    </div>
  )
}

// ── Entry row (read-only or inline-editable) ─────────────────────────────────

function EntryRow({ entry, hitter, hitters, isWinner, striped, adminMode, onPatch, onDelete }: {
  entry: DerbyEntry
  hitter: HitterOption | undefined
  hitters: HitterOption[]
  isWinner: boolean
  striped: boolean
  adminMode: boolean
  onPatch: (patch: Partial<DerbyEntry>) => void
  onDelete: () => void
}) {
  const [draftName, setDraftName] = useState(entry.name)
  const [draftHr, setDraftHr] = useState(String(entry.totalHr))
  useEffect(() => { setDraftName(entry.name) }, [entry.name])
  useEffect(() => { setDraftHr(String(entry.totalHr)) }, [entry.totalHr])

  const rowBg = isWinner ? 'rgba(251,191,36,0.18)' : striped ? '#f9fafb' : '#ffffff'

  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb', background: rowBg }}>
      <td style={{ padding: '10px 8px 10px 14px', fontWeight: 600, color: '#1e293b' }}>
        {adminMode ? (
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={() => { if (draftName.trim() && draftName !== entry.name) onPatch({ name: draftName.trim() }) }}
            style={inputStyle}
          />
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {entry.name}
            {isWinner && (
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                background: '#fbbf24', color: '#1e293b', borderRadius: 4, padding: '2px 6px',
              }}>
                🏆 WINNER
              </span>
            )}
          </span>
        )}
        {adminMode && isWinner && <span style={{ marginLeft: 6 }}>🏆</span>}
      </td>
      <td style={{ padding: '10px 8px' }}>
        {adminMode ? (
          <PlayerCombobox hitters={hitters} value={entry.playerId} onChange={playerId => onPatch({ playerId })} compact fallbackLabel={hitter?.name} />
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#475569', fontWeight: 500 }}>
            {hitter?.teamLogo && <img src={hitter.teamLogo} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />}
            {hitter?.name ?? '—'}
          </span>
        )}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 700, color: '#1e3a5f' }}>
        {adminMode ? (
          <input
            type="number"
            min={0}
            value={draftHr}
            onChange={e => setDraftHr(e.target.value)}
            onBlur={() => {
              const n = parseInt(draftHr, 10)
              if (!isNaN(n) && n >= 0 && n !== entry.totalHr) onPatch({ totalHr: n })
              else setDraftHr(String(entry.totalHr))
            }}
            style={{ ...inputStyle, width: 64, textAlign: 'center' }}
          />
        ) : entry.totalHr}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
        {adminMode ? (
          <input
            type="checkbox"
            checked={entry.paid}
            onChange={e => onPatch({ paid: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: '#15803d', cursor: 'pointer' }}
          />
        ) : entry.paid ? (
          <span style={{ color: '#15803d', fontWeight: 700 }}>✓</span>
        ) : (
          <span style={{ fontSize: 11, color: '#b45309', fontWeight: 700, background: 'rgba(180,83,9,0.1)', borderRadius: 4, padding: '2px 8px' }}>
            UNPAID
          </span>
        )}
      </td>
      {adminMode && (
        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
          <button onClick={onDelete} style={{ ...smallBtn, background: 'rgba(192,57,43,0.08)', color: '#c0392b', border: '1px solid rgba(192,57,43,0.3)' }}>
            Delete
          </button>
        </td>
      )}
    </tr>
  )
}

// ── Admin: add entry ─────────────────────────────────────────────────────────

function AddEntryForm({ hitters, onAdd }: {
  hitters: HitterOption[]
  onAdd: (entry: Omit<DerbyEntry, 'createdAt'>) => void
}) {
  const [name, setName] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [totalHr, setTotalHr] = useState('')
  const [paid, setPaid] = useState(true)

  const hrNum = parseInt(totalHr, 10)
  const valid = name.trim() !== '' && playerId !== '' && !isNaN(hrNum) && hrNum >= 0

  const submit = () => {
    if (!valid) return
    onAdd({ name: name.trim(), playerId, totalHr: hrNum, paid })
    setName(''); setPlayerId(''); setTotalHr(''); setPaid(true)
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '2px solid #1e3a5f', padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 14, color: '#1e3a5f', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Add entry
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Entrant name"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 140px' }}
        />
        <div style={{ flex: '1 1 180px' }}>
          <PlayerCombobox hitters={hitters} value={playerId} onChange={setPlayerId} placeholder="Betting on…" />
        </div>
        <input
          type="number"
          min={0}
          placeholder="Total HR"
          value={totalHr}
          onChange={e => setTotalHr(e.target.value)}
          style={{ ...inputStyle, width: 84 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#15803d' }} />
          Paid
        </label>
        <button
          onClick={submit}
          disabled={!valid}
          style={{
            ...smallBtn, padding: '8px 20px', fontSize: 13,
            background: valid ? '#1e3a5f' : '#cbd5e1', color: '#ffffff', border: 'none',
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >
          Add — ${ENTRY_FEE}
        </button>
      </div>
    </div>
  )
}

// ── Admin: final result ──────────────────────────────────────────────────────

function ResultForm({ hitters, current, onSave, onClear }: {
  hitters: HitterOption[]
  current: { winnerPlayerId: string; totalHr: number; finalized: boolean } | null
  onSave: (winnerPlayerId: string, totalHr: number) => void
  onClear: () => void
}) {
  const [winnerId, setWinnerId] = useState(current?.winnerPlayerId ?? '')
  const [totalHr, setTotalHr] = useState(current ? String(current.totalHr) : '')
  useEffect(() => {
    setWinnerId(current?.winnerPlayerId ?? '')
    setTotalHr(current ? String(current.totalHr) : '')
  }, [current])

  const hrNum = parseInt(totalHr, 10)
  const valid = winnerId !== '' && !isNaN(hrNum) && hrNum >= 0

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '2px solid #fbbf24', padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 14, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Final result {current?.finalized ? '(posted)' : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: '1 1 180px' }}>
          <PlayerCombobox hitters={hitters} value={winnerId} onChange={setWinnerId} placeholder="Derby winner…" />
        </div>
        <input
          type="number"
          min={0}
          placeholder="Winner's total HR"
          value={totalHr}
          onChange={e => setTotalHr(e.target.value)}
          style={{ ...inputStyle, width: 110 }}
        />
        <button
          onClick={() => valid && onSave(winnerId, hrNum)}
          disabled={!valid}
          style={{
            ...smallBtn, padding: '8px 20px', fontSize: 13,
            background: valid ? '#b45309' : '#cbd5e1', color: '#ffffff', border: 'none',
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >
          {current?.finalized ? 'Update result' : 'Post result'}
        </button>
        {current?.finalized && (
          <button onClick={onClear} style={{ ...smallBtn, background: 'none', color: '#64748b', border: '1px solid #d1d5db' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Typeable player dropdown ─────────────────────────────────────────────────

function PlayerCombobox({ hitters, value, onChange, placeholder, compact, fallbackLabel }: {
  hitters: HitterOption[]
  value: string
  onChange: (playerId: string) => void
  placeholder?: string
  compact?: boolean
  /** shown when the current value isn't in the (enabled-only) option list */
  fallbackLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = hitters.find(h => h.id === value)
  const displayName = selected?.name ?? (value ? fallbackLabel : undefined) ?? ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return hitters
    return hitters.filter(h => h.name.toLowerCase().includes(q) || h.teamShort.toLowerCase().includes(q))
  }, [hitters, query])

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={open ? query : displayName}
        placeholder={placeholder ?? 'Search player…'}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => setQuery(e.target.value)}
        style={{ ...inputStyle, width: '100%', minWidth: compact ? 130 : undefined, boxSizing: 'border-box' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 2,
          background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8' }}>No players match.</div>
          ) : filtered.map(h => (
            <div
              key={h.id}
              onMouseDown={() => { onChange(h.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer',
                background: h.id === value ? 'rgba(30,58,95,0.08)' : 'transparent', fontSize: 13,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(30,58,95,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = h.id === value ? 'rgba(30,58,95,0.08)' : 'transparent')}
            >
              {h.teamLogo
                ? <img src={h.teamLogo} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
                : <span style={{ width: 18, flexShrink: 0 }} />}
              <span style={{ fontWeight: 600, color: '#1e293b' }}>{h.name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{h.teamShort}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-score)', fontWeight: 700, color: '#c0392b', fontSize: 13 }}>
                {h.hr} HR
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Password prompt ──────────────────────────────────────────────────────────

function PasswordPrompt({ onSubmit, onCancel }: { onSubmit: () => void; onCancel: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  const check = () => {
    if (pw === ADMIN_PASSWORD) onSubmit()
    else { setError(true); setPw('') }
  }

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#ffffff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 300, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Admin access
        </div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={e => { setPw(e.target.value); setError(false) }}
          onKeyDown={e => { if (e.key === 'Enter') check() }}
          placeholder="Password"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
        />
        {error && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 8 }}>Wrong password.</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ ...smallBtn, background: 'none', color: '#64748b', border: '1px solid #d1d5db' }}>
            Cancel
          </button>
          <button onClick={check} style={{ ...smallBtn, background: '#1e3a5f', color: '#ffffff', border: 'none' }}>
            Enter
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function SortChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
        fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.05em',
        background: active ? '#1e3a5f' : '#ffffff', color: active ? '#ffffff' : '#64748b',
        border: `1px solid ${active ? '#1e3a5f' : '#d1d5db'}`, cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function PotTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', borderTop: `3px solid ${accent}`, padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-score)', fontSize: 28, fontWeight: 900, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{sub}</div>
    </div>
  )
}

const thBase: React.CSSProperties = {
  padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b',
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13,
  fontFamily: 'var(--font-ui)', color: '#1e293b', background: '#ffffff', outline: 'none',
}

const smallBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  fontFamily: 'var(--font-ui)', cursor: 'pointer',
}
