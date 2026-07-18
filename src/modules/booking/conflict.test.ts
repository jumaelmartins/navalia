import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAppointment, cancelAppointment } from './create-appointment'
import { isPhoneVerified } from './verification'

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
    await prisma.notification.deleteMany({ where: { barbershopId } })
    await prisma.appointment.deleteMany({ where: { barbershopId } })
    await prisma.phoneVerification.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.scheduleBlock.deleteMany({ where: { barbershopId } })
    await prisma.availabilityRule.deleteMany({ where: { barbershopId } })
    await prisma.professionalService.deleteMany({ where: { professionalId } })
    await prisma.professional.deleteMany({ where: { barbershopId } })
    await prisma.service.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  const customer = { name: 'João Silva', cpf: '11144477735', phone: '11987654321' }

  const base = (startTime: string) => ({
    tenantId: barbershopId,
    serviceId,
    professionalId,
    date: TEST_DATE,
    startTime,
    customer,
    source: 'ADMIN' as const,
    consent: true,
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

  it('(h) past-today booking → OUTSIDE_AVAILABILITY', async () => {
    // Deterministic strategy: compute a slot on the 15-min grid that is
    // 60+ minutes in the past (shop timezone America/Bahia).
    // Skip window: before 10:00 AM shop time (no room for a 60-min-past slot
    // inside the 09:00 rule) or after 16:30 shop time (30-min duration would
    // exceed the 17:00 rule end).
    // NOTE: a narrow ~30-min skip window around 10:00 is the only flake risk.
    const shopTz = 'America/Bahia'

    const todayInShop = new Intl.DateTimeFormat('en-CA', {
      timeZone: shopTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: shopTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const rawH = timeParts.find(p => p.type === 'hour')?.value ?? '00'
    const nowH = rawH === '24' ? 0 : parseInt(rawH, 10)
    const nowM = parseInt(timeParts.find(p => p.type === 'minute')?.value ?? '00', 10)
    const nowMinutes = nowH * 60 + nowM

    // Past slot on the 15-min slot grid, at least 60 minutes ago
    const pastMinutes = Math.floor((nowMinutes - 60) / 15) * 15

    const [y, mo, d] = todayInShop.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()

    // Skip conditions (deterministic):
    //  - Sunday (weekday 0): shop closed, no businessHours entry
    //  - before 10:00 shop time: 60min back lands before 09:00 rule start
    //  - pastMinutes > 16:30: 30-min duration would breach 17:00 rule end
    if (weekday === 0 || nowMinutes < 10 * 60 || pastMinutes > 16 * 60 + 30) {
      console.log(
        `[SKIP] past-today test: weekday=${weekday} nowMin=${nowMinutes} pastMin=${pastMinutes}`,
      )
      return
    }

    const pastHH = String(Math.floor(pastMinutes / 60)).padStart(2, '0')
    const pastMM = String(pastMinutes % 60).padStart(2, '0')
    const pastSlot = `${pastHH}:${pastMM}`

    // Seed availability rule for today's weekday so the slot would be valid
    // absent the minStart cutoff (AvailabilityRule has no unique-per-weekday
    // constraint so no collision risk with the Monday rule from beforeAll).
    const todayRule = await prisma.availabilityRule.create({
      data: { barbershopId, professionalId, weekday, startTime: '09:00', endTime: '17:00' },
    })

    try {
      const result = await createAppointment({
        tenantId: barbershopId,
        serviceId,
        professionalId,
        date: todayInShop,
        startTime: pastSlot,
        customer: { name: 'Past Test', cpf: '52998224725', phone: '11777777777' },
        source: 'ADMIN',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('OUTSIDE_AVAILABILITY')
    } finally {
      await prisma.availabilityRule.delete({ where: { id: todayRule.id } })
    }
  })

  it('(i) double-cancel → both ok, exactly ONE APPOINTMENT_CANCELLED audit row', async () => {
    const bookResult = await createAppointment(base('14:00'))
    expect(bookResult.ok).toBe(true)
    if (!bookResult.ok) return

    const apptId = bookResult.data.appointmentId

    const cancel1 = await cancelAppointment({
      tenantId: barbershopId,
      appointmentId: apptId,
      by: 'test-runner',
    })
    expect(cancel1.ok).toBe(true)

    // Second cancel on an already-CANCELLED appointment → idempotent ok
    const cancel2 = await cancelAppointment({
      tenantId: barbershopId,
      appointmentId: apptId,
      by: 'test-runner',
    })
    expect(cancel2.ok).toBe(true)

    // Atomic updateMany ensures the audit log is written exactly once
    const auditRows = await prisma.auditLog.findMany({
      where: { barbershopId, entityId: apptId, action: 'APPOINTMENT_CANCELLED' },
    })
    expect(auditRows).toHaveLength(1)
  })

  it('(j) phone "123" → INVALID_PHONE', async () => {
    const result = await createAppointment({
      ...base('15:00'),
      customer: { name: 'Bad Phone', cpf: '52998224725', phone: '123' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_PHONE')
  })

  it('(k) PUBLIC_PAGE source without consent → CONSENT_REQUIRED', async () => {
    const result = await createAppointment({
      ...base('15:15'),
      source: 'PUBLIC_PAGE',
      consent: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CONSENT_REQUIRED')
  })

  it('(l) ADMIN source without consent still succeeds (gate only applies to PUBLIC_PAGE)', async () => {
    const result = await createAppointment({
      tenantId: barbershopId,
      serviceId,
      professionalId,
      date: TEST_DATE,
      startTime: '15:30',
      customer,
      source: 'ADMIN',
    })
    expect(result.ok).toBe(true)
  })

  it('(m) PUBLIC_PAGE booking with consent sets privacyConsentAt; a repeat booking does not overwrite it', async () => {
    // Already E.164-shaped (13 digits) so normalizePhone() is an identity op —
    // must match exactly what create-appointment.ts stores/looks up by.
    const uniquePhone = '5511955550001'
    const consentCpf = '39053344705'

    // Pre-verify this phone so the test isolates consent behaviour from the
    // phone-verification gate (covered separately by tests q/r/s below).
    await prisma.phoneVerification.create({
      data: {
        barbershopId,
        cpf: consentCpf,
        phone: uniquePhone,
        codeHash: 'irrelevant-for-this-test',
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      },
    })

    const first = await createAppointment({
      ...base('16:00'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Consent Tester', cpf: consentCpf, phone: uniquePhone },
    })
    expect(first.ok).toBe(true)

    const afterFirst = await prisma.customer.findUnique({
      where: { barbershopId_cpf: { barbershopId, cpf: consentCpf } },
    })
    expect(afterFirst?.privacyConsentAt).not.toBeNull()
    const consentAt = afterFirst!.privacyConsentAt!.getTime()

    const second = await createAppointment({
      ...base('16:30'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Consent Tester', cpf: consentCpf, phone: uniquePhone },
    })
    expect(second.ok).toBe(true)

    const afterSecond = await prisma.customer.findUnique({
      where: { barbershopId_cpf: { barbershopId, cpf: consentCpf } },
    })
    expect(afterSecond?.privacyConsentAt?.getTime()).toBe(consentAt)
  })

  it('(n) invalid CPF checksum → INVALID_CPF', async () => {
    const result = await createAppointment({
      ...base('17:00'),
      customer: { name: 'Bad CPF', cpf: '11111111111', phone: '11966660001' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('INVALID_CPF')
  })

  it('(o) two different customers sharing one phone get separate records by CPF', async () => {
    // 09:00/09:30 (not 17:15/17:45): the Monday availability rule from beforeAll
    // is 09:00-17:00, so the last valid 30-min start is 16:30 — 09:00/09:30 are
    // free slots inside the window (09:00 was only *attempted* by test (e), which
    // failed at INVALID_SERVICE before booking anything).
    const sharedPhone = '11955559999'
    const first = await createAppointment({
      ...base('09:00'),
      customer: { name: 'Irmao Um', cpf: '11144477735', phone: sharedPhone },
    })
    const second = await createAppointment({
      ...base('09:30'),
      customer: { name: 'Irmao Dois', cpf: '52998224725', phone: sharedPhone },
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const firstAppt = await prisma.appointment.findUnique({ where: { id: first.data.appointmentId } })
    const secondAppt = await prisma.appointment.findUnique({ where: { id: second.data.appointmentId } })
    expect(firstAppt?.customerId).not.toBe(secondAppt?.customerId)
  })

  it('(p) migration gate: any customer missing CPF blocks all new bookings for the tenant', async () => {
    const legacy = await prisma.customer.create({
      data: { barbershopId, name: 'Legacy No CPF', phone: '11900000000', cpf: null },
    })
    try {
      const result = await createAppointment({
        ...base('18:15'),
        customer: { name: 'Anyone', cpf: '39053344705', phone: '11955550002' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('CPF_MIGRATION_REQUIRED')
    } finally {
      await prisma.customer.delete({ where: { id: legacy.id } })
    }
  })

  it('(q) PUBLIC_PAGE booking with an unverified new phone → PHONE_NOT_VERIFIED', async () => {
    const result = await createAppointment({
      ...base('18:30'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Unverified', cpf: '20000000027', phone: '11955550003' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PHONE_NOT_VERIFIED')
  })

  it('(r) PUBLIC_PAGE booking with a recently-verified phone succeeds and sets phoneVerifiedAt', async () => {
    const cpf = '20000791997'
    // Already E.164-shaped (13 digits) so normalizePhone() is an identity op —
    // must match exactly what create-appointment.ts stores/looks up by.
    const phone = '5511955550004'
    await prisma.phoneVerification.create({
      data: {
        barbershopId,
        cpf,
        phone,
        codeHash: 'irrelevant-for-this-test',
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      },
    })

    const result = await createAppointment({
      ...base('13:00'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Recently Verified', cpf, phone },
    })
    expect(result.ok).toBe(true)

    const customer = await prisma.customer.findUnique({
      where: { barbershopId_cpf: { barbershopId, cpf } },
    })
    expect(customer?.phoneVerifiedAt).not.toBeNull()
  })

  it('(s) a returning customer whose phone is already trusted skips the gate on a second booking', async () => {
    const cpf = '20001583824'
    // Already E.164-shaped (13 digits) so normalizePhone() is an identity op —
    // must match exactly what create-appointment.ts stores/looks up by.
    const phone = '5511955550005'
    await prisma.phoneVerification.create({
      data: {
        barbershopId,
        cpf,
        phone,
        codeHash: 'irrelevant-for-this-test',
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      },
    })
    const first = await createAppointment({
      ...base('13:30'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Returning Customer', cpf, phone },
    })
    expect(first.ok).toBe(true)
    expect(await isPhoneVerified(barbershopId, cpf, phone)).toBe(true)

    // No new PhoneVerification row exists for this booking — proves the gate
    // is satisfied via Customer.phoneVerifiedAt, not a fresh code.
    const second = await createAppointment({
      ...base('14:00'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Returning Customer', cpf, phone },
    })
    expect(second.ok).toBe(true)
  })

  it('(t) ADMIN source is unaffected by the phone-verification gate', async () => {
    const result = await createAppointment({
      ...base('14:30'),
      source: 'ADMIN',
      customer: { name: 'Admin Walk-in', cpf: '20002375761', phone: '11955550006' },
    })
    expect(result.ok).toBe(true)
  })
})
