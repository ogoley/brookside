interface Props {
  outs: number
}

export function OutIndicator({ outs }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-3 h-3 rounded-full border-2 border-white/60 transition-colors duration-200"
          style={{ background: i < outs ? '#facc15' : 'transparent' }}
        />
      ))}
    </div>
  )
}
