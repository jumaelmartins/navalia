import { describe, it, expect } from 'vitest'
import { ServiceSchema } from './service-schemas'
import { formatCentsToBRL } from '@/modules/tenancy/money'

// ---------------------------------------------------------------------------
// ServiceSchema — zod validation
// ---------------------------------------------------------------------------

const VALID = {
  name: 'Corte masculino',
  priceCents: 4000,
  durationMin: 30,
}

describe('ServiceSchema', () => {
  it('accepts valid input', () => {
    expect(ServiceSchema.safeParse(VALID).success).toBe(true)
  })

  it('accepts valid input with optional description', () => {
    expect(ServiceSchema.safeParse({ ...VALID, description: 'Inclui lavagem' }).success).toBe(true)
  })

  it('rejects priceCents = 0', () => {
    expect(ServiceSchema.safeParse({ ...VALID, priceCents: 0 }).success).toBe(false)
  })

  it('rejects priceCents < 0 (negative)', () => {
    expect(ServiceSchema.safeParse({ ...VALID, priceCents: -100 }).success).toBe(false)
  })

  it('rejects priceCents = -1', () => {
    expect(ServiceSchema.safeParse({ ...VALID, priceCents: -1 }).success).toBe(false)
  })

  it('rejects durationMin = 4 (below minimum of 5)', () => {
    expect(ServiceSchema.safeParse({ ...VALID, durationMin: 4 }).success).toBe(false)
  })

  it('rejects durationMin = 481 (above maximum of 480)', () => {
    expect(ServiceSchema.safeParse({ ...VALID, durationMin: 481 }).success).toBe(false)
  })

  it('accepts durationMin = 5 (minimum boundary)', () => {
    expect(ServiceSchema.safeParse({ ...VALID, durationMin: 5 }).success).toBe(true)
  })

  it('accepts durationMin = 480 (maximum boundary)', () => {
    expect(ServiceSchema.safeParse({ ...VALID, durationMin: 480 }).success).toBe(true)
  })

  it('rejects name shorter than 2 chars', () => {
    expect(ServiceSchema.safeParse({ ...VALID, name: 'A' }).success).toBe(false)
  })

  it('rejects missing name', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name: _n, ...rest } = VALID
    expect(ServiceSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects non-integer priceCents', () => {
    expect(ServiceSchema.safeParse({ ...VALID, priceCents: 39.9 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatCentsToBRL
// Intl.NumberFormat('pt-BR') emits a non-breaking space (U+00A0, charCode 160)
// between R$ and the amount. nb() normalizes it to a regular space for
// portable assertions across Node / ICU versions.
// ---------------------------------------------------------------------------

/** Replace NBSP (U+00A0) with regular space (U+0020). */
function nb(s: string): string {
  return s.split(String.fromCharCode(160)).join(' ')
}

describe('formatCentsToBRL', () => {
  it('4000 cents → R$ 40,00', () => {
    expect(nb(formatCentsToBRL(4000))).toBe('R$ 40,00')
  })

  it('100 cents → R$ 1,00', () => {
    expect(nb(formatCentsToBRL(100))).toBe('R$ 1,00')
  })

  it('3990 cents → R$ 39,90', () => {
    expect(nb(formatCentsToBRL(3990))).toBe('R$ 39,90')
  })

  it('0 cents → R$ 0,00', () => {
    expect(nb(formatCentsToBRL(0))).toBe('R$ 0,00')
  })

  it('12345678 cents → R$ 123.456,78 (large value)', () => {
    expect(nb(formatCentsToBRL(12345678))).toBe('R$ 123.456,78')
  })
})
