import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { confirmSensitiveAction } from '@/modules/ai/confirm-action'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  actionId: z.string().min(1),
  reject: z.boolean().optional().default(false),
})

// ---------------------------------------------------------------------------
// POST /api/ai/copilot/confirm
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — OWNER only
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

  if (user.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Apenas o proprietário pode confirmar ou rejeitar ações.' },
      { status: 403 },
    )
  }

  const barbershop = user.barbershop

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

  const { actionId, reject } = parsed.data

  // 3. Delegate to the shared module (also used by WhatsApp admin channel).
  const result = await confirmSensitiveAction({
    actionId,
    barbershop: { id: barbershop.id, timezone: barbershop.timezone },
    userId: user.id,
    channel: 'COPILOT',
    reject,
  })

  if (!result.ok) {
    if (result.code === 'NOT_FOUND') {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }
    if (result.code === 'ALREADY_PROCESSED') {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }
    // NO_TOOL, EXEC_ERROR: preserve original route behavior (200 with ok: false)
    return NextResponse.json({ ok: false, error: result.error })
  }

  return NextResponse.json({
    ok: true,
    status: result.data.rejected ? 'REJECTED' : 'CONFIRMED',
    result: result.data.output,
  })
}
