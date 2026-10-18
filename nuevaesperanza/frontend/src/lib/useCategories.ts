import { useEffect, useState } from 'react'
import { api } from './api'
import type { Category } from './types'

let cache: Promise<Category[]> | null = null

// Las categorías cambian muy poco: se piden una sola vez por visita
export function useCategories(): Category[] {
  const [categories, setCategories] = useState<Category[]>([])
  useEffect(() => {
    cache ??= api.get<{ categories: Category[] }>('/categories').then((r) => r.categories).catch(() => { cache = null; return [] })
    let alive = true
    cache.then((list) => { if (alive) setCategories(list) })
    return () => { alive = false }
  }, [])
  return categories
}
