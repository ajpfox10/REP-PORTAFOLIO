import { formatMoney } from '../lib/format'

export function Price({ price, promo }: { price: number; promo: number | null }) {
  return (
    <div className="price">
      {promo != null && <span className="price__was">{formatMoney(price)}</span>}
      <span className={`price__now ${promo != null ? 'price__now--offer' : ''}`}>{formatMoney(promo ?? price)}</span>
    </div>
  )
}
