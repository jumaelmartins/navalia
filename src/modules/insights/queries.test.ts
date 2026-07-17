import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getWeekStart, getWeekEnd, subtractDays, addDays } from './queries'

// ---------------------------------------------------------------------------
// getWeekStart
// ---------------------------------------------------------------------------

describe('getWeekStart', () => {
  it('returns the same date when input is already Monday', () => {
    // 2024-01-01 is a Monday
    expect(getWeekStart('2024-01-01')).toBe('2024-01-01')
  })

  it('returns Monday for a Wednesday input', () => {
    // 2024-01-03 is Wednesday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-03')).toBe('2024-01-01')
  })

  it('returns the previous Monday for a Sunday input', () => {
    // 2024-01-07 is Sunday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-07')).toBe('2024-01-01')
  })

  it('handles a month boundary (Thursday straddling month)', () => {
    // 2024-02-01 is Thursday → Monday was 2024-01-29
    expect(getWeekStart('2024-02-01')).toBe('2024-01-29')
  })

  it('handles a year boundary', () => {
    // 2025-01-01 is Wednesday → Monday was 2024-12-30
    expect(getWeekStart('2025-01-01')).toBe('2024-12-30')
  })

  it('returns Monday for Saturday input', () => {
    // 2024-01-06 is Saturday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-06')).toBe('2024-01-01')
  })

  it('returns Monday for Tuesday input', () => {
    // 2024-01-02 is Tuesday → Monday was 2024-01-01
    expect(getWeekStart('2024-01-02')).toBe('2024-01-01')
  })
})

// ---------------------------------------------------------------------------
// getWeekEnd
// ---------------------------------------------------------------------------

describe('getWeekEnd', () => {
  it('returns 6 days after Monday for a Monday input', () => {
    // 2024-01-01 (Mon) → Sunday is 2024-01-07
    expect(getWeekEnd('2024-01-01')).toBe('2024-01-07')
  })

  it('returns the same Sunday when input is already Sunday', () => {
    // 2024-01-07 is Sunday → same Sunday
    expect(getWeekEnd('2024-01-07')).toBe('2024-01-07')
  })

  it('returns the correct Sunday for a mid-week date', () => {
    // 2024-01-03 is Wednesday → Sunday is 2024-01-07
    expect(getWeekEnd('2024-01-03')).toBe('2024-01-07')
  })

  it('handles a month boundary (Wednesday → Sunday crosses month)', () => {
    // 2024-01-31 is Wednesday → Monday was 2024-01-29 → Sunday is 2024-02-04
    expect(getWeekEnd('2024-01-31')).toBe('2024-02-04')
  })

  it('handles a year boundary', () => {
    // 2024-12-30 is Monday → Sunday is 2025-01-05
    expect(getWeekEnd('2024-12-30')).toBe('2025-01-05')
  })
})

// ---------------------------------------------------------------------------
// subtractDays
// ---------------------------------------------------------------------------

describe('subtractDays', () => {
  it('subtracts days within a month', () => {
    expect(subtractDays('2024-01-31', 30)).toBe('2024-01-01')
  })

  it('subtracts 1 day across a year boundary', () => {
    expect(subtractDays('2024-01-01', 1)).toBe('2023-12-31')
  })

  it('subtracts 0 days returns the same date', () => {
    expect(subtractDays('2024-06-15', 0)).toBe('2024-06-15')
  })

  it('subtracts across a month boundary', () => {
    expect(subtractDays('2024-03-01', 1)).toBe('2024-02-29') // 2024 is a leap year
  })

  it('subtracts 29 days to cover 30-day window', () => {
    // 30-day range: today=2024-01-30, start=2024-01-01
    expect(subtractDays('2024-01-30', 29)).toBe('2024-01-01')
  })
})

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe('addDays', () => {
  it('adds days within the same month', () => {
    expect(addDays('2024-01-01', 6)).toBe('2024-01-07')
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2024-01-29', 6)).toBe('2024-02-04')
  })

  it('adds 0 days returns the same date', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15')
  })

  it('adds days across a year boundary', () => {
    expect(addDays('2024-12-30', 6)).toBe('2025-01-05')
  })
})

import { prisma } from '@/lib/prisma'
import { createAppointment } from '@/modules/booking/create-appointment'
import { getDashboardKpis } from './queries'

