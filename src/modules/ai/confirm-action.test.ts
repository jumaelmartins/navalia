import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { confirmSensitiveAction } from './confirm-action'

describe.skipIf(!process.env.DATABASE_URL)('confirmSensitiveAction', () => {
  it('rejects a pending action and is single-winner under double-confirm', async () => {
    const shop = await prisma.barbershop.findFirstOrThrow()
    const log = await prisma.aiActionLog.create({
      data: {
        barbershopId: shop.id,
        channel: 'WHATSAPP_ADMIN',
        toolName: 'cancelAppointment',
        input: { date: '2099-01-01', startTime: '10:00' },
        status: 'PENDING_CONFIRMATION',
        requiresConfirmation: true,
      },
    })

    const [a, b] = await Promise.all([
      confirmSensitiveAction({
        actionId: log.id,
        barbershop: { id: shop.id, timezone: shop.timezone },
        userId: 'u1',
        channel: 'WHATSAPP_ADMIN',
        reject: true,
      }),
      confirmSensitiveAction({
        actionId: log.id,
        barbershop: { id: shop.id, timezone: shop.timezone },
        userId: 'u1',
        channel: 'WHATSAPP_ADMIN',
        reject: true,
      }),
    ])
    const winners = [a, b].filter((r) => r.ok).length
    expect(winners).toBe(1)

    const after = await prisma.aiActionLog.findUnique({ where: { id: log.id } })
    expect(after?.status).toBe('REJECTED')

    await prisma.aiActionLog.delete({ where: { id: log.id } })
  })

  it('returns NOT_FOUND for an unknown action', async () => {
    const shop = await prisma.barbershop.findFirstOrThrow()
    const r = await confirmSensitiveAction({
      actionId: 'does-not-exist',
      barbershop: { id: shop.id, timezone: shop.timezone },
      userId: 'u1',
      channel: 'COPILOT',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })
})
