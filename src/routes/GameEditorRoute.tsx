import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { ref, onValue, update, set, get } from 'firebase/database'
import { db } from '../firebase'
import { useGames } from '../hooks/useGames'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import { useGameStats } from '../hooks/useGameStats'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import type { GameSummary, GameRecord, PlayersMap, TeamsMap, AtBatRecord } from '../types'

const INNINGS_PER_GAME = 7

// ── IP helpers ────────────────────────────────────────────────────────────────

function formatIp(ip: number): string {
  const full = Math.floor(ip)
  const partial = Math.round((ip - full) * 3)
  return partial === 0 ? `${full}` : `${full}.${partial}`
}

/** Baseball IP notation: "6" → 6.0, "6.2" → 6+2/3 (stored as 6.6̄) */
function parseIpInput(s: string): number | null {
  const t = s.trim()
  if (t === '') return 0
  const dot = t.indexOf('.')
  if (dot === -1) {
    const n = parseInt(t, 10)
    return isNaN(n) || n < 0 ? null : n
  }
  const full = parseInt(t.slice(0, dot), 10)
  const partial = parseInt(t.slice(dot + 1), 10)
  if (isNaN(full) || isNaN(partial) || partial > 2 || partial < 0) return null
  const outs = full * 3 + partial
  return Math.floor(outs / 3) + (outs % 3) / 3
}

// ── Result labels ─────────────────────────────────────────────────────────────

const RESULT_LABELS: Record<string, string> = {
  single: '1B', double: '2B', triple: '3B', home_run: 'HR',
  walk: 'BB', strikeout: 'K', strikeout_looking: 'Kl',
  groundout: 'GO', popout: 'PO', flyout: 'FO',
  hbp: 'HBP', sacrifice_fly: 'SF', sacrifice_bunt: 'SH',
  fielders_choice: 'FC', pitchers_poison: 'PP',
}

// ── Season recalc from game summaries ─────────────────────────────────────────

function recalcSeasonStats(
  allSummaries: Record<string, Record<string, GameSummary>>,
  players: PlayersMap,
): Record<string, unknown> {
  const hAgg: Record<string, {
    gp: number; pa: number; ab: number; h: number
    doubles: number; triples: number; hr: number
    r: number; rbi: number; bb: number; k: number
  }> = {}

  const pAgg: Record<string, {
    gp: number; outs: number; k: number; bb: number; ra: number
  }> = {}

  for (const gameSums of Object.values(allSummaries)) {
    const seenH = new Set<string>()
    const seenP = new Set<string>()

    for (const s of Object.values(gameSums)) {
      if ((s.pa ?? 0) > 0 || (s.ab ?? 0) > 0) {
        if (!hAgg[s.playerId]) hAgg[s.playerId] = {
          gp: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0,
        }
        const h = hAgg[s.playerId]
        h.pa += s.pa ?? 0; h.ab += s.ab ?? 0; h.h += s.h ?? 0
        h.doubles += s.doubles ?? 0; h.triples += s.triples ?? 0; h.hr += s.hr ?? 0
        h.r += s.r ?? 0; h.rbi += s.rbi ?? 0; h.bb += s.bb ?? 0; h.k += s.k ?? 0
        if (!seenH.has(s.playerId)) { h.gp++; seenH.add(s.playerId) }
      }

      if ((s.inningsPitched ?? 0) > 0) {
        if (!pAgg[s.playerId]) pAgg[s.playerId] = { gp: 0, outs: 0, k: 0, bb: 0, ra: 0 }
        const p = pAgg[s.playerId]
        p.outs += Math.round((s.inningsPitched ?? 0) * 3)
        p.k += s.pitchingK ?? 0
        p.bb += s.pitchingBb ?? 0
        p.ra += s.runsAllowed ?? 0
        if (!seenP.has(s.playerId)) { p.gp++; seenP.add(s.playerId) }
      }
    }
  }

  const updates: Record<string, unknown> = {}

  for (const [playerId, agg] of Object.entries(hAgg)) {
    const avg = agg.ab > 0 ? Math.round((agg.h / agg.ab) * 1000) / 1000 : 0
    const obp = agg.pa > 0 ? Math.round(((agg.h + agg.bb) / agg.pa) * 1000) / 1000 : 0
    const singles = agg.h - agg.doubles - agg.triples - agg.hr
    const tb = singles + agg.doubles * 2 + agg.triples * 3 + agg.hr * 4
    const slg = agg.ab > 0 ? Math.round((tb / agg.ab) * 1000) / 1000 : 0
    updates[`players/${playerId}/stats/hitting`] = {
      gp: agg.gp, pa: agg.pa, ab: agg.ab, h: agg.h,
      doubles: agg.doubles, triples: agg.triples, hr: agg.hr,
      r: agg.r, rbi: agg.rbi, bb: agg.bb, k: agg.k,
      avg, obp, slg, ops: Math.round((obp + slg) * 1000) / 1000,
    }
  }

  for (const [playerId, agg] of Object.entries(pAgg)) {
    const ip = Math.floor(agg.outs / 3) + (agg.outs % 3) / 3
    const era = ip > 0 ? Math.round((agg.ra / ip) * INNINGS_PER_GAME * 100) / 100 : 0
    const existing = players[playerId]?.stats?.pitching ?? {}
    updates[`players/${playerId}/stats/pitching`] = {
      ...existing,
      gp: agg.gp,
      inningsPitched: Math.round(ip * 100) / 100,
      k: agg.k,
      bb: agg.bb,
      runsAllowed: agg.ra,
      era,
    }
  }

  return updates
}

// ── Shared cell style ─────────────────────────────────────────────────────────

const cellInput: CSSProperties = {
  width: 44, textAlign: 'center', padding: '3px 2px',
  border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 13, fontFamily: 'var(--font-ui)',
  background: '#fff',
}

const cellInputDirty: CSSProperties = {
  ...cellInput,
  background: '#fffbeb', borderColor: '#f59e0b',
}

// ── IpInput — controlled text input with baseball IP notation ─────────────────

function IpInput({
  value, onChange, dirty,
}: {
  value: number; onChange: (v: number) => void; dirty?: boolean
}) {
  const [text, setText] = useState(formatIp(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(formatIp(value))
  }, [value, focused])

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onFocus={() => { setFocused(true) }}
      onBlur={() => {
        setFocused(false)
        const parsed = parseIpInput(text)
        if (parsed !== null) { onChange(parsed); setText(formatIp(parsed)) }
        else setText(formatIp(value))
      }}
      style={{ ...(dirty ? cellInputDirty : cellInput), width: 52 }}
    />
  )
}

