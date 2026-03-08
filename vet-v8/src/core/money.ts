/**
 * Money — safe integer arithmetic for financial calculations.
 *
 * All amounts stored and computed as integer CENTAVOS to avoid
 * floating-point precision errors (e.g. 1.1 + 2.2 !== 3.3 in IEEE 754).
 *
 * Usage:
 *   const price = Money.fromDecimal("1250.50")  // → 125050 centavos
 *   Money.toDecimal(125050)                      // → "1250.50"
 *   Money.addIva(125050, 21)                     // → 151310 centavos
 */

export const Money = {
  /** Convert decimal string or number to integer centavos */
  fromDecimal(value: string | number): number {
    const n = typeof value === "string" ? parseFloat(value) : value;
    if (!isFinite(n)) throw new Error(`Invalid money value: ${value}`);
    return Math.round(n * 100);
  },

  /** Convert integer centavos back to 2-decimal string */
  toDecimal(centavos: number): string {
    return (Math.round(centavos) / 100).toFixed(2);
  },

  /** Calculate IVA amount in centavos (rounded) */
  iva(baseCentavos: number, pct: number): number {
    return Math.round(baseCentavos * pct / 100);
  },

  /** Multiply centavos by quantity (handles decimal qty like 1.5 kg) */
  multiply(centavos: number, qty: number): number {
    return Math.round(centavos * qty);
  },

  /** Sum array of centavo amounts */
  sum(amounts: number[]): number {
    return amounts.reduce((a, b) => a + b, 0);
  },
};
