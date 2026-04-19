import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '../firebase'

export type Role = 'admin' | 'scorer' | null

export interface AuthState {
  user: User | null
  role: Role
  loading: boolean
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, role: null, loading: true })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) {
        setState({ user: null, role: null, loading: false })
        return
      }
      const token = await user.getIdTokenResult()
      const rawRole = token.claims.role
      const role: Role = rawRole === 'admin' || rawRole === 'scorer' ? rawRole : null
      setState({ user, role, loading: false })
    })
    return unsub
  }, [])

  return state
}

export function hasRole(current: Role, required: 'scorer' | 'admin'): boolean {
  if (current === 'admin') return true
  if (required === 'scorer' && current === 'scorer') return true
  return false
}
