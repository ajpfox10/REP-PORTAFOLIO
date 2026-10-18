import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Product } from '../lib/types'

// El carrito vive en el navegador. Guarda una copia del producto para poder
// mostrarlo al instante; los precios reales siempre los confirma el servidor.
export type CartProduct = Pick<Product, 'id' | 'slug' | 'name' | 'unit' | 'price' | 'promo_price' | 'stock' | 'image_url' | 'category_color' | 'category_icon' | 'brand'>
export interface CartItem { product: CartProduct; quantity: number }

interface CartValue {
  items: CartItem[]
  count: number
  estimate: number
  isOpen: boolean
  open: () => void
  close: () => void
  add: (product: CartProduct, quantity?: number) => void
  setQuantity: (productId: number, quantity: number) => void
  remove: (productId: number) => void
  clear: () => void
  quantityOf: (productId: number) => number
}

const STORAGE_KEY = 'ne_cart'
const MAX_PER_PRODUCT = 50
const CartContext = createContext<CartValue | null>(null)

function readStored(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((i) => i?.product?.id && i.quantity > 0) : []
  } catch {
    return []
  }
}

function pick(product: CartProduct): CartProduct {
  const { id, slug, name, unit, price, promo_price, stock, image_url, category_color, category_icon, brand } = product
  return { id, slug, name, unit, price, promo_price, stock, image_url, category_color, category_icon, brand }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readStored)
  const [isOpen, setOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { /* modo privado */ }
  }, [items])

  const add = useCallback((product: CartProduct, quantity = 1) => {
    setItems((list) => {
      const current = list.find((i) => i.product.id === product.id)
      const limit = Math.min(MAX_PER_PRODUCT, product.stock)
      if (current) {
        return list.map((i) => (i.product.id === product.id
          ? { product: pick(product), quantity: Math.min(limit, i.quantity + quantity) }
          : i))
      }
      return [...list, { product: pick(product), quantity: Math.min(limit, quantity) }]
    })
  }, [])

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setItems((list) => (quantity <= 0
      ? list.filter((i) => i.product.id !== productId)
      : list.map((i) => (i.product.id === productId ? { ...i, quantity: Math.min(MAX_PER_PRODUCT, quantity) } : i))))
  }, [])

  const remove = useCallback((productId: number) => setItems((list) => list.filter((i) => i.product.id !== productId)), [])
  const clear = useCallback(() => setItems([]), [])

  const value = useMemo<CartValue>(() => ({
    items,
    count: items.reduce((acc, i) => acc + i.quantity, 0),
    estimate: items.reduce((acc, i) => acc + (i.product.promo_price ?? i.product.price) * i.quantity, 0),
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    add,
    setQuantity,
    remove,
    clear,
    quantityOf: (id) => items.find((i) => i.product.id === id)?.quantity ?? 0,
  }), [items, isOpen, add, setQuantity, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart fuera de CartProvider')
  return ctx
}
