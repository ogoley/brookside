import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, hasRole } from '../hooks/useAuth'
import { AuthStatus } from './AuthStatus'

interface NavLink {
  to: string
  label: string
  minRole?: 'scorer' | 'admin'
}

// Every overlay and controller is reachable from here — no hidden routes.
const OVERLAY_LINKS: NavLink[] = [
  { to: '/overlay', label: 'Season' },
  { to: '/derby-overlay', label: 'Derby' },
  { to: '/allstar-overlay', label: 'All-Star' },
]

const CONTROLLER_LINKS: NavLink[] = [
  { to: '/controller', label: 'Season' },
  { to: '/derby-controller', label: 'Derby' },
  { to: '/allstar-controller', label: 'All-Star' },
]

const LINKS: NavLink[] = [
  { to: '/derby', label: 'Derby' },
  { to: '/scorekeeper', label: 'Scorekeeper', minRole: 'scorer' },
  { to: '/game-editor', label: 'Game Editor', minRole: 'admin' },
  { to: '/ai-summary', label: 'AI Summary', minRole: 'admin' },
  { to: '/config', label: 'Config', minRole: 'admin' },
]

const itemStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.75)',
  textDecoration: 'none',
  padding: '4px 10px',
  borderRadius: 4,
  letterSpacing: '0.02em',
}

function NavDropdown({ label, links }: { label: string; links: NavLink[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          ...itemStyle,
          background: open ? 'rgba(255,255,255,0.1)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        {label} <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 60, marginTop: 4,
            display: 'flex', flexDirection: 'column', minWidth: 130,
            background: '#1e3a5f', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {links.map(link => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              style={{ ...itemStyle, padding: '7px 10px', fontSize: 12, fontWeight: 600 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function AppNav() {
  const { role, loading } = useAuth()
  if (loading) return null

  // Hide admin-only links from non-admins. Scorer-level links stay visible
  // to everyone — clicking as a logged-out user lands on the login screen.
  const visibleLinks = LINKS.filter(l => l.minRole !== 'admin' || hasRole(role, 'admin'))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
      <NavDropdown label="Overlays" links={OVERLAY_LINKS} />
      <NavDropdown label="Controllers" links={CONTROLLER_LINKS} />
      {visibleLinks.map(link => (
        <Link
          key={link.to}
          to={link.to}
          style={itemStyle}
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
