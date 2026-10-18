import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgePercent, Store, Truck, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import type { Product } from '../lib/types'
import { useCategories } from '../lib/useCategories'
import { CategoryIcon } from '../components/CategoryIcon'
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard'

export function HomePage() {
  const categories = useCategories()
  const [offers, setOffers] = useState<Product[] | null>(null)
  const [fresh, setFresh] = useState<Product[] | null>(null)

  useEffect(() => {
    api.get<{ products: Product[] }>('/products?promo=1&limit=8').then((r) => setOffers(r.products)).catch(() => setOffers([]))
    api.get<{ products: Product[] }>('/products?category=frutas-y-verduras&limit=4').then((r) => setFresh(r.products)).catch(() => setFresh([]))
  }, [])

  return (
    <div className="container" style={{ paddingBottom: 24 }}>
      <section className="hero">
        <div className="hero__grid">
          <div>
            <span className="hero__eyebrow"><BadgePercent size={16} /> Ofertas nuevas todas las semanas</span>
            <h1>Tu compra del súper, <em>sin hacer fila</em>.</h1>
            <p>Elegí tus productos, recibilos en tu casa o pasá a buscarlos por el local. Pagás cuando los tenés en la mano.</p>
            <div className="hero__actions">
              <Link to="/productos?ofertas=1" className="btn btn--primary btn--lg">Ver ofertas <ArrowRight size={18} /></Link>
              <Link to="/productos" className="btn btn--ghost btn--lg">Recorrer el catálogo</Link>
            </div>
          </div>
          <div className="hero__basket" aria-hidden="true">
            {categories.slice(0, 6).map((c) => (
              <div key={c.slug} className="hero__tile">
                <CategoryIcon name={c.icon} size={30} strokeWidth={1.6} />
                {c.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="perks">
        <div className="card perk"><span className="perk__icon"><Truck size={20} /></span><div><strong>Envío gratis</strong><span>En compras desde $50.000</span></div></div>
        <div className="card perk"><span className="perk__icon"><Store size={20} /></span><div><strong>Retiro en el local</strong><span>Listo en 2 horas, sin cargo</span></div></div>
        <div className="card perk"><span className="perk__icon"><Wallet size={20} /></span><div><strong>Pagás al recibir</strong><span>Efectivo, tarjeta o transferencia</span></div></div>
      </div>

      <section className="section" aria-labelledby="cats-title">
        <div className="section__head">
          <div><h2 id="cats-title">Categorías</h2><p>Todo lo que necesitás para la semana.</p></div>
        </div>
        <div className="categories">
          {categories.length === 0
            ? Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 120 }} />)
            : categories.map((c) => (
              <Link key={c.slug} to={`/productos?categoria=${c.slug}`} className="category-tile" style={{ '--cat': c.color } as CSSProperties}>
                <span className="category-tile__icon"><CategoryIcon name={c.icon} size={26} /></span>
                <span>{c.name}<br /><small>{c.product_count} productos</small></span>
              </Link>
            ))}
        </div>
      </section>

      <section className="section" aria-labelledby="offers-title">
        <div className="section__head">
          <div><h2 id="offers-title">Ofertas de la semana</h2><p>Precios rebajados hasta agotar stock.</p></div>
          <Link to="/productos?ofertas=1" className="link-more">Ver todas <ArrowRight size={16} /></Link>
        </div>
        {offers === null ? <ProductGridSkeleton /> : (
          <div className="product-grid">{offers.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        )}
      </section>

      <section className="section">
        <div className="promo-banner">
          <div>
            <h3>Frutas y verduras de estación</h3>
            <p>Seleccionadas cada mañana. <strong>Hasta 20% off</strong> en productos de la huerta.</p>
          </div>
          <Link to="/productos?categoria=frutas-y-verduras" className="btn btn--primary">Ir a la verdulería</Link>
        </div>
      </section>

      <section className="section" aria-labelledby="fresh-title">
        <div className="section__head">
          <div><h2 id="fresh-title">Frescos del día</h2></div>
          <Link to="/productos?categoria=frutas-y-verduras" className="link-more">Ver más <ArrowRight size={16} /></Link>
        </div>
        {fresh === null ? <ProductGridSkeleton count={4} /> : (
          <div className="product-grid">{fresh.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        )}
      </section>
    </div>
  )
}
