import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { AppNav } from '../components/AppNav'
import { useTeams } from '../hooks/useTeams'
import { usePlayers } from '../hooks/usePlayers'
import { useGames } from '../hooks/useGames'
import { useLeagueConfig } from '../hooks/useLeagueConfig'
import { computeGameStats, mergeHittingStats, mergePitchingStats } from '../scoring/engine'
import type { GameRecord, PlayersMap, TeamsMap, AtBatRecord, HittingStats, PitchingStats } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ColDef<R> {
  key: keyof R
  label: string
  tip: string
  format?: (v: R) => string
  minWidth?: number
}

type Tab = 'standings' | 'hitting' | 'pitching' | 'results'
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

function buildHittingRows(
  players: PlayersMap,
  teams: TeamsMap,
  liveAtBats: Record<string, AtBatRecord[]>,
): HittingRow[] {
  const rows: HittingRow[] = []

  for (const [playerId, player] of Object.entries(players)) {
    let hitting: HittingStats | null = player.stats?.hitting ?? null

    for (const atBats of Object.values(liveAtBats)) {
      const nonSub = atBats.filter(ab => !ab.isSub)
      const gameResult = computeGameStats(nonSub, playerId)
      if (gameResult.hitting) {
        hitting = hitting ? mergeHittingStats(hitting, gameResult.hitting) : gameResult.hitting
      }
    }

    if (!hitting) continue

    const team = teams[player.teamId]
    rows.push({
      playerId,
      name: player.name,
      team: team?.name ?? player.teamId,
      teamShort: team?.shortName ?? player.teamId,
      teamLogo: team?.logoUrl ?? '',
      gp: hitting.gp ?? 0,
      pa: hitting.pa ?? 0,
      ab: hitting.ab ?? 0,
      h: hitting.h ?? 0,
      doubles: hitting.doubles ?? 0,
      triples: hitting.triples ?? 0,
      hr: hitting.hr ?? 0,
      r: hitting.r ?? 0,
      rbi: hitting.rbi ?? 0,
      bb: hitting.bb ?? 0,
      k: hitting.k ?? 0,
      avg: hitting.avg ?? 0,
      obp: hitting.obp ?? 0,
      slg: hitting.slg ?? 0,
      ops: hitting.ops ?? 0,
    })
  }

  return rows
}

function buildPitchingRows(
  players: PlayersMap,
  teams: TeamsMap,
  liveAtBats: Record<string, AtBatRecord[]>,
): PitchingRow[] {
  const rows: PitchingRow[] = []

  for (const [playerId, player] of Object.entries(players)) {
    let pitching: PitchingStats | null = player.stats?.pitching ?? null

    for (const atBats of Object.values(liveAtBats)) {
      const nonSub = atBats.filter(ab => !ab.isSub)
      const gameResult = computeGameStats(nonSub, playerId)
      if (gameResult.pitching) {
        pitching = pitching ? mergePitchingStats(pitching, gameResult.pitching) : gameResult.pitching
      }
    }

    if (!pitching) continue

    const ip = pitching.inningsPitched ?? 0
    const team = teams[player.teamId]
    rows.push({
      playerId,
      name: player.name,
      team: team?.name ?? player.teamId,
      teamShort: team?.shortName ?? player.teamId,
      teamLogo: team?.logoUrl ?? '',
      gp: pitching.gp ?? 0,
      ip,
      k: pitching.k ?? 0,
      bb: pitching.bb ?? 0,
      ra: pitching.runsAllowed ?? 0,
      era: pitching.era ?? 0,
    })
  }

  return rows
}

interface StandingsRow {
  teamId: string
  name: string
  shortName: string
  logoUrl: string
  w: number
  l: number
  t: number
  pct: number
}

interface ResultRow {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
  homeName: string
  awayName: string
  homeLogo: string
  awayLogo: string
  homeScore: number
  awayScore: number
}