// ── NumInput ──────────────────────────────────────────────────────────────────

function NumInput({
  value, onChange, dirty,
}: {
  value: number; onChange: (v: number) => void; dirty?: boolean
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={e => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v) && v >= 0) onChange(v)
      }}
      style={dirty ? cellInputDirty : cellInput}
    />
  )
}

// ── Game label helper ─────────────────────────────────────────────────────────

function gameLabel(game: GameRecord, teams: TeamsMap): string {
  const away = teams[game.awayTeamId]?.shortName ?? game.awayTeamId
  const home = teams[game.homeTeamId]?.shortName ?? game.homeTeamId
  const finFlag = game.finalized ? '' : ' — NOT FINALIZED'
  return `${away} @ ${home} — ${game.date}${finFlag}`
}

// ── Trace panel ───────────────────────────────────────────────────────────────

type TraceTab = 'pitcher' | 'batter' | 'runs'

function TracePanel({
  atBats, players, teams, awayTeamId, homeTeamId,
}: {
  atBats: AtBatRecord[]
  players: PlayersMap
  teams: TeamsMap
  awayTeamId: string
  homeTeamId: string
}) {
  const [tab, setTab] = useState<TraceTab>('pitcher')
  const [pitcherId, setPitcherId] = useState<string | null>(null)
  const [batterId, setBatterId] = useState<string | null>(null)

  // All pitchers in this game
  const pitchers = useMemo(() => {
    const ids = new Set<string>()
    for (const ab of atBats) { if (ab.pitcherId) ids.add(ab.pitcherId) }
    return [...ids]
  }, [atBats])

  // All batters in this game
  const batters = useMemo(() => {
    const ids = new Set<string>()
    for (const ab of atBats) { if (ab.batterId) ids.add(ab.batterId) }
    return [...ids]
  }, [atBats])

  useEffect(() => {
    if (!pitcherId && pitchers.length > 0) setPitcherId(pitchers[0])
  }, [pitchers, pitcherId])

  useEffect(() => {
    if (!batterId && batters.length > 0) setBatterId(batters[0])
  }, [batters, batterId])

  // Pitcher trace: at-bats by selected pitcher with running outs
  const pitcherTrace = useMemo(() => {
    if (!pitcherId) return []
    let runningOuts = 0
    return atBats
      .filter(ab => ab.pitcherId === pitcherId)
      .map(ab => {
        runningOuts += ab.outsOnPlay
        return { ab, runningOuts, ip: formatIp(Math.floor(runningOuts / 3) + (runningOuts % 3) / 3) }
      })
  }, [atBats, pitcherId])

  // Batter trace: all at-bats by selected batter with full play context
  const batterTrace = useMemo(() => {
    if (!batterId) return []
    return atBats.filter(ab => ab.batterId === batterId)
  }, [atBats, batterId])

  // Run trace: all scoring plays
  const runTrace = useMemo(() => {
    const plays: { ab: AtBatRecord; scorerIds: string[] }[] = []
    for (const ab of atBats) {
      const scorers: string[] = []
      if (ab.batterAdvancedTo === 'home') scorers.push(ab.batterId)
      for (const id of (ab.runnersScored ?? [])) {
        if (!scorers.includes(id)) scorers.push(id)
      }
      if (scorers.length > 0) plays.push({ ab, scorerIds: scorers })
    }
    return plays
  }, [atBats])

  const th: CSSProperties = {
    padding: '6px 8px', fontSize: 11, fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em',
    textAlign: 'left', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const td: CSSProperties = {
    padding: '5px 8px', fontSize: 12, color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div style={{ fontFamily: 'var(--font-ui)' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 12 }}>
        {(['pitcher', 'batter', 'runs'] as TraceTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: 'none', background: 'none',
              color: tab === t ? '#1e3a5f' : '#6b7280',
              borderBottom: tab === t ? '2px solid #1e3a5f' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap',
            }}
          >
            {t === 'pitcher' ? 'Pitcher' : t === 'batter' ? 'Batter' : 'Runs'}
          </button>
        ))}
      </div>

      {tab === 'pitcher' && (
        <>
          <select
            value={pitcherId ?? ''}
            onChange={e => setPitcherId(e.target.value)}
            style={{
              marginBottom: 12, padding: '6px 10px', fontSize: 13,
              border: '1px solid #d1d5db', borderRadius: 6,
              fontFamily: 'var(--font-ui)', width: '100%',
            }}
          >
            {pitchers.map(id => {
              const side = players[id]?.teamId === awayTeamId
                ? (teams[awayTeamId]?.shortName ?? 'Away')
                : (teams[homeTeamId]?.shortName ?? 'Home')
              return (
                <option key={id} value={id}>
                  {players[id]?.name ?? id} ({side})
                </option>
              )
            })}
          </select>

          {pitcherTrace.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 20 }}>No at-bats found</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Inn</th>
                    <th style={th}>Batter</th>
                    <th style={th}>Result</th>
                    <th style={{ ...th, textAlign: 'center' }}>Outs</th>
                    <th style={{ ...th, textAlign: 'center' }}>Run IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pitcherTrace.map(({ ab, runningOuts, ip }, i) => (
                    <tr key={i} style={{ background: ab.outsOnPlay > 0 ? '#f9fafb' : '#fff' }}>
                      <td style={{ ...td, fontFamily: 'var(--font-score)', fontSize: 13 }}>
                        {ab.isTopInning ? '▲' : '▼'}{ab.inning}
                      </td>
                      <td style={td}>{players[ab.batterId]?.name ?? ab.batterId}</td>
                      <td style={{ ...td, fontWeight: 600 }}>
                        <span style={{
                          display: 'inline-block', padding: '1px 6px', borderRadius: 3,
                          background: ['strikeout', 'strikeout_looking', 'groundout', 'popout', 'flyout'].includes(ab.result) ? '#fee2e2' : ['single', 'double', 'triple', 'home_run'].includes(ab.result) ? '#dcfce7' : ab.result === 'walk' ? '#dbeafe' : '#f3f4f6',
                          color: ['strikeout', 'strikeout_looking', 'groundout', 'popout', 'flyout'].includes(ab.result) ? '#dc2626' : ['single', 'double', 'triple', 'home_run'].includes(ab.result) ? '#16a34a' : ab.result === 'walk' ? '#2563eb' : '#374151',
                          fontSize: 12,
                        }}>
                          {RESULT_LABELS[ab.result] ?? ab.result}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-score)' }}>
                        {runningOuts}
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-score)', fontWeight: 700 }}>
                        {ip}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{
                marginTop: 10, padding: '8px 12px', background: '#1e3a5f', borderRadius: 6,
                display: 'flex', gap: 20,
              }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  Final IP: <strong style={{ color: '#fff', fontFamily: 'var(--font-score)' }}>
                    {pitcherTrace[pitcherTrace.length - 1]?.ip ?? '0'}
                  </strong>
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  K: <strong style={{ color: '#fff' }}>
                    {pitcherTrace.filter(r => r.ab.result === 'strikeout' || r.ab.result === 'strikeout_looking').length}
                  </strong>
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  BB: <strong style={{ color: '#fff' }}>
                    {pitcherTrace.filter(r => r.ab.result === 'walk').length}
                  </strong>
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  R: <strong style={{ color: '#fff' }}>
                    {pitcherTrace.reduce((acc, r) => acc + (r.ab.runnersScored?.length ?? 0) + (r.ab.batterAdvancedTo === 'home' ? 1 : 0), 0)}
                  </strong>
                </span>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'batter' && (
        <>
          <select
            value={batterId ?? ''}
            onChange={e => setBatterId(e.target.value)}
            style={{
              marginBottom: 12, padding: '6px 10px', fontSize: 13,
              border: '1px solid #d1d5db', borderRadius: 6,
              fontFamily: 'var(--font-ui)', width: '100%',
            }}
          >
            {batters.map(id => {
              const side = players[id]?.teamId === awayTeamId
                ? (teams[awayTeamId]?.shortName ?? 'Away')
                : (teams[homeTeamId]?.shortName ?? 'Home')
              return (
                <option key={id} value={id}>
                  {players[id]?.name ?? id} ({side})
                </option>
              )
            })}
          </select>

          {batterTrace.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 20 }}>No at-bats found</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Inn</th>
                    <th style={th}>Pitcher</th>
                    <th style={th}>Situation</th>
                    <th style={th}>Result</th>
                    <th style={th}>Advanced</th>
                    <th style={{ ...th, textAlign: 'center' }}>RBI</th>
                    <th style={th}>Drove In</th>
                  </tr>
                </thead>
                <tbody>
                  {batterTrace.map((ab, i) => {
                    // Runners on base before the play
                    const on = ab.runnersOnBase ?? { first: null, second: null, third: null }
                    const basesOccupied = [
                      on.first ? '1st' : null,
                      on.second ? '2nd' : null,
                      on.third ? '3rd' : null,
                    ].filter(Boolean)

                    // Who scored on this play (excluding the batter themselves for non-HR)
                    const runnersScored = (ab.runnersScored ?? []).filter(id => id !== ab.batterId)
                    const batterScored = ab.batterAdvancedTo === 'home'

                    // Outcome badge colors
                    const isHit = ['single', 'double', 'triple', 'home_run'].includes(ab.result)
                    const isOut = ['strikeout', 'strikeout_looking', 'groundout', 'popout', 'flyout'].includes(ab.result)
                    const isWalk = ab.result === 'walk'

                    const advancedLabel = ab.batterAdvancedTo === null ? '—'
                      : ab.batterAdvancedTo === 'out' ? 'Out'
                      : ab.batterAdvancedTo === 'home' ? 'Scored'
                      : ab.batterAdvancedTo === 'first' ? '1st'
                      : ab.batterAdvancedTo === 'second' ? '2nd'
                      : ab.batterAdvancedTo === 'third' ? '3rd'
                      : ab.batterAdvancedTo

                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ ...td, color: '#9ca3af', width: 24 }}>{i + 1}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-score)', fontSize: 13 }}>
                          {ab.isTopInning ? '▲' : '▼'}{ab.inning}
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {ab.pitcherId ? players[ab.pitcherId]?.name ?? ab.pitcherId : '—'}
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {basesOccupied.length === 0
                            ? <span style={{ color: '#9ca3af' }}>Bases empty</span>
                            : basesOccupied.join(', ')}
                        </td>
                        <td style={td}>
                          <span style={{
                            display: 'inline-block', padding: '2px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600,
                            background: isHit ? '#dcfce7' : isOut ? '#fee2e2' : isWalk ? '#dbeafe' : '#f3f4f6',
                            color: isHit ? '#16a34a' : isOut ? '#dc2626' : isWalk ? '#2563eb' : '#374151',
                          }}>
                            {RESULT_LABELS[ab.result] ?? ab.result}
                          </span>
                        </td>
                        <td style={{
                          ...td, fontSize: 12, fontWeight: 600,
                          color: batterScored ? '#16a34a' : ab.batterAdvancedTo === 'out' ? '#dc2626' : '#374151',
                        }}>
                          {advancedLabel}
                        </td>
                        <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-score)', fontWeight: 700 }}>
                          {ab.rbiCount > 0
                            ? <span style={{ color: '#16a34a' }}>{ab.rbiCount}</span>
                            : <span style={{ color: '#d1d5db' }}>—</span>}
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {runnersScored.length === 0 && !batterScored ? (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          ) : (
                            <div>
                              {runnersScored.map(id => (
                                <div key={id}>{players[id]?.name ?? id}</div>
                              ))}
                              {batterScored && ab.result === 'home_run' && (
                                <div style={{ color: '#6b7280', fontSize: 11 }}>(HR — self)</div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Summary bar */}
              <div style={{
                marginTop: 10, padding: '8px 12px', background: '#1e3a5f', borderRadius: 6,
                display: 'flex', gap: 16, flexWrap: 'wrap',
              }}>
                {[
                  { label: 'AB', val: batterTrace.filter(ab => !['walk', 'hbp', 'sacrifice_fly', 'sacrifice_bunt'].includes(ab.result)).length },
                  { label: 'H', val: batterTrace.filter(ab => ['single', 'double', 'triple', 'home_run'].includes(ab.result)).length },
                  { label: 'HR', val: batterTrace.filter(ab => ab.result === 'home_run').length },
                  { label: 'BB', val: batterTrace.filter(ab => ab.result === 'walk').length },
                  { label: 'K', val: batterTrace.filter(ab => ab.result === 'strikeout' || ab.result === 'strikeout_looking').length },
                  { label: 'RBI', val: batterTrace.reduce((acc, ab) => acc + ab.rbiCount, 0) },
                  { label: 'R', val: batterTrace.filter(ab => ab.batterAdvancedTo === 'home').length },
                ].map(({ label, val }) => (
                  <span key={label} style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                    {label}: <strong style={{ color: '#fff' }}>{val}</strong>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'runs' && (
        <>
          {runTrace.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 20 }}>No runs found in play log</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Inn</th>
                  <th style={th}>Play</th>
                  <th style={th}>Scored</th>
                  <th style={th}>Pitcher</th>
                </tr>
              </thead>
              <tbody>
                {runTrace.map(({ ab, scorerIds }, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    <td style={{ ...td, color: '#9ca3af', width: 28 }}>{i + 1}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-score)', fontSize: 13 }}>
                      {ab.isTopInning ? '▲' : '▼'}{ab.inning}
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                        {RESULT_LABELS[ab.result] ?? ab.result}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {players[ab.batterId]?.name ?? ab.batterId}
                      </div>
                    </td>
                    <td style={td}>
                      {scorerIds.map(id => (
                        <div key={id} style={{ fontSize: 12 }}>
                          {players[id]?.name ?? id}
                          {id === ab.batterId ? <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>(HR)</span> : null}
                        </div>
                      ))}
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {ab.pitcherId ? players[ab.pitcherId]?.name ?? ab.pitcherId : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

// ── BoxScoreSection ───────────────────────────────────────────────────────────

interface BoxScoreProps {
  teamId: string
  teamName: string
  teamColor: string
  players: PlayersMap
  summaries: Record<string, GameSummary>  // all summaries for this game
  edits: Record<string, Partial<GameSummary>>
  onEdit: (playerId: string, teamId: string, field: keyof GameSummary, value: number) => void
  extraBatters: string[]
  extraPitchers: string[]
  onAddBatter: (playerId: string) => void
  onAddPitcher: (playerId: string) => void
  onRemoveBatter: (playerId: string) => void
  onRemovePitcher: (playerId: string) => void
}

function BoxScoreSection({
  teamId, teamName, teamColor, players, summaries, edits,
  onEdit, extraBatters, extraPitchers,
  onAddBatter, onAddPitcher, onRemoveBatter, onRemovePitcher,
}: BoxScoreProps) {
  const [addingBatter, setAddingBatter] = useState(false)
  const [addingPitcher, setAddingPitcher] = useState(false)

  const effectiveSummary = (playerId: string): GameSummary => {
    const base: GameSummary = summaries[playerId] ?? {
      playerId, teamId,
      ab: 0, pa: 0, h: 0, doubles: 0, triples: 0, hr: 0,
      r: 0, rbi: 0, bb: 0, k: 0, inningsPitched: 0,
    }
    return { ...base, ...(edits[playerId] ?? {}) }
  }

  const isDirty = (playerId: string, field: keyof GameSummary): boolean => {
    return field in (edits[playerId] ?? {})
  }

  // Players on this team
  const teamPlayers = Object.entries(players)
    .filter(([, p]) => p.teamId === teamId)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))

  // Players who appear in summaries for this team
  const summaryBatterIds = Object.values(summaries)
    .filter(s => s.teamId === teamId && ((s.ab ?? 0) > 0 || (s.pa ?? 0) > 0))
    .map(s => s.playerId)

  const summaryPitcherIds = Object.values(summaries)
    .filter(s => s.teamId === teamId && (s.inningsPitched ?? 0) > 0)
    .map(s => s.playerId)

  const batterIds = [...new Set([...summaryBatterIds, ...extraBatters])]
  const pitcherIds = [...new Set([...summaryPitcherIds, ...extraPitchers])]

  // Available players to add (not already shown)
  const availableBatters = teamPlayers.filter(([id]) => !batterIds.includes(id))
  const availablePitchers = teamPlayers.filter(([id]) => !pitcherIds.includes(id))

  const thStyle: CSSProperties = {
    padding: '5px 6px', fontSize: 11, fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
    textAlign: 'center', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  }
  const tdLabel: CSSProperties = {
    padding: '5px 8px', fontSize: 13, color: '#111827',
    borderBottom: '1px solid #f3f4f6', textAlign: 'left',
    whiteSpace: 'nowrap', fontWeight: 500,
  }
  const tdCell: CSSProperties = {
    padding: '4px 4px', borderBottom: '1px solid #f3f4f6', textAlign: 'center',
  }
  const removeBtn: CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#d1d5db', fontSize: 14, padding: '0 4px', lineHeight: 1,
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Team header */}
      <div style={{
        background: teamColor, color: '#fff', padding: '8px 12px',
        borderRadius: '6px 6px 0 0', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: 'var(--font-score)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em' }}>
          {teamName.toUpperCase()}
        </span>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {/* ── Batting ── */}
        <div style={{ padding: '10px 12px 4px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Batting
          </span>
        </div>

        {batterIds.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>No batting records — add a player below</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 12 }}>Player</th>
                  <th style={thStyle}>AB</th>
                  <th style={thStyle}>H</th>
                  <th style={thStyle}>2B</th>
                  <th style={thStyle}>3B</th>
                  <th style={thStyle}>HR</th>
                  <th style={thStyle}>R</th>
                  <th style={thStyle}>RBI</th>
                  <th style={thStyle}>BB</th>
                  <th style={thStyle}>K</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {batterIds.map(playerId => {
                  const s = effectiveSummary(playerId)
                  const isExtra = extraBatters.includes(playerId) && !summaryBatterIds.includes(playerId)
                  return (
                    <tr key={playerId}>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>
                        {players[playerId]?.name ?? playerId}
                        {isExtra && <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>new</span>}
                      </td>
                      {(['ab', 'h', 'doubles', 'triples', 'hr', 'r', 'rbi', 'bb', 'k'] as (keyof GameSummary)[]).map(field => (
                        <td key={field} style={tdCell}>
                          <NumInput
                            value={(s[field] as number) ?? 0}
                            onChange={v => onEdit(playerId, teamId, field, v)}
                            dirty={isDirty(playerId, field)}
                          />
                        </td>
                      ))}
                      <td style={tdCell}>
                        {isExtra && (
                          <button style={removeBtn} onClick={() => onRemoveBatter(playerId)} title="Remove">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add batter */}
        <div style={{ padding: '6px 12px 8px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          {addingBatter ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                autoFocus
                style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
                defaultValue=""
                onChange={e => {
                  if (e.target.value) { onAddBatter(e.target.value); setAddingBatter(false) }
                }}
              >
                <option value="" disabled>Select player...</option>
                {availableBatters.map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
              <button onClick={() => setAddingBatter(false)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingBatter(true)}
              disabled={availableBatters.length === 0}
              style={{
                fontSize: 12, color: availableBatters.length > 0 ? '#2563eb' : '#9ca3af',
                background: 'none', border: 'none', cursor: availableBatters.length > 0 ? 'pointer' : 'default',
                padding: 0,
              }}
            >
              + Add Batter
            </button>
          )}
        </div>

        {/* ── Pitching ── */}
        <div style={{ padding: '10px 12px 4px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Pitching
          </span>
        </div>

        {pitcherIds.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>No pitching records — add a player below</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 12 }}>Player</th>
                  <th style={thStyle}>IP</th>
                  <th style={thStyle}>K</th>
                  <th style={thStyle}>BB</th>
                  <th style={thStyle}>RA</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {pitcherIds.map(playerId => {
                  const s = effectiveSummary(playerId)
                  const isExtra = extraPitchers.includes(playerId) && !summaryPitcherIds.includes(playerId)
                  return (
                    <tr key={playerId}>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>
                        {players[playerId]?.name ?? playerId}
                        {isExtra && <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>new</span>}
                      </td>
                      <td style={tdCell}>
                        <IpInput
                          value={s.inningsPitched ?? 0}
                          onChange={v => onEdit(playerId, teamId, 'inningsPitched', v)}
                          dirty={isDirty(playerId, 'inningsPitched')}
                        />
                      </td>
                      <td style={tdCell}>
                        <NumInput
                          value={s.pitchingK ?? 0}
                          onChange={v => onEdit(playerId, teamId, 'pitchingK', v)}
                          dirty={isDirty(playerId, 'pitchingK')}
                        />
                      </td>
                      <td style={tdCell}>
                        <NumInput
                          value={s.pitchingBb ?? 0}
                          onChange={v => onEdit(playerId, teamId, 'pitchingBb', v)}
                          dirty={isDirty(playerId, 'pitchingBb')}
                        />
                      </td>
                      <td style={tdCell}>
                        <NumInput
                          value={s.runsAllowed ?? 0}
                          onChange={v => onEdit(playerId, teamId, 'runsAllowed', v)}
                          dirty={isDirty(playerId, 'runsAllowed')}
                        />
                      </td>
                      <td style={tdCell}>
                        {isExtra && (
                          <button style={removeBtn} onClick={() => onRemovePitcher(playerId)} title="Remove">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add pitcher */}
        <div style={{ padding: '6px 12px 8px', background: '#f9fafb' }}>
          {addingPitcher ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                autoFocus
                style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
                defaultValue=""
                onChange={e => {
                  if (e.target.value) { onAddPitcher(e.target.value); setAddingPitcher(false) }
                }}
              >
                <option value="" disabled>Select player...</option>
                {availablePitchers.map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
              <button onClick={() => setAddingPitcher(false)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPitcher(true)}
              disabled={availablePitchers.length === 0}
              style={{
                fontSize: 12, color: availablePitchers.length > 0 ? '#2563eb' : '#9ca3af',
                background: 'none', border: 'none', cursor: availablePitchers.length > 0 ? 'pointer' : 'default',
                padding: 0,
              }}
            >
              + Add Pitcher
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main route ────────────────────────────────────────────────────────────────

export function GameEditorRoute() {
  const { games } = useGames()
  const { players } = usePlayers()
  const { teams } = useTeams()
  const { config } = useLeagueConfig()

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const selectedGame = useMemo(
    () => games.find(g => g.gameId === selectedGameId)?.game ?? null,
    [games, selectedGameId],
  )

  // Game summaries for selected game (from Firebase, live)
  const [gameSummaries, setGameSummaries] = useState<Record<string, GameSummary>>({})

  // All game summaries across all games (needed for season recalc)
  const [allSummaries, setAllSummaries] = useState<Record<string, Record<string, GameSummary>>>({})

  // At-bats for selected game (trace panel)
  const { atBats: atBatsRaw } = useGameStats(selectedGameId)
  const atBats = useMemo(
    () => Object.values(atBatsRaw).sort((a, b) => a.timestamp - b.timestamp),
    [atBatsRaw],
  )

  // Local edit state
  const [edits, setEdits] = useState<Record<string, Partial<GameSummary>>>({})

  // Manually added players (for paper stats)
  const [extraBatters, setExtraBatters] = useState<Record<string, string[]>>({}) // teamId → playerIds
  const [extraPitchers, setExtraPitchers] = useState<Record<string, string[]>>({})

  // W/L assignment (loaded from game record, editable)
  const [wPitcherId, setWPitcherId] = useState<string | null>(null)
  const [lPitcherId, setLPitcherId] = useState<string | null>(null)

  // New paper game form
  const [showNewGameForm, setShowNewGameForm] = useState(false)
  const [newGameAway, setNewGameAway] = useState('')
  const [newGameHome, setNewGameHome] = useState('')
  const [newGameDate, setNewGameDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [creatingGame, setCreatingGame] = useState(false)

  // UI state
  const [showTrace, setShowTrace] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Load game summaries when selected game changes
  useEffect(() => {
    if (!selectedGameId) { setGameSummaries({}); return }
    const unsub = onValue(ref(db, `gameSummaries/${selectedGameId}`), snap => {
      setGameSummaries(snap.exists() ? snap.val() : {})
    })
    return unsub
  }, [selectedGameId])

  // Load all summaries for season recalc
  useEffect(() => {
    const unsub = onValue(ref(db, 'gameSummaries'), snap => {
      setAllSummaries(snap.exists() ? snap.val() : {})
    })
    return unsub
  }, [])

  // Clear local state on game change; load W/L from game record
  useEffect(() => {
    setEdits({})
    setExtraBatters({})
    setExtraPitchers({})
    setSaveMsg(null)
    setWPitcherId(selectedGame?.wPitcherId ?? null)
    setLPitcherId(selectedGame?.lPitcherId ?? null)
  }, [selectedGameId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When at-bats load for a game that has no stored wPitcherId/lPitcherId,
  // derive W/L the same way computeFinalization does (most outs, min 9).
  useEffect(() => {
    if (!selectedGame || !atBats.length) return
    if (selectedGame.wPitcherId || selectedGame.lPitcherId) return // already stored

    const outsByPitcher: Record<string, number> = {}
    for (const ab of atBats) {
      if (!ab.pitcherId) continue
      outsByPitcher[ab.pitcherId] = (outsByPitcher[ab.pitcherId] ?? 0) + ab.outsOnPlay
    }

    const findBest = (teamId: string): string | null => {
      let bestId: string | null = null
      let bestOuts = 0
      for (const [pid, outs] of Object.entries(outsByPitcher)) {
        if (players[pid]?.teamId !== teamId) continue
        if (outs > bestOuts) { bestOuts = outs; bestId = pid }
      }
      return bestOuts >= 9 ? bestId : null
    }

    const winnerTeamId = selectedGame.homeScore > selectedGame.awayScore ? selectedGame.homeTeamId
      : selectedGame.awayScore > selectedGame.homeScore ? selectedGame.awayTeamId : null
    const loserTeamId = winnerTeamId === selectedGame.homeTeamId ? selectedGame.awayTeamId
      : winnerTeamId === selectedGame.awayTeamId ? selectedGame.homeTeamId : null

    if (winnerTeamId) setWPitcherId(prev => prev ?? findBest(winnerTeamId))
    if (loserTeamId) setLPitcherId(prev => prev ?? findBest(loserTeamId))
  }, [atBats]) // eslint-disable-line react-hooks/exhaustive-deps

  // All pitchers visible in the current editor (for W/L dropdowns)
  const allPitchersInGame = useMemo(() => {
    const ids = new Set<string>()
    for (const s of Object.values(gameSummaries)) {
      const eff = { ...s, ...(edits[s.playerId] ?? {}) }
      if ((eff.inningsPitched ?? 0) > 0) ids.add(s.playerId)
    }
    for (const e of Object.values(edits)) {
      if ((e.inningsPitched ?? 0) > 0 && e.playerId) ids.add(e.playerId)
    }
    for (const ids2 of Object.values(extraPitchers)) {
      for (const id of ids2) ids.add(id)
    }
    return [...ids]
  }, [gameSummaries, edits, extraPitchers])

  const isDirty = Object.keys(edits).length > 0

  // ── Edit handler ──

  const handleEdit = (playerId: string, teamId: string, field: keyof GameSummary, value: number) => {
    setEdits(prev => ({
      ...prev,
      [playerId]: { ...prev[playerId], playerId, teamId, [field]: value },
    }))
  }

  // ── Add/remove extra players ──

  const addExtraBatter = (teamId: string, playerId: string) => {
    setExtraBatters(prev => ({ ...prev, [teamId]: [...(prev[teamId] ?? []), playerId] }))
  }

  const removeExtraBatter = (teamId: string, playerId: string) => {
    setExtraBatters(prev => ({ ...prev, [teamId]: (prev[teamId] ?? []).filter(id => id !== playerId) }))
    setEdits(prev => { const next = { ...prev }; delete next[playerId]; return next })
  }

  const addExtraPitcher = (teamId: string, playerId: string) => {
    setExtraPitchers(prev => ({ ...prev, [teamId]: [...(prev[teamId] ?? []), playerId] }))
  }

  const removeExtraPitcher = (teamId: string, playerId: string) => {
    setExtraPitchers(prev => ({ ...prev, [teamId]: (prev[teamId] ?? []).filter(id => id !== playerId) }))
  }

  // ── Create paper game ──

  const handleCreateGame = async () => {
    if (!newGameAway || !newGameHome || !newGameDate) return
    setCreatingGame(true)
    try {
      // Build game ID with collision detection
      const base = `${newGameDate}_${newGameHome}_${newGameAway}`
      let gameId = base
      for (let n = 2; n <= 9; n++) {
        const snap = await get(ref(db, `games/${gameId}`))
        if (!snap.exists()) break
        gameId = `${base}_g${n}`
      }

      const record: GameRecord = {
        homeTeamId: newGameHome,
        awayTeamId: newGameAway,
        date: newGameDate,
        isStreamed: false,
        finalized: true,
        finalizedAt: Date.now(),
        startedAt: Date.now(),
        inning: 7,
        isTopInning: false,
        outs: 3,
        homeScore: 0,
        awayScore: 0,
      }

      await set(ref(db, `games/${gameId}`), record)
      setSelectedGameId(gameId)
      setShowNewGameForm(false)
      setNewGameAway('')
      setNewGameHome('')
    } catch (err) {
      setSaveMsg({ text: `Error creating game: ${err instanceof Error ? err.message : String(err)}`, ok: false })
    } finally {
      setCreatingGame(false)
    }
  }

  // ── Save handler ──

  const handleSave = async () => {
    if (!selectedGameId || !selectedGame) return
    setSaving(true)
    setSaveMsg(null)

    try {
      const updates: Record<string, unknown> = {}

      // Build new game summaries (merge existing + edits)
      const allPlayerIds = new Set([
        ...Object.keys(gameSummaries),
        ...Object.keys(edits),
      ])

      const newGameSummaries: Record<string, GameSummary> = {}

      for (const playerId of allPlayerIds) {
        const teamId = (edits[playerId]?.teamId as string | undefined)
          ?? gameSummaries[playerId]?.teamId
          ?? players[playerId]?.teamId
          ?? ''
        const base: GameSummary = gameSummaries[playerId] ?? {
          playerId, teamId,
          ab: 0, pa: 0, h: 0, doubles: 0, triples: 0, hr: 0,
          r: 0, rbi: 0, bb: 0, k: 0, inningsPitched: 0,
        }
        const merged: GameSummary = { ...base, ...(edits[playerId] ?? {}) }

        // Auto-compute PA = AB + BB when not explicitly set
        if ((merged.pa ?? 0) === 0 && ((merged.ab ?? 0) > 0 || (merged.bb ?? 0) > 0)) {
          merged.pa = (merged.ab ?? 0) + (merged.bb ?? 0)
        }

        newGameSummaries[playerId] = merged
        updates[`gameSummaries/${selectedGameId}/${playerId}`] = merged
      }

      // Derive scores from batting R totals
      let homeScore = 0, awayScore = 0
      for (const s of Object.values(newGameSummaries)) {
        if (s.teamId === selectedGame.homeTeamId) homeScore += s.r ?? 0
        else if (s.teamId === selectedGame.awayTeamId) awayScore += s.r ?? 0
      }
      updates[`games/${selectedGameId}/homeScore`] = homeScore
      updates[`games/${selectedGameId}/awayScore`] = awayScore
      updates[`games/${selectedGameId}/wPitcherId`] = wPitcherId ?? null
      updates[`games/${selectedGameId}/lPitcherId`] = lPitcherId ?? null

      // Rebuild allSummaries with corrected game data
      const updatedAllSummaries: Record<string, Record<string, GameSummary>> = {
        ...allSummaries,
        [selectedGameId]: newGameSummaries,
      }

      // Recalculate counting stats from all game summaries
      const seasonUpdates = recalcSeasonStats(updatedAllSummaries, players)
      for (const [path, val] of Object.entries(seasonUpdates)) {
        updates[path] = val
      }

      // Apply W/L delta on top of recalcSeasonStats (which preserves existing W/L via spread)
      const prevW = selectedGame.wPitcherId ?? null
      const prevL = selectedGame.lPitcherId ?? null

      const applyWLDelta = (pitcherId: string, field: 'w' | 'l', delta: 1 | -1) => {
        const path = `players/${pitcherId}/stats/pitching`
        const cur = (updates[path] as Record<string, unknown> | undefined)
          ?? { ...(players[pitcherId]?.stats?.pitching ?? {}) }
        const current = (cur[field] as number | undefined) ?? 0
        updates[path] = { ...cur, [field]: Math.max(0, current + delta) }
      }

      if (prevW !== wPitcherId) {
        if (prevW) applyWLDelta(prevW, 'w', -1)
        if (wPitcherId) applyWLDelta(wPitcherId, 'w', 1)
      }
      if (prevL !== lPitcherId) {
        if (prevL) applyWLDelta(prevL, 'l', -1)
        if (lPitcherId) applyWLDelta(lPitcherId, 'l', 1)
      }

      await update(ref(db), updates)

      const gameCount = Object.keys(newGameSummaries).length
      const playerCount = Object.keys(seasonUpdates).length
      setSaveMsg({
        text: `Saved — ${gameCount} player records, recalculated ${playerCount} season stat entries`,
        ok: true,
      })
      setEdits({})
      setExtraBatters({})
      setExtraPitchers({})
    } catch (err) {
      setSaveMsg({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false })
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div style={{ background: '#1e3a5f', borderBottom: '4px solid #c0392b' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            {config.leagueLogo && (
              <img src={config.leagueLogo} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            )}
            <div>
              <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 900, color: '#ffffff', letterSpacing: '0.05em', margin: 0 }}>
                Game Editor
              </h1>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                Brookside Athletics — Stat Correction &amp; Paper Entry
              </p>
            </div>
          </div>

          {/* Nav */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[['/', 'Stats'], ['/game-editor', 'Game Editor']].map(([href, label]) => (
              <a
                key={href}
                href={href}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  color: href === '/game-editor' ? '#fff' : 'rgba(255,255,255,0.6)',
                  borderBottom: href === '/game-editor' ? '3px solid #c0392b' : '3px solid transparent',
                  textDecoration: 'none', display: 'inline-block',
                }}
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Game picker */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px 0' }}>
        <div style={{
          background: '#fff', borderRadius: showNewGameForm ? '8px 8px 0 0' : 8,
          padding: '16px 20px',
          border: '1px solid #e5e7eb', marginBottom: showNewGameForm ? 0 : 20,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
            Select Game
          </label>
          <select
            value={selectedGameId ?? ''}
            onChange={e => { setSelectedGameId(e.target.value || null); setShowNewGameForm(false) }}
            style={{
              flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13,
              border: '1px solid #d1d5db', borderRadius: 6,
              fontFamily: 'var(--font-ui)', background: '#fff',
            }}
          >
            <option value="">— Choose a game —</option>
            {games.map(({ gameId, game }) => (
              <option key={gameId} value={gameId}>
                {gameLabel(game, teams)}
              </option>
            ))}
          </select>

          <button
            onClick={() => { setShowNewGameForm(v => !v); setSelectedGameId(null) }}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
              background: showNewGameForm ? '#1e3a5f' : '#fff',
              color: showNewGameForm ? '#fff' : '#374151', whiteSpace: 'nowrap',
            }}
          >
            + New Paper Game
          </button>

          {selectedGameId && (
            <>
              <button
                onClick={() => setShowTrace(v => !v)}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 600,
                  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
                  background: showTrace ? '#1e3a5f' : '#fff',
                  color: showTrace ? '#fff' : '#374151',
                }}
              >
                {showTrace ? 'Hide Trace' : 'Show Play-by-Play Trace'}
              </button>

              {isDirty && (
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                  ● Unsaved changes
                </span>
              )}
            </>
          )}
        </div>

        {/* New paper game form */}
        {showNewGameForm && (
          <div style={{
            background: '#f8fafc', border: '1px solid #e5e7eb', borderTop: 'none',
            borderRadius: '0 0 8px 8px', padding: '16px 20px', marginBottom: 20,
            display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</label>
              <input
                type="date"
                value={newGameDate}
                onChange={e => setNewGameDate(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'var(--font-ui)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Away Team</label>
              <select
                value={newGameAway}
                onChange={e => setNewGameAway(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'var(--font-ui)', minWidth: 160 }}
              >
                <option value="">— Select —</option>
                {Object.entries(teams).filter(([id]) => id !== newGameHome).map(([id, t]) => (
                  <option key={id} value={id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Home Team</label>
              <select
                value={newGameHome}
                onChange={e => setNewGameHome(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'var(--font-ui)', minWidth: 160 }}
              >
                <option value="">— Select —</option>
                {Object.entries(teams).filter(([id]) => id !== newGameAway).map(([id, t]) => (
                  <option key={id} value={id}>{t.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreateGame}
              disabled={!newGameAway || !newGameHome || !newGameDate || creatingGame}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: newGameAway && newGameHome && newGameDate ? '#1e3a5f' : '#e5e7eb',
                color: newGameAway && newGameHome && newGameDate ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 6,
                cursor: newGameAway && newGameHome && newGameDate ? 'pointer' : 'not-allowed',
              }}
            >
              {creatingGame ? 'Creating...' : 'Create Game'}
            </button>
            <button
              onClick={() => setShowNewGameForm(false)}
              style={{ padding: '8px 12px', fontSize: 13, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}
            >
              cancel
            </button>
          </div>
        )}


        {/* Main content */}
        {selectedGameId && selectedGame && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {/* Box score editor */}
            <div style={{ flex: showTrace ? '0 0 58%' : '1 1 100%', minWidth: 0 }}>
              {/* Score summary bar */}
              <div style={{
                background: '#fff', borderRadius: 8, padding: '12px 20px',
                border: '1px solid #e5e7eb', marginBottom: 16,
                display: 'flex', alignItems: 'center', gap: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {teams[selectedGame.awayTeamId]?.logoUrl && (
                    <img src={teams[selectedGame.awayTeamId].logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
                  )}
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700 }}>
                    {teams[selectedGame.awayTeamId]?.shortName ?? selectedGame.awayTeamId}
                  </span>
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: '#1e3a5f', minWidth: 28, textAlign: 'center' }}>
                    {selectedGame.awayScore}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: '#9ca3af' }}>@</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: '#1e3a5f', minWidth: 28, textAlign: 'center' }}>
                    {selectedGame.homeScore}
                  </span>
                  <span style={{ fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 700 }}>
                    {teams[selectedGame.homeTeamId]?.shortName ?? selectedGame.homeTeamId}
                  </span>
                  {teams[selectedGame.homeTeamId]?.logoUrl && (
                    <img src={teams[selectedGame.homeTeamId].logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
                  )}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: selectedGame.finalized ? '#16a34a' : '#d97706',
                    background: selectedGame.finalized ? '#dcfce7' : '#fef3c7',
                    padding: '3px 8px', borderRadius: 4,
                  }}>
                    {selectedGame.finalized ? 'Finalized' : 'In Progress'}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{selectedGame.date}</span>
                </div>
              </div>

              {/* Away team box score */}
              <BoxScoreSection
                teamId={selectedGame.awayTeamId}
                teamName={teams[selectedGame.awayTeamId]?.name ?? selectedGame.awayTeamId}
                teamColor={teams[selectedGame.awayTeamId]?.primaryColor ?? '#374151'}
                players={players}
                summaries={gameSummaries}
                edits={edits}
                onEdit={handleEdit}
                extraBatters={extraBatters[selectedGame.awayTeamId] ?? []}
                extraPitchers={extraPitchers[selectedGame.awayTeamId] ?? []}
                onAddBatter={id => addExtraBatter(selectedGame.awayTeamId, id)}
                onAddPitcher={id => addExtraPitcher(selectedGame.awayTeamId, id)}
                onRemoveBatter={id => removeExtraBatter(selectedGame.awayTeamId, id)}
                onRemovePitcher={id => removeExtraPitcher(selectedGame.awayTeamId, id)}
              />

              {/* W/L Assignment */}
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                padding: '14px 20px', marginBottom: 16,
                display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  W / L Decision
                </span>
                {(['w', 'l'] as const).map(type => {
                  const current = type === 'w' ? wPitcherId : lPitcherId
                  const setter = type === 'w' ? setWPitcherId : setLPitcherId
                  return (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-score)',
                        color: type === 'w' ? '#16a34a' : '#dc2626',
                        minWidth: 16,
                      }}>
                        {type.toUpperCase()}
                      </span>
                      <select
                        value={current ?? ''}
                        onChange={e => setter(e.target.value || null)}
                        style={{
                          padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db',
                          borderRadius: 6, fontFamily: 'var(--font-ui)', minWidth: 160,
                        }}
                      >
                        <option value="">— No decision —</option>
                        {allPitchersInGame.map(id => (
                          <option key={id} value={id}>
                            {players[id]?.name ?? id} ({teams[players[id]?.teamId]?.shortName ?? '?'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
                {(wPitcherId || lPitcherId) && (
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>
                    Saved on next Save &amp; Update
                  </span>
                )}
              </div>

              {/* Home team box score */}
              <BoxScoreSection
                teamId={selectedGame.homeTeamId}
                teamName={teams[selectedGame.homeTeamId]?.name ?? selectedGame.homeTeamId}
                teamColor={teams[selectedGame.homeTeamId]?.primaryColor ?? '#374151'}
                players={players}
                summaries={gameSummaries}
                edits={edits}
                onEdit={handleEdit}
                extraBatters={extraBatters[selectedGame.homeTeamId] ?? []}
                extraPitchers={extraPitchers[selectedGame.homeTeamId] ?? []}
                onAddBatter={id => addExtraBatter(selectedGame.homeTeamId, id)}
                onAddPitcher={id => addExtraPitcher(selectedGame.homeTeamId, id)}
                onRemoveBatter={id => removeExtraBatter(selectedGame.homeTeamId, id)}
                onRemovePitcher={id => removeExtraPitcher(selectedGame.homeTeamId, id)}
              />

              {/* Save bar */}
              <div style={{
                background: '#fff', borderRadius: 8, padding: '14px 20px',
                border: '1px solid #e5e7eb', marginTop: 4,
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '10px 24px', fontSize: 14, fontWeight: 700,
                    background: saving ? '#9ca3af' : '#1e3a5f',
                    color: '#fff', border: 'none', borderRadius: 6,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    letterSpacing: '0.04em',
                  }}
                >
                  {saving ? 'Saving...' : 'Save & Update Season Stats'}
                </button>

                {saveMsg && (
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    color: saveMsg.ok ? '#16a34a' : '#dc2626',
                  }}>
                    {saveMsg.ok ? '✓ ' : '✗ '}{saveMsg.text}
                  </span>
                )}

                <div style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af', maxWidth: 320 }}>
                  Saves game summaries and recalculates all season stats from game records.
                  W/L records are preserved.
                </div>
              </div>
            </div>

            {/* Trace panel */}
            {showTrace && (
              <div style={{
                flex: '0 0 40%', minWidth: 0,
                background: '#fff', borderRadius: 8, padding: '16px',
                border: '1px solid #e5e7eb', position: 'sticky', top: 16,
                maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
              }}>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e3a5f' }}>
                    Play-by-Play Trace
                  </h3>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>
                    {atBats.length} at-bats logged
                  </span>
                </div>
                {atBats.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
                    No play-by-play data for this game
                  </p>
                ) : (
                  <TracePanel
                    atBats={atBats}
                    players={players}
                    teams={teams}
                    awayTeamId={selectedGame.awayTeamId}
                    homeTeamId={selectedGame.homeTeamId}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!selectedGameId && (
          <div style={{
            background: '#fff', borderRadius: 8, padding: '48px 20px',
            border: '1px solid #e5e7eb', textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 16, color: '#6b7280', margin: 0 }}>
              Select a game above to view and edit its box score
            </p>
            <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>
              Changes here update game summaries and recalculate season stats
            </p>
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
