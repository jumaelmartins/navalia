import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Pure date helpers — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Returns "YYYY-MM-DD" for Monday of the week containing `date`.
 * Computation is in UTC to avoid DST shifts.
 */
export function getWeekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMon = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + daysToMon)
  return dt.toISOString().slice(0, 10)
}

/**
 * Returns "YYYY-MM-DD" for Sunday of the week containing `date`.
 */
export function getWeekEnd(date: string): string {
  const start = getWeekStart(date)
  const [y, m, d] = start.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 6)
  return dt.toISOString().slice(0, 10)
}

/**
 * Returns "YYYY-MM-DD" for the date `daysAgo` days before `date`.
 */
export function subtractDays(date: string, daysAgo: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - daysAgo)
  return dt.toISOString().slice(0, 10)
}

/**
 * Adds `days` to `date` and returns "YYYY-MM-DD".
 */
export function addDays(date: string, days: number): string {
  return subtractDays(date, -days)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toMin(hhmm: string): number {
  const colon = hhmm.indexOf(':')
  return parseInt(hhmm.slice(0, colon), 10) * 60 + parseInt(hhmm.slice(colon + 1), 10)
}

function shopLocalDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type BizHoursMap = Record<string, { start: string; end: string } | null>

// ---------------------------------------------------------------------------
// getDashboardKpis
// ---------------------------------------------------------------------------

export type DashboardKpis = {
  todayCount: number
  weekCount: number
  todayRevenueCents: number
  weekRevenueCents: number
  occupancyPct: number
  noShowRate: number
  topServices: { name: string; count: number }[]
}

export async function getDashboardKpis(tenantId: string): Promise<DashboardKpis> {
  const shop = await prisma.barbershop.findUnique({
    where: { id: tenantId },
    select: { timezone: true, businessHours: true },
  })
  if (!shop) throw new Error('Barbershop not found')

  const bh = shop.businessHours as BizHoursMap
  const today = shopLocalDate(shop.timezone)
  const weekStart = getWeekStart(today)
  const weekEnd = getWeekEnd(today)
  const last30Start = subtractDays(today, 29) // inclusive: 30 days

  const [todayAppts, weekAppts, last30Appts, professionals] = await Promise.all([
    // Today's CONFIRMED+COMPLETED appointments
    prisma.appointment.findMany({
      where: {
        barbershopId: tenantId,
        date: today,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      select: { service: { select: { priceCents: true } } },
    }),
    // This week's all non-cancelled appointments (for occupancy + counts)
    prisma.appointment.findMany({
      where: {
        barbershopId: tenantId,
        date: { gte: weekStart, lte: weekEnd },
        status: { notIn: ['CANCELLED'] },
      },
      select: {
        startTime: true,
        endTime: true,
        status: true,
        service: { select: { priceCents: true } },
      },
    }),
    // Last 30 days for no-show rate + top services (exclude CANCELLED)
    prisma.appointment.findMany({
      where: {
        barbershopId: tenantId,
        date: { gte: last30Start, lte: today },
        status: { not: 'CANCELLED' },
      },
      select: { status: true, service: { select: { name: true } } },
    }),
    // Active professionals with their availability rules
    prisma.professional.findMany({
      where: { barbershopId: tenantId, isActive: true },
      include: { availabilityRules: true },
    }),
  ])

  // ── Today KPIs ──
  const todayCount = todayAppts.length
  const todayRevenueCents = todayAppts.reduce((s, a) => s + a.service.priceCents, 0)

  // ── Week KPIs (CONFIRMED+COMPLETED for revenue, all non-cancelled for count) ──
  const weekRevAppts = weekAppts.filter(
    a => a.status === 'CONFIRMED' || a.status === 'COMPLETED',
  )
  const weekCount = weekAppts.filter(
    a => a.status !== 'CANCELLED',
  ).length
  const weekRevenueCents = weekRevAppts.reduce((s, a) => s + a.service.priceCents, 0)

  // ── Occupancy ──
  let availableMin = 0
  for (let i = 0; i < 7; i++) {
    // Monday=1, Tuesday=2, ..., Saturday=6, Sunday=0
    const weekday = (i + 1) % 7
    const dayBH = bh[String(weekday)]
    if (!dayBH) continue
    const bhStart = toMin(dayBH.start)
    const bhEnd = toMin(dayBH.end)

    for (const prof of professionals) {
      const rules = prof.availabilityRules.filter(r => r.weekday === weekday)
      for (const rule of rules) {
        const ruleStart = toMin(rule.startTime)
        const ruleEnd = toMin(rule.endTime)
        const start = Math.max(bhStart, ruleStart)
        const end = Math.min(bhEnd, ruleEnd)
        if (end > start) availableMin += end - start
      }
    }
  }

  const bookedMin = weekAppts.reduce(
    (s, a) => s + toMin(a.endTime) - toMin(a.startTime),
    0,
  )
  const occupancyPct = availableMin > 0 ? Math.round((bookedMin / availableMin) * 100) : 0

  // ── No-show rate (last 30 days) ──
  const completedCount = last30Appts.filter(a => a.status === 'COMPLETED').length
  const noShowCount = last30Appts.filter(a => a.status === 'NO_SHOW').length
  const noShowTotal = completedCount + noShowCount
  const noShowRate = noShowTotal > 0 ? Math.round((noShowCount / noShowTotal) * 100) : 0

  // ── Top 3 services (last 30 days) ──
  const svcMap = new Map<string, number>()
  for (const appt of last30Appts) {
    const name = appt.service.name
    svcMap.set(name, (svcMap.get(name) ?? 0) + 1)
  }
  const topServices = Array.from(svcMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }))

  return {
    todayCount,
    weekCount,
    todayRevenueCents,
    weekRevenueCents,
    occupancyPct,
    noShowRate,
    topServices,
  }
}
