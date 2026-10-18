import type { Quote } from '../lib/types'
import { formatMoney } from '../lib/format'

export function CartSummary({ quote, showDelivery = true }: { quote: Quote; showDelivery?: boolean }) {
  return (
    <div className="summary">
      <div className="summary__row"><span>Subtotal</span><strong>{formatMoney(quote.subtotal + quote.savings)}</strong></div>
      {quote.savings > 0 && (
        <div className="summary__row summary__row--savings"><span>Ahorro en ofertas</span><strong>-{formatMoney(quote.savings)}</strong></div>
      )}
      {showDelivery && (
        <div className="summary__row">
          <span>Envío</span>
          <strong>{quote.deliveryFee === 0 ? 'Gratis' : formatMoney(quote.deliveryFee)}</strong>
        </div>
      )}
      <div className="summary__total"><span>Total</span><span>{formatMoney(quote.total)}</span></div>
    </div>
  )
}

export function FreeShippingMeter({ subtotal, freeFrom }: { subtotal: number; freeFrom: number }) {
  const missing = Math.max(0, freeFrom - subtotal)
  const pct = Math.min(100, (subtotal / freeFrom) * 100)
  return (
    <div className="free-ship">
      {missing > 0
        ? <span>Te faltan <strong>{formatMoney(missing)}</strong> para el envío gratis</span>
        : <span><strong>¡Tenés envío gratis!</strong></span>}
      <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
