import { useState } from 'react'
import { ref, push } from 'firebase/database'
import { db } from '../firebase'
import { useGameData } from '../hooks/useGameData'
import { usePlayers } from '../hooks/usePlayers'
import { useTeams } from '../hooks/useTeams'

const RESULTS = ['Single', 'Double', 'Triple', 'Home Run', 'Walk', 'Strikeout', 'Groundout', 'Flyout', 'HBP', 'Sacrifice']

const GAME_ID = 'game1' // TODO: make dynamic when multiple games are tracked

export function ScorekeeperRoute() {
  const { game } = useGameData()
  const { players } = usePlayers()
  const { teams } = useTeams()

  const [batterId, setBatterId] = useState('')
  const [pitcherId, setPitcherId] = useState('')
  const [result, setResult] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const hitters = Object.entries(players).filter(([, p]) => p.position === 'hitter' || p.position === 'both')
  const pitchers = Object.entries(players).filter(([, p]) => p.position === 'pitcher' || p.position === 'both')

  const submit = async () => {
    if (!batterId || !pitcherId || !result) return
    await push(ref(db, `gameStats/${GAME_ID}`), {
      batterId,
      pitcherId,
      result: result.toLowerCase().replace(/ /g, '_'),
      inning: game.inning,
      isTopInning: game.isTopInning,
      timestamp: Date.now(),
    })
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 1500)
    setBatterId('')
    setPitcherId('')
    setResult('')
  }

  const canSubmit = batterId && pitcherId && result

  return (
    <div
      className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
      <div className="flex items-baseline gap-4 mb-4">
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

      <div className="flex flex-col gap-4 max-w-3xl lg:max-w-none">
        {/* Batter + Pitcher: stack on mobile, side-by-side on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Batter</label>
            <select
              value={batterId}
              onChange={(e) => setBatterId(e.target.value)}
              className="w-full h-14 rounded-xl px-3 text-base font-medium"
              style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <option value="">— Select batter —</option>
              {hitters.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name} ({teams[p.teamId]?.shortName ?? p.teamId})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Pitcher</label>
            <select
              value={pitcherId}
              onChange={(e) => setPitcherId(e.target.value)}
              className="w-full h-14 rounded-xl px-3 text-base font-medium"
              style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <option value="">— Select pitcher —</option>
              {pitchers.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name} ({teams[p.teamId]?.shortName ?? p.teamId})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Result grid: 2 cols on mobile, 5 cols on md+ */}
        <div className="flex flex-col gap-2">
          <label className="text-white/50 text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>Result</label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {RESULTS.map((r) => (
              <button
                key={r}
                onClick={() => setResult(r)}
                className="h-14 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: result === r ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.07)',
                  color: result === r ? '#fff' : 'rgba(255,255,255,0.75)',
                  border: result === r ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full h-16 rounded-2xl text-base font-bold uppercase tracking-wider transition-all"
          style={{
            background: canSubmit ? '#2563eb' : '#1c2333',
            color: canSubmit ? '#fff' : 'rgba(255,255,255,0.3)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {submitted ? '✓ Recorded' : 'Log At-Bat'}
        </button>
      </div>
    </div>
  )
}
