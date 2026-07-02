import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPublicShop } from '@/modules/booking/public-actions'
import { isOpenAIConfigured } from '@/lib/openai'
import { rateLimit } from '@/lib/rate-limit'
import { runAssistant } from '@/modules/ai/orchestrator'
import { buildPublicTools } from '@/modules/ai/tools/public-tools'
import { publicSystemPrompt } from '@/modules/ai/prompts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNAVAILABLE_REPLY =
  'O assistente está indisponível no momento. Use o formulário de agendamento acima.'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ChatMsgSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000),
})

const BodySchema = z.object({
  slug: z.string().min(1),
  history: z.array(ChatMsgSchema).max(20).default([]),
  message: z.string().min(1).max(1000),
})

// ---------------------------------------------------------------------------
// IP helper
// ---------------------------------------------------------------------------

/**
 * Extract client IP from request headers.
 *
 * Deployment assumption: A reverse proxy (Caddy) is configured to set X-Forwarded-For.
 * Without a proxy, all clients share the 'unknown' bucket — acceptable in dev only.
 *
 * Fallback chain:
 *   1. X-Forwarded-For (first value, before any commas)
 *   2. X-Real-IP
 *   3. 'unknown' (conservative default)
 */
function getClientIp(req: NextRequest): string {
  // X-Forwarded-For may contain a comma-separated list (proxy chain)
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  // Fallback to X-Real-IP if X-Forwarded-For is absent
  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // Conservative default when no proxy headers are present
  return 'unknown'
}

// ---------------------------------------------------------------------------
// POST /api/ai/assistant
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Parse body
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Dados inválidos: ' +
          parsed.error.issues.map(e => e.message).join(', '),
      },
      { status: 400 },
    )
  }

  const { slug, history, message } = parsed.data

  // 2. Resolve shop by slug + subscription access rule
  let shop: Awaited<ReturnType<typeof getPublicShop>>
  try {
    shop = await getPublicShop(slug)
  } catch {
    shop = null
  }

  if (!shop) {
    return NextResponse.json({ error: 'Página indisponível.' }, { status: 404 })
  }

  // 3. Rate limit: 20 msgs / 5 min per IP
  const ip = getClientIp(req)
  let rl: { allowed: boolean; remaining: number }
  try {
    rl = await rateLimit(`rl:web:${ip}`, 20, 300)
  } catch {
    // Redis unavailable — fail open (don't block the user)
    rl = { allowed: true, remaining: 20 }
  }

  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          'Limite de mensagens atingido. Aguarde alguns minutos antes de continuar.',
      },
      { status: 429, headers: { 'Retry-After': '300' } },
    )
  }

  // 4. OpenAI not configured → graceful 200
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ reply: UNAVAILABLE_REPLY })
  }

  // 5. Run assistant
  try {
    const today = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: shop.id,
      history,
      userMessage: message,
      tools: buildPublicTools(),
      systemPrompt: publicSystemPrompt(shop, 'AI_WEB', today),
      ctx: { tenantId: shop.id, channel: 'AI_WEB' },
    })

    if (!result.ok) {
      return NextResponse.json({ reply: UNAVAILABLE_REPLY })
    }

    return NextResponse.json({ reply: result.data.reply })
  } catch {
    return NextResponse.json({ reply: UNAVAILABLE_REPLY })
  }
}
