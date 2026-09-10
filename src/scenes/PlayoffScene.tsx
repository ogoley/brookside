import { motion } from 'framer-motion'
import type { TeamsMap } from '../types'
import { projectBracket, statusTag, outlookLine, type PlayoffPicture, type TeamOutlook } from '../playoffs/engine'
import { fmtPct, fmtDiff, oddsLabel, fmtGameWhen, fmtSeedRange } from '../playoffs/format'

interface Props {
  teams: TeamsMap
  picture: PlayoffPicture | null
}

const GOLD = '#fbbf24'
const GREEN = '#4ade80'
const RED = '#f87171'
const FONT = 'var(--font-score)'

function toneColor(tone: 'gold' | 'green' | 'red' | 'muted'): string {
  return tone === 'gold' ? GOLD : tone === 'green' ? GREEN : tone === 'red' ? RED : 'rgba(255,255,255,0.5)'
}

function Logo({ teams, teamId, size = 48 }: { teams: TeamsMap; teamId: string; size?: number }) {
  const team = teams[teamId]
  const color = team?.primaryColor ?? '#555'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `${color}33`, border: `2px solid ${color}77`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {team?.logoUrl
        ? <img src={team.logoUrl} alt="" style={{ width: size * 0.64, height: size * 0.64, objectFit: 'contain' }} />
        : <span style={{ fontFamily: FONT, fontSize: size * 0.28, fontWeight: 900, color }}>{team?.shortName?.slice(0, 2) ?? '?'}</span>}
    </div>
  )
}

function Cell({ label, value, width = 92, color = '#fff', dim }: { label: string; value: string; width?: number; color?: string; dim?: boolean }) {
  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1, marginBottom: 4 }}>{label}</span>
      <span style={{ fontFamily: FONT, fontSize: 26, fontWeight: 900, lineHeight: 1, color: dim ? 'rgba(255,255,255,0.3)' : color }}>{value}</span>
    </div>
  )
}

function Row({ t, teams, delay, spots, byes }: { t: TeamOutlook; teams: TeamsMap; delay: number; spots: number; byes: number }) {
  const team = teams[t.teamId]
  const tag = statusTag(t)
  const line = outlookLine(t)
  const zone = t.seed <= byes ? 'bye' : t.seed <= spots ? 'playoff' : 'out'
  const accent = t.eliminated ? RED : t.clinchedBye ? GOLD : t.clinchedPlayoff ? GREEN : 'rgba(255,255,255,0.18)'
  const dim = t.eliminated
  return (
    <motion.div
      data-testid="playoff-row"
      initial={{ x: 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 22, stiffness: 200, delay }}
      style={{
        display: 'flex', alignItems: 'center', height: 86, marginBottom: 6, borderRadius: 12,
        background: zone === 'bye' ? 'rgba(251,191,36,0.06)' : zone === 'out' ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.04)',
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div style={{ width: 64, flexShrink: 0, textAlign: 'center' }}>
        <span style={{ fontFamily: FONT, fontSize: 30, fontWeight: 900, color: zone === 'bye' ? GOLD : dim ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)' }}>{t.seed}</span>
      </div>
      <Logo teams={teams} teamId={t.teamId} size={52} />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 16, paddingRight: 12 }}>
        <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: dim ? 'rgba(255,255,255,0.45)' : '#fff', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {team?.name ?? t.teamId}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 18 }}>
          {tag && (
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: toneColor(tag.tone), background: `${toneColor(tag.tone)}1f`, border: `1px solid ${toneColor(tag.tone)}55`, borderRadius: 4, padding: '2px 7px', lineHeight: 1.2 }}>
              {tag.text}
            </span>
          )}
          {line && (
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {line}
            </span>
          )}
        </div>
      </div>
      <Cell label="W-L" value={`${t.line.w}-${t.line.l}${t.line.t ? `-${t.line.t}` : ''}`} width={104} dim={dim} color={zone === 'bye' ? GOLD : '#fff'} />
      <Cell label="PCT" value={fmtPct(t.line)} dim={dim} />
      <Cell label="DIFF" value={fmtDiff(t.line)} dim={dim} color={t.line.rf - t.line.ra >= 0 ? '#fff' : 'rgba(255,255,255,0.75)'} />
      <Cell label="GL" value={String(t.remaining)} width={70} dim={dim} />
      <Cell label="SEED" value={fmtSeedRange(t)} width={88} dim={dim} />
      <Cell label="IN" value={oddsLabel(t)} width={92} dim={dim} color={t.clinchedPlayoff ? GREEN : t.eliminated ? RED : '#fff'} />
    </motion.div>
  )
}

