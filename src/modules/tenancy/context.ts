import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Barbershop, User } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Converte um nome de exibição em slug seguro para URL.
 * Ex.: 'Barbearia do João' → 'barbearia-do-joao'
 */
export function slugify(name: string): string {
  const result = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove marcas diacríticas (acentos)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // mantém letras, dígitos, espaços e hífens
    .trim()
    .replace(/[\s-]+/g, '-') // espaços/hífens consecutivos → um hífen
  return result || 'barbearia'
}

/**
 * Retorna uma nova Date exatamente 7 dias após `from`. Não muta `from`.
 */
export function computeTrialEnd(from: Date): Date {
  return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
}

export type TenantContext = {
  user: User
  barbershop: Barbershop
}

/**
 * Guard server-side: exige sessão válida E barbearia vinculada.
 * Sem sessão → redirect('/login'). Sem barbearia → redirect('/signup').
 */
export async function requireMember(): Promise<TenantContext> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { barbershop: true },
  })
  if (!user || !user.barbershop) redirect('/signup')

  const { barbershop, ...rest } = user
  return { user: rest, barbershop }
}

/**
 * Guard server-side: igual a requireMember, mas exige role OWNER.
 * Não-OWNER → redirect('/dashboard').
 */
export async function requireOwner(): Promise<TenantContext> {
  const ctx = await requireMember()
  if (ctx.user.role !== 'OWNER') redirect('/dashboard')
  return ctx
}
