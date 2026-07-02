'use server'

import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/modules/tenancy/context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export type HumanConversation = {
  id: string
  customerPhone: string
  lastMessageAt: Date
}

// ---------------------------------------------------------------------------
// getHumanConversations — list conversations in TRANSFERRED_TO_HUMAN state
// ---------------------------------------------------------------------------

export async function getHumanConversations(): Promise<HumanConversation[]> {
  const { barbershop } = await requireOwner()

  const convs = await prisma.whatsappConversation.findMany({
    where: {
      barbershopId: barbershop.id,
      state: 'TRANSFERRED_TO_HUMAN',
    },
    select: {
      id: true,
      customerPhone: true,
      lastMessageAt: true,
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  })

  return convs
}

// ---------------------------------------------------------------------------
// reopenConversation — set conversation state back to OPEN (reactivate bot)
// ---------------------------------------------------------------------------

export async function reopenConversation(
  conversationId: string,
): Promise<ActionResult> {
  const { barbershop, user } = await requireOwner()

  const conv = await prisma.whatsappConversation.findFirst({
    where: {
      id: conversationId,
      barbershopId: barbershop.id,
      state: 'TRANSFERRED_TO_HUMAN',
    },
    select: { id: true, customerPhone: true },
  })

  if (!conv) {
    return { ok: false, error: 'Conversa não encontrada ou já está com atendimento automático.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.whatsappConversation.update({
      where: { id: conv.id },
      data: { state: 'OPEN' },
    })
    await tx.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'WHATSAPP_BOT_REOPENED',
        entity: 'WhatsappConversation',
        entityId: conv.id,
        payload: { customerPhone: conv.customerPhone },
      },
    })
  })

  return { ok: true }
}
