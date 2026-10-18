import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBasket, X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useQuote } from '../lib/useQuote'
import { formatMoney } from '../lib/format'
import { ProductArt } from './ProductArt'
import { Stepper } from './Stepper'
import { CartSummary, FreeShippingMeter } from './CartSummary'

export function CartDrawer() {
  const cart = useCart()
  const navigate = useNavigate()
  const { quote } = useQuote(cart.items, 'delivery', cart.isOpen)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!cart.isOpen) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cart.close() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [cart.isOpen, cart])

  if (!cart.isOpen) return null

  const issues = new Map(quote?.issues.map((i) => [i.productId, i.message]))

  return (
    <>
      <div className="drawer-backdrop" onClick={cart.close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="drawer__head">
          <h2 id="cart-title">Tu carrito</h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={cart.close} aria-label="Cerrar carrito"><X size={18} /></button>
        </div>

        {cart.items.length === 0 ? (
          <div className="empty" style={{ flex: 1 }}>
            <span className="empty__icon"><ShoppingBasket size={28} /></span>
            <h2>Tu carrito está vacío</h2>
            <p>Sumá productos y los vas a ver acá.</p>
            <button type="button" className="btn btn--primary" onClick={() => { cart.close(); navigate('/productos?ofertas=1') }}>Ver ofertas</button>
          </div>
        ) : (
          <>
            <div className="drawer__body">
              {cart.items.map(({ product, quantity }) => {
                const unit = product.promo_price ?? product.price
                return (
                  <div key={product.id} className="cart-line">
                    <ProductArt product={product} size={26} />
                    <div>
                      <Link to={`/producto/${product.slug}`} className="cart-line__name" onClick={cart.close}>{product.name}</Link>
                      <div className="cart-line__meta">{product.unit} · {formatMoney(unit)} c/u</div>
                      {issues.has(product.id) && <div className="stock-note stock-note--out">{issues.get(product.id)}</div>}
                      <div style={{ marginTop: 8 }}>
                        <Stepper value={quantity} max={Math.min(50, product.stock)} label={product.name} onChange={(q) => cart.setQuantity(product.id, q)} />
                      </div>
                    </div>
                    <div className="cart-line__side">
                      <span className="cart-line__total">{formatMoney(unit * quantity)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="drawer__foot">
              {quote && <FreeShippingMeter subtotal={quote.subtotal} freeFrom={quote.freeDeliveryFrom} />}
              {quote ? <CartSummary quote={quote} /> : <div className="skeleton" style={{ height: 120 }} />}
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                disabled={!quote || quote.issues.length > 0}
                onClick={() => { cart.close(); navigate('/checkout') }}
              >
                Finalizar compra
              </button>
              <button type="button" className="link-btn" style={{ alignSelf: 'center' }} onClick={cart.clear}>Vaciar carrito</button>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
