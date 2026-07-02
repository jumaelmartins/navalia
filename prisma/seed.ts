/**
 * Navalia – Demo Seed
 *
 * Creates "Barbearia Demo" (slug: barbearia-demo) with realistic data for
 * demos, screenshots, and QA.  Idempotent: safe to run multiple times.
 *
 * Run:  npm run seed
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { auth } from '../src/lib/auth'

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLUG = 'barbearia-demo'
const DEMO_EMAIL = 'demo@navalia.app'
const DEMO_PASSWORD = 'demo1234'
const DEMO_NAME = 'Demo Owner'

const SERVICES_DATA = [
  { name: 'Corte masculino', priceCents: 4000, durationMin: 30, sortOrder: 0 },
  { name: 'Barba', priceCents: 3500, durationMin: 25, sortOrder: 1 },
  { name: 'Corte + Barba', priceCents: 7000, durationMin: 60, sortOrder: 2 },
  { name: 'Sobrancelha', priceCents: 2000, durationMin: 15, sortOrder: 3 },
]

const PROFESSIONALS_DATA = [
  { name: 'João Silva' },
  { name: 'Carlos Mendes' },
]

const CUSTOMERS_DATA = [
  { name: 'André Luiz Santos', phone: '5571991110001' },
  { name: 'Bruno Costa', phone: '5571991110002' },
  { name: 'Carlos Eduardo Lima', phone: '5571991110003' },
  { name: 'Diego Ferreira', phone: '5571991110004' },
  { name: 'Eliton Souza', phone: '5571991110005' },
  { name: 'Fábio Rodrigues', phone: '5571991110006' },
  { name: 'Gabriel Oliveira', phone: '5571991110007' },
  { name: 'Hélio Nascimento', phone: '5571991110008' },
  { name: 'Igor Araújo', phone: '5571991110009' },
  { name: 'Jonas Ribeiro', phone: '5571991110010' },
  { name: 'Lucas Barbosa', phone: '5571991110011' },
  { name: 'Marcos Pereira', phone: '5571991110012' },
  { name: 'Nathan Alves', phone: '5571991110013' },
  { name: 'Otávio Gomes', phone: '5571991110014' },
  { name: 'Paulo Henrique Melo', phone: '5571991110015' },
]

// Mon-Sat 09:00-19:00 weekly availability
const WEEK_HOURS = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '19:00',
}))

// Business hours JSON (keys 0-6, Sun-Sat)
const BUSINESS_HOURS = {
  '0': null,
  '1': { start: '09:00', end: '19:00' },
  '2': { start: '09:00', end: '19:00' },
  '3': { start: '09:00', end: '19:00' },
  '4': { start: '09:00', end: '19:00' },
  '5': { start: '09:00', end: '19:00' },
  '6': { start: '09:00', end: '19:00' },
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date()
  console.log('\n🌱  Navalia Demo Seed — starting…\n')

  // -------------------------------------------------------------------------
  // 1. Barbershop (upsert by slug)
  // -------------------------------------------------------------------------

  const barbershop = await prisma.barbershop.upsert({
    where: { slug: SLUG },
    create: {
      name: 'Barbearia Demo',
      slug: SLUG,
      description: 'A melhor barbearia da região. Especialistas em cortes masculinos modernos e clássicos.',
      phone: '(71) 99999-0000',
      address: 'Av. Oceânica, 1000 — Ondina, Salvador, BA',
      cancellationPolicy: 'Cancele com até 2 horas de antecedência sem cobrança. Após esse prazo, 50% do serviço será cobrado.',
      timezone: 'America/Bahia',
      businessHours: BUSINESS_HOURS,
      subscriptionStatus: 'TRIALING',
      trialEndsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      onboardingCompleted: true,
    },
    update: {
      // Keep existing data on re-run but ensure onboarding is marked complete
      onboardingCompleted: true,
      businessHours: BUSINESS_HOURS,
    },
  })

  console.log(`  ✓ Barbershop: ${barbershop.name} (id: ${barbershop.id})`)

  // -------------------------------------------------------------------------
  // 2. Owner user (via Better Auth for correct password hashing)
  // -------------------------------------------------------------------------

  let userId: string | null = null
  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })

  if (existingUser) {
    userId = existingUser.id
    console.log(`  ✓ User: ${DEMO_EMAIL} already exists (id: ${userId})`)
  } else {
    try {
      const result = await auth.api.signUpEmail({
        body: { name: DEMO_NAME, email: DEMO_EMAIL, password: DEMO_PASSWORD },
        asResponse: false,
      })
      // signUpEmail returns { user, session, ... }
      const uid = (result as { user?: { id?: string } })?.user?.id
      if (!uid) throw new Error('signUpEmail returned no user id')
      userId = uid
      console.log(`  ✓ User created via Better Auth: ${DEMO_EMAIL} (id: ${userId})`)
    } catch (err) {
      // Better Auth might fail on session creation in non-HTTP context
      // but the user should still be created. Check the DB.
      const created = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })
      if (created) {
        userId = created.id
        console.log(`  ✓ User created (session error suppressed): ${DEMO_EMAIL} (id: ${userId})`)
      } else {
        console.error('  ✗ Failed to create user via Better Auth:', err)
        throw new Error('Cannot proceed without owner user')
      }
    }
  }

  // Ensure user has OWNER role + linked barbershop
  await prisma.user.update({
    where: { id: userId! },
    data: { role: 'OWNER', barbershopId: barbershop.id },
  })
  console.log(`  ✓ User linked as OWNER to ${barbershop.name}`)

  // -------------------------------------------------------------------------
  // 3. Services (upsert by name within barbershop)
  // -------------------------------------------------------------------------

  const serviceIds: string[] = []
  for (const svc of SERVICES_DATA) {
    const existing = await prisma.service.findFirst({
      where: { barbershopId: barbershop.id, name: svc.name },
    })
    if (existing) {
      serviceIds.push(existing.id)
    } else {
      const created = await prisma.service.create({
        data: { barbershopId: barbershop.id, ...svc, isActive: true },
      })
      serviceIds.push(created.id)
    }
  }
  console.log(`  ✓ Services: ${serviceIds.length}`)

  // -------------------------------------------------------------------------
  // 4. Professionals + availability + service links
  // -------------------------------------------------------------------------

  const professionalIds: string[] = []
  for (const prof of PROFESSIONALS_DATA) {
    let p = await prisma.professional.findFirst({
      where: { barbershopId: barbershop.id, name: prof.name },
    })
    if (!p) {
      p = await prisma.professional.create({
        data: { barbershopId: barbershop.id, name: prof.name, isActive: true },
      })
    }
    professionalIds.push(p.id)

    // Availability rules (Mon-Sat 09-19), idempotent
    for (const rule of WEEK_HOURS) {
      const existingRule = await prisma.availabilityRule.findFirst({
        where: {
          barbershopId: barbershop.id,
          professionalId: p.id,
          weekday: rule.weekday,
        },
      })
      if (!existingRule) {
        await prisma.availabilityRule.create({
          data: {
            barbershopId: barbershop.id,
            professionalId: p.id,
            ...rule,
          },
        })
      }
    }

    // Link all services
    for (const serviceId of serviceIds) {
      const existingLink = await prisma.professionalService.findUnique({
        where: {
          professionalId_serviceId: {
            professionalId: p.id,
            serviceId,
          },
        },
      })
      if (!existingLink) {
        await prisma.professionalService.create({
          data: { professionalId: p.id, serviceId },
        })
      }
    }
  }
  console.log(`  ✓ Professionals: ${professionalIds.length}`)

  // -------------------------------------------------------------------------
  // 5. Customers (upsert by barbershopId + phone)
  // -------------------------------------------------------------------------

  const customerIds: string[] = []
  for (const c of CUSTOMERS_DATA) {
    const customer = await prisma.customer.upsert({
      where: { barbershopId_phone: { barbershopId: barbershop.id, phone: c.phone } },
      create: { barbershopId: barbershop.id, ...c },
      update: {},
    })
    customerIds.push(customer.id)
  }
  console.log(`  ✓ Customers: ${customerIds.length}`)

  // -------------------------------------------------------------------------
  // 6. Appointments (check before inserting; idempotent via marker tag)
  //    Spread across: last week, yesterday, today, tomorrow, rest of week
  // -------------------------------------------------------------------------

  const yesterday = ymd(addDays(now, -1))
  const today = ymd(now)
  const tomorrow = ymd(addDays(now, 1))
  const day2 = ymd(addDays(now, 2))
  const day3 = ymd(addDays(now, 3))
  const lastWeek1 = ymd(addDays(now, -7))
  const lastWeek2 = ymd(addDays(now, -6))
  const lastWeek3 = ymd(addDays(now, -5))
  const lastWeek4 = ymd(addDays(now, -4))
  const lastWeek5 = ymd(addDays(now, -3))

  // Convenience: pick customer/professional/service by index (cycling)
  const c = (i: number) => customerIds[i % customerIds.length]
  const p = (i: number) => professionalIds[i % professionalIds.length]
  const s = (i: number) => serviceIds[i % serviceIds.length]

  type ApptDef = {
    date: string
    startTime: string
    endTime: string
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
    customerIdx: number
    professionalIdx: number
    serviceIdx: number
  }

  const apptDefs: ApptDef[] = [
    // Last week — 5 COMPLETED, 1 CANCELLED
    { date: lastWeek1, startTime: '09:00', endTime: '09:30', status: 'COMPLETED', customerIdx: 0, professionalIdx: 0, serviceIdx: 0 },
    { date: lastWeek1, startTime: '10:00', endTime: '10:25', status: 'COMPLETED', customerIdx: 1, professionalIdx: 1, serviceIdx: 1 },
    { date: lastWeek2, startTime: '11:00', endTime: '12:00', status: 'COMPLETED', customerIdx: 2, professionalIdx: 0, serviceIdx: 2 },
    { date: lastWeek3, startTime: '09:30', endTime: '10:00', status: 'COMPLETED', customerIdx: 3, professionalIdx: 1, serviceIdx: 0 },
    { date: lastWeek4, startTime: '14:00', endTime: '14:25', status: 'COMPLETED', customerIdx: 4, professionalIdx: 0, serviceIdx: 3 },
    { date: lastWeek5, startTime: '15:00', endTime: '15:30', status: 'CANCELLED', customerIdx: 5, professionalIdx: 1, serviceIdx: 0 },

    // Yesterday — 2 COMPLETED, 1 NO_SHOW
    { date: yesterday, startTime: '09:00', endTime: '09:30', status: 'COMPLETED', customerIdx: 6, professionalIdx: 0, serviceIdx: 0 },
    { date: yesterday, startTime: '10:00', endTime: '11:00', status: 'COMPLETED', customerIdx: 7, professionalIdx: 1, serviceIdx: 2 },
    { date: yesterday, startTime: '14:00', endTime: '14:25', status: 'NO_SHOW', customerIdx: 8, professionalIdx: 0, serviceIdx: 1 },

    // Today — 1 COMPLETED (morning), 3 CONFIRMED (future)
    { date: today, startTime: '09:00', endTime: '09:30', status: 'COMPLETED', customerIdx: 9, professionalIdx: 0, serviceIdx: 0 },
    { date: today, startTime: '14:00', endTime: '14:25', status: 'CONFIRMED', customerIdx: 10, professionalIdx: 0, serviceIdx: 1 },
    { date: today, startTime: '15:00', endTime: '16:00', status: 'CONFIRMED', customerIdx: 11, professionalIdx: 1, serviceIdx: 2 },
    { date: today, startTime: '16:30', endTime: '16:45', status: 'CONFIRMED', customerIdx: 12, professionalIdx: 0, serviceIdx: 3 },

    // Tomorrow — 3 CONFIRMED
    { date: tomorrow, startTime: '09:00', endTime: '09:30', status: 'CONFIRMED', customerIdx: 13, professionalIdx: 0, serviceIdx: 0 },
    { date: tomorrow, startTime: '10:30', endTime: '11:30', status: 'CONFIRMED', customerIdx: 14, professionalIdx: 1, serviceIdx: 2 },
    { date: tomorrow, startTime: '14:00', endTime: '14:25', status: 'CONFIRMED', customerIdx: 0, professionalIdx: 0, serviceIdx: 1 },

    // Rest of week — 4 CONFIRMED
    { date: day2, startTime: '09:00', endTime: '09:30', status: 'CONFIRMED', customerIdx: 1, professionalIdx: 1, serviceIdx: 0 },
    { date: day2, startTime: '11:00', endTime: '11:15', status: 'CONFIRMED', customerIdx: 2, professionalIdx: 0, serviceIdx: 3 },
    { date: day3, startTime: '10:00', endTime: '11:00', status: 'CONFIRMED', customerIdx: 3, professionalIdx: 1, serviceIdx: 2 },
    { date: day3, startTime: '14:30', endTime: '15:00', status: 'CONFIRMED', customerIdx: 4, professionalIdx: 0, serviceIdx: 0 },
  ]

  let appointmentsCreated = 0
  let appointmentsSkipped = 0

  for (const def of apptDefs) {
    // Check if an appointment already exists for same professional+date+startTime
    const existing = await prisma.appointment.findFirst({
      where: {
        barbershopId: barbershop.id,
        professionalId: p(def.professionalIdx),
        date: def.date,
        startTime: def.startTime,
      },
    })
    if (existing) {
      appointmentsSkipped++
      continue
    }

    await prisma.appointment.create({
      data: {
        barbershopId: barbershop.id,
        customerId: c(def.customerIdx),
        professionalId: p(def.professionalIdx),
        serviceId: s(def.serviceIdx),
        date: def.date,
        startTime: def.startTime,
        endTime: def.endTime,
        status: def.status,
        source: 'ADMIN',
        ...(def.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    })
    appointmentsCreated++
  }

  console.log(`  ✓ Appointments: ${appointmentsCreated} created, ${appointmentsSkipped} skipped`)

  // -------------------------------------------------------------------------
  // 7. AuditLog SEED entry
  // -------------------------------------------------------------------------

  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId: userId,
      action: 'SEED',
      entity: 'Barbershop',
      entityId: barbershop.id,
      payload: {
        seededAt: now.toISOString(),
        services: serviceIds.length,
        professionals: professionalIds.length,
        customers: customerIds.length,
        appointmentsCreated,
      },
    },
  })

  // -------------------------------------------------------------------------
  // 8. Summary counts
  // -------------------------------------------------------------------------

  const [svcCount, profCount, custCount, apptCount] = await Promise.all([
    prisma.service.count({ where: { barbershopId: barbershop.id } }),
    prisma.professional.count({ where: { barbershopId: barbershop.id } }),
    prisma.customer.count({ where: { barbershopId: barbershop.id } }),
    prisma.appointment.count({ where: { barbershopId: barbershop.id } }),
  ])

  console.log('\n  📊  Summary for barbearia-demo:')
  console.log(`      Services:      ${svcCount}`)
  console.log(`      Professionals: ${profCount}`)
  console.log(`      Customers:     ${custCount}`)
  console.log(`      Appointments:  ${apptCount}`)
  console.log(`      Owner email:   ${DEMO_EMAIL}`)
  console.log(`      Password:      ${DEMO_PASSWORD}`)
  console.log('\n  ✅  Seed complete.\n')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
