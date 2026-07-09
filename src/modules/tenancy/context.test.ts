import 'dotenv/config'
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { slugify, computeTrialEnd, deriveBarbershopName, ensureBarbershop } from './context'

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

describe('deriveBarbershopName', () => {
  it('uses the first name from a full name', () => {
    expect(deriveBarbershopName('João Silva')).toBe('Barbearia de João')
  })

  it('uses a single-word name as-is', () => {
    expect(deriveBarbershopName('Maria')).toBe('Barbearia de Maria')
  })

  it('collapses extra whitespace before extracting the first name', () => {
    expect(deriveBarbershopName('  Pedro   Alves ')).toBe('Barbearia de Pedro')
  })

  it('falls back to a generic name when empty', () => {
    expect(deriveBarbershopName('')).toBe('Minha Barbearia')
  })

  it('falls back to a generic name when only whitespace', () => {
    expect(deriveBarbershopName('   ')).toBe('Minha Barbearia')
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

describe.skipIf(!process.env.DATABASE_URL)('ensureBarbershop (integration)', () => {
  const cleanupBarbershopIds: string[] = []
  const cleanupUserIds: string[] = []

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { barbershopId: { in: cleanupBarbershopIds } } })
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
    await prisma.barbershop.deleteMany({ where: { id: { in: cleanupBarbershopIds } } })
  })

  it('creates a barbershop, links the user as OWNER, and logs the signup', async () => {
    const user = await prisma.user.create({
      data: { name: 'Carlos Pereira', email: `carlos-${Date.now()}@example.com` },
    })
    cleanupUserIds.push(user.id)

    const barbershop = await ensureBarbershop(user.id, user.name)
    cleanupBarbershopIds.push(barbershop.id)

    expect(barbershop.name).toBe('Barbearia de Carlos')
    expect(barbershop.subscriptionStatus).toBe('TRIALING')

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updatedUser.role).toBe('OWNER')
    expect(updatedUser.barbershopId).toBe(barbershop.id)

    const auditLog = await prisma.auditLog.findFirst({
      where: { barbershopId: barbershop.id, action: 'SIGNUP' },
    })
    expect(auditLog).not.toBeNull()
  })

  it('generates a unique slug when the derived name collides', async () => {
    const existing = await prisma.barbershop.create({
      data: {
        name: 'Barbearia de Ana',
        slug: 'barbearia-de-ana',
        trialEndsAt: new Date(),
        businessHours: {},
      },
    })
    cleanupBarbershopIds.push(existing.id)

    const user = await prisma.user.create({
      data: { name: 'Ana Costa', email: `ana-${Date.now()}@example.com` },
    })
    cleanupUserIds.push(user.id)

    const barbershop = await ensureBarbershop(user.id, user.name)
    cleanupBarbershopIds.push(barbershop.id)

    expect(barbershop.slug).toBe('barbearia-de-ana-2')
  })
})
