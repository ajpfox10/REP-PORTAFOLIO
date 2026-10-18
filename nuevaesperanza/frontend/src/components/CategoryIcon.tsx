import { Apple, Beef, Croissant, CupSoda, Milk, Package, Sparkles, SprayCan, Wheat, type LucideProps } from 'lucide-react'

const ICONS = {
  apple: Apple,
  wheat: Wheat,
  milk: Milk,
  beef: Beef,
  croissant: Croissant,
  'cup-soda': CupSoda,
  'spray-can': SprayCan,
  sparkles: Sparkles,
} as const

export function CategoryIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? Package
  return <Icon aria-hidden="true" {...props} />
}
