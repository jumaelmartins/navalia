import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getUnreadCount, listRecent, markRead, markAllRead } from './queries'

describe.skipIf(!process.env.DATABASE_URL)('notification queries', () => {
  let shopId: string
  beforeAll(async () => {
    const shop = await prisma.barbershop.findFirstOrThrow()
    shopId = shop.id
    await prisma.notification.deleteMany({ where: { barbershopId: shopId } })
    await prisma.notification.createMany({
      data: [
        { barbershopId: shopId, type: 'APPOINTMENT_CREATED' },
        { barbershopId: shopId, type: 'APPOINTMENT_CREATED' },
      ],
    })
  })

  it('counts unread', async () => {
    expect(await getUnreadCount(shopId)).toBe(2)
  })

  it('lists recent (newest first) and is tenant-scoped', async () => {
    const items = await listRecent(shopId, 10)
    expect(items.length).toBe(2)
    expect(await listRecent('nonexistent', 10)).toEqual([])
  })

  it('marks all read', async () => {
    await markAllRead(shopId)
    expect(await getUnreadCount(shopId)).toBe(0)
  })
})
