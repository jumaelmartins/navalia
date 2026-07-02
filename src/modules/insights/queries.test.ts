import { describe, it, expect } from 'vitest'
import { getWeekStart, getWeekEnd, subtractDays, addDays } from './queries'

// ---------------------------------------------------------------------------
// getWeekStart
// ---------------------------------------------------------------------------

describe('getWeekStart', () => {
  it('returns the same date when input is already Monday', () => {
    // 2024-01-01 is a Monday
    expect(getWeekStart('2024-01-01')).toBe('2024-01-01')
  })

  it('returns Monday for a Wednesday input', () => {
    // 2024-01-03 is Wednesday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-03')).toBe('2024-01-01')
  })

  it('returns the previous Monday for a Sunday input', () => {
    // 2024-01-07 is Sunday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-07')).toBe('2024-01-01')
  })

  it('handles a month boundary (Thursday straddling month)', () => {
    // 2024-02-01 is Thursday → Monday was 2024-01-29
    expect(getWeekStart('2024-02-01')).toBe('2024-01-29')
  })

  it('handles a year boundary', () => {
    // 2025-01-01 is Wednesday → Monday was 2024-12-30
    expect(getWeekStart('2025-01-01')).toBe('2024-12-30')
  })

  it('returns Monday for Saturday input', () => {
    // 2024-01-06 is Saturday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-06')).toBe('2024-01-01')
  })

  it('returns Monday for Tuesday input', () => {
    // 2024-01-02 is Tuesday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-02')).toBe('2024-01-01')
  })
})

// ---------------------------------------------------------------------------
// getWeekEnd
// ---------------------------------------------------------------------------

describe('getWeekEnd', () => {
  it('returns 6 days after Monday for a Monday input', () => {
    // 2024-01-01 (Mon) → Sunday is 2024-01-07
    expect(getWeekEnd('2024-01-01')).toBe('2024-01-07')
  })

  it('returns the same Sunday when input is already Sunday', () => {
    // 2024-01-07 is Sunday → same Sunday
    expect(getWeekEnd('2024-01-07')).toBe('2024-01-07')
  })

  it('returns the correct Sunday for a mid-week date', () => {
    // 2024-01-03 is Wednesday → Sunday is 2024-01-07
    expect(getWeekEnd('2024-01-03')).toBe('2024-01-07')
  })

  it('handles a month boundary (Wednesday → Sunday crosses month)', () => {
    // 2024-01-31 is Wednesday → Monday was 2024-01-29 → Sunday is 2024-02-04
    expect(getWeekEnd('2024-01-31')).toBe('2024-02-04')
  })

  it('handles a year boundary', () => {
    // 2024-12-30 is Monday → Sunday is 2025-01-05
    expect(getWeekEnd('2024-12-30')).toBe('2025-01-05')
  })
})

// ---------------------------------------------------------------------------
// subtractDays
// ---------------------------------------------------------------------------

describe('subtractDays', () => {
  it('subtracts days within a month', () => {
    expect(subtractDays('2024-01-31', 30)).toBe('2024-01-01')
  })

  it('subtracts 1 day across a year boundary', () => {
    expect(subtractDays('2024-01-01', 1)).toBe('2023-12-31')
  })

  it('subtracts 0 days returns the same date', () => {
    expect(subtractDays('2024-06-15', 0)).toBe('2024-06-15')
  })

  it('subtracts across a month boundary', () => {
    expect(subtractDays('2024-03-01', 1)).toBe('2024-02-29') // 2024 is a leap year
  })

  it('subtracts 29 days to cover 30-day window', () => {
    // 30-day range: today=2024-01-30, start=2024-01-01
    expect(subtractDays('2024-01-30', 29)).toBe('2024-01-01')
  })
})

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe('addDays', () => {
  it('adds days within the same month', () => {
    expect(addDays('2024-01-01', 6)).toBe('2024-01-07')
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2024-01-29', 6)).toBe('2024-02-04')
  })

  it('adds 0 days returns the same date', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15')
  })

  it('adds days across a year boundary', () => {
    expect(addDays('2024-12-30', 6)).toBe('2025-01-05')
  })
})