interface TeamRosterRow {
  playerId: string
  name: string
  jerseyNumber: string
  avg: number
  hr: number
  rbi: number
}

function buildStandings(
  games: Array<{ gameId: string; game: GameRecord }>,
  teams: TeamsMap,
): StandingsRow[] {
  const agg: Record<string, { w: number; l: number; t: number }> = {}
  for (const teamId of Object.keys(teams)) {
    agg[teamId] = { w: 0, l: 0, t: 0 }
  }
  for (const { game } of games) {
    if (!game.finalized) continue
    const h = agg[game.homeTeamId]
    const a = agg[game.awayTeamId]
    if (!h || !a) continue
    if (game.homeScore > game.awayScore) { h.w++; a.l++ }
    else if (game.awayScore > game.homeScore) { a.w++; h.l++ }
    else { h.t++; a.t++ }
  }
  return Object.entries(agg).map(([teamId, rec]) => {
    const t = teams[teamId]
    const total = rec.w + rec.l + rec.t
    return {
      teamId,
      name: t?.name ?? teamId,
      shortName: t?.shortName ?? teamId,
      logoUrl: t?.logoUrl ?? '',
      ...rec,
      pct: total > 0 ? (rec.w + rec.t * 0.5) / total : 0,
    }
  }).sort((a, b) => b.pct - a.pct || b.w - a.w)
}

function buildResults(
  games: Array<{ gameId: string; game: GameRecord }>,
  teams: TeamsMap,
): ResultRow[] {
  return games
    .filter(({ game }) => game.finalized)
    .sort((a, b) => (b.game.startedAt ?? 0) - (a.game.startedAt ?? 0))
    .map(({ gameId, game }) => ({
      gameId,
      date: game.date,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeName: teams[game.homeTeamId]?.shortName ?? game.homeTeamId,
      awayName: teams[game.awayTeamId]?.shortName ?? game.awayTeamId,
      homeLogo: teams[game.homeTeamId]?.logoUrl ?? '',
      awayLogo: teams[game.awayTeamId]?.logoUrl ?? '',
      homeScore: game.homeScore,
      awayScore: game.awayScore,
    }))
}

