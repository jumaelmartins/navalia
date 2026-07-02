'use server'

import { z } from 'zod'
import { requireOwner } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'

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
