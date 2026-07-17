import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  isPhoneVerified,
  hasRecentVerification,
  requestVerificationCode,
  verifyCode,
} from './verification'

let barbershopId: string
let connectedShopId: string
const CPF_A = '11144477735'
const PHONE_A = '5571999990001'

describe.skipIf(!process.env.DATABASE_URL)('verification (integration)', () => {
  beforeAll(async () => {
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Verification Shop',
        slug: `test-verify-${Date.now()}`,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        whatsappStatus: 'DISCONNECTED',
      },
    })
    barbershopId = shop.id

    const connectedShop = await prisma.barbershop.create({
      data: {
        name: 'Test Connected Shop',
        slug: `test-verify-connected-${Date.now()}`,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        evolutionInstanceId: `test-instance-${Date.now()}`,
        whatsappStatus: 'CONNECTED',
      },
    })
    connectedShopId = connectedShop.id
  })

  afterAll(async () => {
    await prisma.phoneVerification.deleteMany({ where: { barbershopId: { in: [barbershopId, connectedShopId] } } })
    await prisma.customer.deleteMany({ where: { barbershopId: { in: [barbershopId, connectedShopId] } } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
    await prisma.barbershop.delete({ where: { id: connectedShopId } })
  })

  it('(a) isPhoneVerified is false when no customer exists', async () => {
    expect(await isPhoneVerified(barbershopId, CPF_A, PHONE_A)).toBe(false)
  })

  it('(b) requestVerificationCode without email on a disconnected shop → EMAIL_REQUIRED', async () => {
    const result = await requestVerificationCode({ barbershopId, cpf: CPF_A, phone: PHONE_A })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('EMAIL_REQUIRED')
  })

  it('(c) requestVerificationCode with email on a disconnected shop sends via EMAIL', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const result = await requestVerificationCode(
      { barbershopId, cpf: CPF_A, phone: PHONE_A, email: 'cliente@example.com' },
      { sendEmail },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.channel).toBe('EMAIL')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [to, , text] = sendEmail.mock.calls[0]
    expect(to).toBe('cliente@example.com')
    expect(text).toMatch(/\d{6}/)
  })

  it('(d) resend cooldown blocks a second request within 60s', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const result = await requestVerificationCode(
      { barbershopId, cpf: CPF_A, phone: PHONE_A, email: 'cliente@example.com' },
      { sendEmail },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('RESEND_TOO_SOON')
  })

  it('(e) requestVerificationCode on a connected shop sends via WHATSAPP, ignoring email', async () => {
    const sendWhatsApp = vi.fn().mockResolvedValue({ ok: true })
    const sendEmail = vi.fn()
    const result = await requestVerificationCode(
      { barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A },
      { sendWhatsApp, sendEmail },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.channel).toBe('WHATSAPP')
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('(f) verifyCode with the wrong code increments attempts and fails', async () => {
    const result = await verifyCode({ barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A, code: '000000' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CODE_INVALID')

    const row = await prisma.phoneVerification.findFirst({
      where: { barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A },
      orderBy: { createdAt: 'desc' },
    })
    expect(row?.attempts).toBe(1)
  })

  it('(g) verifyCode with the right code succeeds, and hasRecentVerification becomes true', async () => {
    const sendWhatsApp = vi.fn().mockResolvedValue({ ok: true })
    // Capture the code via a spy on the WhatsApp text
    let sentCode = ''
    sendWhatsApp.mockImplementation(async (_instance: string, _to: string, text: string) => {
      sentCode = text.match(/\d{6}/)?.[0] ?? ''
      return { ok: true }
    })

    const uniquePhone = '5571999990099'
    await requestVerificationCode(
      { barbershopId: connectedShopId, cpf: '52998224725', phone: uniquePhone },
      { sendWhatsApp },
    )
    expect(sentCode).toMatch(/^\d{6}$/)

    const result = await verifyCode({
      barbershopId: connectedShopId,
      cpf: '52998224725',
      phone: uniquePhone,
      code: sentCode,
    })
    expect(result.ok).toBe(true)

    expect(await hasRecentVerification(connectedShopId, '52998224725', uniquePhone)).toBe(true)
  })

  it('(h) a customer with phoneVerifiedAt set for this exact phone is already verified', async () => {
    const customer = await prisma.customer.create({
      data: {
        barbershopId,
        name: 'Verified Customer',
        cpf: '39053344705',
        phone: '5571999990088',
        phoneVerifiedAt: new Date(),
      },
    })
    expect(await isPhoneVerified(barbershopId, customer.cpf!, customer.phone)).toBe(true)
  })

  it('(i) a verified customer with a DIFFERENT phone is not verified for the new phone', async () => {
    const customer = await prisma.customer.findFirst({ where: { barbershopId, cpf: '39053344705' } })
    expect(await isPhoneVerified(barbershopId, customer!.cpf!, '5571999990077')).toBe(false)
  })

  it('(j) verifyCode with no pending code → NOT_FOUND', async () => {
    const result = await verifyCode({ barbershopId, cpf: '99999999999', phone: '5571999990066', code: '123456' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('NOT_FOUND')
  })
})
