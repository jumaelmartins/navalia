import { describe, it, expect } from 'vitest'
import { normalizeAdminPhones } from './admin-channel-utils'

describe('normalizeAdminPhones', () => {
  it('normalizes and dedupes numbers', () => {
    const r = normalizeAdminPhones(['(11) 99999-0000', '5511999990000'], null)
    expect(r).toEqual({ ok: true, phones: ['5511999990000'] })
  })

  it('rejects a number equal to the shop own line', () => {
    const r = normalizeAdminPhones(['11988887777'], '11988887777')
    expect(r.ok).toBe(false)
  })

  it('accepts an empty list', () => {
    expect(normalizeAdminPhones([], '11988887777')).toEqual({ ok: true, phones: [] })
  })
})
