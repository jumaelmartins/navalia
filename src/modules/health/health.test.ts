import { describe, expect, it } from 'vitest'
import { BRAND } from '@/lib/brand'

describe('scaffold', () => {
  it('exposes brand token', () => {
    expect(BRAND.name).toBe('Navalia')
  })
})