// ---------------------------------------------------------------------------
// getDashboardKpis — revenue split (integration)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.DATABASE_URL)('getDashboardKpis revenue split', () => {
  let barbershopId: string
  let serviceId: string
  let professionalId: string
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  // Weekday derived from `today` (parsed as UTC midnight), matching
  // dateToWeekday()'s convention used inside createAppointment — avoids a
  // mismatch with `new Date().getUTCDay()` near the UTC/shop-timezone
  // day boundary.
  const todayWeekday = (() => {
    const [y, m, d] = today.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  })()
  // Business hours are 08:00-18:00 and the availability rule below spans the
  // whole day, so the bookable grid is anchored at 08:00 in 15-min steps.
  // Compute the first two non-overlapping grid slots that are safely after
  // "now" (createAppointment rejects past-today start times), so this test
  // is not time-of-day dependent.
  const nowShopMinutes = (() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bahia',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const rawH = parts.find(p => p.type === 'hour')?.value ?? '00'
    const h = rawH === '24' ? 0 : parseInt(rawH, 10)
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '00', 10)
    return h * 60 + m
  })()
  const toHHmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  // +10min buffer avoids a race with the minStart cutoff; 08:00-anchored
  // 15-min grid means rounding up to the next 15 is always grid-aligned.
  const firstSlotMin = Math.ceil((nowShopMinutes + 10) / 15) * 15
  const firstSlot = toHHmm(firstSlotMin)
  const secondSlot = toHHmm(firstSlotMin + 60) // 1h later: no overlap with the 30-min service

  beforeAll(async () => {
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Revenue Shop',
        slug: `test-revenue-${Date.now()}`,
        businessHours: {
          '0': { start: '08:00', end: '18:00' },
          '1': { start: '08:00', end: '18:00' },
          '2': { start: '08:00', end: '18:00' },
          '3': { start: '08:00', end: '18:00' },
          '4': { start: '08:00', end: '18:00' },
          '5': { start: '08:00', end: '18:00' },
          '6': { start: '08:00', end: '18:00' },
        },
        timezone: 'America/Bahia',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    barbershopId = shop.id

    const service = await prisma.service.create({
      data: { barbershopId, name: 'Corte', priceCents: 5000, durationMin: 30, isActive: true },
    })
    serviceId = service.id

    const professional = await prisma.professional.create({
      data: { barbershopId, name: 'Barbeiro Teste', isActive: true },
    })
    professionalId = professional.id
    await prisma.professionalService.create({ data: { professionalId, serviceId } })
    await prisma.availabilityRule.create({
      data: { barbershopId, professionalId, weekday: todayWeekday, startTime: '00:00', endTime: '23:59' },
    })

    const first = await createAppointment({
      tenantId: barbershopId,
      serviceId,
      professionalId,
      date: today,
      startTime: firstSlot,
      customer: { name: 'Cliente Confirmado', phone: '11987654321' },
      source: 'ADMIN',
    })
    if (!first.ok) throw new Error(`setup failed: ${first.error}`)

    const second = await createAppointment({
      tenantId: barbershopId,
      serviceId,
      professionalId,
      date: today,
      startTime: secondSlot,
      customer: { name: 'Cliente Concluido', phone: '11987654322' },
      source: 'ADMIN',
    })
    if (!second.ok) throw new Error(`setup failed: ${second.error}`)
    await prisma.appointment.update({
      where: { id: second.data.appointmentId },
      data: { status: 'COMPLETED' },
    })
  })

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { barbershopId } })
    await prisma.notification.deleteMany({ where: { barbershopId } })
    await prisma.appointment.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.availabilityRule.deleteMany({ where: { barbershopId } })
    await prisma.professionalService.deleteMany({ where: { professionalId } })
    await prisma.professional.deleteMany({ where: { barbershopId } })
    await prisma.service.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  it('counts CONFIRMED+COMPLETED as prevista but only COMPLETED as realizada', async () => {
    const kpis = await getDashboardKpis(barbershopId)
    expect(kpis.todayRevenueCents).toBe(10000) // both appointments: prevista
    expect(kpis.todayRevenueRealizedCents).toBe(5000) // only the COMPLETED one
  })
})
