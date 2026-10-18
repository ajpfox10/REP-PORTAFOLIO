import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="container page">
      <div className="empty card">
        <span className="empty__icon"><MapPinOff size={28} /></span>
        <h2>No encontramos esta página</h2>
        <p>Puede que el producto ya no esté disponible o que el enlace esté mal escrito.</p>
        <Link to="/" className="btn btn--primary">Volver al inicio</Link>
      </div>
    </div>
  )
}
