import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, CircleAlert, CreditCard, Landmark, ShoppingBasket, Store, Truck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { useQuote } from '../lib/useQuote'
import { api, ApiError } from '../lib/api'
import { formatMoney } from '../lib/format'
import type { Order } from '../lib/types'
import { CartSummary, FreeShippingMeter } from '../components/CartSummary'
import { ProductArt } from '../components/ProductArt'

type Method = 'delivery' | 'pickup'
type Payment = 'cash' | 'card' | 'transfer'

export function CheckoutPage() {
  const { user } = useAuth()
  const cart = useCart()
  const notify = useToast()
  const navigate = useNavigate()
  const [method, setMethod] = useState<Method>('delivery')
  const [payment, setPayment] = useState<Payment>('cash')
  const [address, setAddress] = useState(user?.address ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [notes, setNotes] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { quote } = useQuote(cart.items, method)

  useEffect(() => {
    setAddress((a) => a || user?.address || '')
    setPhone((p) => p || user?.phone || '')
  }, [user])

  if (cart.items.length === 0) {
    return (
      <div className="container page">
        <div className="empty card">
          <span className="empty__icon"><ShoppingBasket size={28} /></span>
          <h2>No hay nada para pagar todavía</h2>
          <p>Agregá productos al carrito para hacer tu pedido.</p>
          <Link to="/productos" className="btn btn--primary">Ir a comprar</Link>
        </div>
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setFields({})
    try {
      const { order } = await api.post<{ order: Order }>('/orders', {
        items: cart.items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        deliveryMethod: method,
        address: method === 'delivery' ? address : undefined,
        phone,
        paymentMethod: payment,
        notes: notes || undefined,
      })
      cart.clear()
      notify('¡Recibimos tu pedido!')
      navigate(`/pedidos/${order.id}`, { replace: true, state: { justCreated: true } })
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.code === 'CART_CHANGED' ? 'Algunos productos cambiaron de stock. Revisá el detalle y ajustá las cantidades.' : e.message)
        setFields(e.fields)
      } else setError('No pudimos confirmar el pedido')
    } finally {
      setBusy(false)
    }
  }

  const issues = new Map(quote?.issues.map((i) => [i.productId, i.message]))

  return (
    <div className="container page">
      <h1 className="page-title">Finalizar compra</h1>
      <p className="page-subtitle">Revisá los datos y confirmá. Pagás cuando recibís o retirás el pedido.</p>

      <form className="two-col" onSubmit={submit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="alert alert--error" role="alert"><CircleAlert size={18} /> {error}</div>}

          <section className="card card-pad">
            <h2 className="step-title"><span className="step-num">1</span> ¿Cómo lo recibís?</h2>
            <div className="choice-group" role="radiogroup" aria-label="Forma de entrega">
              <label className="choice">
                <input type="radio" name="method" checked={method === 'delivery'} onChange={() => setMethod('delivery')} />
                <Truck size={20} /><div><strong>Envío a domicilio</strong><span>Hoy o mañana · gratis desde $50.000</span></div>
              </label>
              <label className="choice">
                <input type="radio" name="method" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
                <Store size={20} /><div><strong>Retiro en el local</strong><span>Listo en 2 horas · sin cargo</span></div>
              </label>
            </div>
            <div className="form-grid" style={{ marginTop: 16 }}>
              {method === 'delivery' && (
                <div className="field span-2">
                  <label htmlFor="address">Dirección de entrega</label>
                  <input id="address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address"
                    placeholder="Calle, número, piso y departamento" aria-invalid={Boolean(fields.address)} />
                  {fields.address && <span className="field-error">{fields.address}</span>}
                </div>
              )}
              <div className="field">
                <label htmlFor="phone">Teléfono de contacto</label>
                <input id="phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={Boolean(fields.phone)} />
                {fields.phone && <span className="field-error">{fields.phone}</span>}
              </div>
              <div className="field">
                <label htmlFor="notes">Indicaciones <span className="muted">(opcional)</span></label>
                <input id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Timbre, horario, reemplazos…" />
              </div>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="step-title"><span className="step-num">2</span> ¿Cómo pagás?</h2>
            <div className="choice-group" role="radiogroup" aria-label="Forma de pago">
              <label className="choice"><input type="radio" name="payment" checked={payment === 'cash'} onChange={() => setPayment('cash')} /><Banknote size={20} /><div><strong>Efectivo</strong><span>Al recibir</span></div></label>
              <label className="choice"><input type="radio" name="payment" checked={payment === 'card'} onChange={() => setPayment('card')} /><CreditCard size={20} /><div><strong>Tarjeta</strong><span>Débito o crédito al recibir</span></div></label>
              <label className="choice"><input type="radio" name="payment" checked={payment === 'transfer'} onChange={() => setPayment('transfer')} /><Landmark size={20} /><div><strong>Transferencia</strong><span>Te enviamos el alias</span></div></label>
            </div>
          </section>
        </div>

        <aside className="card card-pad sticky">
          <h2 className="step-title"><span className="step-num">3</span> Tu pedido</h2>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            {cart.items.map(({ product, quantity }) => (
              <div key={product.id} className="cart-line" style={{ gridTemplateColumns: '48px minmax(0,1fr) auto' }}>
                <ProductArt product={product} size={20} />
                <div>
                  <div className="cart-line__name">{product.name}</div>
                  <div className="cart-line__meta">{quantity} × {formatMoney(product.promo_price ?? product.price)}</div>
                  {issues.has(product.id) && <div className="stock-note stock-note--out">{issues.get(product.id)}</div>}
                </div>
                <span className="cart-line__total">{formatMoney((product.promo_price ?? product.price) * quantity)}</span>
              </div>
            ))}
          </div>
          {quote ? (
            <>
              {method === 'delivery' && <div style={{ marginBottom: 14 }}><FreeShippingMeter subtotal={quote.subtotal} freeFrom={quote.freeDeliveryFrom} /></div>}
              <CartSummary quote={quote} />
            </>
          ) : <div className="skeleton" style={{ height: 120 }} />}
          <button type="submit" className="btn btn--primary btn--lg btn--block" style={{ marginTop: 16 }} disabled={busy || !quote || quote.issues.length > 0}>
            {busy ? 'Confirmando…' : `Confirmar pedido${quote ? ` · ${formatMoney(quote.total)}` : ''}`}
          </button>
          <button type="button" className="link-btn" style={{ display: 'block', margin: '12px auto 0' }} onClick={cart.open}>Editar carrito</button>
        </aside>
      </form>
    </div>
  )
}
