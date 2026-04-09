import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useTeams } from '../hooks/useTeams'
import { usePlayers } from '../hooks/usePlayers'
import { useGames } from '../hooks/useGames'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import type { GameSummary, PlayersMap, TeamsMap } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ColDef<R> {
  key: keyof R
  label: string
  tip: string
  format?: (v: R) => string
  minWidth?: number
}

type Tab = 'hitting' | 'pitching'
type SortDir = 'asc' | 'desc'

interface HittingRow {
  playerId: string
  name: string
  team: string
  teamShort: string
  teamLogo: string
  gp: number
  pa: number
  ab: number
  h: number
  doubles: number
  triples: number
  hr: number
  r: number
  rbi: number
  bb: number
  k: number
  avg: number
  obp: number
  slg: number
  ops: number
}

interface PitchingRow {
  playerId: string
  name: string
  team: string
  teamShort: string
  teamLogo: string
  gp: number
  ip: number
  k: number
  bb: number
  ra: number
  era: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INNINGS_PER_GAME = 7

function buildHittingRows(
  allSummaries: Record<string, Record<string, GameSummary>>,
  players: PlayersMap,
  teams: TeamsMap,
): HittingRow[] {
  const agg: Record<string, Omit<HittingRow, 'avg' | 'obp'>> = {}

  for (const gameSummaries of Object.values(allSummaries)) {
    const seen = new Set<string>()
    for (const s of Object.values(gameSummaries)) {
      if (s.pa === 0 && s.ab === 0) continue
      if (!agg[s.playerId]) {
        const p = players[s.playerId]
        const t = teams[s.teamId]
        agg[s.playerId] = {
          playerId: s.playerId,
          name: p?.name ?? s.playerId,
          team: t?.name ?? s.teamId,
          teamShort: t?.shortName ?? s.teamId,
          teamLogo: t?.logoUrl ?? '',
          gp: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0,
          hr: 0, r: 0, rbi: 0, bb: 0, k: 0,
        }
      }
      const a = agg[s.playerId]
      a.pa += s.pa
      a.ab += s.ab
      a.h += s.h
      a.doubles += s.doubles
      a.triples += s.triples
      a.hr += s.hr
      a.r += s.r
      a.rbi += s.rbi
      a.bb += s.bb
      a.k += s.k
      if (!seen.has(s.playerId)) { a.gp++; seen.add(s.playerId) }
    }
  }

  return Object.values(agg).map(a => ({
    ...a,
    avg: a.ab > 0 ? a.h / a.ab : 0,
    obp: a.pa > 0 ? (a.h + a.bb) / a.pa : 0,
    slg: a.ab > 0 ? ((a.h - a.doubles - a.triples - a.hr) + 2 * a.doubles + 3 * a.triples + 4 * a.hr) / a.ab : 0,
    ops: (a.pa > 0 ? (a.h + a.bb) / a.pa : 0) + (a.ab > 0 ? ((a.h - a.doubles - a.triples - a.hr) + 2 * a.doubles + 3 * a.triples + 4 * a.hr) / a.ab : 0),
  }))
}

function buildPitchingRows(
  allSummaries: Record<string, Record<string, GameSummary>>,
  players: PlayersMap,
  teams: TeamsMap,
): PitchingRow[] {
  const agg: Record<string, { playerId: string; name: string; team: string; teamShort: string; teamLogo: string; gp: number; outs: number; k: number; bb: number; ra: number }> = {}

  for (const gameSummaries of Object.values(allSummaries)) {
    const seen = new Set<string>()
    for (const s of Object.values(gameSummaries)) {
      if (s.inningsPitched === 0) continue
      if (!agg[s.playerId]) {
        const p = players[s.playerId]
        const t = teams[s.teamId]
        agg[s.playerId] = {
          playerId: s.playerId,
          name: p?.name ?? s.playerId,
          team: t?.name ?? s.teamId,
          teamShort: t?.shortName ?? s.teamId,
          teamLogo: t?.logoUrl ?? '',
          gp: 0, outs: 0, k: 0, bb: 0, ra: 0,
        }
      }
      const a = agg[s.playerId]
      // Convert IP back to outs for clean accumulation
      a.outs += Math.round(s.inningsPitched * 3)
      a.k += s.pitchingK ?? 0
      a.bb += s.pitchingBb ?? 0
      a.ra += s.runsAllowed ?? 0
      if (!seen.has(s.playerId)) { a.gp++; seen.add(s.playerId) }
    }
  }

  return Object.values(agg).map(a => {
    const ip = Math.floor(a.outs / 3) + (a.outs % 3) / 3
    return {
      playerId: a.playerId,
      name: a.name,
      team: a.team,
      teamShort: a.teamShort,
      teamLogo: a.teamLogo,
      gp: a.gp,
      ip,
      k: a.k,
      bb: a.bb,
      ra: a.ra,
      era: ip > 0 ? (a.ra / ip) * INNINGS_PER_GAME : 0,
    }
  })
}

function formatAvg(val: number): string {
  if (val === 0) return '.000'
  const s = val.toFixed(3)
  return s.startsWith('0') ? s.slice(1) : s
}

function formatEra(val: number): string {
  return val.toFixed(2)
}

function formatIp(ip: number): string {
  const full = Math.floor(ip)
  const partial = Math.round((ip - full) * 3)
  return partial === 0 ? `${full}` : `${full}.${partial}`
}

// ── Component ────────────────────────────────────────────────────────────────

export function StatsRoute() {
  const { teams } = useTeams()
  const { players } = usePlayers()
  const { games } = useGames()
  const { config } = useLeagueConfig()

  const [tab, setTab] = useState<Tab>('hitting')
  const [hittingSort, setHittingSort] = useState<{ col: keyof HittingRow; dir: SortDir }>({ col: 'avg', dir: 'desc' })
  const [pitchingSort, setPitchingSort] = useState<{ col: keyof PitchingRow; dir: SortDir }>({ col: 'era', dir: 'asc' })

  // Load all gameSummaries for finalized games
  const [allSummaries, setAllSummaries] = useState<Record<string, Record<string, GameSummary>>>({})
  const [loading, setLoading] = useState(true)

  const finalizedGameIds = useMemo(
    () => games.filter(g => g.game.finalized).map(g => g.gameId),
    [games],
  )

  useEffect(() => {
    if (finalizedGameIds.length === 0) { setLoading(false); return }
    const unsub = onValue(ref(db, 'gameSummaries'), snap => {
      if (!snap.exists()) { setAllSummaries({}); setLoading(false); return }
      const raw = snap.val() as Record<string, Record<string, GameSummary>>
      // Only include finalized games
      const filtered: typeof raw = {}
      for (const gId of finalizedGameIds) {
        if (raw[gId]) filtered[gId] = raw[gId]
      }
      setAllSummaries(filtered)
      setLoading(false)
    })
    return () => unsub()
  }, [finalizedGameIds])

  const hittingRows = useMemo(() => buildHittingRows(allSummaries, players, teams), [allSummaries, players, teams])
  const pitchingRows = useMemo(() => buildPitchingRows(allSummaries, players, teams), [allSummaries, players, teams])

  const sortedHitting = useMemo(() => {
    const { col, dir } = hittingSort
    return [...hittingRows].sort((a, b) => {
      const av = a[col], bv = b[col]
      if (typeof av === 'string' && typeof bv === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [hittingRows, hittingSort])

  const sortedPitching = useMemo(() => {
    const { col, dir } = pitchingSort
    return [...pitchingRows].sort((a, b) => {
      const av = a[col], bv = b[col]
      if (typeof av === 'string' && typeof bv === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [pitchingRows, pitchingSort])

  const toggleHittingSort = (col: keyof HittingRow) => {
    setHittingSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: col === 'name' || col === 'team' ? 'asc' : 'desc' })
  }

  const togglePitchingSort = (col: keyof PitchingRow) => {
    setPitchingSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: col === 'name' || col === 'team' || col === 'era' ? 'asc' : 'desc' })
  }

  // ── Hitting columns config ──────────────────────────────────────────────

  const hittingCols: ColDef<HittingRow>[] = [
    { key: 'gp', label: 'GP', tip: 'Games Played' },
    { key: 'pa', label: 'PA', tip: 'Plate Appearances — total trips to the plate (AB + BB)' },
    { key: 'ab', label: 'AB', tip: 'At Bats — PA excluding walks' },
    { key: 'h', label: 'H', tip: 'Hits — singles + doubles + triples + home runs' },
    { key: 'doubles', label: '2B', tip: 'Doubles' },
    { key: 'triples', label: '3B', tip: 'Triples' },
    { key: 'hr', label: 'HR', tip: 'Home Runs' },
    { key: 'r', label: 'R', tip: 'Runs Scored' },
    { key: 'rbi', label: 'RBI', tip: 'Runs Batted In' },
    { key: 'bb', label: 'BB', tip: 'Base on Balls (walks)' },
    { key: 'k', label: 'K', tip: 'Strikeouts' },
    { key: 'avg', label: 'AVG', tip: 'Batting Average — H / AB', format: r => formatAvg(r.avg), minWidth: 48 },
    { key: 'obp', label: 'OBP', tip: 'On-Base Percentage — (H + BB) / PA', format: r => formatAvg(r.obp), minWidth: 48 },
    { key: 'slg', label: 'SLG', tip: 'Slugging Percentage — total bases / AB\n(1B + 2×2B + 3×3B + 4×HR) / AB', format: r => formatAvg(r.slg), minWidth: 48 },
    { key: 'ops', label: 'OPS', tip: 'On-Base Plus Slugging — OBP + SLG', format: r => formatAvg(r.ops), minWidth: 48 },
  ]

  const pitchingCols: ColDef<PitchingRow>[] = [
    { key: 'gp', label: 'GP', tip: 'Games Pitched' },
    { key: 'ip', label: 'IP', tip: 'Innings Pitched — total outs recorded / 3', format: r => formatIp(r.ip) },
    { key: 'k', label: 'K', tip: 'Strikeouts thrown' },
    { key: 'bb', label: 'BB', tip: 'Base on Balls (walks allowed)' },
    { key: 'ra', label: 'RA', tip: 'Runs Allowed' },
    { key: 'era', label: 'ERA', tip: 'Earned Run Average — (RA / IP) × 7\nProjected runs over a 7-inning game', format: r => formatEra(r.era), minWidth: 48 },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div style={{ background: '#1e3a5f', borderBottom: '4px solid #c0392b' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            {config.leagueLogo && (
              <img src={config.leagueLogo} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            )}
            <div>
              <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: '#ffffff', letterSpacing: '0.05em', margin: 0 }}>
                Brookside Athletics
              </h1>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                Season Stats
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            <TabButton active={tab === 'hitting'} onClick={() => setTab('hitting')}>Hitting</TabButton>
            <TabButton active={tab === 'pitching'} onClick={() => setTab('pitching')}>Pitching</TabButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 12px', position: 'relative' }}>
        {config.leagueLogo && (
          <img src={config.leagueLogo} alt="" style={{ position: 'absolute', top: 16, right: 12, width: 64, height: 64, objectFit: 'contain', opacity: 0.12, pointerEvents: 'none' }} />
        )}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 14 }}>Loading stats…</p>
        ) : tab === 'hitting' ? (
          sortedHitting.length === 0 ? (
            <EmptyState>No hitting stats yet — finalize a game to see data here.</EmptyState>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1e3a5f' }}>
                    <StickyTh />
                    <SortTh active={hittingSort.col === 'name'} dir={hittingSort.dir} onClick={() => toggleHittingSort('name')} align="left" tip="Player name — sort alphabetically">
                      Player
                    </SortTh>
                    {hittingCols.map(c => (
                      <SortTh key={c.key} active={hittingSort.col === c.key} dir={hittingSort.dir} onClick={() => toggleHittingSort(c.key)} minWidth={c.minWidth} tip={c.tip}>
                        {c.label}
                      </SortTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHitting.map((row, i) => (
                    <tr key={row.playerId} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                      <StickyTd bg={i % 2 === 0 ? '#ffffff' : '#f9fafb'}>
                        {row.teamLogo ? <img src={row.teamLogo} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} /> : <span style={{ width: 20 }} />}
                      </StickyTd>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap', fontWeight: 600, color: '#1e293b', textAlign: 'left' }}>
                        {row.name}
                        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6, fontWeight: 500 }}>{row.teamShort}</span>
                      </td>
                      {hittingCols.map(c => (
                        <td key={c.key} style={{
                          padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
                          fontWeight: hittingSort.col === c.key ? 700 : 500,
                          color: hittingSort.col === c.key ? '#1e3a5f' : '#475569',
                        }}>
                          {c.format ? c.format(row) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          sortedPitching.length === 0 ? (
            <EmptyState>No pitching stats yet — finalize a game to see data here.</EmptyState>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1e3a5f' }}>
                    <StickyTh />
                    <SortTh active={pitchingSort.col === 'name'} dir={pitchingSort.dir} onClick={() => togglePitchingSort('name')} align="left" tip="Player name — sort alphabetically">
                      Player
                    </SortTh>
                    {pitchingCols.map(c => (
                      <SortTh key={c.key} active={pitchingSort.col === c.key} dir={pitchingSort.dir} onClick={() => togglePitchingSort(c.key)} minWidth={c.minWidth} tip={c.tip}>
                        {c.label}
                      </SortTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPitching.map((row, i) => (
                    <tr key={row.playerId} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                      <StickyTd bg={i % 2 === 0 ? '#ffffff' : '#f9fafb'}>
                        {row.teamLogo ? <img src={row.teamLogo} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} /> : <span style={{ width: 20 }} />}
                      </StickyTd>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap', fontWeight: 600, color: '#1e293b', textAlign: 'left' }}>
                        {row.name}
                        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6, fontWeight: 500 }}>{row.teamShort}</span>
                      </td>
                      {pitchingCols.map(c => (
                        <td key={c.key} style={{
                          padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
                          fontWeight: pitchingSort.col === c.key ? 700 : 500,
                          color: pitchingSort.col === c.key ? '#1e3a5f' : '#475569',
                        }}>
                          {c.format ? c.format(row) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 24px',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: 'var(--font-score)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: active ? '#ffffff' : 'rgba(255,255,255,0.45)',
        background: active ? '#c0392b' : 'transparent',
        border: 'none',
        borderRadius: '8px 8px 0 0',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function SortTh({ active, dir, onClick, children, align, minWidth, tip }: {
  active: boolean; dir: SortDir; onClick: () => void; children: React.ReactNode; align?: 'left'; minWidth?: number; tip?: string
}) {
  const [showTip, setShowTip] = useState(false)
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLSpanElement>(null)
  const arrow = active ? (dir === 'desc' ? ' ▾' : ' ▴') : ''

  const openTip = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (showTip) { setShowTip(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setTipPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
    }
    setShowTip(true)
  }, [showTip])

  return (
    <th
      style={{
        padding: '8px 6px',
        textAlign: align ?? 'center',
        fontFamily: 'var(--font-score)',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: active ? '#1e3a5f' : '#64748b',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        minWidth,
        background: active ? 'rgba(30,58,95,0.06)' : 'transparent',
      }}
    >
      <span onClick={onClick}>
        {children}{arrow}
      </span>
      {tip && (
        <span
          ref={btnRef}
          onClick={openTip}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginLeft: 3, width: 13, height: 13, borderRadius: '50%',
            background: showTip ? '#1e3a5f' : 'rgba(100,116,139,0.15)',
            color: showTip ? '#fff' : '#94a3b8',
            fontSize: 8, fontWeight: 700, fontStyle: 'italic', fontFamily: 'Georgia, serif',
            cursor: 'help', verticalAlign: 'middle', lineHeight: 1,
          }}
        >
          i
        </span>
      )}
      {showTip && tip && tipPos && createPortal(
        <>
          <div onClick={() => setShowTip(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: tipPos.top, left: tipPos.left, transform: 'translateX(-50%)',
            zIndex: 9999, padding: '8px 12px', borderRadius: 8,
            background: '#1e293b', color: '#f1f5f9', fontSize: 12, fontWeight: 500,
            fontFamily: 'var(--font-ui)', textTransform: 'none', letterSpacing: 'normal',
            whiteSpace: 'pre-line', lineHeight: 1.5, minWidth: 180, maxWidth: 260,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)', textAlign: 'left',
          }}>
            {tip}
          </div>
        </>,
        document.body,
      )}
    </th>
  )
}

function StickyTh() {
  return (
    <th style={{
      width: 28, padding: '8px 4px 8px 8px',
      position: 'sticky', left: 0, zIndex: 2, background: '#f3f4f6',
    }} />
  )
}

function StickyTd({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <td style={{
      width: 28, padding: '8px 4px 8px 8px',
      position: 'sticky', left: 0, zIndex: 1, background: bg,
    }}>
      {children}
    </td>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8', fontSize: 14 }}>
      {children}
    </div>
  )
}
