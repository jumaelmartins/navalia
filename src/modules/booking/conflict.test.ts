import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAppointment, cancelAppointment } from './create-appointment'

// Fixed future Monday (weekday 1) — stable test anchor
const TEST_DATE = '2026-07-06'

let barbershopId: string
let serviceId: string
let inactiveServiceId: string
let professionalId: string
let appt10Id: string

describe.skipIf(!process.env.DATABASE_URL)('booking conflict (integration)', () => {
  beforeAll(async () => {
    // Seed throwaway barbershop — Mon-Sat 08:00-18:00, Sun closed
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Booking Shop',
        slug: `test-booking-${Date.now()}`,
        businessHours: {
          '0': null,
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
      data: { barbershopId, name: 'Haircut', priceCents: 3000, durationMin: 30, isActive: true },
    })
    serviceId = service.id

    const inactiveService = await prisma.service.create({
      data: { barbershopId, name: 'Inactive Svc', priceCents: 0, durationMin: 30, isActive: false },
    })
    inactiveServiceId = inactiveService.id

    const professional = await prisma.professional.create({
      data: { barbershopId, name: 'Test Barber', isActive: true },
    })
    professionalId = professional.id

    await prisma.professionalService.create({ data: { professionalId, serviceId } })

    // Availability rule: Monday (weekday 1) 09:00–17:00
    await prisma.availabilityRule.create({
      data: {
        barbershopId,
        professionalId,
        weekday: 1,
        startTime: '09:00',
        endTime: '17:00',
      },
    })
  })

  afterAll(async () => {
    // Delete in FK order so constraints don't fire
    await prisma.auditLog.deleteMany({ where: { barbershopId } })
    await prisma.appointment.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.scheduleBlock.deleteMany({ where: { barbershopId } })
    await prisma.availabilityRule.deleteMany({ where: { barbershopId } })
    await prisma.professionalService.deleteMany({ where: { professionalId } })
    await prisma.professional.deleteMany({ where: { barbershopId } })
    await prisma.service.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  const customer = { name: 'João Silva', phone: '11987654321' }

  const base = (startTime: string) => ({
    tenantId: barbershopId,
    serviceId,
    professionalId,
    date: TEST_DATE,
    startTime,
    customer,
    source: 'ADMIN' as const,
  })

  it('(a) creates a valid appointment at 10:00', async () => {
    const result = await createAppointment(base('10:00'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      appt10Id = result.data.appointmentId
      expect(result.data.endTime).toBe('10:30')
      expect(result.data.serviceName).toBe('Haircut')
      expect(result.data.professionalName).toBe('Test Barber')
    }
  })

  it('(b) rejects 10:15 for same professional → SLOT_TAKEN', async () => {
    // 10:15–10:45 overlaps existing 10:00–10:30
    const result = await createAppointment(base('10:15'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('SLOT_TAKEN')
  })

  it('(c) allows 10:30 immediately after 10:00–10:30 (touching edge)', async () => {
    const result = await createAppointment(base('10:30'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.endTime).toBe('11:00')
  })

  it('(d) cancelling 10:00 frees the slot for re-booking', async () => {
    const cancelResult = await cancelAppointment({
      tenantId: barbershopId,
      appointmentId: appt10Id,
      by: 'test-runner',
    })
    expect(cancelResult.ok).toBe(true)

    // Idempotent second cancel
    const cancelAgain = await cancelAppointment({
      tenantId: barbershopId,
      appointmentId: appt10Id,
      by: 'test-runner',
    })
    expect(cancelAgain.ok).toBe(true)

    // Re-book 10:00 — should now succeed
    const result = await createAppointment(base('10:00'))
    expect(result.ok).toBe(true)
  })

  it('(e) inactive service → INVALID_SERVICE', async () => {
    const result = await createAppointment({ ...base('09:00'), serviceId: inactiveServiceId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_SERVICE')
  })

  it('(f) two concurrent creates at the same slot → exactly one ok, one SLOT_TAKEN', async () => {
    const [r1, r2] = await Promise.all([
      createAppointment(base('11:00')),
      createAppointment(base('11:00')),
    ])
    const successes = [r1, r2].filter(r => r.ok)
    const failures = [r1, r2].filter(r => !r.ok)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    if (!failures[0]!.ok) expect(failures[0]!.error).toBe('SLOT_TAKEN')
  })

  it('(g) schedule block 12:00–13:00 rejects 12:15 create → OUTSIDE_AVAILABILITY', async () => {
    await prisma.scheduleBlock.create({
      data: {
        barbershopId,
        professionalId,
        date: TEST_DATE,
        startTime: '12:00',
        endTime: '13:00',
      },
    })

    // 12:15–12:45 overlaps the block
    const result = await createAppointment(base('12:15'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('OUTSIDE_AVAILABILITY')
  })
})
