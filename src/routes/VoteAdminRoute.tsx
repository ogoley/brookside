import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ref, set, update, serverTimestamp } from 'firebase/database'
import { db } from '../firebase'
import { HomeButton } from '../components/HomeButton'
import { AuthStatus } from '../components/AuthStatus'
import { SearchSelect } from '../components/SearchSelect'
import { useVoting } from '../hooks/useVoting'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import {
  sortedAwards, rosterPlayerIds, optionsForAward, optionLabel, cleanPicks, candidateIds,
  linksByPlayer, newVoterUpdates, voteLink, inviteMessage, linksCsv, turnoutByTeam, tallyAward,
  playerOption, teamOption, ballotTeamIds, STARTER_AWARDS, DEFAULT_VOTING_TITLE,
  type AwardEntry, type TeamTurnout, type VoterLink,
} from '../voting/logic'
import type { Award, AwardKind, PlayersMap, TeamsMap, VotingExcluded, VotingState } from '../types'

// Admin screen for season-awards voting (/vote-admin, admin login). Full
// read/write on /voting: open/close polls, awards + finalists, per-player
// links, ballots (edit / enter / reset), live results.

type Tab = 'results' | 'ballots' | 'links' | 'awards'

const card: React.CSSProperties = { background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }
const inputStyle: React.CSSProperties = { background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }
const label: React.CSSProperties = { fontFamily: 'var(--font-score)' }
const ghostBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)' }
const dangerBtn: React.CSSProperties = { background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }
const primaryBtn: React.CSSProperties = { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }

interface Ctx {
  voting: VotingState
  players: PlayersMap
  teams: TeamsMap
  awards: AwardEntry[]
  links: Map<string, VoterLink>
  turnout: TeamTurnout[]
}

