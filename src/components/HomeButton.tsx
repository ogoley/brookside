import { Link } from 'react-router-dom'

export function HomeButton() {
  return (
    <Link
      to="/"
      aria-label="Back to stats"
      title="Back to stats"
      style={{
        width: 30,
        height: 30,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(255,255,255,0.07)',
        color: '#f3f4f6',
        borderRadius: 8,
        textDecoration: 'none',
        border: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </svg>
    </Link>
  )
}
