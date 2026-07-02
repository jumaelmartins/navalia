'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { getAvailableSlots, createAppointment, computeMinStart } from './create-appointment'
import { addMinutes, computeSlots, isCanonicalDate } from './slots'
import { BOOKING_ERROR_PT_BR } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function dateToWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

type BizHoursMap = Record<string, { start: string; end: string } | null>

/** Returns true for errors that warrant a single full-transaction retry. */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  return err.code === 'P2034' || err.code === 'P2002'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgendaAppointment = {
  id: string
  date: string
  startTime: string
  endTime: string
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
  source: string
  customer: { id: string; name: string; phone: string }
  professional: { id: string; name: string }
  service: { id: string; name: string; priceCents: number; durationMin: number }
}

export type AgendaBlock = {
  id: string
  professionalId: string
  professionalName: string
  date: string
  startTime: string
  endTime: string
  reason: string | null
}

export type AgendaData = {
  appointments: AgendaAppointment[]
  blocks: AgendaBlock[]
}

export type WeekAgendaDay = {
  date: string
  count: number
  items: Array<{
    id: string
    startTime: string
    customerName: string
    serviceName: string
    professionalName: string
    status: string
  }>
}

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// getAgenda — returns appointments + blocks for a day
// ---------------------------------------------------------------------------

export async function getAgenda(args: {
  date: string
  professionalId?: string
}): Promise<AgendaData> {
  const { barbershop } = await requireOnboarded()

  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershop.id,
        date: args.date,
        ...(args.professionalId ? { professionalId: args.professionalId } : {}),
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        professional: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, priceCents: true, durationMin: true } },
      },
      orderBy: [{ startTime: 'asc' }, { professional: { name: 'asc' } }],
    }),
    prisma.scheduleBlock.findMany({
      where: {
        barbershopId: barbershop.id,
        date: args.date,
        ...(args.professionalId ? { professionalId: args.professionalId } : {}),
      },
      include: { professional: { select: { name: true } } },
      orderBy: { startTime: 'asc' },
    }),
  ])

  return {
    appointments: appointments.map(a => ({
      id: a.id,
      date: a.date,
      startTime: a.startTime,
      endTime: a.endTime,
      status: a.status as AgendaAppointment['status'],
      source: a.source,
      customer: a.customer,
      professional: a.professional,
      service: a.service,
    })),
    blocks: blocks.map(b => ({
      id: b.id,
      professionalId: b.professionalId,
      professionalName: b.professional.name,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      reason: b.reason,
    })),
  }
}

// ---------------------------------------------------------------------------
// getWeekAgenda — compact per-day counts for week view
// ---------------------------------------------------------------------------

export async function getWeekAgenda(args: {
  weekStart: string // "YYYY-MM-DD" Monday
  professionalId?: string
}): Promise<WeekAgendaDay[]> {
  const { barbershop } = await requireOnboarded()

  // Generate the 7 dates from weekStart
  const dates: string[] = []
  const [y, m, d] = args.weekStart.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base)
    dt.setUTCDate(base.getUTCDate() + i)
    dates.push(dt.toISOString().slice(0, 10))
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: barbershop.id,
      date: { in: dates },
      ...(args.professionalId ? { professionalId: args.professionalId } : {}),
      status: { notIn: ['CANCELLED'] },
    },
    include: {
      customer: { select: { name: true } },
      service: { select: { name: true } },
      professional: { select: { name: true } },
    },
    orderBy: { startTime: 'asc' },
  })

  return dates.map(date => {
    const dayAppts = appointments.filter(a => a.date === date)
    return {
      date,
      count: dayAppts.length,
      items: dayAppts.slice(0, 5).map(a => ({
        id: a.id,
        startTime: a.startTime,
        customerName: a.customer.name,
        serviceName: a.service.name,
        professionalName: a.professional.name,
        status: a.status,
      })),
    }
  })
}

// ---------------------------------------------------------------------------
// completeAppointment — CONFIRMED → COMPLETED
// ---------------------------------------------------------------------------

