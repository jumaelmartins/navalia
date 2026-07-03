import { describe, it, expect } from 'vitest'
import { isAdminPhone, classifyAdminInbound } from './admin-flow'

describe('isAdminPhone', () => {
  it('matches after normalization', () => {
    expect(isAdminPhone(['5511999990000'], '11999990000')).toBe(true)
    expect(isAdminPhone(['5511999990000'], '5511888880000')).toBe(false)
    expect(isAdminPhone([], '11999990000')).toBe(false)
  })
})

describe('classifyAdminInbound', () => {
  it('with no pending action, everything is a command', () => {
    expect(classifyAdminInbound('qual meu faturamento hoje?', false)).toBe('command')
    expect(classifyAdminInbound('123456', false)).toBe('command')
  })

  it('with a pending action, detects cancel / pin / reprompt', () => {
    expect(classifyAdminInbound('cancelar', true)).toBe('cancel')
    expect(classifyAdminInbound('CANCELAR', true)).toBe('cancel')
    expect(classifyAdminInbound('123456', true)).toBe('pin')
    expect(classifyAdminInbound(' 000111 ', true)).toBe('pin')
    expect(classifyAdminInbound('e aí?', true)).toBe('reprompt')
  })
})
