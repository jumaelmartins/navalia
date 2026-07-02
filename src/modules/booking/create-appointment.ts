import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { AppointmentSource, Result } from './types'
import { addMinutes, computeSlots } from './slots'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derives weekday (0=Sun … 6=Sat) from a "YYYY-MM-DD" string without
 *  any timezone shifting: parse as UTC midnight and call getUTCDay(). */
function dateToWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Returns "YYYY-MM-DD" for the current instant in the given IANA timezone. */
function shopLocalDateString(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Returns "HH:mm" for the current instant in the given IANA timezone. */
function shopLocalTimeHHmm(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const rawHour = parts.find(p => p.type === 'hour')?.value ?? '00'
  const rawMin = parts.find(p => p.type === 'minute')?.value ?? '00'
  // Some engines return "24" for midnight; normalise to "00"
  const h = rawHour === '24' ? 0 : parseInt(rawHour, 10)
  const m = parseInt(rawMin, 10)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Rounds an "HH:mm" time UP to the next 5-minute boundary. */
function roundUpTo5Min(hhmm: string): string {
  const colon = hhmm.indexOf(':')
  const total = parseInt(hhmm.slice(0, colon), 10) * 60 + parseInt(hhmm.slice(colon + 1), 10)
  const rounded = Math.ceil(total / 5) * 5
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

/**
 * Normalises a phone to E.164-like digits.
 * BR heuristic: 10–11 raw digits → prefix '55'.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return '55' + digits
  return digits
}

function isSerializationError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
}

type BizHoursMap = Record<string, { start: string; end: string } | null>

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------

export async function getAvailableSlots(args: {
  tenantId: string
  serviceId: string
  professionalId: string | null
  date: string
}): Promise<Result<{ professionalId: string; slots: string[] }[]>> {
  // 1. Validate service belongs to tenant and is active
  const service = await prisma.service.findFirst({
    where: { id: args.serviceId, barbershopId: args.tenantId, isActive: true },
    select: { durationMin: true },
  })
  if (!service) return { ok: false, error: 'INVALID_SERVICE' }

  // 2. Load barbershop (businessHours + timezone)
  const shop = await prisma.barbershop.findUnique({
    where: { id: args.tenantId },
    select: { businessHours: true, timezone: true },
  })
  if (!shop) return { ok: false, error: 'INVALID_SERVICE' }

  // 3. Eligible professionals: the requested one or ALL active + linked
  const profLinks = await prisma.professionalService.findMany({
    where: {
      serviceId: args.serviceId,
      ...(args.professionalId ? { professionalId: args.professionalId } : {}),
      professional: { isActive: true, barbershopId: args.tenantId },
    },
    select: { professionalId: true },
  })

  if (args.professionalId !== null && profLinks.length === 0) {
    return { ok: false, error: 'INVALID_PROFESSIONAL' }
  }

  // 4. Weekday and business hours for this date
  const weekday = dateToWeekday(args.date)
  const bh = (shop.businessHours as BizHoursMap)[String(weekday)] ?? null

  // 5. minStart only when the date is today in the shop's timezone
  const shopDate = shopLocalDateString(shop.timezone)
  let minStart: string | undefined
  if (args.date === shopDate) {
    minStart = roundUpTo5Min(shopLocalTimeHHmm(shop.timezone))
  }

  // 6. Per-professional parallel fetch + slot computation
  const data = await Promise.all(
    profLinks.map(async ({ professionalId }) => {
      const [rules, blocks, appointments] = await Promise.all([
        prisma.availabilityRule.findMany({
          where: { professionalId, weekday },
          select: { startTime: true, endTime: true },
        }),
        prisma.scheduleBlock.findMany({
          where: { professionalId, date: args.date },
          select: { startTime: true, endTime: true },
        }),
        prisma.appointment.findMany({
          where: {
            professionalId,
            date: args.date,
            status: { in: ['PENDING', 'CONFIRMED'] },
          },
          select: { startTime: true, endTime: true },
        }),
      ])

      const slots = computeSlots({
        businessHours: bh,
        availabilityRules: rules.map(r => ({ start: r.startTime, end: r.endTime })),
        blocks: blocks.map(b => ({ start: b.startTime, end: b.endTime })),
        appointments: appointments.map(a => ({ start: a.startTime, end: a.endTime })),
        durationMin: service.durationMin,
        minStart,
      })

      return { professionalId, slots }
    }),
  )

  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// createAppointment
// ---------------------------------------------------------------------------

export async function createAppointment(args: {
  tenantId: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
  source: AppointmentSource
}): Promise<
  Result<{
    appointmentId: string
    endTime: string
    professionalName: string
    serviceName: string
  }>
> {
  const phone = normalizePhone(args.customer.phone)

  const runTx = async () =>
    prisma.$transaction(
      async tx => {
        // --- 1. Validate service ---
        const service = await tx.service.findFirst({
          where: { id: args.serviceId, barbershopId: args.tenantId, isActive: true },
          select: { durationMin: true, name: true },
        })
        if (!service) return { ok: false as const, error: 'INVALID_SERVICE' as const }

        // --- 2. Validate professional (active + linked + belongs to tenant) ---
        const profLink = await tx.professionalService.findFirst({
          where: {
            professionalId: args.professionalId,
            serviceId: args.serviceId,
            professional: { isActive: true, barbershopId: args.tenantId },
          },
        })
        if (!profLink) return { ok: false as const, error: 'INVALID_PROFESSIONAL' as const }

        const professional = await tx.professional.findUnique({
          where: { id: args.professionalId },
          select: { name: true },
        })

        // --- 3. Shop business hours ---
        const shop = await tx.barbershop.findUnique({
          where: { id: args.tenantId },
          select: { businessHours: true },
        })
        if (!shop) return { ok: false as const, error: 'INVALID_SERVICE' as const }

        const weekday = dateToWeekday(args.date)
        const bh = (shop.businessHours as BizHoursMap)[String(weekday)] ?? null

        // --- 4. Fresh availability inside the transaction ---
        const [rules, blocks, existingAppts] = await Promise.all([
          tx.availabilityRule.findMany({
            where: { professionalId: args.professionalId, weekday },
            select: { startTime: true, endTime: true },
          }),
          tx.scheduleBlock.findMany({
            where: { professionalId: args.professionalId, date: args.date },
            select: { startTime: true, endTime: true },
          }),
          tx.appointment.findMany({
            where: {
              professionalId: args.professionalId,
              date: args.date,
              status: { in: ['PENDING', 'CONFIRMED'] },
            },
            select: { startTime: true, endTime: true },
          }),
        ])

        const rulesInput = rules.map(r => ({ start: r.startTime, end: r.endTime }))
        const blocksInput = blocks.map(b => ({ start: b.startTime, end: b.endTime }))
        const apptsInput = existingAppts.map(a => ({ start: a.startTime, end: a.endTime }))

        // Structural check (blocks only, no appointments) → OUTSIDE_AVAILABILITY
        const slotsNoAppts = computeSlots({
          businessHours: bh,
          availabilityRules: rulesInput,
          blocks: blocksInput,
          appointments: [],
          durationMin: service.durationMin,
        })
        if (!slotsNoAppts.includes(args.startTime)) {
          return { ok: false as const, error: 'OUTSIDE_AVAILABILITY' as const }
        }

        // Full check (with appointments) → SLOT_TAKEN when appointments collide
        const slotsWithAppts = computeSlots({
          businessHours: bh,
          availabilityRules: rulesInput,
          blocks: blocksInput,
          appointments: apptsInput,
          durationMin: service.durationMin,
        })
        if (!slotsWithAppts.includes(args.startTime)) {
          return { ok: false as const, error: 'SLOT_TAKEN' as const }
        }

        // --- 5. Upsert customer (barbershopId + normalised phone) ---
        const customer = await tx.customer.upsert({
          where: { barbershopId_phone: { barbershopId: args.tenantId, phone } },
          create: {
            barbershopId: args.tenantId,
            name: args.customer.name,
            phone,
            email: args.customer.email,
          },
          update: { name: args.customer.name },
        })

        // --- 6. Create appointment (always CONFIRMED) ---
        const endTime = addMinutes(args.startTime, service.durationMin)
        const appointment = await tx.appointment.create({
          data: {
            barbershopId: args.tenantId,
            customerId: customer.id,
            professionalId: args.professionalId,
            serviceId: args.serviceId,
            date: args.date,
            startTime: args.startTime,
            endTime,
            status: 'CONFIRMED',
            source: args.source,
          },
        })

        // --- 7. Audit log ---
        await tx.auditLog.create({
          data: {
            barbershopId: args.tenantId,
            action: 'APPOINTMENT_CREATED',
            entity: 'Appointment',
            entityId: appointment.id,
            payload: {
              source: args.source,
              professionalId: args.professionalId,
              serviceId: args.serviceId,
              date: args.date,
              startTime: args.startTime,
            },
          },
        })

        return {
          ok: true as const,
          data: {
            appointmentId: appointment.id,
            endTime,
            professionalName: professional?.name ?? '',
            serviceName: service.name,
          },
        }
      },
      { isolationLevel: 'Serializable' },
    )

  try {
    return await runTx()
  } catch (err) {
    if (isSerializationError(err)) {
      // One retry on PostgreSQL serialization failure
      return await runTx()
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------

export async function cancelAppointment(args: {
  tenantId: string
  appointmentId: string
  by: string
}): Promise<Result<Record<string, never>>> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: args.appointmentId, barbershopId: args.tenantId },
    select: { id: true, status: true },
  })

  // Not found → treat as already effectively cancelled (idempotent)
  if (!appointment) return { ok: true, data: {} as Record<string, never> }

  // Already cancelled → idempotent ok
  if (appointment.status === 'CANCELLED') return { ok: true, data: {} as Record<string, never> }

  await prisma.$transaction(async tx => {
    await tx.appointment.update({
      where: { id: args.appointmentId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        barbershopId: args.tenantId,
        action: 'APPOINTMENT_CANCELLED',
        entity: 'Appointment',
        entityId: args.appointmentId,
        payload: { by: args.by },
      },
    })
  })

  return { ok: true, data: {} as Record<string, never> }
}
