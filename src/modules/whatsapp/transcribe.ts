import 'server-only'
import type OpenAI from 'openai'
import { toFile } from 'openai'
import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export async function transcribeAudio(args: {
  base64: string
  mimetype: string
  contextPrompt?: string
  _client?: OpenAI
}): Promise<Result<{ text: string }>> {
  let client: OpenAI
  if (args._client) {
    client = args._client
  } else {
    if (!isOpenAIConfigured()) return { ok: false, error: 'OPENAI_API_KEY não configurada.' }
    try {
      client = getOpenAIClient()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erro ao iniciar OpenAI.' }
    }
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe'
  try {
    const file = await toFile(Buffer.from(args.base64, 'base64'), 'audio.ogg', {
      type: args.mimetype,
    })
    const res = await client.audio.transcriptions.create({
      model,
      file,
      language: 'pt',
      ...(args.contextPrompt ? { prompt: args.contextPrompt } : {}),
    })
    const text = typeof res.text === 'string' ? res.text.trim() : ''
    if (!text) return { ok: false, error: 'Transcrição vazia.' }
    return { ok: true, data: { text } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro na transcrição.' }
  }
}
