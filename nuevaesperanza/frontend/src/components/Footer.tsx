import { Link } from 'react-router-dom'
import { Clock, MapPin, Phone } from 'lucide-react'
import { Logo } from './Logo'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Logo />
            <p className="muted" style={{ marginTop: 12, maxWidth: 320, fontSize: '0.9rem' }}>
              El supermercado del barrio, ahora también online. Precios de siempre, ofertas todas las semanas.
            </p>
          </div>
          <div>
            <h4>Comprar</h4>
            <ul>
              <li><Link to="/productos?ofertas=1">Ofertas de la semana</Link></li>
              <li><Link to="/productos">Todos los productos</Link></li>
              <li><Link to="/mi-cuenta">Mis pedidos</Link></li>
            </ul>
          </div>
          <div>
            <h4>Envíos</h4>
            <ul>
              <li>Gratis desde $50.000</li>
              <li>Retiro sin cargo en el local</li>
              <li>Pagás al recibir</li>
            </ul>
          </div>
          <div>
            <h4>El local</h4>
            <ul>
              <li style={{ display: 'flex', gap: 8 }}><MapPin size={16} /> Av. Principal 1234</li>
              <li style={{ display: 'flex', gap: 8 }}><Clock size={16} /> Lunes a sábado, 8 a 21 h</li>
              <li style={{ display: 'flex', gap: 8 }}><Phone size={16} /> (011) 4000-1234</li>
            </ul>
          </div>
        </div>
        <div className="footer__bottom">© {new Date().getFullYear()} Supermercado Nueva Esperanza · Proyecto de portafolio</div>
      </div>
    </footer>
  )
}
