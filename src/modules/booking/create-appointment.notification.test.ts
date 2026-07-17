import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAppointment } from './create-appointment'

describe.skipIf(!process.env.DATABASE_URL)('createAppointment → Notification', () => {
  it('writes one APPOINTMENT_CREATED notification per booking', async () => {
    // Adaptation from brief: multi-shop DB — ensure we find a shop with services
    // linked to professionals (brief assumes single demo shop; DB has 5 shops)
    const shop = await prisma.barbershop.findFirstOrThrow({
      where: { services: { some: { professionals: { some: {} } } } },
    })
    const service = await prisma.service.findFirstOrThrow({ where: { barbershopId: shop.id } })
    const pro = await prisma.professional.findFirstOrThrow({ where: { barbershopId: shop.id } })

    // pick a far-future free date to avoid conflicts
    const date = '2099-01-05'
    const before = await prisma.notification.count({ where: { barbershopId: shop.id } })

    const res = await createAppointment({
      tenantId: shop.id,
      serviceId: service.id,
      professionalId: pro.id,
      date,
      startTime: '10:00',
      customer: { name: 'Teste Notif', cpf: '20000000027', phone: '5511999990001' },
      source: 'ADMIN',
    })
    expect(res.ok).toBe(true)

    const after = await prisma.notification.count({ where: { barbershopId: shop.id } })
    expect(after).toBe(before + 1)

    if (res.ok) {
      const n = await prisma.notification.findFirst({
        where: { barbershopId: shop.id, appointmentId: res.data.appointmentId },
      })
      expect(n?.type).toBe('APPOINTMENT_CREATED')
      // cleanup
      await prisma.notification.deleteMany({ where: { appointmentId: res.data.appointmentId } })
      await prisma.appointment.delete({ where: { id: res.data.appointmentId } })
    }
  }, 15_000)
})
