import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/prisma'

let barbershopId: string
let customerAId: string
let customerBId: string

// saveCustomerCpf resolves the tenant via requireOnboarded(), which reads a
// real auth session (headers/cookies) — unavailable outside a request. Mock
// just the auth guard; every DB call (findUnique clash-check, updateMany,
// fixture seed/teardown) hits the real database, matching the integration
// style of conflict.test.ts.
vi.mock('@/modules/tenancy/context', () => ({
  requireOnboarded: vi.fn(async () => ({
    user: {},
    barbershop: { id: barbershopId },
  })),
}))

// revalidatePath requires a live Next.js request/static-generation store,
// which doesn't exist under vitest — stub it out like next/headers is
// stubbed in route.test.ts.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const { saveCustomerCpf } = await import('./actions')

describe.skipIf(!process.env.DATABASE_URL)('saveCustomerCpf (integration)', () => {
  beforeAll(async () => {
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Clientes Shop',
        slug: `test-clientes-${Date.now()}`,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    barbershopId = shop.id

    const a = await prisma.customer.create({
      data: { barbershopId, name: 'Cliente A', phone: '11911111111', cpf: '11144477735' },
    })
    customerAId = a.id

    const b = await prisma.customer.create({
      data: { barbershopId, name: 'Cliente B', phone: '11922222222', cpf: '52998224725' },
    })
    customerBId = b.id
  })

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  it('(a) backfills a valid CPF for an existing customer', async () => {
    const c = await prisma.customer.create({
      data: { barbershopId, name: 'Cliente C', phone: '11933333333', cpf: null },
    })

    const result = await saveCustomerCpf(c.id, '390.533.447-05')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.cpf).toBe('39053344705')
  })

  it('(b) rejects an invalid CPF checksum', async () => {
    const result = await saveCustomerCpf(customerAId, '11111111111')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CPF inválido.')
  })

  it('(c) rejects a CPF already used by a different customer (findUnique fast path)', async () => {
    const result = await saveCustomerCpf(customerAId, '52998224725')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CPF já cadastrado para outro cliente.')
  })

  it('(d) two concurrent backfills to the same new CPF for different customers → exactly one ok, one friendly collision error (no throw)', async () => {
    // Two fresh, CPF-less customers so both requests pass the findUnique
    // pre-check before either write commits — this is what forces the
    // P2002 to surface from updateMany instead of the fast-path check.
    const [x, y] = await Promise.all([
      prisma.customer.create({ data: { barbershopId, name: 'Race X', phone: '11944444444', cpf: null } }),
      prisma.customer.create({ data: { barbershopId, name: 'Race Y', phone: '11955555555', cpf: null } }),
    ])

    const raceCpf = '12345678909'
    const [r1, r2] = await Promise.all([
      saveCustomerCpf(x.id, raceCpf),
      saveCustomerCpf(y.id, raceCpf),
    ])

    const successes = [r1, r2].filter((r) => r.ok)
    const failures = [r1, r2].filter((r) => !r.ok)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    if (!failures[0]!.ok) {
      expect(failures[0]!.error).toBe('CPF já cadastrado para outro cliente.')
    }
  })
})
