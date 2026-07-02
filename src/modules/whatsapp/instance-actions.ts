'use server'

import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/modules/tenancy/context'
import { evolution } from '@/modules/whatsapp/evolution-client'

// ---------------------------------------------------------------------------
// Result type (pt-BR errors, matching project conventions)
// ---------------------------------------------------------------------------

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function webhookUrl(): string {
  const base =
    process.env.EVOLUTION_WEBHOOK_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/api/webhooks/evolution`
}

function instanceName(barbershopId: string): string {
  return `nav_${barbershopId}`
}

// ---------------------------------------------------------------------------
// connectWhatsApp
// ---------------------------------------------------------------------------

/**
 * Create an Evolution instance for the barbershop (idempotent — reuses
 * existing evolutionInstanceId if already set) and return the QR code.
 *
 * Status flow: CONNECTING → CONNECTED (via webhook CONNECTION_UPDATE).
 */
export async function connectWhatsApp(): Promise<
  ActionResult<{ qrBase64: string | null; status: 'CONNECTING' | 'CONNECTED' }>
> {
  const { barbershop, user } = await requireOwner()

  const name = instanceName(barbershop.id)

  // Create the Evolution instance if not yet registered
  if (!barbershop.evolutionInstanceId) {
    const createRes = await evolution.createInstance(name, webhookUrl())
    if (!createRes.ok) {
      return { ok: false, error: `Erro ao criar instância WhatsApp: ${createRes.error}` }
    }

    await prisma.$transaction(async (tx) => {
      await tx.barbershop.update({
        where: { id: barbershop.id },
        data: {
          evolutionInstanceId: name,
          whatsappStatus: 'CONNECTING',
        },
      })
      await tx.auditLog.create({
        data: {
          barbershopId: barbershop.id,
          userId: user.id,
          action: 'WHATSAPP_CONNECT_INITIATED',
          entity: 'Barbershop',
          entityId: barbershop.id,
          payload: { instanceName: name },
        },
      })
    })
  } else {
    // Instance already exists — just ensure status is CONNECTING
    await prisma.barbershop.update({
      where: { id: barbershop.id },
      data: { whatsappStatus: 'CONNECTING' },
    })
  }

  // Fetch QR (may return null if not ready yet — UI polls)
  const qrRes = await evolution.getQr(name)
  const qrBase64 = qrRes.ok ? qrRes.data.qrBase64 : null

  return { ok: true, data: { qrBase64, status: 'CONNECTING' } }
}

// ---------------------------------------------------------------------------
// refreshWhatsAppStatus
// ---------------------------------------------------------------------------

/**
 * Poll Evolution for the current connection state and persist to DB.
 * Returns the updated WhatsappStatus + QR (if still connecting).
 */
export async function refreshWhatsAppStatus(): Promise<
  ActionResult<{
    status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'
    qrBase64: string | null
  }>
> {
  const { barbershop } = await requireOwner()

  const name = barbershop.evolutionInstanceId ?? instanceName(barbershop.id)

  const stateRes = await evolution.getConnectionState(name)
  if (!stateRes.ok) {
    return { ok: false, error: `Erro ao verificar status: ${stateRes.error}` }
  }

  const statusMap = {
    open: 'CONNECTED',
    connecting: 'CONNECTING',
    close: 'DISCONNECTED',
  } as const

  const newStatus = statusMap[stateRes.data] ?? 'DISCONNECTED'

  await prisma.barbershop.update({
    where: { id: barbershop.id },
    data: { whatsappStatus: newStatus },
  })

  // If still connecting, try to return a fresh QR
  let qrBase64: string | null = null
  if (newStatus === 'CONNECTING') {
    const qrRes = await evolution.getQr(name)
    qrBase64 = qrRes.ok ? qrRes.data.qrBase64 : null
  }

  return { ok: true, data: { status: newStatus, qrBase64 } }
}

// ---------------------------------------------------------------------------
// disconnectWhatsApp
// ---------------------------------------------------------------------------

/**
 * Logout from WhatsApp (session ends, instance remains).
 * Sets status to DISCONNECTED. User can reconnect without re-creating.
 */
export async function disconnectWhatsApp(): Promise<ActionResult> {
  const { barbershop, user } = await requireOwner()

  const name = barbershop.evolutionInstanceId ?? instanceName(barbershop.id)

  const logoutRes = await evolution.logout(name)
  // 404 (already disconnected) is acceptable — treat as success
  if (!logoutRes.ok && !logoutRes.error.includes('404')) {
    return { ok: false, error: `Erro ao desconectar: ${logoutRes.error}` }
  }

  await prisma.$transaction(async (tx) => {
    await tx.barbershop.update({
      where: { id: barbershop.id },
      data: { whatsappStatus: 'DISCONNECTED' },
    })
    await tx.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'WHATSAPP_DISCONNECTED',
        entity: 'Barbershop',
        entityId: barbershop.id,
        payload: { instanceName: name },
      },
    })
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// resetWhatsApp
// ---------------------------------------------------------------------------

/**
 * Delete the Evolution instance entirely and clear DB state.
 * Recovery path when something is broken — next connectWhatsApp
 * creates a fresh instance.
 */
export async function resetWhatsApp(): Promise<ActionResult> {
  const { barbershop, user } = await requireOwner()

  const name = barbershop.evolutionInstanceId ?? instanceName(barbershop.id)

  // Attempt to delete — if already gone, continue
  const deleteRes = await evolution.deleteInstance(name)
  if (!deleteRes.ok && !deleteRes.error.includes('404')) {
    return { ok: false, error: `Erro ao remover instância: ${deleteRes.error}` }
  }

  await prisma.$transaction(async (tx) => {
    await tx.barbershop.update({
      where: { id: barbershop.id },
      data: {
        evolutionInstanceId: null,
        whatsappStatus: 'DISCONNECTED',
      },
    })
    await tx.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'WHATSAPP_RESET',
        entity: 'Barbershop',
        entityId: barbershop.id,
        payload: { instanceName: name },
      },
    })
  })

  return { ok: true }
}
