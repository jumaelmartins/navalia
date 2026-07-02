import { describe, it, expect } from 'vitest'
import { RuleSchema, BlockSchema, detectOverlaps } from './availability-schemas'

// ---------------------------------------------------------------------------
// RuleSchema — weekday 0-6, HH:mm, start < end
// ---------------------------------------------------------------------------

describe('RuleSchema', () => {
  it('rejects weekday 7 (out of range)', () => {
    expect(
      RuleSchema.safeParse({ weekday: 7, startTime: '09:00', endTime: '18:00' }).success,
    ).toBe(false)
  })

  it('rejects negative weekday', () => {
    expect(
      RuleSchema.safeParse({ weekday: -1, startTime: '09:00', endTime: '18:00' }).success,
    ).toBe(false)
  })

  it('accepts weekday 0 (domingo)', () => {
    expect(
      RuleSchema.safeParse({ weekday: 0, startTime: '09:00', endTime: '18:00' }).success,
    ).toBe(true)
  })

  it('accepts weekday 6 (sábado)', () => {
    expect(
      RuleSchema.safeParse({ weekday: 6, startTime: '09:00', endTime: '18:00' }).success,
    ).toBe(true)
  })

  it('rejects start > end', () => {
    expect(
      RuleSchema.safeParse({ weekday: 1, startTime: '18:00', endTime: '09:00' }).success,
    ).toBe(false)
  })

  it('rejects start === end', () => {
    expect(
      RuleSchema.safeParse({ weekday: 1, startTime: '09:00', endTime: '09:00' }).success,
    ).toBe(false)
  })

  it('accepts valid rule', () => {
    expect(
      RuleSchema.safeParse({ weekday: 2, startTime: '08:30', endTime: '17:00' }).success,
    ).toBe(true)
  })

  it('rejects invalid HH:mm format', () => {
    expect(
      RuleSchema.safeParse({ weekday: 1, startTime: '9:00', endTime: '18:00' }).success,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectOverlaps — overlap detection logic
// ---------------------------------------------------------------------------

describe('detectOverlaps', () => {
  it('rejects overlapping same-weekday rules (12:00 overlap)', () => {
    const rules = [
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
      { weekday: 1, startTime: '12:00', endTime: '18:00' },
    ]
    expect(detectOverlaps(rules)).not.toBeNull()
  })

  it('accepts non-overlapping multi-window same weekday: 09:00-12:00 + 14:00-19:00', () => {
    const rules = [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '14:00', endTime: '19:00' },
    ]
    expect(detectOverlaps(rules)).toBeNull()
  })

  it('allows touching edges (12:00/12:00 boundary is valid)', () => {
    const rules = [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '12:00', endTime: '18:00' },
    ]
    expect(detectOverlaps(rules)).toBeNull()
  })

  it('accepts rules on different weekdays that would overlap if on same day', () => {
    const rules = [
      { weekday: 1, startTime: '09:00', endTime: '18:00' },
      { weekday: 2, startTime: '09:00', endTime: '18:00' },
    ]
    expect(detectOverlaps(rules)).toBeNull()
  })

  it('returns null for empty rules', () => {
    expect(detectOverlaps([])).toBeNull()
  })

  it('returns null for single rule per day', () => {
    const rules = [
      { weekday: 1, startTime: '09:00', endTime: '18:00' },
      { weekday: 3, startTime: '09:00', endTime: '18:00' },
    ]
    expect(detectOverlaps(rules)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// BlockSchema — YYYY-MM-DD date validation, start < end
// ---------------------------------------------------------------------------

describe('BlockSchema / date validation', () => {
  const validBlock = {
    professionalId: 'prof-1',
    date: '2026-03-15',
    startTime: '09:00',
    endTime: '10:00',
  }

  it('rejects invalid calendar date "2026-02-30" (Feb has at most 29 days)', () => {
    expect(BlockSchema.safeParse({ ...validBlock, date: '2026-02-30' }).success).toBe(false)
  })

  it('accepts a valid date', () => {
    expect(BlockSchema.safeParse(validBlock).success).toBe(true)
  })

  it('rejects start >= end (start after end)', () => {
    expect(
      BlockSchema.safeParse({ ...validBlock, startTime: '10:00', endTime: '09:00' }).success,
    ).toBe(false)
  })

  it('rejects start === end', () => {
    expect(
      BlockSchema.safeParse({ ...validBlock, startTime: '09:00', endTime: '09:00' }).success,
    ).toBe(false)
  })

  it('rejects badly formatted date "20260315"', () => {
    expect(BlockSchema.safeParse({ ...validBlock, date: '20260315' }).success).toBe(false)
  })

  it('rejects month 13', () => {
    expect(BlockSchema.safeParse({ ...validBlock, date: '2026-13-01' }).success).toBe(false)
  })
})
