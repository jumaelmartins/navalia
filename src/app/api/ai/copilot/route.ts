import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isOpenAIConfigured } from '@/lib/openai'
import { rateLimit } from '@/lib/rate-limit'
import { runAssistant } from '@/modules/ai/orchestrator'
import { buildCopilotTools } from '@/modules/ai/tools/copilot-tools'
import { copilotSystemPrompt } from '@/modules/ai/prompts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNAVAILABLE_REPLY =
  'O copiloto de IA não está disponível no momento. Configure a chave OPENAI_API_KEY para ativar.'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ChatMsgSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000),
})

const BodySchema = z.object({
  history: z.array(ChatMsgSchema).max(20).default([]),
  message: z.string().min(1).max(1000),
})

// ---------------------------------------------------------------------------
// POST /api/ai/copilot
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const hdrs = await headers()
  const session = await auth.api.getSession({ headers: hdrs })
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { barbershop: true },
  })

  if (!user?.barbershop?.onboardingCompleted) {
    return NextResponse.json({ error: 'Barbearia não configurada.' }, { status: 403 })
  }

  const barbershop = user.barbershop
  const role = user.role as 'OWNER' | 'BARBER'

  // 2. Parse body
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos: ' + parsed.error.issues.map(e => e.message).join(', ') },
      { status: 400 },
    )
  }

  const { history, message } = parsed.data

  // 3. Rate limit: 30 msgs / 5 min per user
  let rl: { allowed: boolean; remaining: number }
  try {
    rl = await rateLimit(`rl:copilot:${user.id}`, 30, 300)
  } catch {
    rl = { allowed: true, remaining: 30 }
  }

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Limite de mensagens atingido. Aguarde alguns minutos antes de continuar.' },
      { status: 429, headers: { 'Retry-After': '300' } },
    )
  }

  // 4. OpenAI not configured → graceful 200
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ reply: UNAVAILABLE_REPLY })
  }

  // 5. Build tools + prompt
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: barbershop.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const tools = buildCopilotTools({ id: barbershop.id, timezone: barbershop.timezone }, role)
  const systemPrompt = copilotSystemPrompt({ name: barbershop.name }, user.name, role, today)

  // 6. Run assistant
  try {
    const result = await runAssistant({
      channel: 'COPILOT',
      tenantId: barbershop.id,
      history,
      userMessage: message,
      tools,
      systemPrompt,
      ctx: { tenantId: barbershop.id, channel: 'COPILOT', userId: user.id },
    })

    if (!result.ok) {
      return NextResponse.json({ reply: UNAVAILABLE_REPLY })
    }

    return NextResponse.json({ reply: result.data.reply, pendingAction: result.data.pendingAction ?? null })
  } catch {
    return NextResponse.json({ reply: UNAVAILABLE_REPLY })
  }
}
