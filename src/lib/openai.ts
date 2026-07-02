import 'server-only'
import OpenAI from 'openai'

let _client: OpenAI | null = null

/**
 * Returns true if OPENAI_API_KEY looks like a real key (starts with 'sk-' and longer than 30 chars).
 * Does NOT print the key value.
 */
export function isOpenAIConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY ?? ''
  return key.startsWith('sk-') && key.length > 30
}

/**
 * Lazy singleton — throws a friendly pt-BR error when the key is a placeholder.
 */
export function getOpenAIClient(): OpenAI {
  if (_client) return _client
  if (!isOpenAIConfigured()) {
    throw new Error(
      'Serviço de IA não disponível: OPENAI_API_KEY não configurada corretamente. ' +
        'Configure a variável de ambiente com uma chave válida.',
    )
  }
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

/** Resets the singleton — for testing only. */
export function _resetOpenAIClient(): void {
  _client = null
}
