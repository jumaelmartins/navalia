'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { requireOnboarded } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { normalizeCpf, isValidCpf } from '@/modules/tenancy/cpf'

const CPF_CLASH_ERROR = 'CPF já cadastrado para outro cliente.'

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
    return { ok: false, error: CPF_CLASH_ERROR }
  }

  let count: number
  try {
    ;({ count } = await prisma.customer.updateMany({
      where: { id: customerId, barbershopId: barbershop.id },
      data: { cpf },
    }))
  } catch (err) {
    // Race backstop: two concurrent requests can both pass the findUnique
    // check above for the same (barbershopId, cpf) before either write
    // commits. The DB-level @@unique constraint then rejects the loser's
    // updateMany with P2002 — surface it as the same friendly collision
    // message instead of letting it throw. Any other error propagates.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: CPF_CLASH_ERROR }
    }
    throw err
  }

  if (count === 0) return { ok: false, error: 'Cliente não encontrado.' }

  revalidatePath('/dashboard/clientes')
  return { ok: true, cpf }
}
