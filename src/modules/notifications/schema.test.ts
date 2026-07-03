import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'

describe.skipIf(!process.env.DATABASE_URL)('v1.2 schema', () => {
  it('creates a Notification bound to a barbershop', async () => {
    const shop = await prisma.barbershop.findFirst()
    if (!shop) throw new Error('seed a barbershop first (npm run seed)')

    const n = await prisma.notification.create({
      data: { barbershopId: shop.id, type: 'APPOINTMENT_CREATED' },
    })
    expect(n.readAt).toBeNull()
    expect(n.type).toBe('APPOINTMENT_CREATED')

    await prisma.notification.delete({ where: { id: n.id } })
  })

  it('exposes the new Barbershop admin/notify fields', async () => {
    const shop = await prisma.barbershop.findFirstOrThrow()
    expect(Array.isArray(shop.adminPhones)).toBe(true)
    expect(shop.notifyOwnerWhatsapp).toBe(false)
  })
})
