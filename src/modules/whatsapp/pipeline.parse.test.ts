import { describe, it, expect } from 'vitest'
import { parseMessagesUpsert } from './pipeline'

/**
 * Builds a v2.2-batch-shaped payload (the format parseMessagesUpsert reads:
 *   data.messages[0].{ key, message }).
 *
 * The brief's snippet used the v2.3 single-object shape; adapted here to
 * match the real function's data.messages[0] extraction path.
 */
function payload(message: Record<string, unknown>) {
  return {
    instance: 'nav_x',
    data: {
      messages: [
        {
          key: { id: 'm1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false },
          message,
        },
      ],
    },
  }
}

describe('parseMessagesUpsert kind', () => {
  it('classifies a text message', () => {
    const r = parseMessagesUpsert(payload({ conversation: 'oi' }))
    expect(r?.kind).toBe('text')
    expect(r?.text).toBe('oi')
    expect(r?.audioSeconds).toBeNull()
  })

  it('classifies an audio message (text stays null, raw + seconds carried)', () => {
    const r = parseMessagesUpsert(
      payload({ audioMessage: { url: 'x', seconds: 7, mimetype: 'audio/ogg' } }),
    )
    expect(r?.kind).toBe('audio')
    expect(r?.text).toBeNull()
    expect(r?.audioSeconds).toBe(7)
    expect(r?.rawMessage).toBeTruthy()
  })

  it('classifies other media as other', () => {
    const r = parseMessagesUpsert(payload({ imageMessage: { url: 'x' } }))
    expect(r?.kind).toBe('other')
    expect(r?.text).toBeNull()
  })
})
