import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildCopilotTools } from '@/modules/ai/tools/copilot-tools'
import type { ToolCtx } from '@/modules/ai/types'

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

  // 3. Load AiActionLog — tenant fence (→ 404) + capture toolName/input for later
  const log = await prisma.aiActionLog.findFirst({
    where: { id: actionId, barbershopId: barbershop.id },
  })

  if (!log) {
    return NextResponse.json({ error: 'Ação não encontrada.' }, { status: 404 })
  }

  // 4. Atomic claim — prevents concurrent double-execution.
  //    Transitions PENDING_CONFIRMATION → REJECTED (reject) or PROCESSING (confirm).
  //    If count === 0 the row was already claimed by a concurrent request or was not pending.
  const claim = await prisma.aiActionLog.updateMany({
    where: { id: actionId, barbershopId: barbershop.id, status: 'PENDING_CONFIRMATION' },
    data: { status: reject ? 'REJECTED' : 'PROCESSING' },
  })

  if (claim.count !== 1) {
    return NextResponse.json({ error: 'Esta ação já foi processada.' }, { status: 409 })
  }

  // 5. REJECT path
  if (reject) {
    await prisma.aiActionLog.update({
      where: { id: actionId },
      data: {
        output: { rejectedBy: user.id } as Parameters<typeof prisma.aiActionLog.update>[0]['data']['output'],
      },
    })

    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'COPILOT_ACTION_REJECTED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName },
      },
    })

    return NextResponse.json({ ok: true, status: 'REJECTED' })
  }

  // 6. CONFIRM path — execute the stored sensitive action
  const tools = buildCopilotTools({ id: barbershop.id, timezone: barbershop.timezone }, 'OWNER')
  const toolDef = tools.find(t => t.name === log.toolName && t.sensitive === true)

  if (!toolDef) {
    await prisma.aiActionLog.update({
      where: { id: actionId },
      data: {
        status: 'ERROR',
        output: { error: `Ferramenta sensível "${log.toolName}" não encontrada.` } as Parameters<typeof prisma.aiActionLog.update>[0]['data']['output'],
      },
    })
    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'COPILOT_ACTION_FAILED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName, error: `Ferramenta sensível "${log.toolName}" não encontrada.` },
      },
    })
    return NextResponse.json(
      { ok: false, error: `Ferramenta "${log.toolName}" não encontrada ou não é sensível.` },
    )
  }

  // Use stored args (NOT client-resupplied) — tenant from server context only
  const storedInput = log.input
  const ctx: ToolCtx = {
    tenantId: barbershop.id,
    channel: 'COPILOT',
    userId: user.id,
  }

  let execResult: unknown
  let execError: string | null = null

  try {
    execResult = await toolDef.execute(storedInput, ctx)
  } catch (err) {
    execError = err instanceof Error ? err.message : 'Erro inesperado na execução.'
  }

  // Detect error in result object
  if (
    !execError &&
    typeof execResult === 'object' &&
    execResult !== null &&
    'error' in execResult
  ) {
    execError = (execResult as { error: string }).error
  }

  if (execError) {
    await prisma.aiActionLog.update({
      where: { id: actionId },
      data: {
        status: 'ERROR',
        output: { error: execError } as Parameters<typeof prisma.aiActionLog.update>[0]['data']['output'],
      },
    })
    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId: user.id,
        action: 'COPILOT_ACTION_FAILED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName, error: execError },
      },
    })
    return NextResponse.json({ ok: false, error: `Erro ao executar ação: ${execError}` })
  }

  // Success — stamp CONFIRMED + confirmedAt
  await prisma.aiActionLog.update({
    where: { id: actionId },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      output: execResult as Parameters<typeof prisma.aiActionLog.update>[0]['data']['output'],
    },
  })

  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId: user.id,
      action: 'COPILOT_ACTION_CONFIRMED',
      entity: 'AiActionLog',
      entityId: actionId,
      payload: { toolName: log.toolName },
    },
  })

  return NextResponse.json({ ok: true, status: 'CONFIRMED', result: execResult })
}