export async function completeAppointment(
  appointmentId: string,
): Promise<ActionResult> {
  const { barbershop, user } = await requireOnboarded()

  const { count } = await prisma.appointment.updateMany({
    where: {
      id: appointmentId,
      barbershopId: barbershop.id,
      status: 'CONFIRMED',
    },
    data: { status: 'COMPLETED' },
  })

  if (count === 0) {
    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId: barbershop.id },
      select: { status: true },
    })
    if (!existing) return { ok: false, error: 'Agendamento não encontrado.' }
    if (existing.status === 'COMPLETED') return { ok: true } // idempotent
    return {
      ok: false,
      error: `Não é possível concluir: status atual é ${existing.status}.`,
    }
  }

  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId: user.id,
      action: 'APPOINTMENT_COMPLETED',
      entity: 'Appointment',
      entityId: appointmentId,
      payload: {},
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// markNoShow — CONFIRMED → NO_SHOW
// ---------------------------------------------------------------------------

export async function markNoShow(
  appointmentId: string,
): Promise<ActionResult> {
  const { barbershop, user } = await requireOnboarded()

  const { count } = await prisma.appointment.updateMany({
    where: {
      id: appointmentId,
      barbershopId: barbershop.id,
      status: 'CONFIRMED',
    },
    data: { status: 'NO_SHOW' },
  })

  if (count === 0) {
    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId: barbershop.id },
      select: { status: true },
    })
    if (!existing) return { ok: false, error: 'Agendamento não encontrado.' }
    if (existing.status === 'NO_SHOW') return { ok: true }
    return {
      ok: false,
      error: `Não é possível marcar não compareceu: status atual é ${existing.status}.`,
    }
  }

  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId: user.id,
      action: 'APPOINTMENT_NO_SHOW',
      entity: 'Appointment',
      entityId: appointmentId,
      payload: {},
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// cancelAppointmentAdmin — delegates to shared cancelAppointment
// ---------------------------------------------------------------------------

export async function cancelAppointmentAdmin(
  appointmentId: string,
): Promise<ActionResult> {
  const { barbershop, user } = await requireOnboarded()

  // Use atomic updateMany pattern to avoid find-then-update race
  const { count } = await prisma.appointment.updateMany({
    where: {
      id: appointmentId,
      barbershopId: barbershop.id,
      status: { not: 'CANCELLED' },
    },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })

  if (count === 0) {
    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId: barbershop.id },
      select: { status: true },
    })
    if (!existing) return { ok: false, error: 'Agendamento não encontrado.' }
    if (existing.status === 'CANCELLED') return { ok: true }
    return { ok: false, error: 'Não foi possível cancelar o agendamento.' }
  }

  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId: user.id,
      action: 'APPOINTMENT_CANCELLED',
      entity: 'Appointment',
      entityId: appointmentId,
      payload: { by: user.id, via: 'ADMIN' },
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// rescheduleAppointment — validate + update inside a Serializable transaction
// ---------------------------------------------------------------------------

