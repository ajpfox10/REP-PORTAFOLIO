import { useEffect, useState } from 'react'
import { api } from './api'
import type { Quote } from './types'
import type { CartItem } from '../context/CartContext'

// Pide al servidor el presupuesto real del carrito (precios, stock y envío).
export function useQuote(items: CartItem[], deliveryMethod: 'delivery' | 'pickup' = 'delivery', enabled = true) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify(items.map((i) => [i.product.id, i.quantity])) + deliveryMethod

  useEffect(() => {
    if (!enabled || items.length === 0) { setQuote(null); return }
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      api.post<Quote>('/cart/quote', {
        items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        deliveryMethod,
      })
        .then((q) => { if (alive) setQuote(q) })
        .catch(() => { if (alive) setQuote(null) })
        .finally(() => { if (alive) setLoading(false) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  return { quote, loading }
}
