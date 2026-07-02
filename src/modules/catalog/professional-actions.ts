'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOwner, requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ProfessionalSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres.'),
  bio: z.string().optional(),
})

const ProfessionalPatchSchema = ProfessionalSchema.partial()

// ---------------------------------------------------------------------------
// listProfessionals — reads are tenant-scoped via requireOnboarded
// ---------------------------------------------------------------------------

export async function listProfessionals() {
  const { barbershop } = await requireOnboarded()

  const professionals = await prisma.professional.findMany({
    where: { barbershopId: barbershop.id },
    orderBy: { createdAt: 'asc' },
    include: {
      services: {
        include: {
          service: { select: { id: true, name: true, isActive: true } },
        },
      },
      availabilityRules: {
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      },
    },
  })

  return { ok: true as const, data: professionals } as const
}

// ---------------------------------------------------------------------------
// createProfessional
// ---------------------------------------------------------------------------

export async function createProfessional(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { barbershop } = await requireOwner()

  const parsed = ProfessionalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const professional = await prisma.professional.create({
      data: {
        barbershopId: barbershop.id,
        name: parsed.data.name,
        bio: parsed.data.bio ?? null,
        isActive: true,
      },
    })
    revalidatePath('/dashboard/profissionais')
    return { ok: true, data: { id: professional.id } }
  } catch (err) {
    console.error('[createProfessional]', err)
    return { ok: false, error: 'Erro ao criar profissional.' }
  }
}

// ---------------------------------------------------------------------------
// updateProfessional — tenant-verified, empty-patch guard
// ---------------------------------------------------------------------------

export async function updateProfessional(
  id: string,
  patch: unknown,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const parsed = ProfessionalPatchSchema.safeParse(patch)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'Nenhum campo para atualizar.' }
  }

  const existing = await prisma.professional.findFirst({
    where: { id, barbershopId: barbershop.id },
  })
  if (!existing) {
    return { ok: false, error: 'Profissional não encontrado.' }
  }

  try {
    await prisma.professional.update({ where: { id }, data: parsed.data })
    revalidatePath('/dashboard/profissionais')
    return { ok: true }
  } catch (err) {
    console.error('[updateProfessional]', err)
    return { ok: false, error: 'Erro ao atualizar profissional.' }
  }
}

// ---------------------------------------------------------------------------
// toggleProfessional — flips isActive; tenant-verified
// ---------------------------------------------------------------------------

export async function toggleProfessional(id: string): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const existing = await prisma.professional.findFirst({
    where: { id, barbershopId: barbershop.id },
  })
  if (!existing) {
    return { ok: false, error: 'Profissional não encontrado.' }
  }

  try {
    await prisma.professional.update({
      where: { id },
      data: { isActive: !existing.isActive },
    })
    revalidatePath('/dashboard/profissionais')
    return { ok: true }
  } catch (err) {
    console.error('[toggleProfessional]', err)
    return { ok: false, error: 'Erro ao atualizar profissional.' }
  }
}

// ---------------------------------------------------------------------------
// setProfessionalServices — verify professional AND every serviceId belong to
// tenant; replace-all semantics in a transaction (deleteMany + createMany)
// ---------------------------------------------------------------------------

export async function setProfessionalServices(
  professionalId: string,
  serviceIds: string[],
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  // Verify professional belongs to tenant
  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, barbershopId: barbershop.id },
  })
  if (!professional) {
    return { ok: false, error: 'Profissional não encontrado.' }
  }

  // Deduplicate and verify all serviceIds belong to tenant
  const uniqueServiceIds = [...new Set(serviceIds)]

  if (uniqueServiceIds.length > 0) {
    const ownedServices = await prisma.service.findMany({
      where: { barbershopId: barbershop.id, id: { in: uniqueServiceIds } },
      select: { id: true },
    })
    if (ownedServices.length !== uniqueServiceIds.length) {
      return {
        ok: false,
        error: 'Um ou mais serviços não pertencem a esta barbearia.',
      }
    }
  }

  try {
    await prisma.$transaction([
      prisma.professionalService.deleteMany({ where: { professionalId } }),
      ...(uniqueServiceIds.length > 0
        ? [
            prisma.professionalService.createMany({
              data: uniqueServiceIds.map((serviceId) => ({
                professionalId,
                serviceId,
              })),
            }),
          ]
        : []),
    ])
    revalidatePath('/dashboard/profissionais')
    return { ok: true }
  } catch (err) {
    console.error('[setProfessionalServices]', err)
    return { ok: false, error: 'Erro ao atualizar serviços do profissional.' }
  }
}
