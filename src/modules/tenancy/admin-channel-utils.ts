import { normalizePhone } from '@/modules/whatsapp/evolution-client'

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
