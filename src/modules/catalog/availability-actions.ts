'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { RuleSchema, BlockSchema, detectOverlaps } from './availability-schemas'

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// upsertAvailabilityRules — replace-all in transaction
// professional tenant-verified; zod: weekday 0..6, HH:mm, start<end
// overlapping rules on SAME weekday are rejected
// ---------------------------------------------------------------------------

export async function upsertAvailabilityRules(
  professionalId: string,
  rules: unknown[],
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  // Verify professional belongs to tenant
  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, barbershopId: barbershop.id },
  })
  if (!professional) {
    return { ok: false, error: 'Profissional não encontrado.' }
  }

  // Validate each rule
  const validatedRules: { weekday: number; startTime: string; endTime: string }[] = []
  for (const rule of rules) {
    const parsed = RuleSchema.safeParse(rule)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
    }
    validatedRules.push(parsed.data)
  }

  // Reject overlapping rules on the same weekday
  const overlapError = detectOverlaps(validatedRules)
  if (overlapError) {
    return { ok: false, error: overlapError }
  }

  try {
    await prisma.$transaction([
      prisma.availabilityRule.deleteMany({ where: { professionalId } }),
      ...(validatedRules.length > 0
        ? [
            prisma.availabilityRule.createMany({
              data: validatedRules.map((r) => ({
                barbershopId: barbershop.id,
                professionalId,
                weekday: r.weekday,
                startTime: r.startTime,
                endTime: r.endTime,
              })),
            }),
          ]
        : []),
    ])
    revalidatePath('/dashboard/profissionais')
    return { ok: true }
  } catch (err) {
    console.error('[upsertAvailabilityRules]', err)
    return { ok: false, error: 'Erro ao salvar disponibilidade.' }
  }
}

// ---------------------------------------------------------------------------
// createScheduleBlock — source 'USER'; tenant-verified
// ---------------------------------------------------------------------------

export async function createScheduleBlock(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { barbershop } = await requireOwner()

  const parsed = BlockSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  // Verify professional belongs to tenant
  const professional = await prisma.professional.findFirst({
    where: { id: parsed.data.professionalId, barbershopId: barbershop.id },
  })
  if (!professional) {
    return { ok: false, error: 'Profissional não encontrado.' }
  }

  try {
    const block = await prisma.scheduleBlock.create({
      data: {
        barbershopId: barbershop.id,
        professionalId: parsed.data.professionalId,
        date: parsed.data.date,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        reason: parsed.data.reason ?? null,
        source: 'USER',
      },
    })
    return { ok: true, data: { id: block.id } }
  } catch (err) {
    console.error('[createScheduleBlock]', err)
    return { ok: false, error: 'Erro ao criar bloqueio.' }
  }
}

// ---------------------------------------------------------------------------
// deleteScheduleBlock — tenant-verified
// ---------------------------------------------------------------------------

export async function deleteScheduleBlock(blockId: string): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const block = await prisma.scheduleBlock.findFirst({
    where: { id: blockId, barbershopId: barbershop.id },
  })
  if (!block) {
    return { ok: false, error: 'Bloqueio não encontrado.' }
  }

  try {
    await prisma.scheduleBlock.delete({ where: { id: blockId } })
    return { ok: true }
  } catch (err) {
    console.error('[deleteScheduleBlock]', err)
    return { ok: false, error: 'Erro ao excluir bloqueio.' }
  }
}
