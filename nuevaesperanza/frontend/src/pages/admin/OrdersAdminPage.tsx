import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Phone, X } from 'lucide-react'
import { api, ApiError, qs } from '../../lib/api'
import type { Order, OrderStatus, OrderSummary } from '../../lib/types'
import { DELIVERY_LABEL, PAYMENT_LABEL, STATUS_LABEL, formatDateTime, formatMoney } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { OrderTimeline } from '../OrderPage'

const STATUSES: OrderStatus[] = ['pending', 'preparing', 'shipped', 'delivered', 'cancelled']

// Próximo paso natural según el estado y la forma de entrega
function nextStep(order: Pick<Order, 'status' | 'delivery_method'>): OrderStatus | null {
  if (order.status === 'pending') return 'preparing'
  if (order.status === 'preparing') return order.delivery_method === 'pickup' ? 'delivered' : 'shipped'
  if (order.status === 'shipped') return 'delivered'
  return null
}

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: 'Empezar a preparar',
  shipped: 'Despachar',
  delivered: 'Marcar como entregado',
}

export function OrdersAdminPage() {
  const notify = useToast()
  const [params, setParams] = useSearchParams()
  const status = (params.get('estado') ?? '') as OrderStatus | ''
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [selected, setSelected] = useState<Order | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const r = await api.get<{ orders: OrderSummary[] }>(`/admin/orders${qs({ status })}`)
    setOrders(r.orders)
  }

  useEffect(() => {
    setOrders(null)
    load().catch((e) => notify(e.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function open(id: number) {
    try {
      setSelected((await api.get<{ order: Order }>(`/admin/orders/${id}`)).order)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo abrir el pedido', 'error')
    }
  }

  async function changeStatus(next: OrderStatus) {
    if (!selected) return
    if (next === 'cancelled' && !window.confirm('¿Cancelar el pedido? El stock vuelve a quedar disponible.')) return
    setBusy(true)
    try {
      const r = await api.patch<{ order: Order }>(`/admin/orders/${selected.id}/status`, { status: next })
      setSelected(r.order)
      notify(`Pedido #${r.order.id}: ${STATUS_LABEL[r.order.status].toLowerCase()}`)
      await load()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo cambiar el estado', 'error')
    } finally {
      setBusy(false)
    }
  }

  const next = selected ? nextStep(selected) : null

  return (
    <>
      <div className="admin__top">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="page-subtitle">{orders ? `${orders.length} pedidos` : 'Cargando…'}</p>
        </div>
      </div>

      <div className="tabs" role="group" aria-label="Filtrar por estado">
        <button type="button" aria-pressed={!status} onClick={() => setParams({})}>Todos</button>
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setParams({ estado: s })}>{STATUS_LABEL[s]}</button>
        ))}
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Entrega</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>
            {orders?.map((o) => (
              <tr key={o.id} onClick={() => open(o.id)} style={{ cursor: 'pointer' }}>
                <td><button type="button" className="link-btn" style={{ color: 'var(--primary)', fontSize: '0.9rem', fontWeight: 800 }} onClick={(e) => { e.stopPropagation(); open(o.id) }}>#{o.id}</button></td>
                <td>{o.customer_name}<div className="muted" style={{ fontSize: '0.8rem' }}>{o.item_count} productos</div></td>
                <td>{formatDateTime(o.created_at)}</td>
                <td>{DELIVERY_LABEL[o.delivery_method]}</td>
                <td><span className={`badge badge--${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
                <td className="num"><strong>{formatMoney(o.total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders === null && <div className="card-pad"><div className="skeleton" style={{ height: 240 }} /></div>}
        {orders?.length === 0 && <p className="card-pad muted">No hay pedidos en este estado.</p>}
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="order-title">
            <div className="modal__head">
              <div>
                <h2 id="order-title">Pedido #{selected.id}</h2>
                <p className="muted" style={{ fontSize: '0.85rem' }}>{formatDateTime(selected.created_at)}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Cerrar"><X size={18} /></button>
            </div>

            <OrderTimeline order={selected} />

            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="fact"><div><strong>{selected.customer_name}</strong><div>{selected.customer_email}</div></div></div>
              <div className="fact"><Phone size={18} /><div><strong>{selected.phone}</strong><div>{PAYMENT_LABEL[selected.payment_method]}</div></div></div>
              <div className="fact span-2"><div><strong>{DELIVERY_LABEL[selected.delivery_method]}</strong><div>{selected.address ?? 'Retira por el local'}</div>{selected.notes && <div className="muted">“{selected.notes}”</div>}</div></div>
            </div>

            <table className="table" style={{ marginTop: 16 }}>
              <tbody>
                {selected.items.map((i) => (
                  <tr key={i.product_id}>
                    <td>{i.product_name} <span className="muted">· {i.unit}</span></td>
                    <td className="num">{i.quantity} × {formatMoney(i.unit_price)}</td>
                    <td className="num"><strong>{formatMoney(i.line_total)}</strong></td>
                  </tr>
                ))}
                <tr><td colSpan={2}>Envío</td><td className="num">{selected.delivery_fee ? formatMoney(selected.delivery_fee) : 'Gratis'}</td></tr>
                <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{formatMoney(selected.total)}</strong></td></tr>
              </tbody>
            </table>

            <div className="modal__actions">
              {['pending', 'preparing'].includes(selected.status) && (
                <button type="button" className="btn btn--danger" onClick={() => changeStatus('cancelled')} disabled={busy}>Cancelar pedido</button>
              )}
              {next && <button type="button" className="btn btn--primary" onClick={() => changeStatus(next)} disabled={busy}>{NEXT_LABEL[next]}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
