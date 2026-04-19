import { Link } from 'react-router-dom'

export function HomeButton() {
  return (
    <Link
      to="/"
      aria-label="Back to stats"
      title="Back to stats"
      style={{
        position: 'fixed',
        top: 10,
        left: 10,
        zIndex: 1000,
        width: 36,
        height: 36,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.55)',
        color: '#f3f4f6',
        borderRadius: 8,
        textDecoration: 'none',
        border: '1px solid rgba(255,255,255,0.15)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </svg>
    </Link>
  )
}
