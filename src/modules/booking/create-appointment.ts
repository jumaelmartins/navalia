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
 * Returns the earliest valid startTime (rounded-up-5min from now) when date
 * is today in the shop's timezone, or undefined for future/past dates.
 * Shared by getAvailableSlots and the createAppointment transaction.
 */
function computeMinStart(date: string, timezone: string): string | undefined {
  const shopDate = shopLocalDateString(timezone)
  if (date !== shopDate) return undefined
  return roundUpTo5Min(shopLocalTimeHHmm(timezone))
}

/**
 * Normalises a phone to E.164-like digits.
 * BR heuristic: 10–11 raw digits → prefix '55'.
 * Returns null when fewer than 10 digits remain after stripping non-digits.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return null
  if (digits.length === 10 || digits.length === 11) return '55' + digits
  return digits
}

/** Returns true for errors that warrant a single full-transaction retry. */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  // P2034: serialization / snapshot-isolation failure
  if (err.code === 'P2034') return true
  // P2002: unique constraint race — two concurrent new-customer upserts for the
  //         same (barbershopId, phone) pair; retry takes the update path.
  if (err.code === 'P2002') return true
  return false
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
  /** Optional: exclude this appointment's own occupancy (used during reschedule) */
  excludeAppointmentId?: string
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
  const minStart = computeMinStart(args.date, shop.timezone)

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
            ...(args.excludeAppointmentId ? { id: { not: args.excludeAppointmentId } } : {}),
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
  // Fix 3: Validate phone before entering the transaction
  const phone = normalizePhone(args.customer.phone)
  if (phone === null) return { ok: false, error: 'INVALID_PHONE' }

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

        // --- 3. Shop business hours + timezone ---
        const shop = await tx.barbershop.findUnique({
          where: { id: args.tenantId },
          select: { businessHours: true, timezone: true },
        })
        if (!shop) return { ok: false as const, error: 'INVALID_SERVICE' as const }

        const weekday = dateToWeekday(args.date)
        const bh = (shop.businessHours as BizHoursMap)[String(weekday)] ?? null

        // Fix 1: Enforce minStart inside the transaction so AI/WhatsApp channels
        // cannot book a past-today slot. computeMinStart is deterministic for a
        // given clock instant; calling it inside the tx is fine.
        const minStart = computeMinStart(args.date, shop.timezone)

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
        // minStart is applied here so past-today slots are caught immediately.
        const slotsNoAppts = computeSlots({
          businessHours: bh,
          availabilityRules: rulesInput,
          blocks: blocksInput,
          appointments: [],
          durationMin: service.durationMin,
          minStart,
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
          minStart,
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
    if (isRetryableError(err)) {
      // One retry: covers both PostgreSQL serialization failures (P2034) and
      // concurrent new-customer unique-constraint races (P2002).
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
  // Fix 4: Atomic cancel — single updateMany avoids the find-then-update race
  // where two concurrent cancels could both read status=CONFIRMED and both write.
  const { count } = await prisma.appointment.updateMany({
    where: {
      id: args.appointmentId,
      barbershopId: args.tenantId,
      status: { not: 'CANCELLED' },
    },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })

  if (count === 1) {
    // Exactly one row updated → write audit log and return success.
    await prisma.auditLog.create({
      data: {
        barbershopId: args.tenantId,
        action: 'APPOINTMENT_CANCELLED',
        entity: 'Appointment',
        entityId: args.appointmentId,
        payload: { by: args.by },
      },
    })
    return { ok: true, data: {} as Record<string, never> }
  }

  // count === 0: either already cancelled (idempotent) or appointment not found.
  const existing = await prisma.appointment.findFirst({
    where: { id: args.appointmentId, barbershopId: args.tenantId },
    select: { id: true },
  })

  if (existing) {
    // Already cancelled → idempotent success; no additional audit log.
    return { ok: true, data: {} as Record<string, never> }
  }

  // Appointment does not belong to this tenant or does not exist.
  return { ok: false, error: 'NOT_FOUND' }
}
