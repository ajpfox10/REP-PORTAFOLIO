import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Check, ChevronLeft, CircleCheck, PackageCheck, Truck, X } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import type { Order, OrderStatus } from '../lib/types'
import { DELIVERY_LABEL, PAYMENT_LABEL, STATUS_LABEL, formatDateTime, formatMoney } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { NotFoundPage } from './NotFoundPage'

const STEPS: OrderStatus[] = ['pending', 'preparing', 'shipped', 'delivered']

export function OrderTimeline({ order }: { order: Pick<Order, 'status' | 'delivery_method'> }) {
  if (order.status === 'cancelled') return <div className="alert alert--error"><X size={18} /> Este pedido fue cancelado.</div>
  const steps = order.delivery_method === 'pickup' ? STEPS.filter((s) => s !== 'shipped') : STEPS
  const current = steps.indexOf(order.status)
  const label = (s: OrderStatus) => (order.delivery_method === 'pickup' && s === 'delivered' ? 'Retirado' : STATUS_LABEL[s])
  return (
    <ol className="timeline" style={{ listStyle: 'none', padding: 0 }}>
      {steps.map((s, i) => (
        <li key={s} className={`timeline__step ${i <= current ? 'done' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className="timeline__dot">{i <= current ? <Check size={16} /> : i + 1}</span>
          {label(s)}
        </li>
      ))}
    </ol>
  )
}

export function OrderPage() {
  const { id } = useParams()
  const location = useLocation()
  const notify = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated)

  useEffect(() => {
    api.get<{ order: Order }>(`/orders/${Number(id)}`)
      .then((r) => setOrder(r.order))
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setMissing(true) })
  }, [id])

  if (missing) return <NotFoundPage />
  if (!order) return <div className="container page"><div className="skeleton" style={{ height: 400 }} /></div>

  async function cancel() {
    if (!order || !window.confirm('¿Cancelar este pedido?')) return
    setBusy(true)
    try {
      const r = await api.post<{ order: Order }>(`/orders/${order.id}/cancel`)
      setOrder(r.order)
      notify('Pedido cancelado')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No pudimos cancelar el pedido', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container page">
      <Link to="/mi-cuenta" className="link-more" style={{ color: 'var(--text-2)' }}><ChevronLeft size={16} /> Mis pedidos</Link>
      {justCreated && (
        <div className="alert alert--success" style={{ marginTop: 16 }}>
          <CircleCheck size={20} />
          <div><strong>¡Gracias por tu compra!</strong> Te avisamos por teléfono cuando el pedido esté {order.delivery_method === 'pickup' ? 'listo para retirar' : 'en camino'}.</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Pedido #{order.id}</h1>
          <p className="page-subtitle">{formatDateTime(order.created_at)}</p>
        </div>
        <span className={`badge badge--${order.status}`} style={{ fontSize: '0.85rem', padding: '6px 14px' }}>{STATUS_LABEL[order.status]}</span>
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}><OrderTimeline order={order} /></div>

      <div className="two-col">
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Producto</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Total</th></tr></thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.product_id}>
                    <td>
                      {item.slug ? <Link to={`/producto/${item.slug}`} style={{ fontWeight: 600 }}>{item.product_name}</Link> : item.product_name}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{item.unit}</div>
                    </td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">
                      {item.unit_price < item.list_price && <div className="price__was">{formatMoney(item.list_price)}</div>}
                      {formatMoney(item.unit_price)}
                    </td>
                    <td className="num"><strong>{formatMoney(item.line_total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="card card-pad sticky" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="summary">
            <div className="summary__row"><span>Subtotal</span><strong>{formatMoney(order.subtotal + order.savings)}</strong></div>
            {order.savings > 0 && <div className="summary__row summary__row--savings"><span>Ahorro</span><strong>-{formatMoney(order.savings)}</strong></div>}
            <div className="summary__row"><span>Envío</span><strong>{order.delivery_fee === 0 ? 'Gratis' : formatMoney(order.delivery_fee)}</strong></div>
            <div className="summary__total"><span>Total</span><span>{formatMoney(order.total)}</span></div>
          </div>
          <div className="fact">{order.delivery_method === 'pickup' ? <PackageCheck size={18} /> : <Truck size={18} />}<div><strong>{DELIVERY_LABEL[order.delivery_method]}</strong><div>{order.address ?? 'Av. Principal 1234 · de 8 a 21 h'}</div></div></div>
          <div className="fact"><div><strong>Pago</strong><div>{PAYMENT_LABEL[order.payment_method]}</div></div></div>
          {order.notes && <div className="fact"><div><strong>Indicaciones</strong><div>{order.notes}</div></div></div>}
          {order.status === 'pending' && (
            <button type="button" className="btn btn--danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelando…' : 'Cancelar pedido'}</button>
          )}
        </aside>
      </div>
    </div>
  )
}
