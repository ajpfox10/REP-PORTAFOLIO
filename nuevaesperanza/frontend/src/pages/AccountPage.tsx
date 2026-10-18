import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, PackageOpen } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api, ApiError } from '../lib/api'
import type { OrderSummary } from '../lib/types'
import { DELIVERY_LABEL, STATUS_LABEL, formatDate, formatMoney } from '../lib/format'

export function AccountPage() {
  const { user, logout, updateProfile } = useAuth()
  const notify = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [form, setForm] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', address: user?.address ?? '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<{ orders: OrderSummary[] }>('/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([]))
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFields({})
    try {
      await updateProfile(form)
      notify('Datos actualizados')
    } catch (e) {
      if (e instanceof ApiError) { setFields(e.fields); notify(e.message, 'error') }
    } finally {
      setSaving(false)
    }
  }

  async function exit() {
    await logout()
    notify('Cerraste sesión')
    navigate('/')
  }

  if (!user) return null

  return (
    <div className="container page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Hola, {user.name.split(' ')[0]}</h1>
          <p className="page-subtitle">{user.email}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={exit}><LogOut size={16} /> Cerrar sesión</button>
      </div>

      <div className="two-col">
        <section className="card" aria-labelledby="orders-title">
          <div className="card-pad" style={{ paddingBottom: 8 }}><h2 id="orders-title" style={{ fontSize: '1.1rem', fontWeight: 800 }}>Mis pedidos</h2></div>
          {orders === null && <div className="card-pad"><div className="skeleton" style={{ height: 160 }} /></div>}
          {orders?.length === 0 && (
            <div className="empty">
              <span className="empty__icon"><PackageOpen size={28} /></span>
              <h2>Todavía no hiciste pedidos</h2>
              <Link to="/productos?ofertas=1" className="btn btn--primary">Ver ofertas</Link>
            </div>
          )}
          {orders && orders.length > 0 && (
            <div className="order-list">
              {orders.map((o) => (
                <Link key={o.id} to={`/pedidos/${o.id}`} className="order-row">
                  <strong>#{o.id}</strong>
                  <div>
                    <div style={{ fontWeight: 600 }}>{formatDate(o.created_at)}</div>
                    <div className="muted" style={{ fontSize: '0.84rem' }}>{o.item_count} productos · {DELIVERY_LABEL[o.delivery_method]}</div>
                  </div>
                  <span className={`badge badge--${o.status} hide-sm`}>{STATUS_LABEL[o.status]}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>{formatMoney(o.total)} <ChevronRight size={16} /></span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <form className="card card-pad sticky" onSubmit={save} noValidate>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 14 }}>Mis datos</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field"><label htmlFor="acc-name">Nombre</label><input id="acc-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={Boolean(fields.name)} />{fields.name && <span className="field-error">{fields.name}</span>}</div>
            <div className="field"><label htmlFor="acc-phone">Teléfono</label><input id="acc-phone" className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-invalid={Boolean(fields.phone)} />{fields.phone && <span className="field-error">{fields.phone}</span>}</div>
            <div className="field"><label htmlFor="acc-address">Dirección</label><input id="acc-address" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} aria-invalid={Boolean(fields.address)} />{fields.address && <span className="field-error">{fields.address}</span>}</div>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
