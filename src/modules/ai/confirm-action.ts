import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildCopilotTools } from '@/modules/ai/tools/copilot-tools'
import type { Channel, ToolCtx } from '@/modules/ai/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfirmResult =
  | { ok: true; data: { toolName: string; output: unknown; rejected: boolean } }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'ALREADY_PROCESSED' | 'NO_TOOL' | 'EXEC_ERROR' }

// ---------------------------------------------------------------------------
// confirmSensitiveAction
//
// Shared atomic claim + execute + log + audit path used by both the copilot
// web route and (later) the WhatsApp admin channel. Tenant identity always
// comes from `barbershop.id` (server context); the model's stored `input` is
// re-used verbatim — never re-supplied by a caller at confirm time.
// ---------------------------------------------------------------------------

export async function confirmSensitiveAction(args: {
  actionId: string
  barbershop: { id: string; timezone: string }
  userId: string
  channel: Channel
  reject?: boolean
}): Promise<ConfirmResult> {
  const { actionId, barbershop, userId, channel, reject = false } = args

  // 1. Tenant fence — 404 if the log does not belong to this barbershop.
  const log = await prisma.aiActionLog.findFirst({
    where: { id: actionId, barbershopId: barbershop.id },
  })
  if (!log) return { ok: false, error: 'Ação não encontrada.', code: 'NOT_FOUND' }

  // 2. Atomic claim — prevents concurrent double-execution.
  //    Transitions PENDING_CONFIRMATION → REJECTED (reject) or PROCESSING (confirm).
  //    If count === 0 the row was already claimed by a concurrent request or was not pending.
  const claim = await prisma.aiActionLog.updateMany({
    where: { id: actionId, barbershopId: barbershop.id, status: 'PENDING_CONFIRMATION' },
    data: { status: reject ? 'REJECTED' : 'PROCESSING' },
  })
  if (claim.count !== 1) {
    return { ok: false, error: 'Esta ação já foi processada.', code: 'ALREADY_PROCESSED' }
  }

  // 3. REJECT path
  if (reject) {
    await prisma.aiActionLog.update({
      where: { id: actionId },
      data: {
        output: { rejectedBy: userId } as never,
      },
    })
    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId,
        action: 'COPILOT_ACTION_REJECTED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName },
      },
    })
    return { ok: true, data: { toolName: log.toolName, output: null, rejected: true } }
  }

  // 4. CONFIRM path — rebuild the sensitive tool and execute with STORED input.
  const tools = buildCopilotTools({ id: barbershop.id, timezone: barbershop.timezone }, 'OWNER')
  const toolDef = tools.find((t) => t.name === log.toolName && t.sensitive === true)

  if (!toolDef) {
    const errMsg = `Ferramenta sensível "${log.toolName}" não encontrada.`
    await prisma.aiActionLog.update({
      where: { id: actionId },
      data: {
        status: 'ERROR',
        output: { error: errMsg } as never,
      },
    })
    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId,
        action: 'COPILOT_ACTION_FAILED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName, error: errMsg },
      },
    })
    return {
      ok: false,
      error: `Ferramenta "${log.toolName}" não encontrada ou não é sensível.`,
      code: 'NO_TOOL',
    }
  }

  // Use stored args (NOT client-resupplied) — tenant from server context only.
  const ctx: ToolCtx = { tenantId: barbershop.id, channel, userId }

  let execResult: unknown
  let execError: string | null = null

  try {
    execResult = await toolDef.execute(log.input, ctx)
  } catch (err) {
    execError = err instanceof Error ? err.message : 'Erro inesperado na execução.'
  }

  // Detect error embedded in the result object (tool convention).
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
        output: { error: execError } as never,
      },
    })
    await prisma.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId,
        action: 'COPILOT_ACTION_FAILED',
        entity: 'AiActionLog',
        entityId: actionId,
        payload: { toolName: log.toolName, error: execError },
      },
    })
    return {
      ok: false,
      error: `Erro ao executar ação: ${execError}`,
      code: 'EXEC_ERROR',
    }
  }

  // 5. Stamp CONFIRMED + confirmedAt + output.
  await prisma.aiActionLog.update({
    where: { id: actionId },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      output: execResult as never,
    },
  })
  await prisma.auditLog.create({
    data: {
      barbershopId: barbershop.id,
      userId,
      action: 'COPILOT_ACTION_CONFIRMED',
      entity: 'AiActionLog',
      entityId: actionId,
      payload: { toolName: log.toolName },
    },
  })

  return { ok: true, data: { toolName: log.toolName, output: execResult, rejected: false } }
}
