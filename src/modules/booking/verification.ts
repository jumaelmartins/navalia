import 'server-only'
import { createHash, randomInt } from 'crypto'
import { prisma as realPrisma } from '@/lib/prisma'
import { evolution } from '@/modules/whatsapp/evolution-client'
import { sendEmail as realSendEmail } from '@/modules/notifications/email'

const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const RECENT_VERIFICATION_WINDOW_MS = 30 * 60 * 1000
const MAX_ATTEMPTS = 5

export type VerificationError =
  | 'ALREADY_VERIFIED'
  | 'RESEND_TOO_SOON'
  | 'EMAIL_REQUIRED'
  | 'SEND_FAILED'
  | 'NOT_FOUND'
  | 'CODE_EXPIRED'
  | 'CODE_INVALID'
  | 'TOO_MANY_ATTEMPTS'

export type Result<T> = { ok: true; data: T } | { ok: false; error: VerificationError }

type Deps = {
  prisma?: typeof realPrisma
  sendWhatsApp?: (instance: string, to: string, text: string) => Promise<{ ok: boolean }>
  sendEmail?: (to: string, subject: string, text: string) => Promise<{ ok: boolean }>
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** True when this exact (barbershopId, cpf, phone) combination is already trusted. */
export async function isPhoneVerified(
  barbershopId: string,
  cpf: string,
  phone: string,
  deps: Deps = {},
): Promise<boolean> {
  const db = deps.prisma ?? realPrisma
  const customer = await db.customer.findUnique({
    where: { barbershopId_cpf: { barbershopId, cpf } },
    select: { phone: true, phoneVerifiedAt: true },
  })
  return !!customer && customer.phone === phone && customer.phoneVerifiedAt !== null
}

/** True when a fresh (last 30 min), completed PhoneVerification exists for this combination. */
export async function hasRecentVerification(
  barbershopId: string,
  cpf: string,
  phone: string,
  deps: Deps = {},
): Promise<boolean> {
  const db = deps.prisma ?? realPrisma
  const verification = await db.phoneVerification.findFirst({
    where: {
      barbershopId,
      cpf,
      phone,
      verifiedAt: { gte: new Date(Date.now() - RECENT_VERIFICATION_WINDOW_MS) },
    },
  })
  return !!verification
}

/**
 * Sends a 6-digit code via WhatsApp (if the shop's Evolution instance is
 * connected) or email (fallback — requires `args.email`).
 */
export async function requestVerificationCode(
  args: { barbershopId: string; cpf: string; phone: string; email?: string },
  deps: Deps = {},
): Promise<Result<{ channel: 'WHATSAPP' | 'EMAIL' }>> {
  const db = deps.prisma ?? realPrisma
  const sendWhatsApp =
    deps.sendWhatsApp ??
    ((instance: string, to: string, text: string) => evolution.sendText(instance, to, text))
  const sendEmail = deps.sendEmail ?? realSendEmail

  if (await isPhoneVerified(args.barbershopId, args.cpf, args.phone, { prisma: db })) {
    return { ok: false, error: 'ALREADY_VERIFIED' }
  }

  const recent = await db.phoneVerification.findFirst({
    where: { barbershopId: args.barbershopId, cpf: args.cpf, phone: args.phone },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, error: 'RESEND_TOO_SOON' }
  }

  const shop = await db.barbershop.findUnique({
    where: { id: args.barbershopId },
    select: { name: true, evolutionInstanceId: true, whatsappStatus: true },
  })
  if (!shop) return { ok: false, error: 'NOT_FOUND' }

  const useWhatsApp = !!shop.evolutionInstanceId && shop.whatsappStatus === 'CONNECTED'
  if (!useWhatsApp && !args.email) {
    return { ok: false, error: 'EMAIL_REQUIRED' }
  }

  const code = generateCode()
  const text = `Seu código de verificação para ${shop.name}: ${code}\nVálido por 10 minutos.`

  const sendResult = useWhatsApp
    ? await sendWhatsApp(shop.evolutionInstanceId!, args.phone, text)
    : await sendEmail(args.email!, `Código de verificação — ${shop.name}`, text)

  if (!sendResult.ok) return { ok: false, error: 'SEND_FAILED' }

  await db.phoneVerification.create({
    data: {
      barbershopId: args.barbershopId,
      cpf: args.cpf,
      phone: args.phone,
      codeHash: hashCode(code),
      channel: useWhatsApp ? 'WHATSAPP' : 'EMAIL',
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  })

  return { ok: true, data: { channel: useWhatsApp ? 'WHATSAPP' : 'EMAIL' } }
}

/** Verifies the most recent pending code for this (barbershopId, cpf, phone). */
export async function verifyCode(
  args: { barbershopId: string; cpf: string; phone: string; code: string },
  deps: Deps = {},
): Promise<Result<{ verified: true }>> {
  const db = deps.prisma ?? realPrisma

  const verification = await db.phoneVerification.findFirst({
    where: { barbershopId: args.barbershopId, cpf: args.cpf, phone: args.phone, verifiedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!verification) return { ok: false, error: 'NOT_FOUND' }
  if (verification.expiresAt < new Date()) return { ok: false, error: 'CODE_EXPIRED' }
  if (verification.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'TOO_MANY_ATTEMPTS' }

  if (hashCode(args.code) !== verification.codeHash) {
    await db.phoneVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, error: 'CODE_INVALID' }
  }

  await db.phoneVerification.update({
    where: { id: verification.id },
    data: { verifiedAt: new Date() },
  })
  return { ok: true, data: { verified: true } }
}
