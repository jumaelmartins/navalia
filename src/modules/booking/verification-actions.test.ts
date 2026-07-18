import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { checkPhoneVerified, requestPhoneVerification, confirmPhoneVerification } from './verification-actions'
import { createAppointment } from './create-appointment'
import { sendEmail } from '@/modules/notifications/email'

vi.mock('@/modules/notifications/email', async importOriginal => {
  const actual = await importOriginal<typeof import('@/modules/notifications/email')>()
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) }
})

let barbershopId: string
let slug: string
let serviceId: string
let professionalId: string

// Fixed future Monday (weekday 1) — stable test anchor for createAppointment.
const TEST_DATE = '2026-08-03'

describe.skipIf(!process.env.DATABASE_URL)('verification-actions (integration)', () => {
  beforeAll(async () => {
    slug = `test-verify-actions-${Date.now()}`
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Verify Actions Shop',
        slug,
        businessHours: {
          '0': null,
          '1': { start: '08:00', end: '18:00' },
          '2': { start: '08:00', end: '18:00' },
          '3': { start: '08:00', end: '18:00' },
          '4': { start: '08:00', end: '18:00' },
          '5': { start: '08:00', end: '18:00' },
          '6': { start: '08:00', end: '18:00' },
        },
        timezone: 'America/Bahia',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onboardingCompleted: true,
        whatsappStatus: 'DISCONNECTED',
      },
    })
    barbershopId = shop.id

    const service = await prisma.service.create({
      data: { barbershopId, name: 'Haircut', priceCents: 3000, durationMin: 30, isActive: true },
    })
    serviceId = service.id

    const professional = await prisma.professional.create({
      data: { barbershopId, name: 'Test Barber', isActive: true },
    })
    professionalId = professional.id

    await prisma.professionalService.create({ data: { professionalId, serviceId } })

    await prisma.availabilityRule.create({
      data: { barbershopId, professionalId, weekday: 1, startTime: '09:00', endTime: '17:00' },
    })
  })

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { barbershopId } })
    await prisma.notification.deleteMany({ where: { barbershopId } })
    await prisma.appointment.deleteMany({ where: { barbershopId } })
    await prisma.phoneVerification.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.availabilityRule.deleteMany({ where: { barbershopId } })
    await prisma.professionalService.deleteMany({ where: { professionalId } })
    await prisma.professional.deleteMany({ where: { barbershopId } })
    await prisma.service.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('(a) checkPhoneVerified is false for an unknown CPF', async () => {
    const result = await checkPhoneVerified({ slug, cpf: '11144477735', phone: '5571999991001' })
    expect(result.verified).toBe(false)
  })

  it('(b) checkPhoneVerified returns false for an unknown slug (no page-not-found leak)', async () => {
    const result = await checkPhoneVerified({ slug: 'does-not-exist', cpf: '11144477735', phone: '5571999991001' })
    expect(result.verified).toBe(false)
  })

  it('(c) requestPhoneVerification without email on a disconnected shop asks for one', async () => {
    const result = await requestPhoneVerification({ slug, cpf: '52998224725', phone: '5571999991002' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.needsEmail).toBe(true)
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('(d) requestPhoneVerification with email fails gracefully when SMTP is unconfigured', async () => {
    // Force SMTP_* unset regardless of the developer's local .env — this
    // test asserts requestPhoneVerification surfaces a friendly error
    // instead of throwing when the real sendEmail() call fails closed, and
    // must not depend on whether real SMTP credentials happen to be
    // configured on the machine running the suite.
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_PORT', '')
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASSWORD', '')
    vi.stubEnv('SMTP_FROM', '')

    const result = await requestPhoneVerification({
      slug,
      cpf: '52998224725',
      phone: '5571999991002',
      email: 'cliente@example.com',
    })
    expect(result.ok).toBe(false)
  })

  it('(e) confirmPhoneVerification with no pending code returns a friendly error', async () => {
    const result = await confirmPhoneVerification({
      slug,
      cpf: '39053344705',
      phone: '5571999991003',
      code: '123456',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  // Regression test for the raw-vs-normalized phone mismatch: a customer types
  // a realistic local-format phone (no country code — matching the public
  // booking form's own placeholder "(71) 99999-9999"), verifies it through the
  // real exported actions, then books through createAppointment with that
  // SAME raw string. Before the fix, verification-actions.ts stored/looked up
  // PhoneVerification rows keyed by the RAW phone ("71988887777"), while
  // create-appointment.ts's gate normalizes to "5571988887777" before calling
  // hasRecentVerification/isPhoneVerified — so the two never matched and
  // createAppointment always returned PHONE_NOT_VERIFIED for this (default)
  // input shape. Confirmed by temporarily reverting the fix: this test fails
  // with `expected false to be true` on the PHONE_NOT_VERIFIED branch.
  it('(f) realistic local-format phone: verify then book — must NOT be PHONE_NOT_VERIFIED', async () => {
    const rawPhone = '71988887777' // matches the booking form placeholder shape
    const cpf = '10000000019' // valid checksum, unused elsewhere in this file

    let capturedCode = ''
    vi.mocked(sendEmail).mockImplementationOnce(async (_to, _subject, text) => {
      capturedCode = text.match(/\d{6}/)?.[0] ?? ''
      return { ok: true, data: undefined }
    })

    const reqResult = await requestPhoneVerification({
      slug,
      cpf,
      phone: rawPhone,
      email: 'cliente@example.com',
    })
    expect(reqResult.ok).toBe(true)
    expect(capturedCode).toMatch(/^\d{6}$/)

    const confirmResult = await confirmPhoneVerification({
      slug,
      cpf,
      phone: rawPhone,
      code: capturedCode,
    })
    expect(confirmResult.ok).toBe(true)

    const bookingResult = await createAppointment({
      tenantId: barbershopId,
      serviceId,
      professionalId,
      date: TEST_DATE,
      startTime: '10:00',
      customer: { name: 'Regression Test', cpf, phone: rawPhone },
      source: 'PUBLIC_PAGE',
      consent: true,
    })

    expect(bookingResult.ok).toBe(true)
  })

  it('(g) preferredChannel WHATSAPP on a shop with no WhatsApp connected surfaces a friendly WHATSAPP_UNAVAILABLE message', async () => {
    const result = await requestPhoneVerification({
      slug,
      cpf: '18723501006',
      phone: '5571999991004',
      email: 'cliente@example.com',
      preferredChannel: 'WHATSAPP',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('WhatsApp indisponível no momento. Tente pelo e-mail.')
      expect(result.needsEmail).toBe(false)
    }
  })
})
