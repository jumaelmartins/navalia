'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner, requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { ServiceSchema, ServicePatchSchema } from './service-schemas'
import type { ServicePatch } from './service-schemas'

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// listServices — reads are tenant-scoped via requireOnboarded
// ---------------------------------------------------------------------------

export async function listServices() {
  const { barbershop } = await requireOnboarded()
  const services = await prisma.service.findMany({
    where: { barbershopId: barbershop.id },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { professionals: true } } },
  })
  return { ok: true as const, data: services } as const
}

// ---------------------------------------------------------------------------
// createService
// ---------------------------------------------------------------------------

export async function createService(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { barbershop } = await requireOwner()

  const parsed = ServiceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const maxOrder = await prisma.service.aggregate({
      where: { barbershopId: barbershop.id },
      _max: { sortOrder: true },
    })
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1

    const service = await prisma.service.create({
      data: {
        barbershopId: barbershop.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        priceCents: parsed.data.priceCents,
        durationMin: parsed.data.durationMin,
        isActive: true,
        sortOrder: nextOrder,
      },
    })
    revalidatePath('/dashboard/servicos')
    return { ok: true, data: { id: service.id } }
  } catch (err) {
    console.error('[createService]', err)
    return { ok: false, error: 'Erro ao criar serviço.' }
  }
}

// ---------------------------------------------------------------------------
// updateService — verify id+barbershopId before writing
// ---------------------------------------------------------------------------

export async function updateService(
  id: string,
  patch: ServicePatch,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const parsed = ServicePatchSchema.safeParse(patch)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'Nenhum campo para atualizar.' }
  }

  const existing = await prisma.service.findFirst({
    where: { id, barbershopId: barbershop.id },
  })
  if (!existing) {
    return { ok: false, error: 'Serviço não encontrado.' }
  }

  try {
    await prisma.service.update({ where: { id }, data: parsed.data })
    revalidatePath('/dashboard/servicos')
    return { ok: true }
  } catch (err) {
    console.error('[updateService]', err)
    return { ok: false, error: 'Erro ao atualizar serviço.' }
  }
}

// ---------------------------------------------------------------------------
// toggleService — flips isActive; tenant-verified
// ---------------------------------------------------------------------------

export async function toggleService(id: string): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const existing = await prisma.service.findFirst({
    where: { id, barbershopId: barbershop.id },
  })
  if (!existing) {
    return { ok: false, error: 'Serviço não encontrado.' }
  }

  try {
    await prisma.service.update({
      where: { id },
      data: { isActive: !existing.isActive },
    })
    revalidatePath('/dashboard/servicos')
    return { ok: true }
  } catch (err) {
    console.error('[toggleService]', err)
    return { ok: false, error: 'Erro ao atualizar serviço.' }
  }
}

// ---------------------------------------------------------------------------
// reorderServices — verify ALL ids belong to tenant; transaction
// ---------------------------------------------------------------------------

export async function reorderServices(orderedIds: string[]): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const owned = await prisma.service.findMany({
    where: { barbershopId: barbershop.id, id: { in: orderedIds } },
    select: { id: true },
  })

  if (owned.length !== orderedIds.length) {
    return { ok: false, error: 'Um ou mais serviços não pertencem a esta barbearia.' }
  }

  try {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.service.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )
    revalidatePath('/dashboard/servicos')
    return { ok: true }
  } catch (err) {
    console.error('[reorderServices]', err)
    return { ok: false, error: 'Erro ao reordenar serviços.' }
  }
}
