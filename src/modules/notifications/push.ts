import 'server-only'
import { prisma as realPrisma } from '@/lib/prisma'
import { evolution } from '@/modules/whatsapp/evolution-client'

type PushDeps = {
  prisma?: typeof realPrisma
  sendText?: (instance: string, to: string, text: string) => Promise<unknown>
}

/** Best-effort owner push. Never throws — booking must not depend on it. */
export async function pushNewAppointmentToOwner(
  tenantId: string,
  appointmentId: string,
  deps: PushDeps = {},
): Promise<void> {
  const db = deps.prisma ?? realPrisma
  const sendText =
    deps.sendText ??
    ((instance: string, to: string, text: string) => evolution.sendText(instance, to, text))

  try {
    const shop = await db.barbershop.findUnique({ where: { id: tenantId } })
    if (
      !shop ||
      !shop.notifyOwnerWhatsapp ||
      !shop.ownerNotifyPhone ||
      !shop.evolutionInstanceId ||
      shop.whatsappStatus !== 'CONNECTED'
    ) {
      return
    }

    const appt = await db.appointment.findFirst({
      where: { id: appointmentId, barbershopId: tenantId },
      select: {
        date: true,
        startTime: true,
        customer: { select: { name: true } },
        service: { select: { name: true } },
        professional: { select: { name: true } },
      },
    })
    if (!appt) return

    const text =
      `📅 Novo agendamento\n` +
      `${appt.customer.name} — ${appt.service.name}\n` +
      `com ${appt.professional.name}\n` +
      `${appt.date} às ${appt.startTime}`

    await sendText(shop.evolutionInstanceId, shop.ownerNotifyPhone, text)
  } catch (err) {
    console.error('[pushNewAppointmentToOwner] non-fatal', err)
  }
}
