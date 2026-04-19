import { Link } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../hooks/useAuth'

export function AuthStatus() {
  const { user, role, loading } = useAuth()
  if (loading) return null

  const pillBase: React.CSSProperties = {
    position: 'fixed',
    top: 10,
    right: 10,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    color: '#f3f4f6',
    fontFamily: 'var(--font-ui)',
    fontSize: 12,
    backdropFilter: 'blur(4px)',
  }

  if (!user) {
    return (
      <Link to="/controller" style={{ ...pillBase, textDecoration: 'none' }}>
        Sign in
      </Link>
    )
  }

  const username = user.email?.split('@')[0] ?? 'user'

  return (
    <div style={pillBase}>
      <span style={{ color: 'rgba(255,255,255,0.8)' }}>
        {username}{role ? ` · ${role}` : ''}
      </span>
      <button
        onClick={() => signOut(auth)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.3)',
          color: '#f3f4f6',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
        }}
      >
        Sign out
      </button>
    </div>
  )
}
