/**
 * Controller side of awards night. The "🏅 Awards" scene button puts the
 * awards board on air and opens this modal: one row per award (ballot order)
 * with Spotlight / Reveal / Hide, plus Board (close the spotlight) and Hide all.
 *
 * The overlay can't read ballots (/voting is admin-only), so this panel —
 * logged in as admin — tallies them here and copies an award's top 3 into
 * /overlay/awardsReveal/results only at the moment it's revealed. Unrevealed
 * winners never sit in the public overlay data.
 */
import { useEffect, useState } from 'react'
import { ref, get, update } from 'firebase/database'
import { db } from '../firebase'
import type { AwardsMap, AwardsRevealState, BallotsMap, PlayersMap, TeamsMap } from '../types'
import { sortedAwards, awardIcon, revealTopRows, type AwardEntry } from '../voting/logic'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; awards: AwardEntry[]; ballots: BallotsMap; title: string }

const R = 'overlay/awardsReveal'

export function AwardsRevealControl({ state, players, teams, onAir, onPutOnAir, onClose }: {
  state: AwardsRevealState
  players: PlayersMap
  teams: TeamsMap
  onAir: boolean
  onPutOnAir: () => void
  onClose: () => void
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [peek, setPeek] = useState(false)

  // Read the awards + ballots once per open and publish the (winner-free) board.
  useEffect(() => {
    let cancelled = false
    Promise.all([get(ref(db, 'voting/awards')), get(ref(db, 'voting/ballots')), get(ref(db, 'voting/meta'))])
      .then(async ([a, b, m]) => {
        const awards = sortedAwards((a.val() ?? {}) as AwardsMap)
        const title = (m.val()?.title as string | undefined) || `${new Date().getFullYear()} Season Awards`
        const board = Object.fromEntries(awards.map(aw => [aw.id, {
          name: aw.name, order: aw.order ?? 0, description: aw.description ?? null, icon: awardIcon(aw),
        }]))
        await update(ref(db, R), { board, title })
        if (!cancelled) setLoad({ status: 'ready', awards, ballots: (b.val() ?? {}) as BallotsMap, title })
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => { cancelled = true }
  }, [])

  const spotlight = (id: string | null) => update(ref(db, R), { spotlight: id })
  const reveal = (aw: AwardEntry) => {
    if (load.status !== 'ready') return
    const result = revealTopRows(aw, load.ballots, players, teams)
    return update(ref(db, R), { [`results/${aw.id}`]: result, spotlight: aw.id })
  }
  const hide = (id: string) => update(ref(db, R), { [`results/${id}`]: null, ...(state.spotlight === id ? { spotlight: null } : {}) })
  const hideAll = () => update(ref(db, R), { results: null, spotlight: null })

  const revealedCount = Object.keys(state.results).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.12)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-white text-sm font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Awards Reveal</h2>
            <p className="text-white/40 text-xs mt-0.5">{revealedCount} revealed · {onAir ? 'board on air' : 'board NOT on air'}</p>
          </div>
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }}>Close</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onPutOnAir}
            className="h-12 rounded-xl text-sm font-bold"
            style={onAir ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.4)' } : { background: '#1d4ed8', color: '#fff' }}
          >
            {onAir ? '● On air' : 'Put on air'}
          </button>
          <button
            onClick={() => spotlight(null)}
            disabled={!state.spotlight}
            className="h-12 rounded-xl text-sm font-bold"
            style={{ background: 'rgba(255,255,255,0.07)', color: state.spotlight ? '#fff' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            ⬅ Board
          </button>
          <button
            onClick={() => { if (revealedCount === 0 || window.confirm('Re-seal every award?')) void hideAll() }}
            className="h-12 rounded-xl text-sm font-bold"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            Hide all
          </button>
        </div>

        {load.status === 'loading' && <p className="text-white/50 text-sm py-6 text-center">Loading results…</p>}
        {load.status === 'error' && (
          <p className="text-red-300 text-sm py-4">Couldn't read the votes ({load.message}). Log in to the controller as an admin to run the reveal.</p>
        )}
        {load.status === 'ready' && load.awards.map(aw => {
          const revealed = !!state.results[aw.id]
          const spot = state.spotlight === aw.id
          const preview = peek ? revealTopRows(aw, load.ballots, players, teams).top.filter(r => r.rank === 1).map(r => r.name).join(' / ') : ''
          return (
            <div
              key={aw.id}
              className="rounded-xl p-2.5 flex flex-col gap-2"
              style={{
                background: spot ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${spot ? 'rgba(251,191,36,0.6)' : revealed ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {awardIcon(aw) && <img src={awardIcon(aw)!} alt="" className="w-7 h-7 shrink-0" />}
                <span className="text-white text-sm font-bold truncate">{aw.name}</span>
                <span className="ml-auto text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ fontFamily: 'var(--font-score)', color: revealed ? '#fbbf24' : 'rgba(255,255,255,0.35)' }}>
                  {spot ? (revealed ? 'Spotlight · revealed' : 'Spotlight · sealed') : revealed ? 'Revealed' : 'Sealed'}
                </span>
              </div>
              {preview && <div className="text-xs text-amber-200/70 -mt-1 pl-9 truncate">🤫 {preview}</div>}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => spotlight(spot ? null : aw.id)}
                  className="h-11 rounded-lg text-sm font-bold"
                  style={spot ? { background: '#fbbf24', color: '#111' } : { background: 'rgba(255,255,255,0.08)', color: '#fff' }}
                >
                  {spot ? 'Spotlit' : 'Spotlight'}
                </button>
                <button
                  onClick={() => void reveal(aw)}
                  disabled={revealed && spot}
                  className="h-11 rounded-lg text-sm font-bold"
                  style={revealed && spot ? { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' } : { background: '#b45309', color: '#fff' }}
                >
                  {revealed ? 'Re-show' : 'Reveal'}
                </button>
                <button
                  onClick={() => void hide(aw.id)}
                  disabled={!revealed}
                  className="h-11 rounded-lg text-sm font-semibold"
                  style={{ background: 'rgba(255,255,255,0.05)', color: revealed ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)' }}
                >
                  Hide
                </button>
              </div>
            </div>
          )
        })}

        {load.status === 'ready' && (
          <label className="flex items-center gap-2 text-xs text-white/40 pt-1 select-none">
            <input type="checkbox" checked={peek} onChange={e => setPeek(e.target.checked)} />
            Peek at winners in this panel (only you see it)
          </label>
        )}
      </div>
    </div>
  )
}
