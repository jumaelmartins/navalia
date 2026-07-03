import { describe, it, expect, vi } from 'vitest'
import { transcribeAudio } from './transcribe'

function client(text: string) {
  return {
    audio: { transcriptions: { create: vi.fn().mockResolvedValue({ text }) } },
  } as never
}

describe('transcribeAudio', () => {
  it('returns transcribed text', async () => {
    const res = await transcribeAudio({
      base64: Buffer.from('x').toString('base64'),
      mimetype: 'audio/ogg',
      _client: client('quero cortar cabelo amanhã'),
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.text).toContain('cortar cabelo')
  })

  it('returns an error Result when the API throws', async () => {
    const bad = { audio: { transcriptions: { create: vi.fn().mockRejectedValue(new Error('boom')) } } } as never
    const res = await transcribeAudio({ base64: 'AAAA', mimetype: 'audio/ogg', _client: bad })
    expect(res.ok).toBe(false)
  })
})
