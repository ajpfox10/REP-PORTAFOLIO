/**
 * money.ts — Helpers para aritmética monetaria segura
 *
 * NUNCA usar floats para dinero. Siempre trabajar en enteros (centavos).
 *
 * 1 ARS = 100 centavos
 * $10.99 → 1099 centavos
 */

/**
 * Convierte un número decimal de pesos a centavos enteros.
 * Redondea al centavo más cercano (bankers rounding no necesario para AR).
 *
 * toCents(10.99)  → 1099
 * toCents(10.995) → 1100
 * toCents(0.1 + 0.2) → 30  (no 29 o 31)
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convierte centavos de vuelta a pesos con 2 decimales.
 * fromCents(1099) → 10.99
 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Calcula el IVA en centavos dado un subtotal en centavos y un porcentaje.
 * calcIva(1000, 21) → 210  (21% de $10.00 = $2.10)
 * calcIva(1000, 10.5) → 105
 */
export function calcIva(subtotalCents: number, ivaPct: number): number {
  return Math.round(subtotalCents * ivaPct / 100);
}

/**
 * Suma un array de centavos de forma segura.
 * sumCents([100, 200, 300]) → 600
 */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(v), 0);
}

/**
 * Formatea centavos como string ARS para UI/logs.
 * formatARS(1234567) → "$ 12.345,67"
 */
export function formatARS(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(fromCents(cents));
}