function buildTeamRoster(
  teamId: string,
  players: PlayersMap,
  hittingRows: HittingRow[],
): TeamRosterRow[] {
  const hittingMap = new Map(hittingRows.map(r => [r.playerId, r]))
  return Object.entries(players)
    .filter(([, p]) => p.teamId === teamId)
    .map(([id, p]) => {
      const h = hittingMap.get(id)
      return {
        playerId: id,
        name: p.name,
        jerseyNumber: p.jerseyNumber ?? '',
        avg: h?.avg ?? 0,
        hr: h?.hr ?? 0,
        rbi: h?.rbi ?? 0,
      }
    })
    .sort((a, b) => {
      const aNum = parseInt(a.jerseyNumber); const bNum = parseInt(b.jerseyNumber)
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum
      return a.name.localeCompare(b.name)
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

  const [tab, setTab] = useState<Tab>('standings')
  const [hittingSort, setHittingSort] = useState<{ col: keyof HittingRow; dir: SortDir }>({ col: 'avg', dir: 'desc' })
  const [pitchingSort, setPitchingSort] = useState<{ col: keyof PitchingRow; dir: SortDir }>({ col: 'era', dir: 'asc' })
  const [resultsFilter, setResultsFilter] = useState<string>('')
  const [selectedTeam, setSelectedTeam] = useState<string>('')

  // Subscribe to at-bats for any non-finalized games so live stats merge in real-time
  const [liveAtBats, setLiveAtBats] = useState<Record<string, AtBatRecord[]>>({})

  const liveGameIds = useMemo(
    () => games.filter(g => !g.game.finalized).map(g => g.gameId),
    [games],
  )

  useEffect(() => {
    if (liveGameIds.length === 0) { setLiveAtBats({}); return }
    const data: Record<string, AtBatRecord[]> = {}
    const unsubs = liveGameIds.map(gameId =>
      onValue(ref(db, `gameStats/${gameId}`), snap => {
        if (snap.exists()) {
          data[gameId] = Object.values(snap.val() as Record<string, AtBatRecord>)
        } else {
          delete data[gameId]
        }
        setLiveAtBats({ ...data })
      })
    )
    return () => unsubs.forEach(u => u())
  }, [liveGameIds])

  const hittingRows = useMemo(() => buildHittingRows(players, teams, liveAtBats), [players, teams, liveAtBats])
  const pitchingRows = useMemo(() => buildPitchingRows(players, teams, liveAtBats), [players, teams, liveAtBats])

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

  const standings = useMemo(() => buildStandings(games, teams), [games, teams])
  const results = useMemo(() => buildResults(games, teams), [games, teams])
  const filteredResults = useMemo(
    () => resultsFilter ? results.filter(r => r.homeTeamId === resultsFilter || r.awayTeamId === resultsFilter) : results,
    [results, resultsFilter],
  )
  const teamRoster = useMemo(
    () => selectedTeam ? buildTeamRoster(selectedTeam, players, hittingRows) : [],
    [selectedTeam, players, hittingRows],
  )

  // Auto-select first team when standings load
  useEffect(() => {
    if (!selectedTeam && standings.length > 0) setSelectedTeam(standings[0].teamId)
  }, [standings, selectedTeam])

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
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '12px 16px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <AppNav />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            {config.leagueLogo && (
              <img src={config.leagueLogo} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            )}
            <div>
              <h1 style={{ fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 900, color: '#ffffff', letterSpacing: '0.05em', margin: 0 }}>
                Brookside Athletics
              </h1>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                2026 Season
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', alignItems: 'flex-end' }}>
            <TabButton active={tab === 'standings'} onClick={() => setTab('standings')}>Standings</TabButton>
            <TabButton active={tab === 'hitting'} onClick={() => setTab('hitting')}>Hitting</TabButton>
            <TabButton active={tab === 'pitching'} onClick={() => setTab('pitching')}>Pitching</TabButton>
            <TabButton active={tab === 'results'} onClick={() => setTab('results')}>Results</TabButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 12px', position: 'relative' }}>
        {config.leagueLogo && (
          <img src={config.leagueLogo} alt="" style={{ position: 'absolute', top: 16, right: 12, width: 64, height: 64, objectFit: 'contain', opacity: 0.12, pointerEvents: 'none' }} />
        )}
        {tab === 'standings' ? (
          /* ── Standings ──────────────────────────────────────────── */
          <div>
            {/* Standings table */}
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 24 }}>
              {standings.length === 0 ? <EmptyState>No teams found.</EmptyState> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #1e3a5f' }}>
                      <th style={{ ...thBase, textAlign: 'left', paddingLeft: 12 }}>Team</th>
                      <th style={thBase}>W</th>
                      <th style={thBase}>L</th>
                      <th style={thBase}>T</th>
                      <th style={{ ...thBase, minWidth: 48 }}>PCT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, i) => (
                      <tr
                        key={row.teamId}
                        onClick={() => setSelectedTeam(row.teamId)}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          background: selectedTeam === row.teamId ? 'rgba(30,58,95,0.06)' : i % 2 === 0 ? '#ffffff' : '#f9fafb',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                          {row.logoUrl ? <img src={row.logoUrl} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} /> : <span style={{ width: 24 }} />}
                          <span style={{ fontWeight: 600, color: '#1e293b' }}>{row.name}</span>
                        </td>
                        <td style={{ ...tdScore, fontWeight: 700 }}>{row.w}</td>
                        <td style={tdScore}>{row.l}</td>
                        <td style={tdScore}>{row.t}</td>
                        <td style={{ ...tdScore, fontWeight: 700, color: '#1e3a5f' }}>{row.pct.toFixed(3).replace(/^0/, '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Team roster */}
            {selectedTeam && (
              <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb' }}>
                  {teams[selectedTeam]?.logoUrl && <img src={teams[selectedTeam].logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />}
                  <span style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {teams[selectedTeam]?.name ?? selectedTeam} Roster
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ ...thBase, width: 36 }}>#</th>
                      <th style={{ ...thBase, textAlign: 'left' }}>Player</th>
                      <th style={thBase}>AVG</th>
                      <th style={thBase}>HR</th>
                      <th style={thBase}>RBI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamRoster.map((row, i) => (
                      <tr key={row.playerId} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)', fontWeight: 700, color: '#94a3b8' }}>
                          {row.jerseyNumber || '—'}
                        </td>
                        <td style={{ padding: '8px 8px', fontWeight: 600, color: '#1e293b' }}>{row.name}</td>
                        <td style={{ ...tdScore, fontWeight: 600 }}>{formatAvg(row.avg)}</td>
                        <td style={tdScore}>{row.hr}</td>
                        <td style={tdScore}>{row.rbi}</td>
                      </tr>
                    ))}
                    {teamRoster.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>No players on roster</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : tab === 'hitting' ? (
          /* ── Hitting ────────────────────────────────────────────── */
          sortedHitting.length === 0 ? (
            <EmptyState>No hitting stats yet.</EmptyState>
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
        ) : tab === 'pitching' ? (
          /* ── Pitching ───────────────────────────────────────────── */
          sortedPitching.length === 0 ? (
            <EmptyState>No pitching stats yet.</EmptyState>
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
        ) : (
          /* ── Results ────────────────────────────────────────────── */
          <div>
            {/* Team filter */}
            <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <FilterChip active={resultsFilter === ''} onClick={() => setResultsFilter('')}>All</FilterChip>
              {Object.entries(teams)
                .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                .map(([id, t]) => (
                  <FilterChip key={id} active={resultsFilter === id} onClick={() => setResultsFilter(resultsFilter === id ? '' : id)}>
                    {t.shortName}
                  </FilterChip>
                ))}
            </div>

            {filteredResults.length === 0 ? (
              <EmptyState>No results yet.</EmptyState>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredResults.map(r => {
                  const homeWon = r.homeScore > r.awayScore
                  const awayWon = r.awayScore > r.homeScore
                  return (
                    <div key={r.gameId} style={{
                      background: '#ffffff', borderRadius: 10, border: '1px solid #e5e7eb',
                      padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                        {r.awayLogo ? <img src={r.awayLogo} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} /> : <span style={{ width: 24 }} />}
                        <span style={{ fontWeight: awayWon ? 700 : 500, color: awayWon ? '#1e293b' : '#64748b', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.awayName}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, padding: '0 12px' }}>
                        <span style={{ fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 800, color: awayWon ? '#1e293b' : '#94a3b8' }}>{r.awayScore}</span>
                        <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>
                        <span style={{ fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 800, color: homeWon ? '#1e293b' : '#94a3b8' }}>{r.homeScore}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: homeWon ? 700 : 500, color: homeWon ? '#1e293b' : '#64748b', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>
                          {r.homeName}
                        </span>
                        {r.homeLogo ? <img src={r.homeLogo} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} /> : <span style={{ width: 24 }} />}
                      </div>
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>{r.date}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared styles ────────────────────────────────────────────────────────────

const thBase: React.CSSProperties = {
  padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)',
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b',
}

const tdScore: React.CSSProperties = {
  padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 14, color: '#475569',
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
        fontFamily: 'var(--font-score)', textTransform: 'uppercase', letterSpacing: '0.05em',
        background: active ? '#1e3a5f' : '#ffffff', color: active ? '#ffffff' : '#64748b',
        border: `1px solid ${active ? '#1e3a5f' : '#d1d5db'}`, cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

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
