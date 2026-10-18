import { Leaf } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Nueva Esperanza, ir al inicio">
      <span className="logo__mark"><Leaf size={20} /></span>
      <span>
        Nueva Esperanza
        <small>Supermercado</small>
      </span>
    </Link>
  )
}
