export interface Category {
  slug: string
  name: string
  icon: string
  color: string
  product_count: number
}

export interface Product {
  id: number
  slug: string
  name: string
  brand: string | null
  unit: string
  price: number
  promo_price: number | null
  stock: number
  image_url: string | null
  description?: string | null
  category_slug: string
  category_name: string
  category_color: string
  category_icon: string
}

export interface User {
  id: number
  name: string
  email: string
  phone: string | null
  address: string | null
  role: 'customer' | 'admin'
}

export interface QuoteLine {
  productId: number
  slug: string
  name: string
  unit: string
  quantity: number
  stock: number
  unitPrice: number
  listPrice: number
  lineTotal: number
}

export interface QuoteIssue {
  productId: number
  code: 'UNAVAILABLE' | 'NOT_ENOUGH_STOCK'
  available?: number
  message: string
}

export interface Quote {
  lines: QuoteLine[]
  issues: QuoteIssue[]
  subtotal: number
  savings: number
  deliveryFee: number
  total: number
  freeDeliveryFrom: number
}

export type OrderStatus = 'pending' | 'preparing' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderSummary {
  id: number
  status: OrderStatus
  delivery_method: 'delivery' | 'pickup'
  payment_method?: 'cash' | 'card' | 'transfer'
  total: number
  created_at: string
  item_count: number
  customer_name?: string
}

export interface OrderItem {
  product_id: number
  product_name: string
  unit: string
  unit_price: number
  list_price: number
  quantity: number
  line_total: number
  slug: string | null
}

export interface Order extends OrderSummary {
  address: string | null
  phone: string
  payment_method: 'cash' | 'card' | 'transfer'
  notes: string | null
  subtotal: number
  savings: number
  delivery_fee: number
  customer_name: string
  customer_email: string
  items: OrderItem[]
}
