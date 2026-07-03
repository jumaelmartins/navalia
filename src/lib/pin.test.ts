import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin } from './pin'

describe('pin', () => {
  it('hashes deterministically to 64 hex chars', () => {
    const h = hashPin('123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashPin('123456')).toBe(h)
  })

  it('verifies a correct pin and rejects a wrong one', () => {
    const h = hashPin('654321')
    expect(verifyPin('654321', h)).toBe(true)
    expect(verifyPin('000000', h)).toBe(false)
  })

  it('returns false for malformed hash without throwing', () => {
    expect(verifyPin('123456', 'not-a-hash')).toBe(false)
  })
})
