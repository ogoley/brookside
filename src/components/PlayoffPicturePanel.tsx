import type { TeamsMap } from '../types'
import { projectBracket, statusTag, outlookLine, type PlayoffPicture } from '../playoffs/engine'
import { fmtPct, fmtDiff, oddsLabel, fmtGameWhen, fmtSeedRange } from '../playoffs/format'

interface Props {
  teams: TeamsMap
  picture: PlayoffPicture | null
}

const th: React.CSSProperties = {
  padding: '8px 6px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
  letterSpacing: '0.08em', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: 'var(--font-score)',
}
const td: React.CSSProperties = { padding: '10px 6px', textAlign: 'center', fontFamily: 'var(--font-score)', fontSize: 15, color: '#1e293b' }

function toneColors(tone: 'gold' | 'green' | 'red' | 'muted') {
  switch (tone) {
    case 'gold': return { bg: '#fef3c7', fg: '#92400e' }
    case 'green': return { bg: '#dcfce7', fg: '#166534' }
    case 'red': return { bg: '#fee2e2', fg: '#991b1b' }
    default: return { bg: '#f1f5f9', fg: '#475569' }
  }
}

function TeamCell({ teams, teamId, size = 24 }: { teams: TeamsMap; teamId: string; size?: number }) {
  const t = teams[teamId]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {t?.logoUrl ? <img src={t.logoUrl} alt="" style={{ width: size, height: size, objectFit: 'contain' }} /> : <span style={{ width: size }} />}
      <span style={{ fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' }}>{t?.name ?? teamId}</span>
    </span>
  )
}

/** Public /stats "Playoffs" tab — light theme twin of the overlay scene. */
export function PlayoffPicturePanel({ teams, picture }: Props) {
  if (!picture) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading playoff picture…</div>
  }
  const { config, order, teams: rows, remainingGames, postponedGames } = picture
  const bracket = projectBracket(config)
  const name = (seed: number) => {
    const id = order[seed - 1]
    return id ? (teams[id]?.name ?? id) : 'TBD'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Playoff Picture
          </span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {config.spots} teams qualify · top {config.byes} earn a bye · {remainingGames.length} games left
            {postponedGames.length ? ` (incl. ${postponedGames.length} makeup)` : ''}
          </span>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1e3a5f' }}>
                <th style={{ ...th, width: 36 }}>#</th>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 12 }}>Team</th>
                <th style={th}>W-L</th>
                <th style={th}>PCT</th>
                <th style={th}>Diff</th>
                <th style={th} title="Games left">GL</th>
                <th style={th} title="Best–worst possible seed">Seed</th>
                <th style={th} title="Share of remaining outcomes that qualify">In</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const tag = statusTag(t)
                const line = outlookLine(t)
                const colors = tag ? toneColors(tag.tone) : null
                const byeLine = i === config.byes - 1
                const playoffLine = i === config.spots - 1 && i < rows.length - 1
                return (
                  <tr key={t.teamId} style={{
                    borderBottom: byeLine ? '2px dashed #f59e0b' : playoffLine ? '2px dashed #ef4444' : '1px solid #e5e7eb',
                    background: i % 2 === 0 ? '#ffffff' : '#f9fafb',
                    opacity: t.eliminated ? 0.6 : 1,
                  }}>
                    <td style={{ ...td, fontWeight: 900, color: i < config.byes ? '#b45309' : '#94a3b8' }}>{t.seed}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <TeamCell teams={teams} teamId={t.teamId} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {tag && colors && (
                          <span style={{ fontFamily: 'var(--font-score)', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.fg, background: colors.bg, borderRadius: 4, padding: '2px 6px' }}>
                            {tag.text}
                          </span>
                        )}
                        {line && <span style={{ fontSize: 11, color: '#64748b' }}>{line}</span>}
                      </div>
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>{t.line.w}-{t.line.l}{t.line.t ? `-${t.line.t}` : ''}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#1e3a5f' }}>{fmtPct(t.line)}</td>
                    <td style={td}>{fmtDiff(t.line)}</td>
                    <td style={td}>{t.remaining}</td>
                    <td style={td}>{fmtSeedRange(t)}</td>
                    <td style={{ ...td, fontWeight: 800, color: t.clinchedPlayoff ? '#166534' : t.eliminated ? '#991b1b' : '#1e293b' }}>{oddsLabel(t)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #f1f5f9' }}>
          {picture.exact
            ? `Exact: every one of the ${picture.outcomesEvaluated.toLocaleString()} remaining win/loss outcomes was played out. `
            : 'Estimate: too many games remain for exact enumeration; clinches use max-wins bounds. '}
          Ties: head-to-head, then run differential, then runs allowed.
          {postponedGames.length > 0 && ' Postponed games count as remaining games — league policy is that they will be made up.'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            If the season ended today
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>First-round byes</div>
              {bracket.byes.map(seed => (
                <div key={seed} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ fontFamily: 'var(--font-score)', fontWeight: 900, color: '#b45309', width: 18 }}>{seed}</span>
                  <TeamCell teams={teams} teamId={order[seed - 1] ?? ''} />
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Quarterfinals</div>
              {bracket.quarterfinals.map(m => (
                <div key={m.label} style={{ padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
                  <span style={{ fontFamily: 'var(--font-score)', fontWeight: 900, color: '#94a3b8', marginRight: 6 }}>{m.lowSeed}</span>
                  {name(m.lowSeed)}
                  <span style={{ color: '#94a3b8', margin: '0 8px', fontSize: 11, fontWeight: 700 }}>AT</span>
                  <span style={{ fontFamily: 'var(--font-score)', fontWeight: 900, color: '#94a3b8', marginRight: 6 }}>{m.highSeed}</span>
                  {name(m.highSeed)}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Semifinals reseed: the 1 seed hosts the lowest remaining seed, the 2 seed hosts the other. Winners meet in the final.
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', fontFamily: 'var(--font-score)', fontWeight: 800, fontSize: 15, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Still to play
          </div>
          <div style={{ padding: '8px 16px 12px', fontSize: 13 }}>
            {remainingGames.length === 0 && <div style={{ color: '#94a3b8', padding: '8px 0' }}>Regular season complete.</div>}
            {remainingGames.map(g => (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontFamily: 'var(--font-score)', fontSize: 11, fontWeight: 700, color: '#b45309', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {fmtGameWhen(g)}{g.venue ? ` · ${g.venue}` : ''}
                </span>
                <span style={{ color: '#1e293b', fontWeight: 600 }}>
                  {teams[g.awayTeamId]?.name ?? g.awayTeamId} <span style={{ color: '#94a3b8', fontWeight: 500 }}>at</span> {teams[g.homeTeamId]?.name ?? g.homeTeamId}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
