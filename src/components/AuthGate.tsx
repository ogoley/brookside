import { useState, type FormEvent, type ReactNode } from 'react'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { usernameToEmail } from '../authConfig'
import { useAuth, hasRole, type Role } from '../hooks/useAuth'

interface AuthGateProps {
  requiredRole: 'scorer' | 'admin'
  children: ReactNode
}

export function AuthGate({ requiredRole, children }: AuthGateProps) {
  const { user, role, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-ui)', color: '#9ca3af' }}>
        Loading…
      </div>
    )
  }

  if (!user) return <LoginScreen requiredRole={requiredRole} />
  if (!hasRole(role, requiredRole)) return <InsufficientRole role={role} requiredRole={requiredRole} />

  return <>{children}</>
}

function LoginScreen({ requiredRole }: { requiredRole: 'scorer' | 'admin' }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(username), password)
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Invalid username or password.')
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Try again in a few minutes.')
      } else {
        setError(`Login failed: ${code || 'unknown error'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1220', fontFamily: 'var(--font-ui)' }}>
      <form
        onSubmit={submit}
        style={{
          background: '#111827',
          border: '1px solid #1f2937',
          borderRadius: 12,
          padding: 32,
          width: 360,
          color: '#e5e7eb',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 4 }}>Sign in</h1>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, marginBottom: 20 }}>
          {requiredRole === 'admin' ? 'Admin access required.' : 'Scorekeeper or admin access required.'}
        </p>
        <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Username</label>
        <input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          style={inputStyle}
        />
        <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginTop: 12, marginBottom: 4 }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#fca5a5' }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 20,
            width: '100%',
            padding: '10px 14px',
            background: busy ? '#374151' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function InsufficientRole({ role, requiredRole }: { role: Role; requiredRole: 'scorer' | 'admin' }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1220', fontFamily: 'var(--font-ui)', color: '#e5e7eb' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0, marginBottom: 8 }}>Not authorized</h1>
        <p style={{ fontSize: 14, color: '#9ca3af', margin: 0, marginBottom: 20 }}>
          This page requires <strong>{requiredRole}</strong> access. Your account currently has{' '}
          <strong>{role ?? 'no role'}</strong>.
        </p>
        <button
          onClick={() => signOut(auth)}
          style={{
            padding: '8px 14px',
            background: '#1f2937',
            color: '#e5e7eb',
            border: '1px solid #374151',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  background: '#0b1220',
  border: '1px solid #374151',
  borderRadius: 6,
  color: '#e5e7eb',
  fontSize: 14,
  fontFamily: 'var(--font-ui)',
  boxSizing: 'border-box',
}
