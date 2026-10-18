import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="container page"><div className="skeleton" style={{ height: 300 }} /></div>
  if (!user) return <Navigate to="/ingresar" replace state={{ from: location.pathname + location.search }} />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
