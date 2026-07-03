'use server'

import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { requireOwner } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/modules/whatsapp/evolution-client'
import { hashPin } from '@/lib/pin'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Shop Settings (dados + política de cancelamento)
// ---------------------------------------------------------------------------

const ShopSettingsSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres.'),
  description: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  cancellationPolicy: z.string().optional(),
})

export type ShopSettingsInput = z.infer<typeof ShopSettingsSchema>

export async function saveShopSettings(
  input: ShopSettingsInput,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()

  const parsed = ShopSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const { name, description, phone, address, cancellationPolicy } = parsed.data

  // Empty-patch guard: only write to DB if something actually changed
  const unchanged =
    name === barbershop.name &&
    (description ?? null) === barbershop.description &&
    (phone ?? null) === barbershop.phone &&
    (address ?? null) === barbershop.address &&
    (cancellationPolicy ?? null) === barbershop.cancellationPolicy

  if (unchanged) return { ok: true }

  try {
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: {
        name,
        description: description ?? null,
        phone: phone ?? null,
        address: address ?? null,
        cancellationPolicy: cancellationPolicy ?? null,
      },
    })
    return { ok: true }
  } catch (err) {
    console.error('[saveShopSettings]', err)
    return { ok: false, error: 'Erro ao salvar configurações da barbearia.' }
  }
}

// ---------------------------------------------------------------------------
// Admin Channel Config + PIN generation
// ---------------------------------------------------------------------------

const ADMIN_PIN_TTL_MS = 5 * 60 * 1000

/** Normalize + dedupe admin/notify phones and forbid the shop's own line. */
export function normalizeAdminPhones(
  rawPhones: string[],
  shopPhone: string | null,
): { ok: true; phones: string[] } | { ok: false; error: string } {
  const own = shopPhone ? normalizePhone(shopPhone) : null
  const out = new Set<string>()
  for (const raw of rawPhones) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const p = normalizePhone(trimmed)
    if (own && p === own) {
      return {
        ok: false,
        error: 'Use um número pessoal, diferente do número da barbearia.',
      }
    }
    out.add(p)
  }
  return { ok: true, phones: [...out] }
}

const AdminChannelSchema = z.object({
  adminPhones: z.array(z.string()).default([]),
  ownerNotifyPhone: z.string().optional(),
  notifyOwnerWhatsapp: z.boolean(),
})

export async function saveAdminChannelConfig(
  input: z.infer<typeof AdminChannelSchema>,
): Promise<ActionResult> {
  const { barbershop } = await requireOwner()
  const parsed = AdminChannelSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const admin = normalizeAdminPhones(parsed.data.adminPhones, barbershop.phone)
  if (!admin.ok) return admin

  let notifyPhone: string | null = null
  if (parsed.data.ownerNotifyPhone && parsed.data.ownerNotifyPhone.trim()) {
    const notify = normalizeAdminPhones([parsed.data.ownerNotifyPhone], barbershop.phone)
    if (!notify.ok) return notify
    notifyPhone = notify.phones[0] ?? null
  }

  try {
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: {
        adminPhones: admin.phones,
        ownerNotifyPhone: notifyPhone,
        notifyOwnerWhatsapp: parsed.data.notifyOwnerWhatsapp,
      },
    })
    return { ok: true }
  } catch (err) {
    console.error('[saveAdminChannelConfig]', err)
    return { ok: false, error: 'Erro ao salvar configuração do canal admin.' }
  }
}

/** Generate a single-use 6-digit PIN; store the hash + expiry, return plaintext once. */
export async function generateAdminPin(): Promise<
  ActionResult<{ pin: string; expiresAt: string }>
> {
  const { barbershop } = await requireOwner()
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(Date.now() + ADMIN_PIN_TTL_MS)
  try {
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: { adminPinHash: hashPin(pin), adminPinExpiresAt: expiresAt },
    })
    return { ok: true, data: { pin, expiresAt: expiresAt.toISOString() } }
  } catch (err) {
    console.error('[generateAdminPin]', err)
    return { ok: false, error: 'Erro ao gerar PIN.' }
  }
}
