/**
 * Converts a BRL price string to centavos (integer).
 *
 * Accepts:
 *   "40"    → 4000
 *   "39,90" → 3990  (comma decimal separator)
 *   "10.50" → 1050  (dot decimal separator)
 *
 * Returns null for invalid or negative input.
 */
export function parseBRLToCents(input: string): number | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed === '') return null

  // Replace comma decimal separator with dot
  const normalized = trimmed.replace(',', '.')
  const value = parseFloat(normalized)

  if (isNaN(value) || value < 0) return null

  // Multiply by 100 and round to avoid floating-point rounding errors
  return Math.round(value * 100)
}
