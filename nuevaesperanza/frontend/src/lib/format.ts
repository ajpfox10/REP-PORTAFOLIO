import type { OrderStatus } from './types'

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const moneyCents = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })

export function formatMoney(value: number): string {
  return Number.isInteger(value) ? money.format(value) : moneyCents.format(value)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function discountPct(price: number, promo: number | null): number {
  return promo ? Math.round((1 - promo / price) * 100) : 0
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Recibido',
  preparing: 'En preparación',
  shipped: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

export const PAYMENT_LABEL = { cash: 'Efectivo al recibir', card: 'Tarjeta al recibir', transfer: 'Transferencia' } as const
export const DELIVERY_LABEL = { delivery: 'Envío a domicilio', pickup: 'Retiro en el local' } as const

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
}