export function VoteAdminRoute() {
  const { voting, loading } = useVoting()
  const { players } = usePlayers()
  const { teams } = useTeams()
  const [tabChoice, setTab] = useState<Tab | null>(null)

  const awards = useMemo(() => sortedAwards(voting.awards), [voting.awards])
  const links = useMemo(() => linksByPlayer(voting.voters), [voting.voters])
  const turnout = useMemo(
    () => turnoutByTeam(players, teams, voting.voters, voting.ballots, voting.excluded),
    [players, teams, voting.voters, voting.ballots, voting.excluded],
  )
  const ctx: Ctx = { voting, players, teams, awards, links, turnout }

  // Default tab is decided once, on load — not re-derived, or adding the first
  // awards would yank the view from Awards over to Ballots.
  if (!loading && tabChoice === null) setTab(awards.length ? 'ballots' : 'awards')
  const tab: Tab = tabChoice ?? 'awards'
  const total = turnout.reduce((n, t) => n + t.total, 0)
  const voted = turnout.reduce((n, t) => n + t.voted, 0)
  const linked = turnout.reduce((n, t) => n + t.players.filter(p => p.hasLink).length, 0)

  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8" style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}>
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HomeButton />
          <h1 className="text-white text-2xl font-black uppercase tracking-widest truncate" style={label}>Awards Voting</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/config" className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>← Config</Link>
          <AuthStatus />
        </div>
      </div>

      <div style={{ maxWidth: 900 }}>
        {loading ? (
          <p className="text-white/40">Loading…</p>
        ) : (
          <>
            <StatusPanel voting={voting} voted={voted} linked={linked} total={total} awardCount={awards.length} />

            <div className="flex gap-1.5 mb-5 flex-wrap">
              {([
                ['ballots', `Ballots · ${voted}`],
                ['results', 'Results'],
                ['links', `Voters & links · ${linked}/${total}`],
                ['awards', `Awards · ${awards.length}`],
              ] as [Tab, string][]).map(([id, text]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="h-10 px-4 rounded-xl text-sm font-bold uppercase tracking-wider"
                  style={{
                    ...label,
                    background: tab === id ? '#2563eb' : 'rgba(255,255,255,0.05)',
                    color: tab === id ? '#fff' : 'rgba(255,255,255,0.55)',
                    border: `1px solid ${tab === id ? '#2563eb' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {text}
                </button>
              ))}
            </div>

            {tab === 'ballots' && <BallotsTab ctx={ctx} />}
            {tab === 'results' && <ResultsTab ctx={ctx} />}
            {tab === 'links' && <LinksTab ctx={ctx} />}
            {tab === 'awards' && <AwardsTab ctx={ctx} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── Status: polls, turnout, title ────────────────────────────────────────────

function StatusPanel({ voting, voted, linked, total, awardCount }: {
  voting: VotingState; voted: number; linked: number; total: number; awardCount: number
}) {
  const open = voting.meta.open
  const [title, setTitle] = useState<string | null>(null)
  const savedTitle = voting.meta.title || DEFAULT_VOTING_TITLE

  const toggle = async () => {
    const msg = open
      ? 'Close voting? Links stop accepting ballots immediately (ballots already cast are kept).'
      : `Open voting? Every issued link starts accepting ballots immediately.${awardCount === 0 ? '\n\nThere are no awards yet!' : ''}`
    if (!window.confirm(msg)) return
    await set(ref(db, 'voting/meta/open'), !open)
  }

  const saveTitle = async () => {
    if (title === null) return
    const t = title.trim()
    await set(ref(db, 'voting/meta/title'), t || null)
    setTitle(null)
  }

  const pct = total ? Math.round((voted / total) * 100) : 0

  return (
    <div className="rounded-2xl p-4 mb-5 flex flex-col gap-4" style={card}>
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={toggle}
          className="h-14 px-5 rounded-xl flex items-center gap-3 font-black uppercase tracking-wider text-base"
          style={{
            ...label,
            background: open ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.05)',
            color: open ? '#4ade80' : 'rgba(255,255,255,0.6)',
            border: `1px solid ${open ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.12)'}`,
          }}
          title={open ? 'Click to close voting' : 'Click to open voting'}
        >
          <span style={{ width: 12, height: 12, borderRadius: 6, background: open ? '#22c55e' : '#6b7280', boxShadow: open ? '0 0 10px #22c55e' : 'none' }} />
          {open ? 'Voting open' : 'Voting closed'}
          <span className="text-xs font-semibold normal-case tracking-normal" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-ui)' }}>
            {open ? 'click to close' : 'click to open'}
          </span>
        </button>

        <div className="flex-1 min-w-[180px]">
          <div className="flex items-baseline gap-2">
            <span className="text-white text-3xl font-black" style={label}>{voted}</span>
            <span className="text-white/40 text-sm">of {total} players voted · {pct}%</span>
          </div>
          <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#22c55e', transition: 'width 0.4s' }} />
          </div>
          <p className="text-white/35 text-xs mt-1.5">{linked} of {total} players have a link</p>
        </div>

        <a
          href="/vote/preview"
          target="_blank"
          rel="noreferrer"
          className="h-10 px-4 rounded-lg text-sm font-semibold flex items-center"
          style={ghostBtn}
        >
          Preview ballot ↗
        </a>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-white/40 text-xs uppercase tracking-widest shrink-0" style={label}>Ballot title</span>
        <input
          value={title ?? savedTitle}
          onChange={e => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 h-9 rounded-lg px-3 text-sm"
          style={inputStyle}
        />
      </div>
    </div>
  )
}

// ── Ballots ──────────────────────────────────────────────────────────────────

function BallotsTab({ ctx }: { ctx: Ctx }) {
  const { voting, players, teams, awards, turnout } = ctx
  const [editing, setEditing] = useState<string | null>(null)   // playerId, or '__new__'
  const [confirmReset, setConfirmReset] = useState<string | null>(null)

  const ballots = Object.entries(voting.ballots)
    .sort(([, a], [, b]) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))

  const reset = async (playerId: string) => {
    const updates: Record<string, null> = { [`voting/ballots/${playerId}`]: null }
    for (const [token, v] of Object.entries(voting.voters)) {
      if (v.playerId === playerId && v.votedAt) updates[`voting/voters/${token}/votedAt`] = null
    }
    await update(ref(db), updates)
    setConfirmReset(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Turnout by team — who still needs a nudge */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {turnout.map(t => {
          const missing = t.players.filter(p => !p.voted)
          const logo = teams[t.teamId]?.logoUrl
          return (
            <div key={t.teamId} className="rounded-xl px-3 py-2.5" style={card}>
              <div className="flex items-center gap-2">
                {logo && <img src={logo} alt="" className="w-6 h-6 object-contain" />}
                <span className="text-white font-semibold text-sm truncate">{t.teamName}</span>
                <span className="ml-auto text-sm font-black" style={{ ...label, color: t.voted === t.total ? '#4ade80' : '#fff' }}>
                  {t.voted}/{t.total}
                </span>
              </div>
              {missing.length > 0 && (
                <p className="text-white/40 text-xs mt-1.5 leading-relaxed">
                  Waiting on {missing.map(p => p.name).join(', ')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setEditing('__new__')}
        className="h-11 rounded-xl text-sm font-bold uppercase tracking-wider self-start px-5"
        style={{ ...label, background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '2px dashed rgba(255,255,255,0.15)' }}
      >
        + Enter a ballot for a player
      </button>

      {ballots.length === 0 ? (
        <p className="text-white/35 text-sm">No ballots yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ballots.map(([playerId, b]) => {
            const p = players[playerId]
            const team = p ? teams[p.teamId] : undefined
            return (
              <div key={playerId} className="rounded-2xl px-4 py-3 flex flex-col gap-2" style={card}>
                <div className="flex items-center gap-3 flex-wrap">
                  {team?.logoUrl && <img src={team.logoUrl} alt="" className="w-7 h-7 object-contain" />}
                  <div className="min-w-0">
                    <p className="text-white font-semibold leading-tight">{p?.name ?? playerId}</p>
                    <p className="text-white/35 text-xs">
                      {team?.name ?? ''} · {formatWhen(b.submittedAt)}
                      {b.editedAt && <span style={{ color: '#fbbf24' }}> · edited by admin {formatWhen(b.editedAt)}</span>}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => setEditing(playerId)} className="h-8 px-3 rounded-lg text-xs font-semibold" style={ghostBtn}>Edit</button>
                    {confirmReset === playerId ? (
                      <>
                        <button onClick={() => reset(playerId)} className="h-8 px-3 rounded-lg text-xs font-bold" style={{ background: '#7f1d1d', color: '#fca5a5' }}>Delete ballot</button>
                        <button onClick={() => setConfirmReset(null)} className="h-8 px-3 rounded-lg text-xs" style={ghostBtn}>No</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmReset(playerId)}
                        className="h-8 px-3 rounded-lg text-xs font-semibold"
                        style={dangerBtn}
                        title="Delete this ballot. Their link works again so they can re-vote."
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {awards.map(a => {
                    const pick = b.picks?.[a.id]
                    return (
                      <span key={a.id} className="text-xs rounded-md px-2 py-1" style={{ background: 'rgba(255,255,255,0.05)', color: pick ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)' }}>
                        <span className="text-white/40">{a.name}:</span> {pick ? optionLabel(a, pick, players, teams).name : 'no vote'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <BallotEditor ctx={ctx} playerId={editing === '__new__' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function BallotEditor({ ctx, playerId: fixedPlayerId, onClose }: { ctx: Ctx; playerId: string | null; onClose: () => void }) {
  const { voting, players, teams, awards, links } = ctx
  const [playerId, setPlayerId] = useState(fixedPlayerId ?? '')
  const existing = playerId ? voting.ballots[playerId] : undefined
  const [picks, setPicks] = useState<Record<string, string>>(() => ({ ...(fixedPlayerId ? voting.ballots[fixedPlayerId]?.picks : {}) }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const voterOptions = useMemo(
    () => rosterPlayerIds(players, voting.excluded).filter(id => !voting.ballots[id]).map(id => playerOption(id, players, teams)),
    [players, teams, voting.ballots, voting.excluded],
  )

  const save = async () => {
    if (!playerId) { setError('Pick whose ballot this is.'); return }
    const clean = cleanPicks(picks, voting.awards, players, teams, playerId, voting.excluded)
    if (Object.keys(clean).length === 0) { setError('Pick at least one award, or use Reset to delete a ballot.'); return }
    const updates: Record<string, unknown> = {
      [`voting/ballots/${playerId}`]: {
        token: existing?.token ?? links.get(playerId)?.token ?? 'admin',
        picks: clean,
        submittedAt: existing?.submittedAt ?? serverTimestamp(),
        editedAt: serverTimestamp(),
      },
    }
    // A ballot entered on someone's behalf uses up their link too.
    if (!existing) {
      for (const [token, v] of Object.entries(voting.voters)) {
        if (v.playerId === playerId) updates[`voting/voters/${token}/votedAt`] = serverTimestamp()
      }
    }
    setSaving(true)
    try {
      await update(ref(db), updates)
      onClose()
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="text-white text-lg font-black uppercase tracking-wider mb-1" style={label}>
        {fixedPlayerId ? `Edit ballot · ${players[fixedPlayerId]?.name ?? fixedPlayerId}` : 'Enter a ballot'}
      </h3>
      <p className="text-white/40 text-xs mb-4">
        {fixedPlayerId
          ? 'Changes are marked "edited by admin" on the ballot.'
          : "For a player who voted some other way. Their link will show they've already voted."}
      </p>
      {!fixedPlayerId && (
        <div className="mb-4">
          <FieldLabel>Voter</FieldLabel>
          <SearchSelect dark options={voterOptions} value={playerId} onChange={id => { setPlayerId(id); setPicks({}) }} placeholder="Search players who haven't voted…" />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {awards.map(a => (
          <div key={a.id}>
            <FieldLabel>{a.name}</FieldLabel>
            <SearchSelect
              dark
              options={optionsForAward(a, players, teams, playerId || null, voting.excluded)}
              value={picks[a.id] ?? ''}
              onChange={id => setPicks(p => ({ ...p, [a.id]: id }))}
              placeholder={a.kind === 'team' ? 'Search teams…' : 'Search players…'}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-sm mt-3" style={{ color: '#f87171' }}>{error}</p>}
      <div className="flex gap-2 mt-5">
        <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl font-bold uppercase tracking-wider text-sm" style={{ ...label, ...primaryBtn }}>
          {saving ? 'Saving…' : 'Save ballot'}
        </button>
        <button onClick={onClose} className="h-11 px-5 rounded-xl text-sm font-semibold" style={ghostBtn}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Results ──────────────────────────────────────────────────────────────────

function ResultsTab({ ctx }: { ctx: Ctx }) {
  const { voting, players, teams, awards } = ctx
  if (awards.length === 0) return <p className="text-white/35 text-sm">No awards yet.</p>

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
      {awards.map(a => {
        const { rows, counted } = tallyAward(a.id, voting.ballots)
        const top = rows[0]?.votes ?? 0
        const tiedTop = rows.filter(r => r.rank === 1).length > 1
        return (
          <div key={a.id} className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
            <div className="flex items-baseline gap-2">
              <span className="text-white text-lg font-black uppercase tracking-wider" style={label}>{a.name}</span>
              {tiedTop && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>TIE</span>}
              <span className="ml-auto text-white/35 text-xs">{counted} vote{counted === 1 ? '' : 's'}</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-white/30 text-sm">No votes yet.</p>
            ) : rows.map(r => {
              const opt = optionLabel(a, r.id, players, teams)
              const leader = r.rank === 1
              return (
                <div key={r.id} className="flex items-center gap-2.5">
                  <span className="w-5 text-right text-sm font-black" style={{ ...label, color: leader ? '#fbbf24' : 'rgba(255,255,255,0.35)' }}>{r.rank}</span>
                  {opt.logo ? <img src={opt.logo} alt="" className="w-6 h-6 object-contain shrink-0" /> : <span className="w-6 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: leader ? '#fff' : 'rgba(255,255,255,0.75)' }}>{opt.name}</span>
                      <span className="text-[11px] text-white/30 truncate">{opt.sub}</span>
                      <span className="ml-auto text-sm font-black" style={{ ...label, color: leader ? '#fbbf24' : 'rgba(255,255,255,0.7)' }}>
                        {r.votes} <span className="text-white/30 font-semibold">· {Math.round((r.votes / counted) * 100)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(r.votes / top) * 100}%`, background: leader ? '#fbbf24' : 'rgba(96,165,250,0.6)' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Voters & links ───────────────────────────────────────────────────────────

function LinksTab({ ctx }: { ctx: Ctx }) {
  const { voting, players, teams, links, turnout } = ctx
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const title = voting.meta.title || DEFAULT_VOTING_TITLE

  const roster = rosterPlayerIds(players, voting.excluded)
  const missing = roster.filter(id => !links.has(id))
  const excludedIds = Object.keys(voting.excluded).filter(id => voting.excluded[id])
  const rosterSet = new Set(roster)
  const orphans = Object.entries(voting.voters).filter(([, v]) => !rosterSet.has(v.playerId))

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      window.prompt('Copy this:', text)
    }
  }

  const tokensFor = (playerId: string) => Object.entries(voting.voters).filter(([, v]) => v.playerId === playerId).map(([t]) => t)

  const createLinks = async (playerIds: string[]) => {
    if (playerIds.length === 0) return
    setBusy(true)
    try { await update(ref(db), newVoterUpdates(playerIds, () => crypto.randomUUID(), Date.now())) } finally { setBusy(false) }
  }

  const reissue = async (playerId: string) => {
    const name = players[playerId]?.name ?? playerId
    if (!window.confirm(`Reissue ${name}'s link? The old link stops working immediately.`)) return
    const updates: Record<string, unknown> = {}
    for (const t of tokensFor(playerId)) updates[`voting/voters/${t}`] = null
    const fresh: Record<string, unknown> = { playerId, createdAt: Date.now() }
    // Keep "already voted" on the new link if they have a ballot.
    if (voting.ballots[playerId]) fresh.votedAt = voting.ballots[playerId].submittedAt
    updates[`voting/voters/${crypto.randomUUID()}`] = fresh
    await update(ref(db), updates)
  }

  const revoke = async (playerId: string) => {
    const name = players[playerId]?.name ?? playerId
    if (!window.confirm(`Revoke ${name}'s link? It stops working; a ballot they already cast is kept.`)) return
    const updates: Record<string, null> = {}
    for (const t of tokensFor(playerId)) updates[`voting/voters/${t}`] = null
    await update(ref(db), updates)
  }

  const exclude = async (playerId: string) => {
    const name = players[playerId]?.name ?? playerId
    if (!window.confirm(`Exclude ${name} from voting? No link, not on the ballot, not counted in turnout. Their stats aren't touched.`)) return
    const updates: Record<string, unknown> = { [`voting/excluded/${playerId}`]: true }
    for (const t of tokensFor(playerId)) updates[`voting/voters/${t}`] = null
    await update(ref(db), updates)
  }

  const include = (playerId: string) => set(ref(db, `voting/excluded/${playerId}`), null)

  const downloadCsv = () => {
    const rows = turnout.flatMap(t => t.players.filter(p => links.has(p.playerId)).map(p => {
      const link = voteLink(links.get(p.playerId)!.token)
      return { team: t.teamName, name: p.name, playerId: p.playerId, link, voted: p.voted, message: inviteMessage(p.name, link, title) }
    }))
    const blob = new Blob([linksCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `vote-links-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-2" style={card}>
        <p className="text-white/45 text-xs w-full mb-1 leading-relaxed">
          Each link is a personal ballot: whoever opens it votes as that player, once. Send each one privately.
          Links work only while voting is open.
        </p>
        <button
          onClick={() => createLinks(missing)}
          disabled={busy || missing.length === 0}
          className="h-10 px-4 rounded-lg text-sm font-bold"
          style={missing.length ? primaryBtn : { ...ghostBtn, opacity: 0.5 }}
        >
          {missing.length ? `Create links for ${missing.length} player${missing.length === 1 ? '' : 's'}` : 'Every player has a link'}
        </button>
        <button onClick={downloadCsv} disabled={links.size === 0} className="h-10 px-4 rounded-lg text-sm font-semibold" style={ghostBtn}>
          Download CSV (links + invite text)
        </button>
      </div>

      {turnout.map(t => (
        <div key={t.teamId} className="rounded-2xl overflow-hidden" style={card}>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {teams[t.teamId]?.logoUrl && <img src={teams[t.teamId].logoUrl} alt="" className="w-6 h-6 object-contain" />}
            <span className="text-white font-bold text-sm uppercase tracking-wider" style={label}>{t.teamName}</span>
            <span className="ml-auto text-white/40 text-xs">{t.voted}/{t.total} voted</span>
          </div>
          {t.players.map(p => {
            const link = links.get(p.playerId)
            const url = link ? voteLink(link.token) : ''
            return (
              <div key={p.playerId} className="flex items-center gap-2 px-4 py-2 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="text-white text-sm font-semibold w-44 truncate">{p.name}</span>
                <StatusPill voted={p.voted} hasLink={!!link} />
                {link ? (
                  <>
                    <code className="text-white/35 text-xs truncate flex-1 min-w-[120px]" title={url}>…/vote/{link.token.slice(0, 8)}…</code>
                    <button onClick={() => copy(`l-${p.playerId}`, url)} className="h-8 px-2.5 rounded-lg text-xs font-semibold" style={ghostBtn}>
                      {copied === `l-${p.playerId}` ? '✓ Copied' : 'Copy link'}
                    </button>
                    <button onClick={() => copy(`m-${p.playerId}`, inviteMessage(p.name, url, title))} className="h-8 px-2.5 rounded-lg text-xs font-semibold" style={ghostBtn}>
                      {copied === `m-${p.playerId}` ? '✓ Copied' : 'Copy invite'}
                    </button>
                    <button onClick={() => reissue(p.playerId)} className="h-8 px-2.5 rounded-lg text-xs font-semibold" style={ghostBtn} title="New link; the old one stops working">Reissue</button>
                    <button onClick={() => revoke(p.playerId)} className="h-8 px-2.5 rounded-lg text-xs font-semibold" style={dangerBtn} title="Disable this player's link">Revoke</button>
                  </>
                ) : (
                  <button onClick={() => createLinks([p.playerId])} disabled={busy} className="ml-auto h-8 px-3 rounded-lg text-xs font-semibold" style={ghostBtn}>Create link</button>
                )}
                <button onClick={() => exclude(p.playerId)} className="h-8 px-2.5 rounded-lg text-xs font-semibold" style={{ ...ghostBtn, color: 'rgba(255,255,255,0.4)' }} title="Keep this player out of voting entirely">Exclude</button>
              </div>
            )
          })}
        </div>
      ))}

      {excludedIds.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <p className="text-white/50 text-xs uppercase tracking-widest" style={label}>Excluded from voting</p>
          <p className="text-white/35 text-xs">No link, not on the ballot, not counted in turnout.</p>
          {excludedIds.map(id => (
            <div key={id} className="flex items-center gap-2">
              <span className="text-white/60 text-sm flex-1">
                {players[id]?.name ?? id}
                <span className="text-white/30 text-xs"> · {teams[players[id]?.teamId ?? '']?.name ?? ''}</span>
              </span>
              <button onClick={() => include(id)} className="h-8 px-3 rounded-lg text-xs font-semibold" style={ghostBtn}>Include again</button>
            </div>
          ))}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <p className="text-white/50 text-xs uppercase tracking-widest" style={label}>Links for players no longer on the roster</p>
          {orphans.map(([token, v]) => (
            <div key={token} className="flex items-center gap-2">
              <span className="text-white/60 text-sm flex-1">{v.playerId} <code className="text-white/30 text-xs">{token.slice(0, 8)}…</code></span>
              <button onClick={() => set(ref(db, `voting/voters/${token}`), null)} className="h-8 px-3 rounded-lg text-xs font-semibold" style={dangerBtn}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ voted, hasLink }: { voted: boolean; hasLink: boolean }) {
  const [text, color, bg] = voted
    ? ['Voted', '#4ade80', 'rgba(22,163,74,0.15)']
    : hasLink ? ['Not yet', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.06)'] : ['No link', '#fbbf24', 'rgba(251,191,36,0.12)']
  return <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0" style={{ color, background: bg }}>{text}</span>
}

// ── Awards ───────────────────────────────────────────────────────────────────

interface AwardForm {
  name: string
  kind: AwardKind
  description: string
  candidates: string[]
}

const EMPTY_AWARD: AwardForm = { name: '', kind: 'player', description: '', candidates: [] }

function awardIdFor(name: string, taken: Record<string, unknown>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'award'
  let id = base
  for (let n = 2; taken[id]; n++) id = `${base}_${n}`
  return id
}

function AwardsTab({ ctx }: { ctx: Ctx }) {
  const { voting, players, teams, awards } = ctx
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AwardForm>(EMPTY_AWARD)
  const [seeding, setSeeding] = useState(false)
  const ballotCount = Object.keys(voting.ballots).length

  const startEdit = (a: AwardEntry) => {
    setEditingId(a.id)
    setForm({ name: a.name, kind: a.kind, description: a.description ?? '', candidates: candidateIds(a) })
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) return
    const id = editingId === '__new__' ? awardIdFor(name, voting.awards) : editingId!
    const order = editingId === '__new__'
      ? (awards.length ? Math.max(...awards.map(a => a.order ?? 0)) + 1 : 1)
      : voting.awards[id]?.order ?? awards.length + 1
    const out: Award = { name, kind: form.kind, order }
    if (form.description.trim()) out.description = form.description.trim()
    if (form.candidates.length) out.candidates = Object.fromEntries(form.candidates.map(c => [c, true as const]))
    await set(ref(db, `voting/awards/${id}`), out)
    setEditingId(null)
  }

  const remove = async (a: AwardEntry) => {
    const withPick = Object.values(voting.ballots).filter(b => b.picks?.[a.id]).length
    const msg = withPick
      ? `Delete "${a.name}"? ${withPick} ballot${withPick === 1 ? ' has a pick' : 's have picks'} for it; those picks will be ignored.`
      : `Delete "${a.name}"?`
    if (!window.confirm(msg)) return
    await set(ref(db, `voting/awards/${a.id}`), null)
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= awards.length) return
    const reordered = [...awards]
    const [item] = reordered.splice(index, 1)
    reordered.splice(target, 0, item)
    const updates: Record<string, number> = {}
    reordered.forEach((a, i) => { updates[`voting/awards/${a.id}/order`] = i + 1 })
    await update(ref(db), updates)
  }

  const seedStarters = async () => {
    setSeeding(true)
    try {
      const updates: Record<string, Award> = {}
      for (const [id, a] of Object.entries(STARTER_AWARDS)) if (!voting.awards[id]) updates[`voting/awards/${id}`] = a
      if (Object.keys(updates).length) await update(ref(db), updates)
    } finally {
      setSeeding(false)
    }
  }

  const rosterSize = rosterPlayerIds(players, voting.excluded).length
  const teamCount = ballotTeamIds(teams).length

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 680 }}>
      {ballotCount > 0 && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
          {ballotCount} ballot{ballotCount === 1 ? ' is' : 's are'} already in. Ballots aren't re-checked if you change an award now.
        </div>
      )}

      {awards.length === 0 && editingId !== '__new__' && (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={card}>
          <p className="text-white/40 text-sm">No awards yet.</p>
          <button
            onClick={seedStarters}
            disabled={seeding}
            className="h-11 rounded-xl text-sm font-bold uppercase tracking-wider"
            style={{ background: 'rgba(37,99,235,0.15)', color: '#60a5fa', border: '1px solid rgba(37,99,235,0.3)' }}
          >
            {seeding ? 'Adding…' : 'Add starter awards (MVP · Cy Young · Hitter · Rookie · Captain)'}
          </button>
        </div>
      )}

      {awards.map((a, i) =>
        editingId === a.id ? (
          <AwardFormCard key={a.id} form={form} onChange={setForm} onSave={save} onCancel={() => setEditingId(null)} players={players} teams={teams} excluded={voting.excluded} />
        ) : (
          <div key={a.id} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={card}>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="h-5 w-7 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: i === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)' }} title="Move up">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === awards.length - 1} className="h-5 w-7 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: i === awards.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)' }} title="Move down">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-white font-semibold text-base leading-none truncate">{a.name}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: a.kind === 'team' ? 'rgba(168,85,247,0.18)' : 'rgba(96,165,250,0.15)', color: a.kind === 'team' ? '#c084fc' : '#60a5fa' }}>
                  {a.kind}
                </span>
              </div>
              <p className="text-white/40 text-xs mt-1 truncate">
                {a.candidates
                  ? `${candidateIds(a).length} finalists: ${candidateIds(a).map(id => optionLabel(a, id, players, teams).name).join(', ')}`
                  : a.kind === 'team' ? `Open to all ${teamCount} teams` : `Open to all ${rosterSize} players`}
                {a.description ? ` · ${a.description}` : ''}
              </p>
            </div>
            <button onClick={() => startEdit(a)} className="h-9 px-4 rounded-lg text-sm font-semibold shrink-0" style={ghostBtn}>Edit</button>
            <button onClick={() => remove(a)} className="h-9 px-3 rounded-lg text-sm font-semibold shrink-0" style={dangerBtn}>✕</button>
          </div>
        ),
      )}

      {editingId === '__new__' ? (
        <AwardFormCard form={form} onChange={setForm} onSave={save} onCancel={() => setEditingId(null)} players={players} teams={teams} excluded={voting.excluded} />
      ) : (
        <button
          onClick={() => { setEditingId('__new__'); setForm(EMPTY_AWARD) }}
          className="w-full h-14 rounded-2xl text-base font-bold uppercase tracking-wider"
          style={{ ...label, background: 'transparent', color: 'rgba(255,255,255,0.35)', border: '2px dashed rgba(255,255,255,0.15)' }}
        >
          + Add Award
        </button>
      )}
    </div>
  )
}

function AwardFormCard({ form, onChange, onSave, onCancel, players, teams, excluded }: {
  form: AwardForm
  onChange: (f: AwardForm) => void
  onSave: () => void
  onCancel: () => void
  players: PlayersMap
  teams: TeamsMap
  excluded: VotingExcluded
}) {
  const patch = <K extends keyof AwardForm>(key: K, value: AwardForm[K]) => onChange({ ...form, [key]: value })
  const label1 = (id: string) => (form.kind === 'team' ? teamOption(id, teams) : playerOption(id, players, teams))
  const pool = form.kind === 'team'
    ? ballotTeamIds(teams).map(id => teamOption(id, teams))
    : rosterPlayerIds(players, excluded).map(id => playerOption(id, players, teams))
  const addable = pool.filter(o => !form.candidates.includes(o.id))
  const canSave = form.name.trim().length > 0

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-4" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.18)' }}>
      <div>
        <FieldLabel>Award name</FieldLabel>
        <input value={form.name} onChange={e => patch('name', e.target.value)} placeholder="e.g. Gold Glove" className="w-full h-11 rounded-lg px-3 text-base" style={inputStyle} />
      </div>
      <div>
        <FieldLabel>Vote for a</FieldLabel>
        <div className="flex gap-2">
          {(['player', 'team'] as AwardKind[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ ...form, kind: k, candidates: k === form.kind ? form.candidates : [] })}
              className="flex-1 h-11 rounded-lg text-sm font-bold uppercase tracking-wider"
              style={{ ...label, background: form.kind === k ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.06)', color: form.kind === k ? '#fff' : 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>Description (optional)</FieldLabel>
        <input value={form.description} onChange={e => patch('description', e.target.value)} placeholder="One short line shown on the ballot" className="w-full h-11 rounded-lg px-3 text-base" style={inputStyle} />
      </div>
      <div>
        <FieldLabel>Finalists (optional)</FieldLabel>
        <p className="text-white/35 text-xs mb-2">
          Leave empty to put every {form.kind === 'team' ? 'team' : 'player'} on the ballot. Add names to limit the vote to a shortlist (e.g. Rookie of the Year, Best Captain).
        </p>
        {form.candidates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.candidates.map(id => {
              const o = label1(id)
              return (
                <span key={id} className="flex items-center gap-1.5 h-8 pl-2 pr-1 rounded-lg text-sm" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
                  {o.logo && <img src={o.logo} alt="" className="w-4 h-4 object-contain" />}
                  {o.name}
                  <button type="button" onClick={() => patch('candidates', form.candidates.filter(c => c !== id))} className="w-6 h-6 rounded text-white/50 hover:text-white">✕</button>
                </span>
              )
            })}
          </div>
        )}
        <SearchSelect
          dark
          options={addable}
          value=""
          onChange={id => { if (id) patch('candidates', [...form.candidates, id]) }}
          placeholder={form.kind === 'team' ? 'Add a team…' : 'Add a player…'}
        />
      </div>
      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex-1 h-12 rounded-xl font-bold text-base uppercase tracking-wider"
          style={{ background: canSave ? '#2563eb' : '#1c2333', color: canSave ? '#fff' : 'rgba(255,255,255,0.3)' }}
        >
          Save award
        </button>
        <button onClick={onCancel} className="h-12 px-6 rounded-xl font-semibold text-sm uppercase tracking-wider" style={ghostBtn}>Cancel</button>
      </div>
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div onClick={e => e.stopPropagation()} className="w-full rounded-2xl p-5 my-8" style={{ maxWidth: 520, background: '#161b27', border: '1px solid rgba(255,255,255,0.15)' }}>
        {children}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-white/50 text-xs uppercase tracking-widest mb-1.5" style={label}>{children}</label>
}

function formatWhen(ms: number | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
