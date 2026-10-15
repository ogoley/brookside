import { useState, useEffect, useMemo } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { resolveBracket, type BracketConfig, type PostseasonMeta, type ResolvedBracket, type PostseasonGameEntry } from '../postseason/bracket'
import type { HittingStats, PitchingStats } from '../types'

const DEFAULT_META: PostseasonMeta = { active: false, season: new Date().getFullYear() }

/** /postseason/meta — the global playoff switch. */
export function usePostseasonMeta() {
  const [meta, setMeta] = useState<PostseasonMeta>(DEFAULT_META)
  const [loading, setLoading] = useState(true)
  useEffect(() => onValue(ref(db, 'postseason/meta'), snap => {
    setMeta({ ...DEFAULT_META, ...(snap.val() ?? {}) })
    setLoading(false)
  }), [])
  return { meta, loading }
}

/** /postseason/brackets/{season} */
export function useBracketConfig(season: number) {
  const [config, setConfig] = useState<BracketConfig | null>(null)
  useEffect(() => onValue(ref(db, `postseason/brackets/${season}`), snap => {
    const v = snap.val() as BracketConfig | null
    setConfig(v ? { ...v, season, seeds: v.seeds ?? [] } : null)
  }), [season])
  return config
}

/** /postseason/games — every playoff game, all seasons, newest first. */
export function usePostseasonGames() {
  const [games, setGames] = useState<PostseasonGameEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onValue(ref(db, 'postseason/games'), snap => {
    const raw = (snap.val() ?? {}) as Record<string, PostseasonGameEntry['game']>
    const entries = Object.entries(raw).map(([gameId, game]) => ({ gameId, game }))
    entries.sort((a, b) => (b.game.startedAt ?? 0) - (a.game.startedAt ?? 0))
    setGames(entries)
    setLoading(false)
  }), [])
  return { games, loading }
}

/** Meta + this season's bracket config + playoff games → resolved bracket. */
export function usePostseason() {
  const { meta, loading } = usePostseasonMeta()
  const config = useBracketConfig(meta.season)
  const { games } = usePostseasonGames()
  const bracket: ResolvedBracket | null = useMemo(
    () => (config ? resolveBracket(config, games) : null),
    [config, games],
  )
  return { meta, config, bracket, games, loading }
}

export interface PostseasonPlayerRecord {
  name?: string
  /** Lifetime playoff totals */
  stats?: { hitting?: HittingStats; pitching?: PitchingStats }
  seasons?: Record<string, { teamId?: string; hitting?: HittingStats; pitching?: PitchingStats }>
}

/** /postseason/players — lifetime + per-season playoff stats. */
export function usePostseasonPlayers() {
  const [players, setPlayers] = useState<Record<string, PostseasonPlayerRecord>>({})
  useEffect(() => onValue(ref(db, 'postseason/players'), snap => setPlayers(snap.val() ?? {})), [])
  return players
}
