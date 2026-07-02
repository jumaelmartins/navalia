'use server'

import { revalidatePath } from 'next/cache'
import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'

type ActionResult = { ok: true } | { ok: false; error: string }

export async function saveCustomerNotes(
  customerId: string,
  notes: string,
): Promise<ActionResult> {
  const { barbershop } = await requireOnboarded()

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, barbershopId: barbershop.id },
  })
  if (!customer) return { ok: false, error: 'Cliente não encontrado.' }

  try {
    await prisma.customer.update({
      where: { id: customerId },
      data: { notes: notes.trim() || null },
    })
    revalidatePath('/dashboard/clientes')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Erro ao salvar notas.' }
  }
}
