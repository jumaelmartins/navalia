/**
 * Strips non-digits from a CPF string; returns the 11-digit string or
 * null if the result isn't exactly 11 digits.
 */
export function normalizeCpf(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

/**
 * Validates an already-normalized 11-digit CPF via the standard checksum
 * algorithm. Rejects the 11 repeated-digit sequences (000.000.000-00 …
 * 999.999.999-99), which pass the checksum but are never real CPFs.
 */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const checkDigit = (length: number): number => {
    let sum = 0
    for (let i = 0; i < length; i++) {
      sum += parseInt(cpf[i], 10) * (length + 1 - i)
    }
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return checkDigit(9) === parseInt(cpf[9], 10) && checkDigit(10) === parseInt(cpf[10], 10)
}

/** Formats an 11-digit CPF as "000.000.000-00". Returns input unchanged if not 11 digits. */
export function formatCpf(cpf: string): string {
  if (!/^\d{11}$/.test(cpf)) return cpf
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`
}
