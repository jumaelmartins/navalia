'use server'

import { z } from 'zod'
import { requireOwner } from '@/modules/tenancy/context'
import { BusinessHoursSchema } from '@/modules/tenancy/business-hours'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Step 1 — Dados básicos da barbearia
// ---------------------------------------------------------------------------

const ShopBasicsSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres.'),
  description: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
})

export async function saveShopBasics(
  input: z.infer<typeof ShopBasicsSchema>,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const parsed = ShopBasicsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
      },
    })
    return { ok: true }
  } catch (err) {
    console.error('[saveShopBasics]', err)
    return { ok: false, error: 'Erro ao salvar dados da barbearia.' }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Horários de funcionamento
// ---------------------------------------------------------------------------

export async function saveBusinessHours(
  hours: unknown,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const parsed = BusinessHoursSchema.safeParse(hours)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Horários inválidos.' }
  }

  try {
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: { businessHours: parsed.data },
    })
    return { ok: true }
  } catch (err) {
    console.error('[saveBusinessHours]', err)
    return { ok: false, error: 'Erro ao salvar horários.' }
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Primeiro serviço
// ---------------------------------------------------------------------------

const FirstServiceSchema = z.object({
  name: z.string().min(2, 'Nome do serviço deve ter ao menos 2 caracteres.'),
  priceCents: z.number().int().positive('Preço deve ser maior que zero.'),
  durationMin: z.number().int().min(5).max(480),
})

export async function createFirstService(
  input: z.infer<typeof FirstServiceSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { barbershop } = await requireOwner()

  const parsed = FirstServiceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados do serviço inválidos.' }
  }

  try {
    const service = await prisma.service.create({
      data: {
        barbershopId: barbershop.id,
        name: parsed.data.name,
        priceCents: parsed.data.priceCents,
        durationMin: parsed.data.durationMin,
        isActive: true,
        sortOrder: 0,
      },
    })
    return { ok: true, data: { id: service.id } }
  } catch (err) {
    console.error('[createFirstService]', err)
    return { ok: false, error: 'Erro ao criar serviço.' }
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Primeiro profissional (auto-link service + availability rules)
// ---------------------------------------------------------------------------

const FirstProfessionalSchema = z.object({
  name: z.string().min(2, 'Nome do profissional deve ter ao menos 2 caracteres.'),
})

export async function createFirstProfessional(
  input: z.infer<typeof FirstProfessionalSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { barbershop } = await requireOwner()

  const parsed = FirstProfessionalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  // Idempotency guard: if a professional already exists for this barbershop, return success
  const existingProfessional = await prisma.professional.findFirst({
    where: { barbershopId: barbershop.id },
  })
  if (existingProfessional) {
    return { ok: true, data: { id: existingProfessional.id } }
  }

  // Fetch the first active service and the shop's businessHours for mirroring
  const [firstService, shop] = await Promise.all([
    prisma.service.findFirst({
      where: { barbershopId: barbershop.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.barbershop.findUnique({
      where: { id: barbershop.id },
      select: { businessHours: true },
    }),
  ])

  if (!firstService) {
    return { ok: false, error: 'Crie um serviço antes de cadastrar um profissional.' }
  }

  try {
    const professional = await prisma.$transaction(async (tx) => {
      // Create the professional
      const prof = await tx.professional.create({
        data: {
          barbershopId: barbershop.id,
          name: parsed.data.name,
          isActive: true,
        },
      })

      // Link to the first service
      await tx.professionalService.create({
        data: {
          professionalId: prof.id,
          serviceId: firstService.id,
        },
      })

      // Mirror businessHours as AvailabilityRules (open days only)
      const hours = (shop?.businessHours ?? {}) as Record<
        string,
        { start: string; end: string } | null
      >

      const availabilityData = Object.entries(hours)
        .filter(([, v]) => v !== null)
        .map(([weekdayStr, v]) => ({
          barbershopId: barbershop.id,
          professionalId: prof.id,
          weekday: parseInt(weekdayStr, 10),
          startTime: (v as { start: string; end: string }).start,
          endTime: (v as { start: string; end: string }).end,
        }))

      if (availabilityData.length > 0) {
        await tx.availabilityRule.createMany({ data: availabilityData })
      }

      return prof
    })

    return { ok: true, data: { id: professional.id } }
  } catch (err) {
    console.error('[createFirstProfessional]', err)
    return { ok: false, error: 'Erro ao criar profissional.' }
  }
}

// ---------------------------------------------------------------------------
// Final step — Complete onboarding
// ---------------------------------------------------------------------------

export async function completeOnboarding(): Promise<ActionResult> {
  const { barbershop, user } = await requireOwner()

  // Guard: businessHours must have at least one open day
  const hours = (barbershop.businessHours ?? {}) as Record<string, unknown>
  const hasOpenDay = Object.values(hours).some((v) => v !== null)
  if (!hasOpenDay) {
    return { ok: false, error: 'Configure os horários de funcionamento antes de continuar.' }
  }

  // Guard: at least one service
  const serviceCount = await prisma.service.count({
    where: { barbershopId: barbershop.id, isActive: true },
  })
  if (serviceCount === 0) {
    return { ok: false, error: 'Cadastre pelo menos um serviço antes de continuar.' }
  }

  // Guard: at least one professional
  const profCount = await prisma.professional.count({
    where: { barbershopId: barbershop.id, isActive: true },
  })
  if (profCount === 0) {
    return { ok: false, error: 'Cadastre pelo menos um profissional antes de continuar.' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.barbershop.update({
        where: { id: barbershop.id },
        data: { onboardingCompleted: true },
      })

      await tx.auditLog.create({
        data: {
          barbershopId: barbershop.id,
          userId: user.id,
          action: 'ONBOARDING_COMPLETED',
          entity: 'Barbershop',
          entityId: barbershop.id,
        },
      })
    })

    return { ok: true }
  } catch (err) {
    console.error('[completeOnboarding]', err)
    return { ok: false, error: 'Erro ao finalizar onboarding.' }
  }
}
