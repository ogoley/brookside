import type { Team, DerbyRoundScores } from '../../types'
import { DERBY_CHARITY_NAME, type DerbyBetWinner } from '../../derby/logic'

export interface DerbyWinnerProps {
  /** The champion. */
  name: string
  team?: Team
  totalHr: number                 // across all three rounds — the 50/50 number
  scores: DerbyRoundScores        // per-round breakdown
  seasonHr?: number
  /** Settled 50/50: everyone who tied on the closest call. */
  betWinners: DerbyBetWinner[]
  betTotalGuess?: number          // shown when a single winner called it
  pot: number
  toWinners: number
  toCharity: number
  eachTakes: number
}

const GOLD = '#fbbf24'
const DEEP = '#080d18'

// Hand-authored so nothing here calls Math.random during render — a re-render
// mid-animation would otherwise reshuffle every piece. 14 pieces: the money
// ball taught us to keep this count in the teens.
const CONFETTI: { x: number; drift: number; spin: number; delay: number; dur: number; w: number; h: number; c: string }[] = [
  { x: -820, drift: 90, spin: 420, delay: 0.15, dur: 5.2, w: 10, h: 16, c: '#fbbf24' },
  { x: -640, drift: -70, spin: -380, delay: 0.9, dur: 6.1, w: 8, h: 14, c: '#ffffff' },
  { x: -470, drift: 120, spin: 300, delay: 0.4, dur: 5.6, w: 12, h: 12, c: '#f59e0b' },
  { x: -300, drift: -50, spin: 460, delay: 1.5, dur: 6.4, w: 9, h: 15, c: '#fbbf24' },
  { x: -140, drift: 80, spin: -320, delay: 0.65, dur: 5.0, w: 11, h: 11, c: '#fde68a' },
  { x: 20, drift: -110, spin: 380, delay: 1.9, dur: 6.8, w: 8, h: 16, c: '#ffffff' },
  { x: 180, drift: 60, spin: -420, delay: 0.25, dur: 5.4, w: 12, h: 13, c: '#fbbf24' },
  { x: 340, drift: -90, spin: 340, delay: 1.2, dur: 6.0, w: 10, h: 15, c: '#f59e0b' },
  { x: 500, drift: 100, spin: -300, delay: 2.2, dur: 5.8, w: 9, h: 12, c: '#fde68a' },
  { x: 660, drift: -60, spin: 440, delay: 0.75, dur: 6.6, w: 11, h: 14, c: '#fbbf24' },
  { x: 810, drift: 70, spin: -360, delay: 1.65, dur: 5.3, w: 8, h: 13, c: '#ffffff' },
  { x: -730, drift: -100, spin: 320, delay: 2.6, dur: 6.2, w: 10, h: 14, c: '#f59e0b' },
  { x: 260, drift: 110, spin: -400, delay: 3.1, dur: 5.9, w: 9, h: 16, c: '#fbbf24' },
  { x: -390, drift: 40, spin: 360, delay: 3.6, dur: 6.5, w: 11, h: 12, c: '#fde68a' },
]

const RINGS = [
  { delay: 0.05, dur: 1.5, to: 3.6, size: 300 },
  { delay: 0.25, dur: 1.7, to: 4.2, size: 300 },
  { delay: 0.45, dur: 1.9, to: 4.8, size: 300 },
]

const ROUND_BOXES: { key: keyof DerbyRoundScores; label: string }[] = [
  { key: 'r1', label: 'Round 1' },
  { key: 'r2', label: 'Round 2' },
  { key: 'r3', label: 'Final' },
]

