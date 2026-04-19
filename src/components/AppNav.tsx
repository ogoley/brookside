import { Link } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth, hasRole } from '../hooks/useAuth'

interface NavLink {
  to: string
  label: string
  minRole?: 'scorer' | 'admin'
}

const LINKS: NavLink[] = [
  { to: '/overlay', label: 'Overlay' },
  { to: '/controller', label: 'Controller', minRole: 'scorer' },
  { to: '/scorekeeper', label: 'Scorekeeper', minRole: 'scorer' },
  { to: '/game-editor', label: 'Game Editor', minRole: 'admin' },
  { to: '/ai-summary', label: 'AI Summary', minRole: 'admin' },
  { to: '/config', label: 'Config', minRole: 'admin' },
]

export function AppNav() {
  const { user, role, loading } = useAuth()
  if (loading) return null

  // Hide admin-only links from non-admins. Scorer-level links stay visible
  // to everyone — clicking as a logged-out user lands on the login screen.
  const visibleLinks = LINKS.filter(l => l.minRole !== 'admin' || hasRole(role, 'admin'))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
      {visibleLinks.map(link => (
        <Link
          key={link.to}
          to={link.to}
          style={{
            color: 'rgba(255,255,255,0.75)',
            textDecoration: 'none',
            padding: '4px 10px',
            borderRadius: 4,
            letterSpacing: '0.02em',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {link.label}
        </Link>
      ))}
      <div style={{ flex: 1 }} />
      {user ? (
        <>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '0 6px' }}>
            {user.email?.split('@')[0]}{role ? ` · ${role}` : ''}
          </span>
          <button
            onClick={() => signOut(auth)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'rgba(255,255,255,0.75)',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <Link
          to="/controller"
          style={{
            color: 'rgba(255,255,255,0.75)',
            textDecoration: 'none',
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.3)',
            fontSize: 11,
          }}
        >
          Sign in
        </Link>
      )}
    </div>
  )
}
