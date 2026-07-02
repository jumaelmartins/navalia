import { describe, expect, it } from 'vitest'
import { computeSlots, overlaps, addMinutes, isCanonicalDate } from './slots'

const bh = { start: '08:00', end: '18:00' }
const avail = [{ start: '09:00', end: '17:00' }]

describe('isCanonicalDate', () => {
  it('accepts a valid ISO date', () => {
    expect(isCanonicalDate('2026-07-06')).toBe(true)
  })
  it('rejects non-zero-padded month/day', () => {
    expect(isCanonicalDate('2026-7-6')).toBe(false)
  })
  it('rejects an impossible calendar date', () => {
    expect(isCanonicalDate('2026-02-30')).toBe(false)
  })
  it('rejects empty string', () => {
    expect(isCanonicalDate('')).toBe(false)
  })
  it('rejects wrong format', () => {
    expect(isCanonicalDate('06/07/2026')).toBe(false)
  })
})

describe('overlaps', () => {
  it('detects newStart < existingEnd && newEnd > existingStart', () => {
    expect(overlaps('10:15', '10:45', '10:00', '10:30')).toBe(true)
    expect(overlaps('10:30', '11:00', '10:00', '10:30')).toBe(false) // touching edges ok
  })
})

describe('computeSlots', () => {
  it('intersects business hours with availability', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30, stepMin: 30 })
    expect(slots[0]).toBe('09:00')
    expect(slots.at(-1)).toBe('16:30') // 16:30+30 = 17:00 fits
  })
  it('removes lunch block', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [{ start: '12:00', end: '13:00' }], appointments: [], durationMin: 30, stepMin: 30 })
    expect(slots).not.toContain('12:00')
    expect(slots).not.toContain('12:30')
    expect(slots).toContain('13:00')
  })
  it('removes booked ranges and partial overlaps', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [{ start: '10:00', end: '10:30' }], durationMin: 60, stepMin: 30 })
    expect(slots).not.toContain('09:30') // 09:30+60 crosses 10:00
    expect(slots).not.toContain('10:00')
    expect(slots).toContain('10:30')
  })
  it('closed day → empty', () => {
    expect(computeSlots({ businessHours: null, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30 })).toEqual([])
  })
  it('service longer than any window → empty', () => {
    expect(computeSlots({ businessHours: bh, availabilityRules: [{ start: '09:00', end: '09:30' }], blocks: [], appointments: [], durationMin: 60 })).toEqual([])
  })
  it('respects minStart cutoff', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30, stepMin: 30, minStart: '15:00' })
    expect(slots[0]).toBe('15:00')
  })
})
