import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { AgendaClient } from './_components/AgendaClient'

export default async function AgendaPage() {
  const { barbershop } = await requireOnboarded()

  // Current date in shop timezone
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: barbershop.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  // Load professionals and services for dialogs
  const [professionals, services] = await Promise.all([
    prisma.professional.findMany({
      where: { barbershopId: barbershop.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.service.findMany({
      where: { barbershopId: barbershop.id },
      select: { id: true, name: true, durationMin: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  const businessHours = barbershop.businessHours as Record<
    string,
    { start: string; end: string } | null
  >

  return (
    <AgendaClient
      initialDate={today}
      professionals={professionals}
      services={services}
      businessHours={businessHours}
    />
  )
}
