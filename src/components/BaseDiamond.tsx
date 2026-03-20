import type { Bases } from '../types'

interface Props {
  bases: Bases
  size?: number
}

export function BaseDiamond({ bases, size = 40 }: Props) {
  const sq = Math.round(size * 0.4)
  const gap = Math.round(size * 0.05)
  const BaseSquare = ({ active, label }: { active: boolean; label: string }) => (
    <div
      aria-label={label}
      className="rotate-45 border-2 border-white/60 transition-colors duration-200"
      style={{ width: sq, height: sq, background: active ? '#facc15' : 'transparent' }}
    />
  )

  return (
    <div className="flex flex-col items-center" style={{ width: size, height: size, gap }}>
      <div className="flex justify-center">
        <BaseSquare active={bases.second} label="Second base" />
      </div>
      <div className="flex justify-between w-full">
        <BaseSquare active={bases.third} label="Third base" />
        <BaseSquare active={bases.first} label="First base" />
      </div>
    </div>
  )
}
