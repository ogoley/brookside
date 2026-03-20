import { useState } from 'react'
import { ref, push, set, update, remove } from 'firebase/database'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'
import { useMatchup } from '../hooks/useMatchup'
import { useGameStats } from '../hooks/useGameStats'
import { useLiveRunners } from '../hooks/useLiveRunners'
import type { AtBatResult, AtBatRecord, RunnersState, PlayersMap } from '../types'

// ── Constants ──────────────────────────────────────────────────────────────

type WizardStep = 'batter' | 'result' | 'scored' | 'confirm'

const RESULT_LABELS: Record<AtBatResult, string> = {
  single: 'Single', double: 'Double', triple: 'Triple', home_run: 'Home Run',
  walk: 'Walk', strikeout: 'Strikeout', groundout: 'Ground Out', flyout: 'Fly Out',
  hbp: 'Hit By Pitch', sacrifice_fly: 'Sac Fly', sacrifice_bunt: 'Sac Bunt',
  fielders_choice: "Fielder's Choice", error: 'Error',
}

const RESULTS: AtBatResult[] = [
  'single', 'double', 'triple', 'home_run',
  'walk', 'strikeout', 'groundout', 'flyout',
  'hbp', 'sacrifice_fly', 'sacrifice_bunt', 'fielders_choice', 'error',
]

const BASE_LABELS: Record<string, string> = {
  first: '1st base', second: '2nd base', third: '3rd base',
}

function batterAdvanceFrom(result: AtBatResult): AtBatRecord['batterAdvancedTo'] {
  const map: Partial<Record<AtBatResult, AtBatRecord['batterAdvancedTo']>> = {
    single: 'first', double: 'second', triple: 'third', home_run: 'home',
    walk: 'first', hbp: 'first', fielders_choice: 'first', error: 'first',
    strikeout: 'out', groundout: 'out', flyout: 'out',
    sacrifice_fly: 'out', sacrifice_bunt: 'out',
  }
  return map[result] ?? null
}

function computeRbi(result: AtBatResult, scoredIds: string[]): number {
  if (result === 'error') return 0
  let count = scoredIds.length
  if (result === 'home_run') count += 1 // batter drives themselves in
  return count
}

function lastName(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1]
}

// ── Main component ──────────────────────────────────────────────────────────

