import { Link } from 'react-router-dom'
import { useAuth, hasRole } from '../hooks/useAuth'
import { AuthStatus } from './AuthStatus'

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
  const { role, loading } = useAuth()
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
      <AuthStatus />
    </div>
  )
}
