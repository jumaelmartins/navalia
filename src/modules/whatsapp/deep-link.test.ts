import { describe, expect, it } from 'vitest'
import { buildWhatsAppLink, buildConfirmationShareText } from './deep-link'

describe('buildWhatsAppLink', () => {
  it('returns generic message when only shopName given', () => {
    const url = buildWhatsAppLink({ phone: '5571999998888', shopName: 'Barbearia Top' })
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toBe('Olá! Gostaria de agendar um horário na Barbearia Top.')
    expect(url).toMatch(/^https:\/\/wa\.me\/5571999998888\?text=/)
  })

  it('includes service name when service provided (no date/time)', () => {
    const url = buildWhatsAppLink({
      phone: '5571999998888',
      shopName: 'Barbearia Top',
      service: 'Corte Masculino',
    })
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toBe('Olá! Gostaria de agendar Corte Masculino na Barbearia Top.')
  })

  it('appends professional when service and professional given (no date/time)', () => {
    const url = buildWhatsAppLink({
      phone: '5571999998888',
      shopName: 'Barbearia Top',
      service: 'Corte Masculino',
      professional: 'João',
    })
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toBe('Olá! Gostaria de agendar Corte Masculino na Barbearia Top com João.')
  })

  it('uses confirmation intent message when service, date and time are all provided', () => {
    const url = buildWhatsAppLink({
      phone: '5571999998888',
      shopName: 'Barbearia Top',
      service: 'Corte Masculino',
      date: '2026-08-15',
      time: '10:30',
    })
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toBe(
      'Olá! Gostaria de confirmar um agendamento de Corte Masculino para 15/08 às 10:30 na Barbearia Top.',
    )
  })

  it('URL-encodes special characters — "Corte + Barba" contains no raw + or space in text param', () => {
    const url = buildWhatsAppLink({
      phone: '5571999998888',
      shopName: 'Barbearia Top',
      service: 'Corte + Barba',
    })
    const textParam = url.split('?text=')[1]
    expect(textParam).not.toContain('+')
    expect(textParam).not.toContain(' ')
    expect(textParam).toContain('%2B')
    const decoded = decodeURIComponent(textParam)
    expect(decoded).toContain('Corte + Barba')
  })

  it('normalizes 11-digit phone by prefixing 55', () => {
    const url = buildWhatsAppLink({ phone: '71999998888', shopName: 'Barbearia Top' })
    expect(url).toMatch(/^https:\/\/wa\.me\/5571999998888\?text=/)
  })

  it('normalizes 10-digit phone by prefixing 55', () => {
    const url = buildWhatsAppLink({ phone: '7199998888', shopName: 'Barbearia Top' })
    expect(url).toMatch(/^https:\/\/wa\.me\/557199998888\?text=/)
  })

  it('leaves already-prefixed phone unchanged', () => {
    const url = buildWhatsAppLink({ phone: '5571999998888', shopName: 'Barbearia Top' })
    expect(url).toMatch(/^https:\/\/wa\.me\/5571999998888\?text=/)
  })

  it('strips non-digit characters from phone before normalization', () => {
    const url = buildWhatsAppLink({ phone: '(71) 99999-8888', shopName: 'Barbearia Top' })
    expect(url).toMatch(/^https:\/\/wa\.me\/5571999998888\?text=/)
  })
})

describe('buildConfirmationShareText', () => {
  it('returns multi-line pt-BR confirmation summary', () => {
    const text = buildConfirmationShareText({
      serviceName: 'Corte Masculino',
      professionalName: 'João Silva',
      date: '2026-08-15',
      time: '10:30',
      shopName: 'Barbearia Top',
    })
    expect(text).toContain('Barbearia Top')
    expect(text).toContain('Corte Masculino')
    expect(text).toContain('João Silva')
    expect(text).toContain('15/08/2026')
    expect(text).toContain('10:30')
    // must be multi-line
    expect(text.split('\n').length).toBeGreaterThan(2)
  })
})