function Divider({ label, color, delay }: { label: string; color: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay, duration: 0.4 }}
      style={{ display: 'flex', alignItems: 'center', gap: 14, height: 30, padding: '0 12px', marginBottom: 6 }}>
      <div style={{ flex: 1, height: 1, background: color, opacity: 0.5 }} />
      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color, letterSpacing: '0.22em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: color, opacity: 0.5 }} />
    </motion.div>
  )
}

function SeedChip({ teams, order, seed, small }: { teams: TeamsMap; order: string[]; seed: number; small?: boolean }) {
  const id = order[seed - 1]
  const team = id ? teams[id] : undefined
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
      <span style={{ fontFamily: FONT, fontSize: small ? 13 : 15, fontWeight: 900, color: GOLD, width: 20, textAlign: 'right', flexShrink: 0 }}>{seed}</span>
      {id ? <Logo teams={teams} teamId={id} size={small ? 30 : 36} /> : <div style={{ width: small ? 30 : 36 }} />}
      <span style={{ fontFamily: FONT, fontSize: small ? 17 : 20, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {team?.name ?? (id ?? 'TBD')}
      </span>
    </div>
  )
}

function Panel({ title, children, delay }: { title: string; children: React.ReactNode; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
      {children}
    </motion.div>
  )
}

export function PlayoffScene({ teams, picture }: Props) {
  const spots = picture?.config.spots ?? 6
  const byes = picture?.config.byes ?? 2
  const bracket = projectBracket(picture?.config)
  const order = picture?.order ?? []
  const remaining = picture?.remainingGames ?? []
  const postponed = picture?.postponedGames ?? []

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#080d18' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 1200px 400px at 50% 0%, rgba(255,255,255,0.04), transparent 70%)' }} />
      <div style={{ position: 'relative', padding: '48px 64px 0', display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 56, fontWeight: 900, color: '#fff', letterSpacing: '0.1em', lineHeight: 1, textTransform: 'uppercase' }}>Playoff Picture</div>
            <div style={{ fontFamily: FONT, fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 8 }}>
              {spots} teams qualify · top {byes} earn a bye · semifinals reseed
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{remaining.length}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4 }}>
              games remaining{postponed.length ? ` · incl. ${postponed.length} makeup` : ''}
            </div>
          </div>
        </motion.div>
        <motion.div style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 14 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.05, duration: 0.4, ease: 'easeOut' }} />

        <div style={{ display: 'flex', gap: 36, flex: 1, minHeight: 0 }}>
          {/* Standings with clinch status */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!picture && (
              <div style={{ fontFamily: FONT, color: 'rgba(255,255,255,0.3)', fontSize: 18, textAlign: 'center', padding: 60, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                Waiting for standings…
              </div>
            )}
            {picture?.teams.map((t, i) => (
              <div key={t.teamId}>
                <Row t={t} teams={teams} delay={0.1 + i * 0.07} spots={spots} byes={byes} />
                {i === byes - 1 && <Divider label="Bye line" color={GOLD} delay={0.1 + i * 0.07 + 0.1} />}
                {i === spots - 1 && i < picture.teams.length - 1 && <Divider label="Playoff line" color={RED} delay={0.1 + i * 0.07 + 0.1} />}
              </div>
            ))}
          </div>

          {/* Bracket + remaining games */}
          <div style={{ width: 560, flexShrink: 0 }}>
            <Panel title="If the season ended today" delay={0.25}>
              <div style={{ fontFamily: FONT, fontSize: 11, color: GOLD, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>First-round byes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {bracket.byes.map(seed => <SeedChip key={seed} teams={teams} order={order} seed={seed} />)}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>Quarterfinals</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {bracket.quarterfinals.map(m => (
                  <div key={m.label} data-testid="bracket-qf" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 10px' }}>
                    <SeedChip teams={teams} order={order} seed={m.lowSeed} small />
                    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>AT</span>
                    <SeedChip teams={teams} order={order} seed={m.highSeed} small />
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.4 }}>
                Semifinals: 1 seed hosts the lowest remaining seed · 2 seed hosts the other · winners meet in the final
              </div>
            </Panel>

            <Panel title="Still to play" delay={0.4}>
              {remaining.length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 16, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Regular season complete</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {remaining.slice(0, 7).map(g => (
                  <div key={g.id} data-testid="remaining-game" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: GOLD, letterSpacing: '0.06em', width: 168, flexShrink: 0, textTransform: 'uppercase' }}>{fmtGameWhen(g)}</span>
                    <Logo teams={teams} teamId={g.awayTeamId} size={24} />
                    <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {teams[g.awayTeamId]?.shortName ?? g.awayTeamId}
                      <span style={{ color: 'rgba(255,255,255,0.35)', margin: '0 6px' }}>at</span>
                      {teams[g.homeTeamId]?.shortName ?? g.homeTeamId}
                    </span>
                  </div>
                ))}
                {remaining.length > 7 && (
                  <div style={{ fontFamily: FONT, fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>+ {remaining.length - 7} more</div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
