import { prisma } from '@/lib/prisma'
import type { ToolCtx } from './types'

interface LogToolCallArgs {
  ctx: Pick<ToolCtx, 'tenantId' | 'channel' | 'userId'>
  toolName: string
  input: unknown
  output?: unknown
  status: 'EXECUTED' | 'ERROR' | 'PENDING_CONFIRMATION'
  requiresConfirmation?: boolean
}

/**
 * Writes an AiActionLog row for every tool call.
 * Never throws — on failure logs to console.error and returns ''.
 * @returns the AiActionLog id, or '' on error.
 */
export async function logToolCall({
  ctx,
  toolName,
  input,
  output,
  status,
  requiresConfirmation = false,
}: LogToolCallArgs): Promise<string> {
  try {
    const log = await prisma.aiActionLog.create({
      data: {
        barbershopId: ctx.tenantId,
        channel: ctx.channel,
        toolName,
        input: input as Parameters<typeof prisma.aiActionLog.create>[0]['data']['input'],
        output:
          output !== undefined
            ? (output as Parameters<typeof prisma.aiActionLog.create>[0]['data']['output'])
            : undefined,
        status,
        requiresConfirmation,
        userId: ctx.userId,
      },
    })
    return log.id
  } catch (err) {
    console.error('[logToolCall] failed to write AiActionLog:', err)
    return ''
  }
}