export async function rescheduleAppointment(args: {
  id: string
  newDate: string
  newStartTime: string
}): Promise<ActionResult> {
  const { barbershop, user } = await requireOnboarded()

  // Validate canonical date before entering the transaction (C1)
  if (!isCanonicalDate(args.newDate)) {
    return { ok: false, error: 'Horário indisponível. Escolha outro horário.' }
  }

  const runTx = async () =>
    prisma.$transaction(
      async tx => {
        // 1. Load appointment (tenant-verified + reschedulable status)
        const appt = await tx.appointment.findFirst({
          where: {
            id: args.id,
            barbershopId: barbershop.id,
            status: { in: ['PENDING', 'CONFIRMED'] },
          },
          include: { service: { select: { durationMin: true } } },
        })
        if (!appt) {
          return {
            ok: false as const,
            error: 'Agendamento não encontrado ou não pode ser remarcado no status atual.',
          }
        }

        // 2. Shop business hours + timezone for slot computation
        const shop = await tx.barbershop.findUnique({
          where: { id: barbershop.id },
          select: { businessHours: true, timezone: true },
        })
        if (!shop) return { ok: false as const, error: 'Barbearia não encontrada.' }

        const weekday = dateToWeekday(args.newDate)
        const bh = (shop.businessHours as BizHoursMap)[String(weekday)] ?? null
        const minStart = computeMinStart(args.newDate, shop.timezone)

        // 3. Fresh availability for the new date (excluding this appointment's own occupancy)
        const [rules, blocks, appointments] = await Promise.all([
          tx.availabilityRule.findMany({
            where: { barbershopId: barbershop.id, professionalId: appt.professionalId, weekday },
            select: { startTime: true, endTime: true },
          }),
          tx.scheduleBlock.findMany({
            where: { barbershopId: barbershop.id, professionalId: appt.professionalId, date: args.newDate },
            select: { startTime: true, endTime: true },
          }),
          tx.appointment.findMany({
            where: {
              barbershopId: barbershop.id,
              professionalId: appt.professionalId,
              date: args.newDate,
              status: { in: ['PENDING', 'CONFIRMED'] },
              id: { not: args.id },
            },
            select: { startTime: true, endTime: true },
          }),
        ])

        // 4. Compute slots and validate the requested start time
        const slots = computeSlots({
          businessHours: bh,
          availabilityRules: rules.map(r => ({ start: r.startTime, end: r.endTime })),
          blocks: blocks.map(b => ({ start: b.startTime, end: b.endTime })),
          appointments: appointments.map(a => ({ start: a.startTime, end: a.endTime })),
          durationMin: appt.service.durationMin,
          minStart,
        })

        if (!slots.includes(args.newStartTime)) {
          return { ok: false as const, error: 'Horário indisponível. Escolha outro horário.' }
        }

        // 5. Update appointment + AuditLog inside the transaction
        const newEndTime = addMinutes(args.newStartTime, appt.service.durationMin)

        await tx.appointment.update({
          where: { id: args.id },
          data: {
            date: args.newDate,
            startTime: args.newStartTime,
            endTime: newEndTime,
          },
        })

        await tx.auditLog.create({
          data: {
            barbershopId: barbershop.id,
            userId: user.id,
            action: 'APPOINTMENT_RESCHEDULED',
            entity: 'Appointment',
            entityId: args.id,
            payload: {
              previousDate: appt.date,
              previousStartTime: appt.startTime,
              newDate: args.newDate,
              newStartTime: args.newStartTime,
              newEndTime,
            },
          },
        })

        return { ok: true as const }
      },
      { isolationLevel: 'Serializable' },
    )

  try {
    const result = await runTx()
    if (result.ok) revalidatePath('/dashboard/agenda')
    return result
  } catch (err) {
    if (isRetryableError(err)) {
      // One retry: covers PostgreSQL serialization failures (P2034) and
      // concurrent unique-constraint races (P2002).
      const result = await runTx()
      if (result.ok) revalidatePath('/dashboard/agenda')
      return result
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// createAppointmentAdmin — creates via booking engine with source ADMIN
// ---------------------------------------------------------------------------

export async function createAppointmentAdmin(args: {
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
}): Promise<ActionResult<{ appointmentId: string }>> {
  const { barbershop } = await requireOnboarded()

  try {
    const result = await createAppointment({
      tenantId: barbershop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
      startTime: args.startTime,
      customer: args.customer,
      source: 'ADMIN',
    })

    if (!result.ok) {
      return { ok: false, error: BOOKING_ERROR_PT_BR[result.error] ?? result.error }
    }

    revalidatePath('/dashboard/agenda')
    revalidatePath('/dashboard')
    return { ok: true, data: { appointmentId: result.data.appointmentId } }
  } catch (err) {
    console.error('[createAppointmentAdmin]', err)
    return { ok: false, error: 'Erro ao criar agendamento. Tente novamente.' }
  }
}

// ---------------------------------------------------------------------------
// getAdminSlots — wrapper for admin slot lookup
// ---------------------------------------------------------------------------

export async function getAdminSlots(args: {
  serviceId: string
  professionalId: string
  date: string
  excludeAppointmentId?: string
}): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  try {
    const { barbershop } = await requireOnboarded()

    const result = await getAvailableSlots({
      tenantId: barbershop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
      excludeAppointmentId: args.excludeAppointmentId,
    })

    if (!result.ok) {
      return { ok: false, error: 'Não foi possível carregar os horários.' }
    }

    const profSlots = result.data.find(p => p.professionalId === args.professionalId)
    return { ok: true, slots: profSlots?.slots ?? [] }
  } catch (err) {
    console.error('[getAdminSlots]', err)
    return { ok: false, error: 'Erro ao carregar horários. Tente novamente.' }
  }
}
