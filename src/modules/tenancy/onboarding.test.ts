import { describe, it, expect } from 'vitest'
import { parseBRLToCents } from './money'
import { BusinessHoursSchema } from './business-hours'

// ---------------------------------------------------------------------------
// parseBRLToCents
// ---------------------------------------------------------------------------

describe('parseBRLToCents', () => {
  it('"40" → 4000', () => {
    expect(parseBRLToCents('40')).toBe(4000)
  })

  it('"39,90" → 3990', () => {
    expect(parseBRLToCents('39,90')).toBe(3990)
  })

  it('"0" → 0', () => {
    expect(parseBRLToCents('0')).toBe(0)
  })

  it('"10.50" → 1050', () => {
    expect(parseBRLToCents('10.50')).toBe(1050)
  })

  it('"1" → 100', () => {
    expect(parseBRLToCents('1')).toBe(100)
  })

  it('"abc" → null', () => {
    expect(parseBRLToCents('abc')).toBeNull()
  })

  it('empty string → null', () => {
    expect(parseBRLToCents('')).toBeNull()
  })

  it('negative value → null', () => {
    expect(parseBRLToCents('-5')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// BusinessHoursSchema
// ---------------------------------------------------------------------------

const VALID_WEEK = {
  '0': null,
  '1': { start: '09:00', end: '19:00' },
  '2': { start: '09:00', end: '19:00' },
  '3': { start: '09:00', end: '19:00' },
  '4': { start: '09:00', end: '19:00' },
  '5': { start: '09:00', end: '19:00' },
  '6': { start: '09:00', end: '17:00' },
}

describe('BusinessHoursSchema', () => {
  it('accepts a valid week with Sunday closed', () => {
    expect(BusinessHoursSchema.safeParse(VALID_WEEK).success).toBe(true)
  })

  it('accepts a day marked as null (closed)', () => {
    const data = { ...VALID_WEEK, '6': null }
    expect(BusinessHoursSchema.safeParse(data).success).toBe(true)
  })

  it('rejects bad HH:mm format — single-digit hour', () => {
    const data = { ...VALID_WEEK, '1': { start: '9:00', end: '19:00' } }
    expect(BusinessHoursSchema.safeParse(data).success).toBe(false)
  })

  it('rejects bad HH:mm format — missing leading zero on minutes', () => {
    const data = { ...VALID_WEEK, '1': { start: '09:0', end: '19:00' } }
    expect(BusinessHoursSchema.safeParse(data).success).toBe(false)
  })

  it('rejects start > end', () => {
    const data = { ...VALID_WEEK, '1': { start: '19:00', end: '09:00' } }
    expect(BusinessHoursSchema.safeParse(data).success).toBe(false)
  })

  it('rejects start === end', () => {
    const data = { ...VALID_WEEK, '1': { start: '09:00', end: '09:00' } }
    expect(BusinessHoursSchema.safeParse(data).success).toBe(false)
  })

  it('rejects all-7-days-closed with the correct message', () => {
    const allClosed = {
      '0': null,
      '1': null,
      '2': null,
      '3': null,
      '4': null,
      '5': null,
      '6': null,
    }
    const result = BusinessHoursSchema.safeParse(allClosed)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'A barbearia precisa abrir pelo menos um dia.',
      )
    }
  })

  it('rejects input that is missing weekday keys', () => {
    const incomplete = {
      '1': { start: '09:00', end: '19:00' },
    }
    expect(BusinessHoursSchema.safeParse(incomplete).success).toBe(false)
  })
})
