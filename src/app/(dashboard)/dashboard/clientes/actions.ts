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

  const { count } = await prisma.customer.updateMany({
    where: { id: customerId, barbershopId: barbershop.id },
    data: { notes: notes.trim() || null },
  })

  if (count === 0) return { ok: false, error: 'Cliente não encontrado.' }

  revalidatePath('/dashboard/clientes')
  return { ok: true }
}
