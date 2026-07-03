import { normalizePhone } from '@/modules/whatsapp/evolution-client'
import type { runAssistant as RunAssistant } from '@/modules/ai/orchestrator'
import type { buildCopilotTools as BuildCopilotTools } from '@/modules/ai/tools/copilot-tools'
import type { adminWhatsAppSystemPrompt as AdminPrompt } from '@/modules/ai/prompts'
import type { confirmSensitiveAction as ConfirmAction } from '@/modules/ai/confirm-action'
import { verifyPin as realVerifyPin } from '@/lib/pin'

export function isAdminPhone(adminPhones: string[], fromPhone: string): boolean {
  if (!adminPhones.length) return false
  const from = normalizePhone(fromPhone)
  return adminPhones.some((p) => normalizePhone(p) === from)
}

/** Decide how to treat an admin inbound message given whether an action is pending. */
export function classifyAdminInbound(
  text: string,
  hasPending: boolean,
): 'cancel' | 'pin' | 'reprompt' | 'command' {
  if (!hasPending) return 'command'
  const t = text.trim()
  if (t.toLowerCase() === 'cancelar') return 'cancel'
  if (/^\d{6}$/.test(t)) return 'pin'
  return 'reprompt'
}

// ---------------------------------------------------------------------------
// handleAdminTurn — PIN step-up state machine
// ---------------------------------------------------------------------------

export const ADMIN_PENDING_TTL_MS = 5 * 60 * 1000

export type AdminDeps = {
  runAssistant: typeof RunAssistant
  buildCopilotTools: typeof BuildCopilotTools
  adminPrompt: typeof AdminPrompt
  confirmSensitiveAction: typeof ConfirmAction
  verifyPin: typeof realVerifyPin
}

export type AdminTurnOutcome = {
  reply: string
  /** undefined = leave unchanged; null = clear */
  setPending?: { actionId: string; expiresAt: Date } | null
  /** true = clear adminPinHash/adminPinExpiresAt */
  consumePin?: boolean
}

export async function handleAdminTurn(args: {
  shop: {
    id: string
    name: string
    timezone: string
    adminPinHash: string | null
    adminPinExpiresAt: Date | null
  }
  ownerUserId: string
  conversation: { pendingActionId: string | null; pendingActionExpiresAt: Date | null }
  text: string
  history: { role: 'user' | 'assistant'; content: string }[]
  today: string
  now: Date
  deps: AdminDeps
}): Promise<AdminTurnOutcome> {
  const { shop, ownerUserId, conversation, text, history, today, now, deps } = args

  // Step 1: Expire a stale pending action.
  const pendingLive =
    !!conversation.pendingActionId &&
    !!conversation.pendingActionExpiresAt &&
    conversation.pendingActionExpiresAt > now
  const pendingId = pendingLive ? conversation.pendingActionId! : null
  const clearedStale = !!conversation.pendingActionId && !pendingLive

  // Step 2: Classify the inbound message.
  const kind = classifyAdminInbound(text, !!pendingId)

  // ---- Branch: live pending + cancel ----
  if (pendingId && kind === 'cancel') {
    const res = await deps.confirmSensitiveAction({
      actionId: pendingId,
      barbershop: { id: shop.id, timezone: shop.timezone },
      userId: ownerUserId,
      channel: 'WHATSAPP_ADMIN',
      reject: true,
    })
    return {
      reply: res.ok ? 'Ação cancelada.' : 'Essa ação já não estava mais pendente.',
      setPending: null,
    }
  }

  // ---- Branch: live pending + pin ----
  if (pendingId && kind === 'pin') {
    // Distinguish expired PIN from wrong PIN (gives clearer UX).
    if (shop.adminPinExpiresAt && shop.adminPinExpiresAt <= now) {
      return { reply: 'O PIN expirou. Gere um novo no painel e envie de novo.' }
    }

    const pinOk =
      !!shop.adminPinHash &&
      !!shop.adminPinExpiresAt &&
      shop.adminPinExpiresAt > now &&
      deps.verifyPin(text.trim(), shop.adminPinHash)

    if (!pinOk) {
      return { reply: 'PIN inválido. Gere um PIN no painel e envie os 6 dígitos.' }
    }

    const res = await deps.confirmSensitiveAction({
      actionId: pendingId,
      barbershop: { id: shop.id, timezone: shop.timezone },
      userId: ownerUserId,
      channel: 'WHATSAPP_ADMIN',
      reject: false,
    })
    const reply = res.ok ? 'Feito ✅' : `Não consegui concluir: ${res.error}`
    return { reply, setPending: null, consumePin: true }
  }

  // ---- Branch: live pending + reprompt ----
  if (pendingId && kind === 'reprompt') {
    return { reply: 'Há uma ação aguardando confirmação. Envie o PIN do painel ou "cancelar".' }
  }

  // ---- Branch: fresh command (no live pending) ----
  const tools = deps.buildCopilotTools({ id: shop.id, timezone: shop.timezone }, 'OWNER')
  const result = await deps.runAssistant({
    channel: 'WHATSAPP_ADMIN',
    tenantId: shop.id,
    history,
    userMessage: text,
    tools,
    systemPrompt: deps.adminPrompt({ name: shop.name }, today),
    ctx: { tenantId: shop.id, channel: 'WHATSAPP_ADMIN', userId: ownerUserId },
  })

  if (!result.ok) {
    return {
      reply: 'Não consegui processar agora. Tente de novo.',
      setPending: clearedStale ? null : undefined,
    }
  }

  if (result.data.pendingAction) {
    const expiresAt = new Date(now.getTime() + ADMIN_PENDING_TTL_MS)
    return {
      reply: `Para confirmar «${result.data.pendingAction.summary}», gere um PIN no painel (Configurações → WhatsApp Admin) e envie aqui. Ou responda "cancelar".`,
      setPending: { actionId: result.data.pendingAction.id, expiresAt },
    }
  }

  return { reply: result.data.reply, setPending: clearedStale ? null : undefined }
}
