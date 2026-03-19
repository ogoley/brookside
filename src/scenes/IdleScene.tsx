export function IdleScene() {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #0d1b2a 0%, #1a2a4a 100%)' }}
    >
      {/* League logo placeholder — replace with actual logo */}
      <div
        className="w-32 h-32 rounded-full flex items-center justify-center mb-6"
        style={{ background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.15)' }}
      >
        <span
          className="text-white text-5xl font-black"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          WB
        </span>
      </div>

      <p
        className="text-white text-3xl font-black uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        Wiffle Ball League
      </p>
      <p
        className="text-white/40 text-base mt-2 tracking-widest uppercase"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        Broadcast Starting Soon
      </p>
    </div>
  )
}
