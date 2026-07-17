import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { checkPhoneVerified, requestPhoneVerification, confirmPhoneVerification } from './verification-actions'

let barbershopId: string
let slug: string

describe.skipIf(!process.env.DATABASE_URL)('verification-actions (integration)', () => {
  beforeAll(async () => {
    slug = `test-verify-actions-${Date.now()}`
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Verify Actions Shop',
        slug,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onboardingCompleted: true,
        whatsappStatus: 'DISCONNECTED',
      },
    })
    barbershopId = shop.id
  })

  afterAll(async () => {
    await prisma.phoneVerification.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
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
})
