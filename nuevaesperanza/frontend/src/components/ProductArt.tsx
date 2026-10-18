import type { CSSProperties } from 'react'
import { CategoryIcon } from './CategoryIcon'

interface Props {
  product: { id: number; name: string; unit?: string; image_url: string | null; category_color: string; category_icon: string }
  size?: number
  showUnit?: boolean
}

// Ilustración del producto: foto si existe; si no, una composición con el
// color y el ícono de su categoría, variando la posición según el producto.
export function ProductArt({ product, size = 64, showUnit = false }: Props) {
  const style = { '--cat': product.category_color } as CSSProperties
  if (product.image_url) {
    return (
      <div className="art" style={style}>
        <img src={product.image_url} alt={product.name} loading="lazy" />
      </div>
    )
  }
  const seed = product.id * 37
  const ringSize = 60 + (seed % 35)
  return (
    <div className="art" style={style} role="img" aria-label={product.name}>
      <span className="art__ring" style={{ width: `${ringSize}%`, aspectRatio: '1' }} />
      <CategoryIcon name={product.category_icon} size={size} strokeWidth={1.6} style={{ transform: `rotate(${(seed % 21) - 10}deg)` }} />
      {showUnit && product.unit && <span className="art__label">{product.unit}</span>}
    </div>
  )
}
