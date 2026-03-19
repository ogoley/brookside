import { useState } from 'react'
import { motion } from 'framer-motion'
import type { GameMeta, TeamsMap, PlayersMap, Team, Player } from '../types'
import { TeamColorInjector } from '../components/TeamColorInjector'

interface Props {
  game: GameMeta
  teams: TeamsMap
  players: PlayersMap
}

export function StatCardScene({ game, teams, players }: Props) {
  const homeTeam = teams[game.homeTeamId]
  const awayTeam = teams[game.awayTeamId]

  const homePlayers = Object.entries(players).filter(([, p]) => p.teamId === game.homeTeamId)
  const awayPlayers = Object.entries(players).filter(([, p]) => p.teamId === game.awayTeamId)

  const awayColor = awayTeam?.primaryColor ?? '#c0392b'
  const homeColor = homeTeam?.primaryColor ?? '#1a3a6b'

  return (
    <div
      className="relative w-full h-full flex overflow-hidden"
      style={{
        background: `linear-gradient(90deg, ${awayColor} 0%, #111 50%, ${homeColor} 100%)`,
      }}
    >
      <TeamColorInjector homeTeam={homeTeam} awayTeam={awayTeam} />

      {/* Subtle texture overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0, rgba(255,255,255,.05) 1px, transparent 0, transparent 50%)' }}
      />

      {/* Two-column layout */}
      <div className="relative z-10 flex w-full h-full gap-6 px-12 py-10">
        <TeamColumn team={awayTeam} players={awayPlayers} side="away" />
        <div className="w-px bg-white/20 self-stretch" />
        <TeamColumn team={homeTeam} players={homePlayers} side="home" />
      </div>
    </div>
  )
}

// Badge logo: fast entry spin (720°), then slow back-and-forth tilt wobble
function SpinBadge({ src, alt, delay }: { src: string; alt: string; delay: number }) {
  const [phase, setPhase] = useState<'enter' | 'idle'>('enter')

  return (
    <div style={{ perspective: '500px', width: 96, height: 96, flexShrink: 0 }}>
      <motion.img
        src={src}
        alt={alt}
        style={{ width: 96, height: 96, objectFit: 'contain', display: 'block' }}
        initial={{ rotateY: 720, scale: 0.5, opacity: 0 }}
        animate={
          phase === 'enter'
            ? { rotateY: 0, scale: 1, opacity: 1 }
            : { rotateY: [0, 22, -22, 12, -12, 0], scale: 1, opacity: 1 }
        }
        transition={
          phase === 'enter'
            ? { type: 'spring', damping: 11, stiffness: 160, delay, opacity: { duration: 0.25, delay } }
            : { duration: 6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2.5 }
        }
        onAnimationComplete={() => {
          if (phase === 'enter') setPhase('idle')
        }}
      />
    </div>
  )
}

function TeamColumn({
  team,
  players,
  side,
}: {
  team?: Team
  players: [string, Player][]
  side: 'away' | 'home'
}) {
  const headerX = side === 'away' ? -80 : 80
  const rowXBase = side === 'away' ? -120 : 120

  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Team header — drops in from top */}
      <motion.div
        className="flex items-center gap-4 mb-2"
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 260, delay: 0.1 }}
      >
        {team?.logoUrl && <SpinBadge src={team.logoUrl} alt={team.name ?? ''} delay={0.22} />}
        <div>
          <motion.p
            className="text-white/50 text-sm uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-score)' }}
            initial={{ x: headerX, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.18, duration: 0.3, ease: 'easeOut' }}
          >
            {side === 'away' ? 'Away' : 'Home'}
          </motion.p>
          <motion.p
            className="text-white font-black uppercase leading-none"
            style={{ fontFamily: 'var(--font-score)', fontSize: 52 }}
            initial={{ x: headerX, opacity: 0 }}
            animate={{ x: 0, opacity: [null, 1], scale: [null, 1, 1.06, 1] }}
            transition={{
              x: { type: 'spring', damping: 16, stiffness: 280, delay: 0.26 },
              opacity: { duration: 0.3, delay: 0.26 },
              scale: { delay: 2, duration: 0.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 4.5 },
            }}
          >
            {team?.name ?? '---'}
          </motion.p>
        </div>
      </motion.div>

      {/* Column headers */}
      <motion.div
        className="grid grid-cols-4 text-white/40 text-sm uppercase tracking-widest px-3"
        style={{ fontFamily: 'var(--font-score)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.3 }}
      >
        <span className="col-span-1">Player</span>
        <span className="text-center">AVG</span>
        <span className="text-center">HR</span>
        <span className="text-center">RBI</span>
      </motion.div>

      {/* Players — each row flies in from its side, staggered */}
      <div className="flex flex-col gap-3 overflow-hidden">
        {players.length === 0 && (
          <p className="text-white/30 text-sm italic" style={{ fontFamily: 'var(--font-ui)' }}>No players listed</p>
        )}
        {players.map(([id, player], i) => (
          <motion.div
            key={id}
            className="grid grid-cols-4 items-center px-4 py-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(4px)' }}
            initial={{ x: rowXBase, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260, delay: 0.5 + i * 0.06 }}
          >
            <span className="col-span-1 text-white font-semibold text-lg truncate" style={{ fontFamily: 'var(--font-ui)' }}>
              {player.name}
            </span>
            <span className="text-center text-white font-bold text-xl" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.avg !== undefined ? player.stats.avg.toFixed(3).replace(/^0/, '') : '---'}
            </span>
            <span className="text-center text-white font-bold text-xl" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.hr ?? 0}
            </span>
            <span className="text-center text-white font-bold text-xl" style={{ fontFamily: 'var(--font-score)' }}>
              {player.stats.rbi ?? 0}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
