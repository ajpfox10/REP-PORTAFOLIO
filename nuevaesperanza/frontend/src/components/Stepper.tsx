import { Minus, Plus, Trash2 } from 'lucide-react'

interface Props {
  value: number
  max: number
  onChange: (value: number) => void
  label: string
  size?: 'md' | 'lg'
  allowZero?: boolean
}

export function Stepper({ value, max, onChange, label, size = 'md', allowZero = true }: Props) {
  const min = allowZero ? 0 : 1
  return (
    <div className={`stepper ${size === 'lg' ? 'stepper--lg' : ''}`} role="group" aria-label={`Cantidad de ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Quitar uno">
        {allowZero && value === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Agregar uno">
        <Plus size={16} />
      </button>
    </div>
  )
}
