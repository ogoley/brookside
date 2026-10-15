/**
 * Controller panel for the playoffs: global on/off switch, bracket setup,
 * per-slot winner overrides, and the corner-logo quick switch. Collapses to
 * one header row + the logo switch (rarely touched mid-game); the Bracket
 * scene button lives in the Scene grid while playoff mode is on.
 *
 * Writes: /postseason/meta, /postseason/brackets/{season}, /overlay/roundTag.
 */
import { useState } from 'react'
import { ref, update, set } from 'firebase/database'
import { db } from '../firebase'
import { usePostseason } from '../hooks/usePostseason'
import { SLOTS, ROUND_LABEL, ROUND_SHORT, BRACKET_2026, slotWhen, type SlotId } from '../postseason/bracket'
import type { RoundTagMode, TeamsMap } from '../types'

const GOLD = '#fbbf24'

const TAG_MODES: { id: RoundTagMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'auto', label: 'Auto' },
  { id: 'qf', label: 'QF' },
  { id: 'sf', label: 'SF' },
  { id: 'final', label: 'Final' },
]

const COLLAPSE_KEY = 'controller.playoffsCollapsed'

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) !== '0' } catch { return true }
}

export function PlayoffsControlSection({ teams, roundTag, timerVisible }: {
  teams: TeamsMap
  roundTag: RoundTagMode
  timerVisible: boolean
}) {
  const { meta, config, bracket } = usePostseason()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* per-viewer nicety only */ }
      return !c
    })
  }
  const name = (id?: string | null) => (id ? teams[id]?.shortName ?? id : 'TBD')

  const setActive = (active: boolean) =>
    update(ref(db, 'postseason/meta'), { active, season: meta.season })

  const loadBracket = () => set(ref(db, `postseason/brackets/${BRACKET_2026.season}`), BRACKET_2026)

  const setOverride = (slot: SlotId, teamId: string | null) =>
    set(ref(db, `postseason/brackets/${meta.season}/slots/${slot}/winnerOverride`), teamId)

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: '#161b27', border: `1px solid ${meta.active ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.08)'}` }}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={toggleCollapsed} className="flex items-center gap-2 min-w-0 text-left" aria-expanded={!collapsed}>
          <span className="text-white/40 text-xs w-3">{collapsed ? '▸' : '▾'}</span>
          <h2 className="text-white/50 text-xs font-semibold uppercase tracking-widest truncate" style={{ fontFamily: 'var(--font-score)' }}>
            🏆 Playoffs {meta.season}{bracket ? ` · ${bracket.champion ? 'Champions crowned' : ROUND_LABEL[bracket.currentRound]}` : ''}
          </h2>
        </button>
        <button
          onClick={() => setActive(!meta.active)}
          className="h-9 px-3 rounded-lg text-xs font-bold uppercase tracking-wider"
          style={{
            background: meta.active ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.06)',
            color: meta.active ? GOLD : 'rgba(255,255,255,0.5)',
            border: `1px solid ${meta.active ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}`,
          }}
        >
          Playoff mode {meta.active ? '● ON' : '○ OFF'}
        </button>
      </div>
      {!collapsed && (
        <p className="text-white/35 text-xs leading-snug">
          When on, new games between bracket opponents are playoff games (their stats stay out of the regular season), the
          at-bat strip shows a second playoff row, and a 🏆 Bracket button appears in the Scene grid.
        </p>
      )}

      {!config ? (
        <button onClick={loadBracket} className="h-12 rounded-xl font-bold text-sm uppercase tracking-wider"
          style={{ background: GOLD, color: '#111' }}>
          Load {BRACKET_2026.season} bracket
        </button>
      ) : (
        <>
          {/* Scorebug round tag quick switch */}
          <div className="flex flex-col gap-1.5">
            <span className="text-white/40 text-[11px] uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
              Scorebug round tag{roundTag === 'auto' && bracket ? ` · auto = ${ROUND_LABEL[bracket.currentRound]}` : ''}
              {timerVisible && roundTag !== 'off' && <span className="normal-case tracking-normal text-amber-400/80"> · hidden while the countdown timer is shown</span>}
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {TAG_MODES.map(m => (
                <button key={m.id} onClick={() => update(ref(db, 'overlay'), { roundTag: m.id })}
                  className="h-10 rounded-lg text-xs font-bold uppercase"
                  style={{
                    background: roundTag === m.id ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.06)',
                    color: roundTag === m.id ? '#fff' : 'rgba(255,255,255,0.65)',
                    border: `1px solid ${roundTag === m.id ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bracket slots: status + winner override */}
          {bracket && !collapsed && (
            <div className="flex flex-col gap-1.5">
              <span className="text-white/40 text-[11px] uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                Bracket — winners fill in when a playoff game is finalized
              </span>
              {SLOTS.map(def => {
                const s = bracket.slots[def.id]
                const teamsKnown = s.high && s.low
                return (
                  <div key={def.id} className="rounded-lg px-3 py-2 flex flex-col gap-1.5"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-white/85 font-semibold">
                        <span className="text-white/35 text-xs mr-1.5" style={{ fontFamily: 'var(--font-score)' }}>{ROUND_SHORT[def.round]}</span>
                        {s.high ? `(${s.high.seed}) ${name(s.high.teamId)}` : 'TBD'} v {s.low ? `(${s.low.seed}) ${name(s.low.teamId)}` : 'TBD'}
                      </span>
                      <span className="text-xs font-bold shrink-0" style={{
                        color: s.status === 'final' ? GOLD : s.status === 'live' ? '#4ade80' : 'rgba(255,255,255,0.35)',
                      }}>
                        {s.status === 'final' ? `${name(s.winner?.teamId)} won${s.overridden ? ' (set)' : ''}`
                          : s.status === 'live' ? 'LIVE' : s.status === 'scheduled' ? 'Up next' : 'Waiting'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/30 text-xs">{slotWhen(s.config)}</span>
                      {teamsKnown && (
                        <select
                          value={s.config.winnerOverride ?? ''}
                          onChange={e => setOverride(def.id, e.target.value || null)}
                          className="h-8 rounded-md px-2 text-xs"
                          style={{ background: '#0d1117', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}
                        >
                          <option value="">Winner: from game</option>
                          <option value={s.high!.teamId}>Set winner: {name(s.high!.teamId)}</option>
                          <option value={s.low!.teamId}>Set winner: {name(s.low!.teamId)}</option>
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
              {bracket.champion && (
                <p className="text-center text-sm font-black uppercase tracking-widest" style={{ color: GOLD, fontFamily: 'var(--font-score)' }}>
                  🏆 {teams[bracket.champion.teamId]?.name} — Champions
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
