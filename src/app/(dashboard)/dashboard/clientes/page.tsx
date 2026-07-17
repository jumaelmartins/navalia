import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { ClientesClient, type CustomerRow } from './_components/ClientesClient'

export default async function ClientesPage() {
  const { barbershop } = await requireOnboarded()

  // Today for "inactive" calculation
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: barbershop.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  // Inactive cutoff: 45 days ago
  const [y, m, d] = today.split('-').map(Number)
  const cutoffDt = new Date(Date.UTC(y, m - 1, d))
  cutoffDt.setUTCDate(cutoffDt.getUTCDate() - 45)
  const cutoff = cutoffDt.toISOString().slice(0, 10)

  const customers = await prisma.customer.findMany({
    where: { barbershopId: barbershop.id },
    include: {
      appointments: {
        include: {
          service: { select: { name: true, priceCents: true } },
          professional: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  const rows: CustomerRow[] = customers.map(c => {
    const nonCancelled = c.appointments.filter(a => a.status !== 'CANCELLED')
    const completed = c.appointments.filter(a => a.status === 'COMPLETED')

    // Last non-cancelled appointment date
    const lastVisit = nonCancelled.length > 0 ? nonCancelled[0].date : null

    // Total spent = sum of priceCents over COMPLETED appointments
    const totalSpentCents = completed.reduce((s, a) => s + a.service.priceCents, 0)

    // No-show count
    const noShowCount = c.appointments.filter(a => a.status === 'NO_SHOW').length

    // Inactive: no appointment in 45+ days (comparing against cutoff date)
    const isInactive = !lastVisit || lastVisit < cutoff

    // History (all appointments, most recent first)
    const history = c.appointments.map(a => ({
      id: a.id,
      date: a.date,
      startTime: a.startTime,
      serviceName: a.service.name,
      professionalName: a.professional.name,
      status: a.status,
    }))

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      cpf: c.cpf,
      notes: c.notes,
      lastVisit,
      totalSpentCents,
      noShowCount,
      isInactive,
      history,
    }
  })

  return <ClientesClient customers={rows} />
}
