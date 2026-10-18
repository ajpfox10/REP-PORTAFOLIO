import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Minus, Pencil, Plus, X } from 'lucide-react'
import { api, ApiError, qs } from '../../lib/api'
import { useCategories } from '../../lib/useCategories'
import { formatMoney } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { ProductArt } from '../../components/ProductArt'

interface AdminProduct {
  id: number
  slug: string
  name: string
  brand: string | null
  unit: string
  description: string | null
  price: number
  promo_price: number | null
  stock: number
  image_url: string | null
  is_active: number
  category_slug: string
  category_name: string
}

interface FormState {
  id?: number
  name: string
  brand: string
  categorySlug: string
  unit: string
  description: string
  price: string
  promoPrice: string
  stock: string
  imageUrl: string
  isActive: boolean
}

const EMPTY: FormState = { name: '', brand: '', categorySlug: '', unit: '', description: '', price: '', promoPrice: '', stock: '0', imageUrl: '', isActive: true }

export function ProductsAdminPage() {
  const categories = useCategories()
  const notify = useToast()
  const [params, setParams] = useSearchParams()
  const [products, setProducts] = useState<AdminProduct[] | null>(null)
  const [term, setTerm] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const status = params.get('estado') ?? ''
  const category = params.get('categoria') ?? ''

  async function load() {
    const r = await api.get<{ products: AdminProduct[] }>(`/admin/products${qs({ q: term.trim(), status, category })}`)
    setProducts(r.products)
  }

  useEffect(() => {
    const timer = setTimeout(() => { load().catch((e) => notify(e.message, 'error')) }, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status, category])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next)
  }

  function edit(p: AdminProduct) {
    setFields({})
    setForm({
      id: p.id, name: p.name, brand: p.brand ?? '', categorySlug: p.category_slug, unit: p.unit, description: p.description ?? '',
      price: String(p.price), promoPrice: p.promo_price != null ? String(p.promo_price) : '', stock: String(p.stock),
      imageUrl: p.image_url ?? '', isActive: Boolean(p.is_active),
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setFields({})
    const body = {
      name: form.name, brand: form.brand, categorySlug: form.categorySlug, unit: form.unit, description: form.description,
      price: Number(form.price), promoPrice: form.promoPrice ? Number(form.promoPrice) : null, stock: Number(form.stock),
      imageUrl: form.imageUrl || null, isActive: form.isActive,
    }
    try {
      if (form.id) await api.put(`/admin/products/${form.id}`, body)
      else await api.post('/admin/products', body)
      notify(form.id ? 'Producto actualizado' : 'Producto creado')
      setForm(null)
      await load()
    } catch (e) {
      if (e instanceof ApiError) { setFields(e.fields); notify(e.message, 'error') }
    } finally {
      setSaving(false)
    }
  }

  async function adjust(p: AdminProduct, delta: number) {
    try {
      const r = await api.post<{ product: { stock: number } }>(`/admin/products/${p.id}/stock`, { delta })
      setProducts((list) => list?.map((x) => (x.id === p.id ? { ...x, stock: r.product.stock } : x)) ?? null)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo ajustar el stock', 'error')
    }
  }

  const input = (key: keyof FormState, props: Record<string, unknown> = {}) => (
    <>
      <input
        id={`pf-${key}`}
        className="input"
        value={String(form?.[key] ?? '')}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
        aria-invalid={Boolean(fields[key])}
        {...props}
      />
      {fields[key] && <span className="field-error">{fields[key]}</span>}
    </>
  )

  return (
    <>
      <div className="admin__top">
        <div>
          <h1 className="page-title">Productos</h1>
          <p className="page-subtitle">{products ? `${products.length} productos` : 'Cargando…'}</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => { setFields({}); setForm({ ...EMPTY, categorySlug: categories[0]?.slug ?? '' }) }}>
          <Plus size={18} /> Nuevo producto
        </button>
      </div>

      <div className="toolbar">
        <label className="sr-only" htmlFor="admin-search">Buscar</label>
        <input id="admin-search" className="input" type="search" placeholder="Buscar por nombre o marca" value={term} onChange={(e) => setTerm(e.target.value)} />
        <select className="select" value={category} onChange={(e) => setFilter('categoria', e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => setFilter('estado', e.target.value)} aria-label="Estado">
          <option value="">Todos</option>
          <option value="active">Publicados</option>
          <option value="inactive">Ocultos</option>
          <option value="low">Stock bajo</option>
        </select>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th className="num">Precio</th><th className="num">Stock</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {products?.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="cell-product">
                    <div className="thumb"><ProductArt product={{ ...p, category_color: categories.find((c) => c.slug === p.category_slug)?.color ?? '#64748b', category_icon: categories.find((c) => c.slug === p.category_slug)?.icon ?? '' }} size={20} /></div>
                    <div><strong>{p.name}</strong><small>{[p.brand, p.unit].filter(Boolean).join(' · ')}</small></div>
                  </div>
                </td>
                <td>{p.category_name}</td>
                <td className="num">
                  {p.promo_price != null && <div className="price__was">{formatMoney(p.price)}</div>}
                  <strong className={p.promo_price != null ? 'price__now--offer' : ''}>{formatMoney(p.promo_price ?? p.price)}</strong>
                </td>
                <td className="num">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => adjust(p, -1)} disabled={p.stock === 0} aria-label={`Restar stock de ${p.name}`}><Minus size={14} /></button>
                    <strong style={{ minWidth: 34, color: p.stock === 0 ? 'var(--danger)' : p.stock < 15 ? 'var(--offer)' : undefined }}>{p.stock}</strong>
                    <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => adjust(p, 10)} aria-label={`Sumar 10 al stock de ${p.name}`}><Plus size={14} /></button>
                  </div>
                </td>
                <td><span className={`badge ${p.is_active ? 'badge--delivered' : 'badge--neutral'}`}>{p.is_active ? 'Publicado' : 'Oculto'}</span></td>
                <td><button type="button" className="btn btn--ghost btn--sm" onClick={() => edit(p)}><Pencil size={14} /> Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {products === null && <div className="card-pad"><div className="skeleton" style={{ height: 240 }} /></div>}
        {products?.length === 0 && <p className="card-pad muted">No hay productos con esos filtros.</p>}
      </div>

      {form && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setForm(null) }}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title" onSubmit={save} noValidate>
            <div className="modal__head">
              <h2 id="product-form-title">{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="form-grid">
              <div className="field span-2"><label htmlFor="pf-name">Nombre</label>{input('name', { required: true, autoFocus: true })}</div>
              <div className="field"><label htmlFor="pf-brand">Marca</label>{input('brand')}</div>
              <div className="field"><label htmlFor="pf-unit">Presentación</label>{input('unit', { placeholder: '1 kg, 500 ml, 6 unidades…' })}</div>
              <div className="field">
                <label htmlFor="pf-categorySlug">Categoría</label>
                <select id="pf-categorySlug" className="select" value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })}>
                  {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="pf-stock">Stock</label>{input('stock', { type: 'number', min: 0 })}</div>
              <div className="field"><label htmlFor="pf-price">Precio</label>{input('price', { type: 'number', min: 0, step: '0.01' })}</div>
              <div className="field"><label htmlFor="pf-promoPrice">Precio de oferta <span className="muted">(opcional)</span></label>{input('promoPrice', { type: 'number', min: 0, step: '0.01' })}</div>
              <div className="field span-2"><label htmlFor="pf-imageUrl">Imagen (URL https) <span className="muted">(opcional)</span></label>{input('imageUrl', { type: 'url', placeholder: 'https://…' })}</div>
              <div className="field span-2">
                <label htmlFor="pf-description">Descripción</label>
                <textarea id="pf-description" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
              </div>
              <label className="span-2" style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
                Publicado en la tienda
              </label>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
