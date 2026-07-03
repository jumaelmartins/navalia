import { describe, it, expect } from 'vitest'
import { adminWhatsAppSystemPrompt } from './prompts'

describe('adminWhatsAppSystemPrompt', () => {
  it('names the shop and today, and mentions the PIN step-up', () => {
    const p = adminWhatsAppSystemPrompt({ name: 'Barbearia X' }, '2026-07-03')
    expect(p).toContain('Barbearia X')
    expect(p).toContain('2026-07-03')
    expect(p.toLowerCase()).toContain('pin')
  })
})
