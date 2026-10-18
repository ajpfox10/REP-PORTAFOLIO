import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/types'

interface RegisterData { name: string; email: string; password: string; phone?: string; address?: string }

interface AuthValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (data: RegisterData) => Promise<User>
  logout: () => Promise<void>
  updateProfile: (data: Partial<Pick<User, 'name' | 'phone' | 'address'>>) => Promise<User>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ user: User | null }>('/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: User }>('/auth/login', { email, password })
    setUser(res.user)
    return res.user
  }, [])

  const register = useCallback(async (data: RegisterData) => {
    const res = await api.post<{ user: User }>('/auth/register', data)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (data: Partial<Pick<User, 'name' | 'phone' | 'address'>>) => {
    const res = await api.patch<{ user: User }>('/auth/me', data)
    setUser(res.user)
    return res.user
  }, [])

  const value = useMemo(() => ({ user, loading, login, register, logout, updateProfile }), [user, loading, login, register, logout, updateProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
