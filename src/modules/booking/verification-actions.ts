'use server'

import { prisma } from '@/lib/prisma'
import { isShopAccessible } from './public-actions'
import { normalizeCpf } from '@/modules/tenancy/cpf'
import { normalizePhone } from './create-appointment'
import {
  isPhoneVerified,
  requestVerificationCode,
  verifyCode,
  type VerificationError,
} from './verification'

const REQUEST_ERROR_PT_BR: Record<VerificationError, string> = {
  ALREADY_VERIFIED: 'Telefone já verificado.',
  RESEND_TOO_SOON: 'Aguarde um minuto antes de pedir um novo código.',
  EMAIL_REQUIRED: 'Informe seu e-mail para receber o código.',
  WHATSAPP_UNAVAILABLE: 'WhatsApp indisponível no momento. Tente pelo e-mail.',
  SEND_FAILED: 'Não foi possível enviar o código agora. Tente novamente.',
  NOT_FOUND: 'Página indisponível.',
  CODE_EXPIRED: 'Código expirado. Solicite um novo.',
  CODE_INVALID: 'Código incorreto.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas. Solicite um novo código.',
}

async function resolveAccessibleShopId(slug: string): Promise<string | null> {
  const shop = await prisma.barbershop.findUnique({
    where: { slug },
    select: { id: true, onboardingCompleted: true, subscriptionStatus: true, trialEndsAt: true },
  })
  if (!shop || !(await isShopAccessible(shop))) return null
  return shop.id
}

export async function checkPhoneVerified(args: {
  slug: string
  cpf: string
  phone: string
}): Promise<{ verified: boolean }> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { verified: false }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { verified: false }

  const phone = normalizePhone(args.phone)
  if (!phone) return { verified: false }

  const verified = await isPhoneVerified(barbershopId, cpf, phone)
  return { verified }
}

export async function requestPhoneVerification(args: {
  slug: string
  cpf: string
  phone: string
  email?: string
  preferredChannel?: 'WHATSAPP' | 'EMAIL'
}): Promise<
  | { ok: true; channel: 'WHATSAPP' | 'EMAIL' }
  | { ok: false; error: string; needsEmail?: boolean }
> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { ok: false, error: 'Página indisponível.' }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { ok: false, error: 'CPF inválido.' }

  const phone = normalizePhone(args.phone)
  if (!phone) return { ok: false, error: 'Telefone inválido.' }

  const result = await requestVerificationCode({
    barbershopId,
    cpf,
    phone,
    email: args.email?.trim() || undefined,
    preferredChannel: args.preferredChannel,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: REQUEST_ERROR_PT_BR[result.error],
      needsEmail: result.error === 'EMAIL_REQUIRED',
    }
  }

  return { ok: true, channel: result.data.channel }
}

export async function confirmPhoneVerification(args: {
  slug: string
  cpf: string
  phone: string
  code: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { ok: false, error: 'Página indisponível.' }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { ok: false, error: 'CPF inválido.' }

  const phone = normalizePhone(args.phone)
  if (!phone) return { ok: false, error: 'Telefone inválido.' }

  const result = await verifyCode({
    barbershopId,
    cpf,
    phone,
    code: args.code.trim(),
  })

  if (!result.ok) return { ok: false, error: REQUEST_ERROR_PT_BR[result.error] }
  return { ok: true }
}
