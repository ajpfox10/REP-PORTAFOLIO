import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SearchX, X } from 'lucide-react'
import { api, qs } from '../lib/api'
import type { Product } from '../lib/types'
import { useCategories } from '../lib/useCategories'
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard'

interface ListResponse { products: Product[]; total: number; page: number; pages: number }

const SORTS = [
  ['relevance', 'Destacados'],
  ['price_asc', 'Menor precio'],
  ['price_desc', 'Mayor precio'],
  ['name', 'Nombre (A-Z)'],
] as const

export function CatalogPage() {
  const [params, setParams] = useSearchParams()
  const categories = useCategories()
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState('')

  const q = params.get('q') ?? ''
  const category = params.get('categoria') ?? ''
  const offers = params.get('ofertas') === '1'
  const sort = params.get('orden') ?? 'relevance'
  const page = Number(params.get('pagina') ?? '1') || 1

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    api.get<ListResponse>(`/products${qs({ q, category, promo: offers ? 1 : undefined, sort, page, limit: 24 })}`)
      .then((r) => { if (alive) setData(r) })
      .catch((e) => { if (alive) setError(e.message) })
    window.scrollTo({ top: 0 })
    return () => { alive = false }
  }, [q, category, offers, sort, page])

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key)
    }
    if (!('pagina' in changes)) next.delete('pagina')
    setParams(next)
  }

  const current = categories.find((c) => c.slug === category)
  const title = q ? `Resultados para “${q}”` : current?.name ?? (offers ? 'Ofertas de la semana' : 'Todos los productos')

  return (
    <div className="container page">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{data ? `${data.total} ${data.total === 1 ? 'producto' : 'productos'}` : 'Buscando…'}</p>

      <div className="catalog">
        <aside className="filters" aria-label="Filtros">
          <label className="toggle">
            Solo ofertas
            <input type="checkbox" checked={offers} onChange={(e) => update({ ofertas: e.target.checked ? '1' : null })} />
          </label>
          <h3 style={{ marginTop: 22 }}>Categorías</h3>
          <ul>
            <li><Link to={`/productos${qs({ q, ofertas: offers ? 1 : undefined })}`} className={!category ? 'active' : ''}>Todas</Link></li>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link to={`/productos${qs({ categoria: c.slug, q, ofertas: offers ? 1 : undefined })}`} className={category === c.slug ? 'active' : ''}>
                  {c.name} <small>{c.product_count}</small>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <div>
          <div className="mobile-cats">
            <button type="button" className={`chip`} onClick={() => update({ ofertas: offers ? null : '1' })} aria-pressed={offers}>
              {offers ? 'Mostrando ofertas' : 'Solo ofertas'}
            </button>
            {categories.map((c) => (
              <button key={c.slug} type="button" className="chip" aria-pressed={category === c.slug} onClick={() => update({ categoria: category === c.slug ? null : c.slug })}>
                {c.name}
              </button>
            ))}
          </div>

          <div className="catalog__bar">
            <div className="chips">
              {q && <button type="button" className="chip" onClick={() => update({ q: null })}>“{q}” <X size={14} /></button>}
              {current && <button type="button" className="chip" onClick={() => update({ categoria: null })}>{current.name} <X size={14} /></button>}
              {offers && <button type="button" className="chip" onClick={() => update({ ofertas: null })}>Ofertas <X size={14} /></button>}
            </div>
            <label className="sr-only" htmlFor="sort">Ordenar</label>
            <select id="sort" className="select" value={sort} onChange={(e) => update({ orden: e.target.value === 'relevance' ? null : e.target.value })}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {error && <div className="alert alert--error">{error}</div>}
          {!data && !error && <ProductGridSkeleton count={12} />}
          {data && data.products.length === 0 && (
            <div className="empty card">
              <span className="empty__icon"><SearchX size={28} /></span>
              <h2>No encontramos productos</h2>
              <p>Probá con otra palabra o sacá algún filtro.</p>
              <Link to="/productos" className="btn btn--ghost">Ver todo el catálogo</Link>
            </div>
          )}
          {data && data.products.length > 0 && (
            <>
              <div className="product-grid">{data.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>
              {data.pages > 1 && (
                <nav className="pagination" aria-label="Páginas">
                  <button type="button" disabled={page <= 1} onClick={() => update({ pagina: String(page - 1) })} aria-label="Página anterior">‹</button>
                  {Array.from({ length: data.pages }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => update({ pagina: n === 1 ? null : String(n) })}>{n}</button>
                  ))}
                  <button type="button" disabled={page >= data.pages} onClick={() => update({ pagina: String(page + 1) })} aria-label="Página siguiente">›</button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
