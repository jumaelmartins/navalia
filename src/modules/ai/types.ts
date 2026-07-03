// ---------------------------------------------------------------------------
// AI module public contracts — Task 15
// ---------------------------------------------------------------------------

export type Channel = 'WHATSAPP' | 'AI_WEB' | 'COPILOT' | 'WHATSAPP_ADMIN'

export type ChatMsg = { role: 'user' | 'assistant'; content: string }

export type ToolDef = {
  name: string
  description: string
  parameters: object // JSON schema
  execute(args: unknown, ctx: ToolCtx): Promise<unknown>
  sensitive?: boolean // copilot-only: return pendingAction instead of executing
}

export type ToolCtx = {
  tenantId: string
  channel: Channel
  userId?: string
  customerPhone?: string
}

/** id = AiActionLog id */
export type PendingAction = {
  id: string
  toolName: string
  summary: string
  args: unknown
}

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Full signature for runAssistant — implementation lives in orchestrator.ts */
export type RunAssistantFn = (args: {
  channel: Channel
  tenantId: string
  history: ChatMsg[]
  userMessage: string
  tools: ToolDef[]
  systemPrompt: string
  ctx: ToolCtx
}) => Promise<AiResult<{ reply: string; pendingAction?: PendingAction }>>
