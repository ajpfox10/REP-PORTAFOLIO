import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../lib/api'
import type { OrderStatus } from '../../lib/types'
import { STATUS_LABEL, formatMoney } from '../../lib/format'

interface Stats {
  today: { orders: number; revenue: number }
  week: { orders: number; revenue: number; average: number }
  byStatus: Array<{ status: OrderStatus; count: number }>
  daily: Array<{ day: string; orders: number; revenue: number }>
  topProducts: Array<{ name: string; units: number; revenue: number }>
  lowStock: Array<{ id: number; name: string; unit: string; stock: number }>
  customers: number
  lowStockThreshold: number
}

// Completa los días sin ventas para que el gráfico muestre las dos semanas
function lastDays(daily: Stats['daily'], days = 14) {
  const byDay = new Map(daily.map((d) => [d.day, d]))
  return Array.from({ length: days }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - i))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return { key, date, revenue: Number(byDay.get(key)?.revenue ?? 0), orders: Number(byDay.get(key)?.orders ?? 0) }
  })
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Stats>('/admin/stats').then(setStats).catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="alert alert--error">{error}</div>
  if (!stats) return <div className="skeleton" style={{ height: 480 }} />

  const days = lastDays(stats.daily)
  const max = Math.max(1, ...days.map((d) => d.revenue))
  const topMax = Math.max(1, ...stats.topProducts.map((p) => Number(p.units)))
  const pending = stats.byStatus.find((s) => s.status === 'pending')?.count ?? 0

  return (
    <>
      <div className="admin__top">
        <div>
          <h1 className="page-title">Resumen</h1>
          <p className="page-subtitle">Cómo viene el negocio en los últimos días.</p>
        </div>
        {pending > 0 && <Link to="/admin/pedidos?estado=pending" className="btn btn--primary">{pending} pedidos para preparar</Link>}
      </div>

      <div className="kpis">
        <div className="card kpi"><span>Ventas de hoy</span><strong>{formatMoney(Number(stats.today.revenue))}</strong><small>{stats.today.orders} pedidos</small></div>
        <div className="card kpi"><span>Últimos 7 días</span><strong>{formatMoney(Number(stats.week.revenue))}</strong><small>{stats.week.orders} pedidos</small></div>
        <div className="card kpi"><span>Ticket promedio</span><strong>{formatMoney(Math.round(Number(stats.week.average)))}</strong><small>últimos 7 días</small></div>
        <div className="card kpi"><span>Clientes</span><strong>{stats.customers}</strong><small>registrados</small></div>
      </div>

      <div className="admin-grid">
        <section className="card card-pad" aria-labelledby="chart-title">
          <div className="panel-title"><h2 id="chart-title">Ventas por día</h2><span className="muted" style={{ fontSize: '0.82rem' }}>Últimas 2 semanas</span></div>
          <div className="bars" role="img" aria-label={`Ventas diarias de las últimas dos semanas. Máximo ${formatMoney(max)}.`}>
            {days.map((d) => (
              <div key={d.key} className="bars__col" tabIndex={0} aria-label={`${d.date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}: ${formatMoney(d.revenue)}, ${d.orders} pedidos`}>
                <span className="bars__tip">{d.date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })} · {formatMoney(d.revenue)} · {d.orders} ped.</span>
                <div className="bars__bar" style={{ height: `${(d.revenue / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="bars__labels" aria-hidden="true">
            {days.map((d, i) => <span key={d.key}>{i % 2 === 1 || days.length < 10 ? d.date.getDate() : ''}</span>)}
          </div>
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>Día de mayor venta: {formatMoney(max)}</p>
        </section>

        <section className="card card-pad" aria-labelledby="status-title">
          <div className="panel-title"><h2 id="status-title">Pedidos por estado</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['pending', 'preparing', 'shipped', 'delivered', 'cancelled'] as OrderStatus[]).map((s) => (
              <Link key={s} to={`/admin/pedidos?estado=${s}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`badge badge--${s}`}>{STATUS_LABEL[s]}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.byStatus.find((x) => x.status === s)?.count ?? 0}</strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="card card-pad" aria-labelledby="top-title">
          <div className="panel-title"><h2 id="top-title">Más vendidos</h2><span className="muted" style={{ fontSize: '0.82rem' }}>30 días · unidades</span></div>
          <div className="bar-list">
            {stats.topProducts.map((p) => (
              <div key={p.name} className="bar-list__row">
                <span>{p.name}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{p.units}</strong>
                <div className="bar-list__track"><div className="bar-list__fill" style={{ width: `${(Number(p.units) / topMax) * 100}%` }} /></div>
              </div>
            ))}
            {stats.topProducts.length === 0 && <p className="muted">Todavía no hay ventas.</p>}
          </div>
        </section>

        <section className="card card-pad" aria-labelledby="low-title">
          <div className="panel-title"><h2 id="low-title">Stock bajo</h2><span className="muted" style={{ fontSize: '0.82rem' }}>menos de {stats.lowStockThreshold}</span></div>
          {stats.lowStock.length === 0 ? <p className="muted">Todo el stock está en orden.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stats.lowStock.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.9rem' }}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} style={{ color: 'var(--offer)' }} /> {p.name} <span className="muted">{p.unit}</span></span>
                  <strong className={p.stock === 0 ? 'stock-note--out' : ''}>{p.stock}</strong>
                </div>
              ))}
              <Link to="/admin/productos?estado=low" className="link-more">Reponer stock</Link>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
