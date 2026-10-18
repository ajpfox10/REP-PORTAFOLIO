import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Product } from '../lib/types'
import { discountPct } from '../lib/format'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { ProductArt } from './ProductArt'
import { Price } from './Price'
import { Stepper } from './Stepper'

export function ProductCard({ product }: { product: Product }) {
  const cart = useCart()
  const notify = useToast()
  const inCart = cart.quantityOf(product.id)
  const off = discountPct(product.price, product.promo_price)
  const out = product.stock === 0

  return (
    <article className="product-card">
      {off > 0 && <span className="badge badge--offer product-card__badge">-{off}%</span>}
      <Link to={`/producto/${product.slug}`} className="product-card__media" tabIndex={-1} aria-hidden="true">
        <ProductArt product={product} showUnit />
      </Link>
      <div className="product-card__body">
        {product.brand && <span className="product-card__brand">{product.brand}</span>}
        <Link to={`/producto/${product.slug}`} className="product-card__name">{product.name}</Link>
        <span className="product-card__unit">{product.unit}</span>
        {out
          ? <span className="stock-note stock-note--out">Sin stock</span>
          : product.stock <= 10 && <span className="stock-note">Últimas {product.stock} unidades</span>}
        <div className="product-card__footer">
          <Price price={product.price} promo={product.promo_price} />
          {inCart > 0 ? (
            <Stepper value={inCart} max={Math.min(50, product.stock)} label={product.name} onChange={(q) => cart.setQuantity(product.id, q)} />
          ) : (
            <button
              type="button"
              className="add-btn"
              disabled={out}
              aria-label={`Agregar ${product.name} al carrito`}
              onClick={() => { cart.add(product); notify(`${product.name} se agregó al carrito`) }}
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ height: 320 }} />)}
    </div>
  )
}
