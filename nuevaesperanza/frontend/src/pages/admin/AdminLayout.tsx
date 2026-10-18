import { NavLink, Outlet, Link } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, Package, ReceiptText } from 'lucide-react'
import { Logo } from '../../components/Logo'

export function AdminLayout() {
  return (
    <div className="admin">
      <aside className="admin__side">
        <Logo />
        <nav aria-label="Administración">
          <NavLink to="/admin" end><LayoutDashboard size={18} /> Resumen</NavLink>
          <NavLink to="/admin/pedidos"><ReceiptText size={18} /> Pedidos</NavLink>
          <NavLink to="/admin/productos"><Package size={18} /> Productos</NavLink>
        </nav>
        <Link to="/" className="link-more admin__back" style={{ marginTop: 'auto', color: 'var(--text-2)' }}><ArrowLeft size={16} /> Volver a la tienda</Link>
      </aside>
      <main className="admin__main"><Outlet /></main>
    </div>
  )
}
