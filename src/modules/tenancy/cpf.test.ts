import { describe, it, expect } from 'vitest'
import { normalizeCpf, isValidCpf, formatCpf } from './cpf'

describe('normalizeCpf', () => {
  it('strips punctuation from a formatted CPF', () => {
    expect(normalizeCpf('111.444.777-35')).toBe('11144477735')
  })

  it('accepts an already-normalized 11-digit string', () => {
    expect(normalizeCpf('52998224725')).toBe('52998224725')
  })

  it('returns null when fewer than 11 digits remain', () => {
    expect(normalizeCpf('123.456.789')).toBeNull()
  })

  it('returns null when more than 11 digits remain', () => {
    expect(normalizeCpf('123456789012')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(normalizeCpf('')).toBeNull()
  })
})

describe('isValidCpf', () => {
  it('accepts a valid CPF', () => {
    expect(isValidCpf('11144477735')).toBe(true)
  })

  it('accepts another valid CPF', () => {
    expect(isValidCpf('52998224725')).toBe(true)
  })

  it('rejects a repeated-digit sequence that would otherwise pass checksum', () => {
    expect(isValidCpf('11111111111')).toBe(false)
  })

  it('rejects a CPF with a wrong check digit', () => {
    expect(isValidCpf('11144477736')).toBe(false)
  })

  it('rejects a string that is not 11 digits', () => {
    expect(isValidCpf('123')).toBe(false)
  })
})

describe('formatCpf', () => {
  it('formats an 11-digit CPF as 000.000.000-00', () => {
    expect(formatCpf('11144477735')).toBe('111.444.777-35')
  })

  it('returns the input unchanged when not 11 digits', () => {
    expect(formatCpf('123')).toBe('123')
  })
})
