/**
 * Converts a BRL price string to centavos (integer).
 *
 * Accepts:
 *   "40"       → 4000
 *   "39,90"    → 3990  (comma decimal separator)
 *   "10.50"    → 1050  (dot decimal separator)
 *   "1.234,56" → 123456 (thousands separator + comma decimal)
 *   "1.234"    → 123400 (thousands separator, no decimal — treating as 1234 reais)
 *
 * Rules:
 *   - If comma is present: treat dots as thousands separators (strip them), comma as decimal
 *   - If no comma: single dot at position >= 2 chars from end → decimal; otherwise thousands
 *
 * Returns null for invalid or negative input.
 */
export function parseBRLToCents(input: string): number | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed === '') return null

  let normalized: string

  if (trimmed.includes(',')) {
    // Comma is present: strip all dots (thousands), replace comma with dot
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else {
    // No comma: check if the single dot is a decimal or thousands separator
    const lastDotIdx = trimmed.lastIndexOf('.')
    if (lastDotIdx !== -1 && lastDotIdx >= trimmed.length - 3) {
      // Dot is 1–2 digits from the end → treat as decimal
      normalized = trimmed
    } else if (lastDotIdx !== -1) {
      // Dot is 3+ digits from the end → treat as thousands separator; strip it
      normalized = trimmed.replace(/\./g, '')
    } else {
      // No dot at all
      normalized = trimmed
    }
  }

  const value = parseFloat(normalized)

  if (isNaN(value) || value < 0) return null

  // Multiply by 100 and round to avoid floating-point rounding errors
  return Math.round(value * 100)
}
