/**
 * evolution-client.test.ts
 *
 * Tests for Evolution API client builders (URL construction, headers,
 * payload shapes, phone normalization, response parsing).
 * fetch is mocked — no real network calls.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildHeaders,
  buildUrl,
  buildWebhookConfig,
  normalizePhone,
  evolution,
} from './evolution-client'

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  process.env.EVOLUTION_URL = 'http://127.0.0.1:8080'
  process.env.EVOLUTION_API_KEY = 'test-api-key'
  process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-webhook-token'
})

afterEach(() => {
  // Restore env
  for (const key of ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_TOKEN']) {
    if (key in ENV_BACKUP) {
      process.env[key] = ENV_BACKUP[key]
    } else {
      delete process.env[key]
    }
  }
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Pure builders (no fetch)
// ---------------------------------------------------------------------------

describe('buildHeaders', () => {
  it('includes Content-Type and apikey', () => {
    const h = buildHeaders()
    expect(h['Content-Type']).toBe('application/json')
    expect(h['apikey']).toBe('test-api-key')
  })
})

describe('buildUrl', () => {
  it('joins base URL with path', () => {
    expect(buildUrl('/instance/create')).toBe('http://127.0.0.1:8080/instance/create')
  })

  it('strips trailing slash from EVOLUTION_URL before joining', () => {
    process.env.EVOLUTION_URL = 'http://127.0.0.1:8080/'
    expect(buildUrl('/instance/create')).toBe('http://127.0.0.1:8080/instance/create')
  })

  it('builds connectionState URL with instance name', () => {
    expect(buildUrl('/instance/connectionState/nav_abc123')).toBe(
      'http://127.0.0.1:8080/instance/connectionState/nav_abc123',
    )
  })
})

describe('buildWebhookConfig', () => {
  it('includes required events', () => {
    const cfg = buildWebhookConfig('http://host.docker.internal:3000/api/webhooks/evolution') as {
      events: string[]
    }
    expect(cfg.events).toContain('MESSAGES_UPSERT')
    expect(cfg.events).toContain('CONNECTION_UPDATE')
  })

  it('sets enabled = true and webhookByEvents = false', () => {
    const cfg = buildWebhookConfig('http://example.com') as {
      enabled: boolean
      webhookByEvents: boolean
    }
    expect(cfg.enabled).toBe(true)
    expect(cfg.webhookByEvents).toBe(false)
  })

  it('includes X-Navalia-Token header from EVOLUTION_WEBHOOK_TOKEN', () => {
    const cfg = buildWebhookConfig('http://example.com') as {
      headers: Record<string, string>
    }
    expect(cfg.headers['X-Navalia-Token']).toBe('test-webhook-token')
  })

  it('sets the webhook URL', () => {
    const webhookUrl = 'http://host.docker.internal:3000/api/webhooks/evolution'
    const cfg = buildWebhookConfig(webhookUrl) as { url: string }
    expect(cfg.url).toBe(webhookUrl)
  })
})

// ---------------------------------------------------------------------------
// normalizePhone
// ---------------------------------------------------------------------------

describe('normalizePhone', () => {
  it('leaves a 13-digit number (with country code) unchanged', () => {
    expect(normalizePhone('5571999998888')).toBe('5571999998888')
  })

  it('prefixes 55 on an 11-digit number (DDD + 9 + number)', () => {
    expect(normalizePhone('71999998888')).toBe('5571999998888')
  })

  it('prefixes 55 on a 10-digit number (DDD + number, landline)', () => {
    expect(normalizePhone('7199998888')).toBe('557199998888')
  })

  it('strips non-digit characters before normalizing', () => {
    expect(normalizePhone('(71) 9 9999-8888')).toBe('5571999998888')
  })

  it('strips @s.whatsapp.net JID suffix before normalizing', () => {
    expect(normalizePhone('5571999998888@s.whatsapp.net')).toBe('5571999998888')
  })

  it('strips JID and normalizes 11-digit raw number', () => {
    expect(normalizePhone('71999998888@s.whatsapp.net')).toBe('5571999998888')
  })
})

// ---------------------------------------------------------------------------
// evolution.createInstance (fetch mocked)
// ---------------------------------------------------------------------------

describe('evolution.createInstance', () => {
  it('POSTs to /instance/create with correct shape', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instance: { instanceName: 'nav_abc', instanceId: 'id-1', status: 'close' },
        webhook: { webhookUrl: 'http://example.com' },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await evolution.createInstance('nav_abc', 'http://example.com/webhook')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.qrBase64).toBeNull()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/instance/create')
    expect(opts.method).toBe('POST')

    const body = JSON.parse(opts.body as string)
    expect(body.instanceName).toBe('nav_abc')
    expect(body.integration).toBe('WHATSAPP-BAILEYS')
    expect(body.webhook.events).toContain('CONNECTION_UPDATE')
    expect(body.webhook.events).toContain('MESSAGES_UPSERT')
    expect(body.webhook.headers['X-Navalia-Token']).toBe('test-webhook-token')
  })

  it('returns ok: false on non-2xx response with statusCode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ response: { message: 'Instance already exists' } }),
    }))

    const result = await evolution.createInstance('nav_abc', 'http://example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('422')
      expect(result.statusCode).toBe(422)
    }
  })

  it('returns ok: false on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await evolution.createInstance('nav_abc', 'http://example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNREFUSED')
  })

  it('returns timeout error on fetch AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const result = await evolution.createInstance('nav_abc', 'http://example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Evolution API timeout')
  })
})

// ---------------------------------------------------------------------------
// evolution.getConnectionState (fetch mocked)
// ---------------------------------------------------------------------------

describe('evolution.getConnectionState', () => {
  it('GETs /instance/connectionState/{name} and maps state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instance: { instanceName: 'nav_abc', state: 'open' } }),
    }))

    const result = await evolution.getConnectionState('nav_abc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe('open')
  })

  it('maps "connecting" correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instance: { instanceName: 'nav_abc', state: 'connecting' } }),
    }))

    const result = await evolution.getConnectionState('nav_abc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe('connecting')
  })

  it('maps "close" correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instance: { instanceName: 'nav_abc', state: 'close' } }),
    }))

    const result = await evolution.getConnectionState('nav_abc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe('close')
  })

  it('uses GET method with apikey header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instance: { instanceName: 'nav_abc', state: 'close' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await evolution.getConnectionState('nav_abc')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/instance/connectionState/nav_abc')
    expect(opts.method).toBe('GET')
    expect((opts.headers as Record<string, string>)['apikey']).toBe('test-api-key')
  })
})

// ---------------------------------------------------------------------------
// evolution.getQr (fetch mocked)
// ---------------------------------------------------------------------------

describe('evolution.getQr', () => {
  it('returns qrBase64 when base64 field is present and count > 0', async () => {
    const fakeBase64 = 'data:image/png;base64,iVBORw0KGgo='
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ base64: fakeBase64, count: 1 }),
    }))

    const result = await evolution.getQr('nav_abc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.qrBase64).toBe(fakeBase64)
  })

  it('returns ok: false when count = 0 (QR not ready)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    }))

    const result = await evolution.getQr('nav_abc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('QR')
  })

  it('GETs /instance/connect/{name}', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ base64: 'data:image/png;base64,abc', count: 1 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await evolution.getQr('nav_abc')

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/instance/connect/nav_abc')
  })
})

// ---------------------------------------------------------------------------
// evolution.sendText (fetch mocked) — validates request shape only
// (can't test live without a connected phone)
// ---------------------------------------------------------------------------

describe('evolution.sendText', () => {
  it('POSTs to /message/sendText/{name} with normalized phone and text', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: 'msg-1' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await evolution.sendText('nav_abc', '71999998888', 'Olá!')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/message/sendText/nav_abc')
    expect(opts.method).toBe('POST')

    const body = JSON.parse(opts.body as string)
    expect(body.number).toBe('5571999998888') // normalized
    expect(body.text).toBe('Olá!')
  })

  it('normalizes JID phone for sendText', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: 'msg-2' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await evolution.sendText('nav_abc', '71999998888@s.whatsapp.net', 'Teste')

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.number).toBe('5571999998888')
  })
})

// ---------------------------------------------------------------------------
// evolution.logout (fetch mocked)
// ---------------------------------------------------------------------------

describe('evolution.logout', () => {
  it('DELETEs /instance/logout/{name}', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await evolution.logout('nav_abc')
    expect(result.ok).toBe(true)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/instance/logout/nav_abc')
    expect(opts.method).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// evolution.deleteInstance (fetch mocked)
// ---------------------------------------------------------------------------

describe('evolution.deleteInstance', () => {
  it('DELETEs /instance/delete/{name}', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await evolution.deleteInstance('nav_abc')
    expect(result.ok).toBe(true)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/instance/delete/nav_abc')
    expect(opts.method).toBe('DELETE')
  })
})