export function ScorekeeperRoute() {
  const { game } = useGameData()
  const { players } = usePlayers()
  const { teams } = useTeams()
  const { matchup } = useMatchup()
  const { atBats } = useGameStats(game.currentGameId ?? null)
  const { liveRunners } = useLiveRunners(game.currentGameId ?? null)

  const [step, setStep] = useState<WizardStep>('batter')
  const [batterId, setBatterId] = useState('')
  const [result, setResult] = useState<AtBatResult | null>(null)
  const [scoredIds, setScoredIds] = useState<string[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  const gameId = game.currentGameId

  const battingTeamId = game.isTopInning ? game.awayTeamId : game.homeTeamId
  const fieldingTeamId = game.isTopInning ? game.homeTeamId : game.awayTeamId

  const batterOptions = Object.entries(players)
    .filter(([, p]) => p.teamId === battingTeamId && (p.position === 'hitter' || p.position === 'both'))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))

  const pitcherName = matchup.pitcherId ? (players[matchup.pitcherId]?.name ?? 'Unknown') : null
  const fieldingTeamName = teams[fieldingTeamId]?.shortName ?? fieldingTeamId

  const currentRunners: Array<{ id: string; base: keyof RunnersState }> = [
    liveRunners.third ? { id: liveRunners.third, base: 'third' as const } : null,
    liveRunners.second ? { id: liveRunners.second, base: 'second' as const } : null,
    liveRunners.first ? { id: liveRunners.first, base: 'first' as const } : null,
  ].filter(Boolean) as Array<{ id: string; base: keyof RunnersState }>

  const hasRunners = currentRunners.length > 0

  const handleSelectResult = (r: AtBatResult) => {
    setResult(r)
    if (r === 'home_run') {
      setScoredIds(currentRunners.map(runner => runner.id))
      setStep('confirm')
    } else if (hasRunners) {
      setScoredIds([])
      setStep('scored')
    } else {
      setScoredIds([])
      setStep('confirm')
    }
  }

  const toggleScored = (runnerId: string) => {
    setScoredIds(prev =>
      prev.includes(runnerId) ? prev.filter(id => id !== runnerId) : [...prev, runnerId]
    )
  }

  const submit = async () => {
    if (!gameId || !batterId || !result) return

    const batterAdv = batterAdvanceFrom(result)
    const rbiCount = computeRbi(result, scoredIds)

    const atBatRecord: AtBatRecord = {
      batterId,
      pitcherId: matchup.pitcherId ?? '',
      inning: game.inning,
      isTopInning: game.isTopInning,
      timestamp: editId ? (atBats[editId]?.timestamp ?? Date.now()) : Date.now(),
      result,
      runnersOnBase: {
        first: liveRunners.first,
        second: liveRunners.second,
        third: liveRunners.third,
      },
      runnersScored: scoredIds,
      rbiCount,
      batterAdvancedTo: batterAdv,
      isEarnedRun: true,
    }

    if (editId) {
      await update(ref(db, `gameStats/${gameId}/${editId}`), atBatRecord)
    } else {
      await push(ref(db, `gameStats/${gameId}`), atBatRecord)

      // Update liveRunners (only on new at-bats, not edits)
      const newRunners: RunnersState = {
        first: liveRunners.first,
        second: liveRunners.second,
        third: liveRunners.third,
      }
      for (const runnerId of scoredIds) {
        if (newRunners.first === runnerId) newRunners.first = null
        if (newRunners.second === runnerId) newRunners.second = null
        if (newRunners.third === runnerId) newRunners.third = null
      }
      if (result === 'home_run') {
        newRunners.first = null; newRunners.second = null; newRunners.third = null
      } else {
        if (batterAdv === 'first') newRunners.first = batterId
        else if (batterAdv === 'second') newRunners.second = batterId
        else if (batterAdv === 'third') newRunners.third = batterId
      }
      await set(ref(db, `liveRunners/${gameId}`), newRunners)
    }

    resetWizard()
  }

  const resetWizard = () => {
    setBatterId('')
    setResult(null)
    setScoredIds([])
    setEditId(null)
    setStep('batter')
  }

  const startEdit = (atBatId: string) => {
    const ab = atBats[atBatId]
    if (!ab) return
    setBatterId(ab.batterId)
    setResult(ab.result)
    setScoredIds(ab.runnersScored)
    setEditId(atBatId)
    setStep('batter')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteAtBat = async (atBatId: string) => {
    if (!gameId) return
    await remove(ref(db, `gameStats/${gameId}/${atBatId}`))
  }

  // ── No game state ──────────────────────────────────────────────────────────

  if (!gameId) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-4"
        style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
      >
        <div
          className="rounded-2xl px-6 py-8 text-center max-w-sm w-full"
          style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-white/40 text-sm mb-2" style={{ fontFamily: 'var(--font-score)' }}>
            SCOREKEEPER
          </p>
          <p className="text-white text-base font-semibold mb-1">No game in progress</p>
          <p className="text-white/50 text-sm">
            Create a new game from the Controller tab to begin logging at-bats.
          </p>
        </div>
      </div>
    )
  }

  // ── Sorted log ─────────────────────────────────────────────────────────────

  const sortedAtBats = Object.entries(atBats).sort(([, a], [, b]) => b.timestamp - a.timestamp)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen px-4 py-4"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h1
          className="text-white text-2xl font-black uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          Scorekeeper
        </h1>
        <p className="text-white/40 text-sm">
          {game.isTopInning ? '▲' : '▼'} {game.inning} · {game.outs} out{game.outs !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Edit banner */}
      {editId && (
        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between mb-4"
          style={{ background: 'rgba(180,83,9,0.2)', border: '1px solid rgba(251,146,60,0.4)' }}
        >
          <span className="text-orange-300 text-sm font-semibold">Editing at-bat</span>
          <button
            onClick={resetWizard}
            className="text-orange-400 text-sm font-bold"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Live runners badge */}
      {hasRunners && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['third', 'second', 'first'] as const).map(base => {
            const runnerId = liveRunners[base]
            if (!runnerId) return null
            return (
              <span
                key={base}
                className="text-xs font-semibold rounded-full px-3 py-1"
                style={{ background: 'rgba(37,99,235,0.25)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)' }}
              >
                {lastName(players[runnerId]?.name ?? runnerId)} on {BASE_LABELS[base]}
              </span>
            )
          })}
        </div>
      )}

      {/* Wizard card */}
      <div
        className="rounded-2xl p-4 mb-4"
        style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Step: Batter */}
        {step === 'batter' && (
          <div className="flex flex-col gap-4">
            <StepLabel step={1} label="Who's Up?" />

            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                🏏 Batter — {teams[battingTeamId]?.shortName ?? battingTeamId}
              </span>
              <select
                value={batterId}
                onChange={e => setBatterId(e.target.value)}
                className="w-full h-14 rounded-xl px-3 text-base font-medium"
                style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <option value="">— Select batter —</option>
                {batterOptions.map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                ⚾ Pitcher — {fieldingTeamName}
              </span>
              <div
                className="h-14 rounded-xl px-3 flex items-center text-base font-medium"
                style={{ background: 'rgba(255,255,255,0.04)', color: pitcherName ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {pitcherName ?? 'Not set in controller'}
              </div>
            </div>

            <SkBtn
              onClick={() => setStep('result')}
              disabled={!batterId}
              primary
            >
              Next — What happened? →
            </SkBtn>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={2} label="What Happened?" />
              <BackBtn onClick={() => setStep('batter')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => handleSelectResult(r)}
                  className="h-14 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: result === r ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.07)',
                    color: result === r ? '#fff' : 'rgba(255,255,255,0.8)',
                    border: result === r ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {RESULT_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Who Scored */}
        {step === 'scored' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={3} label="Who Scored?" />
              <BackBtn onClick={() => setStep('result')} />
            </div>
            {currentRunners.length === 0 ? (
              <p className="text-white/40 text-sm text-center py-4">No runners on base</p>
            ) : (
              <div className="flex flex-col gap-2">
                {currentRunners.map(({ id, base }) => {
                  const scored = scoredIds.includes(id)
                  return (
                    <button
                      key={id}
                      onClick={() => toggleScored(id)}
                      className="h-16 rounded-xl px-4 flex items-center justify-between transition-all"
                      style={{
                        background: scored ? 'rgba(22,163,74,0.25)' : 'rgba(255,255,255,0.07)',
                        border: scored ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-white font-semibold text-base">
                          {players[id]?.name ?? id}
                        </span>
                        <span className="text-white/40 text-xs">{BASE_LABELS[base]}</span>
                      </div>
                      <span
                        className="text-lg font-bold"
                        style={{ color: scored ? '#4ade80' : 'rgba(255,255,255,0.2)' }}
                      >
                        {scored ? '✓ Scored' : 'Tap to score'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <SkBtn onClick={() => setStep('confirm')} primary>
              Next — Confirm →
            </SkBtn>
          </div>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StepLabel step={editId ? undefined : 4} label="Confirm" />
              <BackBtn onClick={() => {
                if (hasRunners && result !== 'home_run') setStep('scored')
                else setStep('result')
              }} />
            </div>

            {/* Summary card */}
            <div
              className="rounded-xl p-4 flex flex-col gap-2"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <div className="flex items-baseline gap-3">
                <span className="text-white font-bold text-lg">
                  {players[batterId]?.name ?? batterId}
                </span>
                <span
                  className="text-white/60 text-sm font-semibold"
                  style={{ fontFamily: 'var(--font-score)' }}
                >
                  {game.isTopInning ? '▲' : '▼'}{game.inning}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className="text-blue-300 font-black text-xl uppercase"
                  style={{ fontFamily: 'var(--font-score)' }}
                >
                  {RESULT_LABELS[result]}
                </span>
                {computeRbi(result, scoredIds) > 0 && (
                  <span
                    className="text-green-400 font-bold text-sm"
                    style={{ background: 'rgba(22,163,74,0.15)', padding: '2px 10px', borderRadius: 9999 }}
                  >
                    {computeRbi(result, scoredIds)} RBI
                  </span>
                )}
              </div>
              {scoredIds.length > 0 && (
                <p className="text-white/50 text-sm">
                  Scored: {scoredIds.map(id => lastName(players[id]?.name ?? id)).join(', ')}
                </p>
              )}
              {pitcherName && (
                <p className="text-white/40 text-xs">vs. {pitcherName}</p>
              )}
            </div>

            <SkBtn onClick={submit} primary>
              {editId ? '✓ Save Changes' : '✓ Log At-Bat'}
            </SkBtn>
          </div>
        )}
      </div>

      {/* Edit Log */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button
          onClick={() => setShowLog(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <span className="text-white/40 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
            At-Bat Log ({sortedAtBats.length})
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{showLog ? '▲' : '▼'}</span>
        </button>

        {showLog && (
          <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {sortedAtBats.length === 0 && (
              <p className="px-4 py-6 text-white/30 text-sm text-center">No at-bats logged yet</p>
            )}
            {sortedAtBats.map(([id, ab]) => (
              <AtBatRow
                key={id}
                atBatId={id}
                ab={ab}
                players={players}
                onEdit={startEdit}
                onDelete={deleteAtBat}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StepLabel({ step, label }: { step?: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {step != null && (
        <span
          className="text-xs font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0"
          style={{ background: 'rgba(37,99,235,0.9)', color: '#fff', fontFamily: 'var(--font-score)' }}
        >
          {step}
        </span>
      )}
      <h2
        className="text-white font-bold text-base uppercase tracking-wider"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        {label}
      </h2>
    </div>
  )
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-white/40 text-sm font-semibold px-3 py-1 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.06)' }}
    >
      ← Back
    </button>
  )
}

function SkBtn({ onClick, disabled, primary, children }: {
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-14 rounded-xl font-bold text-base uppercase tracking-wider transition-all"
      style={{
        background: disabled ? '#1c2333' : primary ? '#2563eb' : 'rgba(255,255,255,0.07)',
        color: disabled ? 'rgba(255,255,255,0.3)' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: primary && !disabled ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {children}
    </button>
  )
}

function AtBatRow({ atBatId, ab, players, onEdit, onDelete }: {
  atBatId: string
  ab: AtBatRecord
  players: PlayersMap
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const batter = players[ab.batterId]
  const label = RESULT_LABELS[ab.result] ?? ab.result

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-white font-semibold text-sm truncate">
            {batter?.name ?? ab.batterId}
          </span>
          <span
            className="text-white/60 text-xs font-semibold shrink-0"
            style={{ fontFamily: 'var(--font-score)' }}
          >
            {ab.isTopInning ? '▲' : '▼'}{ab.inning}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-xs font-bold" style={{ fontFamily: 'var(--font-score)' }}>
            {label}
          </span>
          {ab.rbiCount > 0 && (
            <span className="text-green-400 text-xs font-semibold">
              {ab.rbiCount} RBI
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {confirming ? (
          <>
            <button
              onClick={() => { onDelete(atBatId); setConfirming(false) }}
              className="text-xs font-bold px-3 h-8 rounded-lg"
              style={{ background: '#b91c1c', color: '#fff' }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs font-semibold px-3 h-8 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onEdit(atBatId)}
              className="text-xs font-semibold px-3 h-8 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
            >
              Edit
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="text-xs font-semibold px-3 h-8 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}