function Crown({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 100 78" fill="none" style={{ display: 'block' }}>
      <path
        d="M6 70 L14 20 L34 44 L50 6 L66 44 L86 20 L94 70 Z"
        fill="url(#crownGold)" stroke="#92400e" strokeWidth="2.5" strokeLinejoin="round"
      />
      <rect x="6" y="70" width="88" height="8" rx="2" fill="url(#crownGold)" stroke="#92400e" strokeWidth="2.5" />
      <circle cx="50" cy="30" r="5" fill="#fff7ed" stroke="#92400e" strokeWidth="1.6" />
      <circle cx="14" cy="20" r="4" fill="#fff7ed" stroke="#92400e" strokeWidth="1.6" />
      <circle cx="86" cy="20" r="4" fill="#fff7ed" stroke="#92400e" strokeWidth="1.6" />
      <defs>
        <linearGradient id="crownGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function Laurel({ flip }: { flip?: boolean }) {
  return (
    <svg
      width="86" height="200" viewBox="0 0 60 140" fill="none"
      style={{ display: 'block', transform: flip ? 'scaleX(-1)' : undefined }}
    >
      <path d="M46 6 C22 30 14 70 22 134" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />
      {[14, 30, 46, 62, 78, 94, 110].map((y, i) => (
        <ellipse
          key={y}
          cx={30 - i * 1.5} cy={y} rx="14" ry="6.5"
          fill={GOLD} opacity={0.85}
          transform={`rotate(${-38 + i * 3} ${30 - i * 1.5} ${y})`}
        />
      ))}
    </svg>
  )
}

/**
 * Champion takeover — the graphic that closes the derby.
 *
 * Unlike the money ball this one is HELD: the producer leaves it up while the
 * winner is interviewed, so the entrance settles into a held pose instead of
 * clearing itself, and only the laurels and confetti keep moving. See the
 * `derby-win-*` block in index.css for the frame-rate rules it obeys.
 */
export function DerbyWinnerScene(props: DerbyWinnerProps) {
  const {
    name, team, totalHr, scores, seasonHr,
    betWinners, pot, toWinners, toCharity, eachTakes,
  } = props

  const accent = team?.primaryColor ?? GOLD
  const split = betWinners.length > 1

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Wash — the only full-screen layer, and it fades once then holds */}
      <div
        className="derby-win-anim"
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 38%, rgba(251,191,36,0.20), rgba(8,13,24,0.93) 62%, rgba(8,13,24,0.97))',
          animation: 'derby-win-wash 0.7s ease-out',
        }}
      />

      {/* Shockwaves behind the crown */}
      {RINGS.map((r, i) => (
        <div
          key={i}
          className="derby-win-anim"
          style={{
            position: 'absolute', left: '50%', top: 232,
            width: r.size, height: r.size, marginLeft: -r.size / 2, marginTop: -r.size / 2,
            borderRadius: '50%', border: `3px solid ${GOLD}`,
            ['--win-ring-to' as string]: String(r.to),
            animation: `derby-win-ring ${r.dur}s cubic-bezier(0.16,0.8,0.3,1) ${r.delay}s`,
          }}
        />
      ))}

      {/* Confetti */}
      {CONFETTI.map((c, i) => (
        <div
          key={i}
          className="derby-win-anim"
          style={{
            position: 'absolute', left: '50%', top: 0,
            width: c.w, height: c.h, background: c.c, borderRadius: 2,
            ['--win-x' as string]: `${c.x}px`,
            ['--win-drift' as string]: `${c.drift}px`,
            ['--win-spin' as string]: `${c.spin}deg`,
            animation: `derby-win-confetti ${c.dur}s linear ${c.delay}s infinite`,
          }}
        />
      ))}

      {/* ── Centre column ── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 118,
      }}>
        {/* Crown */}
        <div
          className="derby-win-anim"
          style={{ animation: 'derby-win-crown 0.95s cubic-bezier(0.22,1.2,0.36,1) 0.1s' }}
        >
          <Crown />
        </div>

        {/* Title */}
        <div
          className="derby-win-anim"
          style={{
            marginTop: 14,
            fontFamily: 'var(--font-score)', fontSize: 26, fontWeight: 900,
            color: GOLD, letterSpacing: '0.42em', textTransform: 'uppercase', lineHeight: 1,
            animation: 'derby-win-rise 0.6s ease-out 0.45s',
          }}
        >
          Home Run Derby Champion
        </div>

        {/* Name, flanked by laurels */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 18 }}>
          <div
            className="derby-win-anim"
            style={{ animation: 'derby-win-rise 0.7s ease-out 0.6s, derby-win-breathe 4s ease-in-out 1.6s infinite' }}
          >
            <Laurel />
          </div>

          <div
            className="derby-win-anim"
            style={{
              position: 'relative', overflow: 'hidden', padding: '0 12px',
              animation: 'derby-win-name 0.8s cubic-bezier(0.22,1.15,0.36,1) 0.5s',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 132, fontWeight: 900,
              color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.02em',
              lineHeight: 1, whiteSpace: 'nowrap',
              textShadow: `0 6px 40px ${GOLD}66`,
            }}>
              {name}
            </div>
            {/* One-shot specular pass over the name */}
            <div
              className="derby-win-anim"
              style={{
                position: 'absolute', top: 0, bottom: 0, left: 0, width: '26%',
                background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.6), rgba(255,255,255,0))',
                animation: 'derby-win-sweep 1.5s ease-out 1.15s',
              }}
            />
          </div>

          <div
            className="derby-win-anim"
            style={{ animation: 'derby-win-rise 0.7s ease-out 0.6s, derby-win-breathe 4s ease-in-out 1.6s infinite' }}
          >
            <Laurel flip />
          </div>
        </div>

        {/* Team + season line */}
        <div
          className="derby-win-anim"
          style={{
            display: 'flex', alignItems: 'center', gap: 14, marginTop: 6,
            animation: 'derby-win-rise 0.6s ease-out 0.85s',
          }}
        >
          {team?.logoUrl && <img src={team.logoUrl} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />}
          <span style={{
            fontFamily: 'var(--font-score)', fontSize: 24, fontWeight: 800,
            color: accent, textTransform: 'uppercase', letterSpacing: '0.14em',
          }}>
            {team?.name ?? ''}
          </span>
          {seasonHr !== undefined && (
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 22, fontWeight: 700,
              color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              · {seasonHr} HR this season
            </span>
          )}
        </div>

        {/* ── Total + per-round breakdown ── */}
        <div
          className="derby-win-anim"
          style={{
            display: 'flex', alignItems: 'stretch', gap: 16, marginTop: 30,
            animation: 'derby-win-rise 0.65s ease-out 1s',
          }}
        >
          <div style={{
            background: GOLD, borderRadius: 16, padding: '16px 38px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 18px 60px rgba(251,191,36,0.28)',
          }}>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 15, fontWeight: 900,
              color: 'rgba(8,13,24,0.62)', letterSpacing: '0.24em', textTransform: 'uppercase', lineHeight: 1,
            }}>
              Total Home Runs
            </span>
            <span style={{
              fontFamily: 'var(--font-score)', fontSize: 88, fontWeight: 900,
              color: DEEP, lineHeight: 1.02, fontVariantNumeric: 'tabular-nums',
            }}>
              {totalHr}
            </span>
          </div>

          {ROUND_BOXES.map(box => (
            <div
              key={box.key}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 16, padding: '16px 26px', minWidth: 132,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 800,
                color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', textTransform: 'uppercase', lineHeight: 1,
              }}>
                {box.label}
              </span>
              <span style={{
                fontFamily: 'var(--font-score)', fontSize: 54, fontWeight: 900,
                color: '#ffffff', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums',
              }}>
                {scores[box.key] ?? '–'}
              </span>
            </div>
          ))}
        </div>

        {/* ── The 50/50 ── */}
        <div
          className="derby-win-anim"
          style={{
            marginTop: 26, width: 1180,
            background: 'rgba(8,13,24,0.82)',
            border: `1px solid ${GOLD}59`,
            borderRadius: 16, padding: '18px 30px',
            display: 'flex', alignItems: 'center', gap: 26,
            animation: 'derby-win-rise 0.65s ease-out 1.2s',
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 14, fontWeight: 900,
              color: GOLD, letterSpacing: '0.24em', textTransform: 'uppercase', lineHeight: 1,
            }}>
              50/50 Winner{split ? 's' : ''}
            </div>
            <div style={{
              fontFamily: 'var(--font-score)', fontSize: 13, fontWeight: 700,
              color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em',
              textTransform: 'uppercase', marginTop: 4,
            }}>
              {betWinners.length === 0
                ? 'No winning entry'
                : split
                  ? `${betWinners.length} tied — split evenly`
                  : 'Closest call'}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {betWinners.length === 0 ? (
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 34, fontWeight: 800,
                color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.2,
              }}>
                Nobody backed {name} — the whole ${pot} pot goes to {DERBY_CHARITY_NAME}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                {betWinners.map(w => (
                  <div
                    key={w.id}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 10,
                      background: 'rgba(251,191,36,0.14)',
                      border: `1px solid ${GOLD}80`,
                      borderRadius: 10, padding: '7px 16px',
                    }}
                  >
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 38, fontWeight: 900,
                      color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1,
                      whiteSpace: 'nowrap',
                    }}>
                      {w.name}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-score)', fontSize: 20, fontWeight: 800,
                      color: GOLD, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                    }}>
                      called {w.totalHr}
                      {w.delta === 0 && <span style={{ color: '#4ade80', marginLeft: 8 }}>EXACT</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Money */}
          <div style={{ flexShrink: 0, display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 800,
                color: 'rgba(255,255,255,0.4)', letterSpacing: '0.18em', textTransform: 'uppercase',
              }}>
                {betWinners.length > 1 ? 'Each takes' : 'Takes home'}
              </div>
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 46, fontWeight: 900,
                color: GOLD, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                ${betWinners.length === 0 ? 0 : eachTakes}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.14)' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 12, fontWeight: 800,
                color: 'rgba(255,255,255,0.4)', letterSpacing: '0.18em', textTransform: 'uppercase',
              }}>
                To charity
              </div>
              <div style={{
                fontFamily: 'var(--font-score)', fontSize: 46, fontWeight: 900,
                color: '#4ade80', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                ${betWinners.length === 0 ? pot : toCharity}
              </div>
            </div>
          </div>
        </div>

        {/* Charity footer */}
        <div
          className="derby-win-anim"
          style={{
            marginTop: 12,
            fontFamily: 'var(--font-score)', fontSize: 16, fontWeight: 700,
            color: 'rgba(255,255,255,0.42)', letterSpacing: '0.2em', textTransform: 'uppercase',
            animation: 'derby-win-rise 0.6s ease-out 1.4s',
          }}
        >
          ${pot} raised · half to {DERBY_CHARITY_NAME}
          {betWinners.length > 0 && ` · $${toWinners} to the winner${split ? 's' : ''}`}
        </div>
      </div>
    </div>
  )
}
