import { normalizePhone } from '@/modules/whatsapp/evolution-client'

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
