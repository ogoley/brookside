import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ref, update, serverTimestamp } from 'firebase/database'
import { db } from '../firebase'
import { useBallotSetup } from '../hooks/useVoting'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { SearchSelect } from '../components/SearchSelect'
import {
  sortedAwards, optionsForAward, cleanPicks, buildBallotUpdates, optionLabel,
  candidateIds, rosterPlayerIds, DEFAULT_VOTING_TITLE, type AwardEntry,
} from '../voting/logic'
import type { PlayersMap, TeamsMap, VotingExcluded } from '../types'

// Public ballot page — /vote/<token>. The token in the path is the voter's
// only credential: the rules let it write exactly one ballot, for the player
// it was issued to, once, while polls are open (database.rules.json → voting).
// /vote/preview[?as=playerId] renders the real ballot with submit disabled,
// even while polls are closed — linked from /vote-admin.

const NAVY = '#1e3a5f'
const RED = '#c0392b'

type SubmitState = 'idle' | 'saving' | 'slow' | 'error' | 'preview'

export function VoteRoute() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const preview = token === 'preview'
  const { meta, awards, excluded, voter: linkVoter, loading } = useBallotSetup(preview ? undefined : token)
  const { players, loading: playersLoading } = usePlayers()
  const { teams, loading: teamsLoading } = useTeams()
  const { config } = useLeagueConfig()
  const [picks, setPicks] = useState<Record<string, string>>({})
  // Awards the voter deliberately left blank. Skipping isn't offered up
  // front; a blank award is only accepted after an explicit "No vote".
  const [noVote, setNoVote] = useState<Record<string, true>>({})
  const [sheet, setSheet] = useState<'missing' | 'review' | null>(null)
  const [submit, setSubmit] = useState<SubmitState>('idle')
  const [submitted, setSubmitted] = useState<Record<string, string> | null>(null)

  const title = meta?.title || DEFAULT_VOTING_TITLE
  useEffect(() => { document.title = `${title} · Ballot` }, [title])

  const awardList = useMemo(() => sortedAwards(awards ?? {}), [awards])
  const previewId = preview ? (searchParams.get('as') || rosterPlayerIds(players, excluded)[0] || null) : null
  const voter = preview ? (previewId ? { playerId: previewId, createdAt: 0 } : null) : linkVoter
  const playerId = voter?.playerId ?? null
  const me = playerId ? players[playerId] : undefined
  const myTeam = me ? teams[me.teamId] : undefined
  const clean = useMemo(
    () => cleanPicks(picks, awards ?? {}, players, teams, playerId, excluded),
    [picks, awards, players, teams, playerId, excluded],
  )
  const pickedCount = Object.keys(clean).length
  const unanswered = awardList.filter(a => !clean[a.id] && !noVote[a.id])
  // Once every blank is answered (picked or "No vote"), the missing-awards
  // sheet turns into the review sheet on its own.
  const activeSheet = sheet === 'missing' && unanswered.length === 0 ? 'review' : sheet

  const shell = (children: React.ReactNode) => (
    <Shell title={title} logo={config.leagueLogo}>{children}</Shell>
  )

  if (loading || playersLoading || teamsLoading) {
    return shell(<p style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading your ballot…</p>)
  }

  if (!voter || !playerId || !me || excluded[playerId]) {
    return shell(
      <Notice icon="🔗" heading="This link isn't valid">
        Make sure you opened the full link from your Spond message. If it still doesn't work, ask the
        commissioner for a new one.
      </Notice>,
    )
  }

  if (submitted) {
    return shell(
      <>
        <Notice icon="✅" heading="Ballot received" tone="success">
          Thanks, {me.name.split(' ')[0]}! Your votes are in. Winners will be announced at the end of the season.
        </Notice>
        <PickSummary awards={awardList} picks={submitted} players={players} teams={teams} />
      </>,
    )
  }

  if (!preview && voter.votedAt) {
    return shell(
      <Notice icon="🗳️" heading="You've already voted">
        This link's ballot was submitted {formatWhen(voter.votedAt)}. Ballots are final. If something
        looks wrong, contact the commissioner.
      </Notice>,
    )
  }

  if (!preview && !meta?.open) {
    return shell(
      <Notice icon="⏳" heading="Voting isn't open right now">
        Hang on to this link. It's your personal ballot and it will work as soon as voting opens.
      </Notice>,
    )
  }

  const doSubmit = async () => {
    if (!token || pickedCount === 0) return
    if (preview) { setSubmit('preview'); return }
    setSubmit('saving')
    // A write while offline queues in this tab and only resolves on reconnect
    // — say so instead of spinning forever.
    const slow = setTimeout(() => setSubmit(s => (s === 'saving' ? 'slow' : s)), 8000)
    try {
      await update(ref(db), buildBallotUpdates(token, playerId, clean, serverTimestamp()))
      setSubmitted(clean)
      setSheet(null)
      setSubmit('idle')
    } catch {
      setSubmit('error')
    } finally {
      clearTimeout(slow)
    }
  }

  const choose = (awardId: string, id: string) => {
    setPicks(p => ({ ...p, [awardId]: id }))
    if (id && noVote[awardId]) {
      setNoVote(n => {
        const next = { ...n }
        delete next[awardId]
        return next
      })
    }
  }

  const pickNow = (awardId: string) => {
    setSheet(null)
    // After the sheet unmounts: bring the card into view and open its picker.
    setTimeout(() => {
      const card = document.getElementById(`award-${awardId}`)
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card?.querySelector('input')?.focus({ preventScroll: true })
    }, 50)
  }

  const busy = submit === 'saving' || submit === 'slow'

  return shell(
    <>
      {preview && (
        <div style={{ ...statusMsg, margin: '0 0 12px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
          <b>Preview</b> as {me.name}. Submitting is disabled{meta?.open ? '' : ', and voting is currently closed'}.
        </div>
      )}

      {/* Who this ballot belongs to */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, borderTop: `4px solid ${NAVY}` }}>
        {myTeam?.logoUrl
          ? <img src={myTeam.logoUrl} alt="" style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }} />
          : null}
        <div style={{ minWidth: 0 }}>
          <div style={eyebrow}>Voting as</div>
          <div style={{ fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 900, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1.05 }}>
            {me.name}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{myTeam?.name}</div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: '#64748b', margin: '8px 4px 18px', lineHeight: 1.5 }}>
        Not you? Don't vote. Close this page and let the commissioner know. This link only works for {me.name.split(' ')[0]}.
      </p>

      <div style={{ ...card, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 18 }}>
        <div style={{ fontSize: 14, color: '#78350f', lineHeight: 1.55 }}>
          Pick one for each award. You can't vote for yourself or your own team.
          <b> Once you submit, your ballot is final.</b>
        </div>
      </div>

      {awardList.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#64748b' }}>The awards haven't been posted yet. Check back soon.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {awardList.map((award, i) => (
            <AwardCard
              key={award.id}
              index={i + 1}
              award={award}
              value={clean[award.id] ?? ''}
              noVote={!!noVote[award.id] && !clean[award.id]}
              onChange={id => choose(award.id, id)}
              players={players}
              teams={teams}
              voterId={playerId}
              excluded={excluded}
            />
          ))}
        </div>
      )}

      {/* Spacer so the sticky bar never covers the last card */}
      <div style={{ height: 96 }} />

      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
        background: 'rgba(255,255,255,0.96)', borderTop: '1px solid #e5e7eb', backdropFilter: 'blur(6px)',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 14, color: '#475569', fontWeight: 600 }}>
            <span style={{ fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 900, color: NAVY }}>{pickedCount}</span>
            {' '}of {awardList.length} picked
          </div>
          <button
            onClick={() => setSheet(unanswered.length ? 'missing' : 'review')}
            disabled={pickedCount === 0}
            style={{
              marginLeft: 'auto', height: 48, padding: '0 22px', borderRadius: 12, border: 'none',
              fontFamily: 'var(--font-score)', fontSize: 17, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: pickedCount ? RED : '#cbd5e1', color: '#ffffff', cursor: pickedCount ? 'pointer' : 'not-allowed',
            }}
          >
            Review &amp; submit
          </button>
        </div>
      </div>

      {activeSheet === 'missing' && (
        <Sheet onDismiss={() => setSheet(null)}>
          <div style={sheetTitle}>
            You didn't pick for {unanswered.length === 1 ? 'this award' : `${unanswered.length} awards`}
          </div>
          <p style={{ fontSize: 13.5, color: '#64748b', margin: '2px 0 14px', lineHeight: 1.5 }}>
            Pick someone, or tap <b>No vote</b> if you'd rather not vote on it.
          </p>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {unanswered.map((a, i) => (
              <div key={a.id} style={{ padding: '12px 14px', borderTop: i ? '1px solid #eef2f7' : 'none' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{a.name}</div>
                {a.description && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 1 }}>{a.description}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => pickNow(a.id)}
                    style={{ flex: 1, height: 44, borderRadius: 10, border: 'none', background: NAVY, color: '#ffffff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {a.kind === 'team' ? 'Pick a team' : 'Pick someone'}
                  </button>
                  <button
                    onClick={() => setNoVote(n => ({ ...n, [a.id]: true }))}
                    style={{ flex: 1, height: 44, borderRadius: 10, border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    No vote
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSheet(null)}
            style={{ marginTop: 14, width: '100%', height: 46, borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Back to my ballot
          </button>
        </Sheet>
      )}

      {activeSheet === 'review' && (
        <Sheet onDismiss={() => (busy ? undefined : setSheet(null))}>
            <div style={sheetTitle}>Review your ballot</div>
            <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 14px' }}>Voting as {me.name}. Submitting is final.</p>
            <PickSummary awards={awardList} picks={clean} players={players} teams={teams} />

            {submit === 'slow' && (
              <p style={{ ...statusMsg, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                Still sending… your connection looks slow. Keep this page open and it will finish on its own.
              </p>
            )}
            {submit === 'preview' && (
              <p style={{ ...statusMsg, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                Preview only. Nothing was submitted.
              </p>
            )}
            {submit === 'error' && (
              <p style={{ ...statusMsg, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                Your ballot wasn't accepted. Voting may have just closed, or this link was already used.
                Contact the commissioner if that seems wrong.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setSheet(null)}
                disabled={busy}
                style={{ height: 50, padding: '0 18px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              >
                Go back
              </button>
              <button
                onClick={doSubmit}
                disabled={busy}
                style={{
                  flex: 1, height: 50, borderRadius: 12, border: 'none', background: RED, color: '#ffffff',
                  fontFamily: 'var(--font-score)', fontSize: 18, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer', opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? 'Submitting…' : 'Submit final ballot'}
              </button>
            </div>
        </Sheet>
      )}
    </>,
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Shell({ title, logo, children }: { title: string; logo: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'var(--font-ui)' }}>
      <div style={{ background: NAVY, borderBottom: `4px solid ${RED}` }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          {logo && <img src={logo} alt="" style={{ width: 46, height: 46, objectFit: 'contain' }} />}
          <div>
            <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 'clamp(22px, 6vw, 28px)', fontWeight: 900, color: '#ffffff', letterSpacing: '0.04em', margin: 0, textTransform: 'uppercase', lineHeight: 1.05 }}>
              {title}
            </h1>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '2px 0 0' }}>
              Official player ballot
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px', boxSizing: 'border-box' }}>{children}</div>
    </div>
  )
}

function AwardCard({ index, award, value, noVote, onChange, players, teams, voterId, excluded }: {
  index: number
  award: AwardEntry
  value: string
  noVote: boolean
  onChange: (id: string) => void
  players: PlayersMap
  teams: TeamsMap
  voterId: string
  excluded: VotingExcluded
}) {
  const options = useMemo(() => optionsForAward(award, players, teams, voterId, excluded), [award, players, teams, voterId, excluded])
  const finalists = award.candidates ? candidateIds(award).length : 0
  const done = !!value

  return (
    <div id={`award-${award.id}`} style={{ ...card, borderLeft: `4px solid ${done ? '#16a34a' : '#cbd5e1'}`, transition: 'border-color 0.2s', scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center',
          background: done ? '#16a34a' : noVote ? '#94a3b8' : NAVY, color: '#ffffff', fontFamily: 'var(--font-score)', fontWeight: 900, fontSize: 15,
        }}>
          {done ? '✓' : noVote ? '–' : index}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-score)', fontSize: 21, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1.1 }}>
              {award.name}
            </span>
            {award.kind === 'team' && <Chip>Team award</Chip>}
            {finalists > 0 && <Chip>{finalists} finalists</Chip>}
            {noVote && <Chip>No vote</Chip>}
          </div>
          {award.description && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{award.description}</div>}
        </div>
      </div>
      <SearchSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={award.kind === 'team' ? 'Search teams…' : 'Search players…'}
        emptyText={award.kind === 'team' ? 'No teams match.' : 'No players match.'}
      />
    </div>
  )
}

function PickSummary({ awards, picks, players, teams }: {
  awards: AwardEntry[]
  picks: Record<string, string>
  players: PlayersMap
  teams: TeamsMap
}) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {awards.map((a, i) => {
        const pick = picks[a.id]
        const opt = pick ? optionLabel(a, pick, players, teams) : null
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: i ? '1px solid #eef2f7' : 'none' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={eyebrow}>{a.name}</div>
              {opt
                ? <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{opt.name} <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>{opt.sub}</span></div>
                : <div style={{ fontSize: 14, fontStyle: 'italic', color: '#94a3b8' }}>No vote</div>}
            </div>
            {opt?.logo && <img src={opt.logo} alt="" style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }} />}
          </div>
        )
      })}
    </div>
  )
}

/** Bottom sheet over a dimmed backdrop; tapping the backdrop calls onDismiss. */
function Sheet({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onDismiss}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#f8fafc', width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto',
          borderRadius: '18px 18px 0 0', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Notice({ icon, heading, tone, children }: { icon: string; heading: string; tone?: 'success'; children: React.ReactNode }) {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '28px 20px', marginBottom: 16, borderTop: `4px solid ${tone === 'success' ? '#16a34a' : NAVY}` }}>
      <div style={{ fontSize: 40, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 900, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '10px 0 6px' }}>
        {heading}
      </div>
      <div style={{ fontSize: 14.5, color: '#475569', lineHeight: 1.55, maxWidth: 440, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: NAVY, background: 'rgba(30,58,95,0.08)', borderRadius: 999, padding: '3px 8px' }}>
      {children}
    </span>
  )
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const card: React.CSSProperties = {
  background: '#ffffff', borderRadius: 14, border: '1px solid #e5e7eb', padding: 16,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)', boxSizing: 'border-box',
}

const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em',
}

const statusMsg: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.5, borderRadius: 10, padding: '10px 12px', margin: '12px 0 0',
}

const sheetTitle: React.CSSProperties = {
  fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em',
}
