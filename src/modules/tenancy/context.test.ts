import { describe, it, expect } from 'vitest'
import { slugify, computeTrialEnd } from './context'

describe('slugify', () => {
  it("converts 'Barbearia do João' to 'barbearia-do-joao'", () => {
    expect(slugify('Barbearia do João')).toBe('barbearia-do-joao')
  })

  it('strips accent marks', () => {
    expect(slugify('Café')).toBe('cafe')
    expect(slugify('Ângelo Barbearia')).toBe('angelo-barbearia')
  })

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('Barbearia  do   Sul')).toBe('barbearia-do-sul')
  })

  it('removes special characters', () => {
    expect(slugify('Barbearia (Top!) & Cia')).toBe('barbearia-top-cia')
  })

  it('collapses consecutive hyphens', () => {
    expect(slugify('Top--Barber')).toBe('top-barber')
  })

  it('trims leading and trailing whitespace', () => {
    expect(slugify('  Navalia  ')).toBe('navalia')
  })

  it("returns 'barbearia' when all characters are stripped", () => {
    expect(slugify('!!!')).toBe('barbearia')
  })
})

describe('computeTrialEnd', () => {
  it('adds exactly 7 days', () => {
    const from = new Date('2026-07-01T12:00:00.000Z')
    expect(computeTrialEnd(from).toISOString()).toBe('2026-07-08T12:00:00.000Z')
  })

  it('does not mutate the input date', () => {
    const from = new Date('2026-07-01T12:00:00.000Z')
    computeTrialEnd(from)
    expect(from.toISOString()).toBe('2026-07-01T12:00:00.000Z')
  })
})
