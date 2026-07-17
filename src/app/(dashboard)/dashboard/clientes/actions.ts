'use server'

import { revalidatePath } from 'next/cache'
import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { normalizeCpf, isValidCpf } from '@/modules/tenancy/cpf'

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

export async function saveCustomerCpf(
  customerId: string,
  rawCpf: string,
): Promise<{ ok: true; cpf: string } | { ok: false; error: string }> {
  const { barbershop } = await requireOnboarded()

  const cpf = normalizeCpf(rawCpf)
  if (!cpf || !isValidCpf(cpf)) {
    return { ok: false, error: 'CPF inválido.' }
  }

  const clash = await prisma.customer.findUnique({
    where: { barbershopId_cpf: { barbershopId: barbershop.id, cpf } },
    select: { id: true },
  })
  if (clash && clash.id !== customerId) {
    return { ok: false, error: 'CPF já cadastrado para outro cliente.' }
  }

  const { count } = await prisma.customer.updateMany({
    where: { id: customerId, barbershopId: barbershop.id },
    data: { cpf },
  })

  if (count === 0) return { ok: false, error: 'Cliente não encontrado.' }

  revalidatePath('/dashboard/clientes')
  return { ok: true, cpf }
}
