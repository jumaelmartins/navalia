import 'server-only'

/**
 * evolution-client.ts
 *
 * Thin, Result-typed fetch wrapper around Evolution API v2.2.3.
 * All network errors and non-2xx responses are returned as { ok: false, error }.
 *
 * API shape notes (verified against live container):
 *  - POST /instance/create → {instance, webhook: {webhookUrl, webhookHeaders?}, ...}
 *    response has NO qrBase64 regardless of "qrcode" flag; QR is fetched separately.
 *  - GET  /instance/connect/{name} → {base64: string, count: N} when QR ready
 *                                   → {count: 0} when QR not yet generated
 *    The field is "base64", NOT "qrBase64".
 *  - GET  /instance/connectionState/{name} → {instance: {instanceName, state}}
 *    state values: "open" | "connecting" | "close"
 *  - DELETE /instance/logout/{name} → 200 on success, 404 if not found
 *  - DELETE /instance/delete/{name} → {status:"SUCCESS", error:false, response:{message}}
 *  - POST /message/sendText/{name}  → {key, message, ...} on success
 *    Body shape: {number, text}  (plain digits; Evolution resolves JID internally)
 *
 * Webhook auth: Evolution v2.2.3 supports custom webhook headers via
 *   webhook.headers in create payload. We send "X-Navalia-Token" header.
 *   The route verifies this header against EVOLUTION_WEBHOOK_TOKEN.
 */

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; statusCode?: number }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function baseUrl(): string {
  const url = process.env.EVOLUTION_URL
  if (!url) throw new Error('EVOLUTION_URL is not set')
  return url.replace(/\/$/, '')
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY
  if (!key) throw new Error('EVOLUTION_API_KEY is not set')
  return key
}

/** Build default headers for every Evolution request. */
export function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey(),
  }
}

/** Build the full URL for a given path. */
export function buildUrl(path: string): string {
  return `${baseUrl()}${path}`
}

/**
 * Normalize a phone number for use with Evolution's sendText endpoint.
 *
 * Rules (same philosophy as deep-link.ts):
 *  - Strip non-digit characters.
 *  - If the result is 10 or 11 digits (Brazilian local format), prefix "55".
 *  - Otherwise keep as-is (already has country code or is a JID).
 *  - Strip trailing @s.whatsapp.net JID suffix if present (Evolution handles JID).
 */
export function normalizePhone(phone: string): string {
  const withoutJid = phone.replace(/@s\.whatsapp\.net$/, '')
  const digits = withoutJid.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return '55' + digits
  return digits
}

/** Build the webhook config object for createInstance. */
export function buildWebhookConfig(webhookUrl: string): object {
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN ?? ''
  return {
    enabled: true,
    url: webhookUrl,
    webhookByEvents: false,
    webhookBase64: false,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    headers: { 'X-Navalia-Token': token },
  }
}

/** Generic fetch wrapper — returns Result<T>. Includes 12s timeout. */
async function apiFetch<T>(
  url: string,
  options: RequestInit,
): Promise<Result<T>> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)

  let res: Response
  try {
    res = await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    const error = err as Error
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Evolution API timeout' }
    }
    return { ok: false, error: `Network error: ${error.message}` }
  } finally {
    clearTimeout(timeoutId)
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'response' in body
        ? JSON.stringify((body as { response: unknown }).response)
        : String(res.status)
    return { ok: false, error: `Evolution API error ${res.status}: ${msg}`, statusCode: res.status }
  }

  return { ok: true, data: body as T }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const evolution = {
  /**
   * Create a new Evolution instance and configure webhook.
   * Returns qrBase64 = null (QR is not in the create response; call getQr after).
   */
  async createInstance(
    instanceName: string,
    webhookUrl: string,
  ): Promise<Result<{ qrBase64: string | null }>> {
    const url = buildUrl('/instance/create')
    const body = {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: buildWebhookConfig(webhookUrl),
    }

    const result = await apiFetch<unknown>(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    })

    if (!result.ok) return result
    return { ok: true, data: { qrBase64: null } }
  },

  /**
   * Get the current connection state of an instance.
   * Maps Evolution state to our union: "open" | "connecting" | "close".
   */
  async getConnectionState(
    instanceName: string,
  ): Promise<Result<'open' | 'connecting' | 'close'>> {
    const url = buildUrl(`/instance/connectionState/${encodeURIComponent(instanceName)}`)

    const result = await apiFetch<{
      instance: { instanceName: string; state: string }
    }>(url, {
      method: 'GET',
      headers: buildHeaders(),
    })

    if (!result.ok) return result

    const state = result.data.instance?.state
    if (state === 'open' || state === 'connecting' || state === 'close') {
      return { ok: true, data: state }
    }
    // Treat unknown states as close
    return { ok: true, data: 'close' }
  },

  /**
   * Get the QR code for an instance.
   * Returns ok: true with qrBase64 when QR is ready (count > 0).
   * Returns ok: false with error "QR não disponível" when count == 0.
   */
  async getQr(
    instanceName: string,
  ): Promise<Result<{ qrBase64: string }>> {
    const url = buildUrl(`/instance/connect/${encodeURIComponent(instanceName)}`)

    const result = await apiFetch<{ base64?: string; count: number }>(url, {
      method: 'GET',
      headers: buildHeaders(),
    })

    if (!result.ok) return result

    if (result.data.count === 0 || !result.data.base64) {
      return { ok: false, error: 'QR não disponível ainda. Aguarde alguns segundos.' }
    }

    return { ok: true, data: { qrBase64: result.data.base64 } }
  },

  /**
   * Send a text message via an Evolution instance.
   * toPhone: plain digits (normalizePhone applied internally).
   */
  async sendText(
    instanceName: string,
    toPhone: string,
    text: string,
  ): Promise<Result<Record<string, unknown>>> {
    const url = buildUrl(`/message/sendText/${encodeURIComponent(instanceName)}`)
    const body = {
      number: normalizePhone(toPhone),
      text,
    }

    return apiFetch<Record<string, unknown>>(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    })
  },

  /**
   * Logout from WhatsApp (disconnect session, keep instance).
   * Instance can reconnect later without re-creating.
   */
  async logout(
    instanceName: string,
  ): Promise<Result<Record<string, unknown>>> {
    const url = buildUrl(`/instance/logout/${encodeURIComponent(instanceName)}`)

    return apiFetch<Record<string, unknown>>(url, {
      method: 'DELETE',
      headers: buildHeaders(),
    })
  },

  /**
   * Delete an Evolution instance entirely (recovery/reset path).
   * After this, a new instance must be created.
   */
  async deleteInstance(
    instanceName: string,
  ): Promise<Result<Record<string, unknown>>> {
    const url = buildUrl(`/instance/delete/${encodeURIComponent(instanceName)}`)

    return apiFetch<Record<string, unknown>>(url, {
      method: 'DELETE',
      headers: buildHeaders(),
    })
  },
}
