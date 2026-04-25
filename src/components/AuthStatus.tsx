import { Link } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../hooks/useAuth'

export function AuthStatus() {
  const { user, role, loading } = useAuth()
  if (loading) return null

  const pillBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'var(--font-ui)',
    fontSize: 11,
    lineHeight: 1.2,
    flexShrink: 0,
  }

  if (!user) {
    return (
      <Link to="/controller" style={{ ...pillBase, textDecoration: 'none' }}>
        Sign in
      </Link>
    )
  }

  return (
    <div style={pillBase}>
      <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {role ?? 'user'}
      </span>
      <button
        onClick={() => signOut(auth)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.7)',
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Sign out
      </button>
    </div>
  )
}
