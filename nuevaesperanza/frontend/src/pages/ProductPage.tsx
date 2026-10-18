import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, PackageCheck, ShoppingCart, Store, Truck } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import type { Product } from '../lib/types'
import { discountPct, formatMoney } from '../lib/format'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { ProductArt } from '../components/ProductArt'
import { Price } from '../components/Price'
import { Stepper } from '../components/Stepper'
import { ProductCard } from '../components/ProductCard'
import { NotFoundPage } from './NotFoundPage'

export function ProductPage() {
  const { slug = '' } = useParams()
  const cart = useCart()
  const notify = useToast()
  const [data, setData] = useState<{ product: Product; related: Product[] } | null>(null)
  const [missing, setMissing] = useState(false)
  const [quantity, setQuantity] = useState(1)

  useEffect(() => {
    let alive = true
    setData(null)
    setMissing(false)
    setQuantity(1)
    api.get<{ product: Product; related: Product[] }>(`/products/${encodeURIComponent(slug)}`)
      .then((r) => { if (alive) { setData(r); document.title = `${r.product.name} · Nueva Esperanza` } })
      .catch((e) => { if (alive && e instanceof ApiError && e.status === 404) setMissing(true) })
    window.scrollTo({ top: 0 })
    return () => { alive = false; document.title = 'Nueva Esperanza · Supermercado online' }
  }, [slug])

  if (missing) return <NotFoundPage />
  if (!data) {
    return (
      <div className="container page">
        <div className="detail"><div className="skeleton" style={{ aspectRatio: '1' }} /><div className="skeleton" style={{ height: 360 }} /></div>
      </div>
    )
  }

  const { product, related } = data
  const off = discountPct(product.price, product.promo_price)
  const inCart = cart.quantityOf(product.id)
  const max = Math.max(0, Math.min(50, product.stock) - inCart)

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Ubicación">
        <Link to="/">Inicio</Link><ChevronRight size={14} />
        <Link to={`/productos?categoria=${product.category_slug}`}>{product.category_name}</Link><ChevronRight size={14} />
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="detail">
        <ProductArt product={product} size={150} showUnit />
        <div className="detail__info">
          {product.brand && <span className="product-card__brand">{product.brand}</span>}
          <h1>{product.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="badge badge--neutral">{product.unit}</span>
            {off > 0 && <span className="badge badge--offer">Ahorrás {off}% · {formatMoney(product.price - (product.promo_price ?? product.price))}</span>}
          </div>
          <Price price={product.price} promo={product.promo_price} />
          {product.description && <p style={{ color: 'var(--text-2)' }}>{product.description}</p>}

          <div className="detail__buy">
            {product.stock === 0 ? (
              <span className="stock-note stock-note--out">Sin stock por el momento</span>
            ) : (
              <>
                <Stepper value={quantity} max={Math.max(1, max)} allowZero={false} size="lg" label={product.name} onChange={setQuantity} />
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  style={{ flex: 1 }}
                  disabled={max === 0}
                  onClick={() => { cart.add(product, quantity); notify(`${quantity} × ${product.name} al carrito`); setQuantity(1) }}
                >
                  <ShoppingCart size={18} /> {max === 0 ? 'Ya tenés todo el stock' : 'Agregar al carrito'}
                </button>
              </>
            )}
            {inCart > 0 && (
              <button type="button" className="link-btn" onClick={cart.open} style={{ width: '100%', textAlign: 'left', color: 'var(--primary)' }}>
                Tenés {inCart} en el carrito · Ver carrito
              </button>
            )}
          </div>

          <div className="detail__facts">
            <div className="fact"><Truck size={18} /> Envío gratis desde $50.000</div>
            <div className="fact"><Store size={18} /> Retiro sin cargo en el local</div>
            <div className="fact"><PackageCheck size={18} /> {product.stock > 10 ? 'Stock disponible' : `Quedan ${product.stock} unidades`}</div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <div className="section__head"><h2>También te puede interesar</h2></div>
          <div className="product-grid">{related.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}
    </div>
  )
}
