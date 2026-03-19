import type { Bases } from '../types'

interface Props {
  bases: Bases
}

export function BaseDiamond({ bases }: Props) {
  const BaseSquare = ({ active, label }: { active: boolean; label: string }) => (
    <div
      aria-label={label}
      className="w-4 h-4 rotate-45 border-2 border-white/60 transition-colors duration-200"
      style={{ background: active ? '#facc15' : 'transparent' }}
    />
  )

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: 40, height: 40 }}>
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
