import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { evolution } from './evolution-client'

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  process.env.EVOLUTION_URL = 'http://127.0.0.1:8080'
  process.env.EVOLUTION_API_KEY = 'test-api-key'
})

afterEach(() => {
  for (const key of ['EVOLUTION_URL', 'EVOLUTION_API_KEY']) {
    if (key in ENV_BACKUP) {
      process.env[key] = ENV_BACKUP[key]
    } else {
      delete process.env[key]
    }
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('evolution.getBase64FromMedia', () => {
  it('POSTs the message and returns base64 + mimetype', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ base64: 'AAAA', mimetype: 'audio/ogg' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await evolution.getBase64FromMedia('nav_x', { key: { id: 'm1' } })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.base64).toBe('AAAA')
      expect(res.data.mimetype).toBe('audio/ogg')
    }
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/chat/getBase64FromMediaMessage/nav_x')
    expect(opts.method).toBe('POST')
  })

  it('returns an error Result on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    const res = await evolution.getBase64FromMedia('nav_x', { key: { id: 'm1' } })
    expect(res.ok).toBe(false)
  })

  it('returns an error Result when base64 is absent from response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ mimetype: 'audio/ogg' }), { status: 200 }),
      ),
    )
    const res = await evolution.getBase64FromMedia('nav_x', { key: { id: 'm1' } })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('base64')
    }
  })

  it('defaults mimetype to audio/ogg when missing from response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ base64: 'BBBB' }), { status: 200 }),
      ),
    )
    const res = await evolution.getBase64FromMedia('nav_x', { key: { id: 'm1' } })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.base64).toBe('BBBB')
      expect(res.data.mimetype).toBe('audio/ogg')
    }
  })
})
