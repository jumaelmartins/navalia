import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Barbershop, User } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAccess } from '@/modules/billing/gate'

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
 * Deriva um nome padrão de barbearia a partir do nome do usuário (Google
 * sign-in de tenants novos). Ex.: 'João Silva' → 'Barbearia de João'.
 */
export function deriveBarbershopName(userName: string): string {
  const firstName = userName.trim().split(/\s+/)[0]
  return firstName ? `Barbearia de ${firstName}` : 'Minha Barbearia'
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
 * Sem billing gate — usado apenas por ações de billing (checkout/portal)
 * que DEVEM funcionar mesmo quando o acesso está bloqueado.
 */
export async function requireOwnerUngated(): Promise<TenantContext> {
  const ctx = await requireMember()
  if (ctx.user.role !== 'OWNER') redirect('/dashboard')
  return ctx
}

/**
 * Guard server-side: igual a requireOwnerUngated, mas também exige acesso
 * ativo à assinatura. Assinatura vencida → redirect('/dashboard/reativar').
 */
export async function requireOwner(): Promise<TenantContext> {
  const ctx = await requireOwnerUngated()
  if (!hasAccess(ctx.barbershop)) redirect('/dashboard/reativar')
  return ctx
}

/**
 * Guard server-side: igual a requireMember, mas exige que o onboarding
 * já esteja completo E que a assinatura esteja ativa.
 * Onboarding incompleto → redirect('/dashboard/onboarding').
 * Assinatura vencida → redirect('/dashboard/reativar').
 */
export async function requireOnboarded(): Promise<TenantContext> {
  const ctx = await requireMember()
  if (!ctx.barbershop.onboardingCompleted) redirect('/dashboard/onboarding')
  if (!hasAccess(ctx.barbershop)) redirect('/dashboard/reativar')
  return ctx
}
