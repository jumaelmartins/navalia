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

  it('(k) 5 wrong attempts exhaust the cap; a 6th call (even with the correct code) is TOO_MANY_ATTEMPTS', async () => {
    const sendWhatsApp = vi.fn()
    let sentCode = ''
    sendWhatsApp.mockImplementation(async (_instance: string, _to: string, text: string) => {
      sentCode = text.match(/\d{6}/)?.[0] ?? ''
      return { ok: true }
    })

    const cpf = 'attempt-cap-cpf'
    const phone = '5571999990111'
    const requested = await requestVerificationCode({ barbershopId: connectedShopId, cpf, phone }, { sendWhatsApp })
    expect(requested.ok).toBe(true)
    expect(sentCode).toMatch(/^\d{6}$/)

    const wrongCode = sentCode === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      const result = await verifyCode({ barbershopId: connectedShopId, cpf, phone, code: wrongCode })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('CODE_INVALID')
    }

    // 6th call, even with the originally-correct code, proves attempts are
    // exhausted regardless of correctness (the cap check happens before the
    // hash comparison).
    const finalResult = await verifyCode({ barbershopId: connectedShopId, cpf, phone, code: sentCode })
    expect(finalResult.ok).toBe(false)
    if (!finalResult.ok) expect(finalResult.error).toBe('TOO_MANY_ATTEMPTS')
  })

  it('(l) an expired code returns CODE_EXPIRED', async () => {
    const cpf = 'expire-test-cpf'
    const phone = '5571999990112'
    await prisma.phoneVerification.create({
      data: {
        barbershopId: connectedShopId,
        cpf,
        phone,
        codeHash: 'irrelevant-hash-never-matched',
        channel: 'WHATSAPP',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const result = await verifyCode({ barbershopId: connectedShopId, cpf, phone, code: '123456' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CODE_EXPIRED')
  })

  it('(m) requestVerificationCode short-circuits to ALREADY_VERIFIED before attempting any send', async () => {
    const cpf = 'already-verified-cpf'
    const phone = '5571999990113'
    await prisma.customer.create({
      data: {
        barbershopId: connectedShopId,
        name: 'Already Verified Customer',
        cpf,
        phone,
        phoneVerifiedAt: new Date(),
      },
    })

    const sendWhatsApp = vi.fn().mockResolvedValue({ ok: true })
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const result = await requestVerificationCode(
      { barbershopId: connectedShopId, cpf, phone },
      { sendWhatsApp, sendEmail },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('ALREADY_VERIFIED')
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('(n) two concurrent requestVerificationCode calls for the same new phone only send once', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const uniqueCpf = 'concurrent-test-cpf'
    const uniquePhone = '5571999990199'

    const [a, b] = await Promise.all([
      requestVerificationCode({ barbershopId, cpf: uniqueCpf, phone: uniquePhone, email: 'cliente@example.com' }, { sendEmail }),
      requestVerificationCode({ barbershopId, cpf: uniqueCpf, phone: uniquePhone, email: 'cliente@example.com' }, { sendEmail }),
    ])

    const results = [a, b]
    const succeeded = results.filter(r => r.ok)
    const failed = results.filter(r => !r.ok)
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    if (!failed[0].ok) expect(failed[0].error).toBe('RESEND_TOO_SOON')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})
