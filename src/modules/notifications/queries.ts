import 'server-only'
import { prisma } from '@/lib/prisma'

export type NotificationView = {
  id: string
  type: string
  appointmentId: string | null
  customerName: string | null
  serviceName: string | null
  professionalName: string | null
  date: string | null
  startTime: string | null
  readAt: Date | null
  createdAt: Date
}

export async function getUnreadCount(tenantId: string): Promise<number> {
  return prisma.notification.count({
    where: { barbershopId: tenantId, readAt: null },
  })
}

export async function listRecent(
  tenantId: string,
  limit = 20,
): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { barbershopId: tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const apptIds = rows.map((r) => r.appointmentId).filter((x): x is string => !!x)
  const appts = apptIds.length
    ? await prisma.appointment.findMany({
        where: { id: { in: apptIds }, barbershopId: tenantId },
        select: {
          id: true,
          date: true,
          startTime: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
          professional: { select: { name: true } },
        },
      })
    : []
  const byId = new Map(appts.map((a) => [a.id, a]))

  return rows.map((r) => {
    const a = r.appointmentId ? byId.get(r.appointmentId) : undefined
    return {
      id: r.id,
      type: r.type,
      appointmentId: r.appointmentId,
      customerName: a?.customer.name ?? null,
      serviceName: a?.service.name ?? null,
      professionalName: a?.professional.name ?? null,
      date: a?.date ?? null,
      startTime: a?.startTime ?? null,
      readAt: r.readAt,
      createdAt: r.createdAt,
    }
  })
}

export async function markRead(tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  await prisma.notification.updateMany({
    where: { barbershopId: tenantId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  })
}

export async function markAllRead(tenantId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { barbershopId: tenantId, readAt: null },
    data: { readAt: new Date() },
  })
}
