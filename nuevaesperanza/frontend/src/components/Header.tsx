import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutDashboard, Moon, Percent, Search, ShoppingCart, Sun, User } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useCategories } from '../lib/useCategories'
import { useTheme } from '../lib/theme'
import { initials } from '../lib/format'
import { CategoryIcon } from './CategoryIcon'
import { Logo } from './Logo'

export function Header() {
  const { user } = useAuth()
  const cart = useCart()
  const categories = useCategories()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')

  useEffect(() => { setTerm(params.get('q') ?? '') }, [params])

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = term.trim()
    navigate(q ? `/productos?q=${encodeURIComponent(q)}` : '/productos')
  }

  const activeCategory = location.pathname === '/productos' ? params.get('categoria') : null
  const offersActive = location.pathname === '/productos' && params.get('ofertas') === '1'

  return (
    <header className="header">
      <div className="container header__bar">
        <Logo />
        <form className="search" role="search" onSubmit={submit}>
          <Search size={18} />
          <label htmlFor="search" className="sr-only">Buscar productos</label>
          <input
            id="search"
            className="input"
            type="search"
            placeholder="Buscá leche, yerba, detergente…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            maxLength={80}
          />
        </form>
        <div className="header__actions">
          <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {user?.role === 'admin' && (
            <Link to="/admin" className="icon-btn" aria-label="Panel de administración" title="Panel de administración">
              <LayoutDashboard size={18} />
            </Link>
          )}
          {user ? (
            <Link to="/mi-cuenta" className="header__account">
              <span className="avatar">{initials(user.name)}</span>
              <span>{user.name.split(' ')[0]}</span>
            </Link>
          ) : (
            <Link to="/ingresar" className="header__account">
              <span className="avatar"><User size={15} /></span>
              <span>Ingresar</span>
            </Link>
          )}
          <button type="button" className="icon-btn cart-btn" onClick={cart.open} aria-label={`Abrir carrito, ${cart.count} productos`}>
            <ShoppingCart size={18} />
            {cart.count > 0 && <span className="cart-btn__count">{cart.count > 99 ? '99+' : cart.count}</span>}
          </button>
        </div>
      </div>
      <nav className="catnav" aria-label="Categorías">
        <div className="container catnav__list">
          <NavLink to="/productos?ofertas=1" className={`offers ${offersActive ? 'active' : ''}`}>
            <Percent size={16} /> Ofertas
          </NavLink>
          {categories.map((c) => (
            <Link key={c.slug} to={`/productos?categoria=${c.slug}`} className={activeCategory === c.slug ? 'active' : ''}>
              <CategoryIcon name={c.icon} size={16} style={{ color: c.color }} /> {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}
