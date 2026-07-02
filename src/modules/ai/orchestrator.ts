import 'server-only'
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions'
import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai'
import { logToolCall } from './log'
import type { Channel, ChatMsg, ToolDef, ToolCtx, PendingAction, AiResult } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 6
const FALLBACK_REPLY =
  'Desculpe, não consegui completar sua solicitação no momento. Por favor, tente novamente ou entre em contato com a barbearia diretamente.'

// ---------------------------------------------------------------------------
// runAssistant
// ---------------------------------------------------------------------------

/**
 * Runs the AI assistant loop:
 * - Composes messages (system + last-20 history + user)
 * - Iterates up to MAX_ITERATIONS calling OpenAI with tools
 * - On tool_calls: executes each tool, logs every call, feeds results back
 * - Sensitive tools: return pendingAction instead of executing
 * - Returns the first text reply or a fallback after iteration cap
 */
export async function runAssistant(args: {
  channel: Channel
  tenantId: string
  history: ChatMsg[]
  userMessage: string
  tools: ToolDef[]
  systemPrompt: string
  ctx: ToolCtx
  /** Injectable OpenAI client — for testing only */
  _client?: OpenAI
}): Promise<AiResult<{ reply: string; pendingAction?: PendingAction }>> {
  const { history, userMessage, tools, systemPrompt, ctx } = args

  // Resolve OpenAI client (injected or lazy singleton)
  let client: OpenAI
  if (args._client) {
    client = args._client
  } else {
    if (!isOpenAIConfigured()) {
      return {
        ok: false,
        error:
          'Serviço de IA não disponível: OPENAI_API_KEY não configurada corretamente.',
      }
    }
    try {
      client = getOpenAIClient()
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Erro ao inicializar cliente OpenAI.',
      }
    }
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  // Build OpenAI function specs
  // Cast parameters: ToolDef.parameters is `object`; OpenAI expects FunctionParameters = {[key: string]: unknown}
  const openAITools: ChatCompletionTool[] = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }))

  // Window history to last 20 messages
  const windowedHistory = history.slice(-20)

  // Compose initial message list
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...windowedHistory.map(
      m => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam,
    ),
    { role: 'user', content: userMessage },
  ]

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // ---------------------------------------------------------------------------
    // Call OpenAI
    // ---------------------------------------------------------------------------
    let response: Awaited<ReturnType<typeof client.chat.completions.create>>
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        ...(openAITools.length > 0
          ? { tools: openAITools, tool_choice: 'auto' as const }
          : {}),
      })
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Erro na chamada à API do OpenAI.',
      }
    }

    const choice = response.choices?.[0]
    if (!choice) {
      return { ok: false, error: 'Resposta vazia da API do OpenAI.' }
    }

    const message = choice.message

    // No tool calls → final text reply
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = message.content ?? FALLBACK_REPLY
      return { ok: true, data: { reply } }
    }

    // Add assistant message (with tool_calls) to history
    messages.push(message)

    // ---------------------------------------------------------------------------
    // Execute each tool call
    // ---------------------------------------------------------------------------
    const toolResultMessages: ChatCompletionMessageParam[] = []

    for (const rawToolCall of message.tool_calls) {
      // Only handle function-type tool calls (skip 'custom' tool calls)
      if (rawToolCall.type !== 'function') {
        // Non-function tool call: push error result and log as ERROR
        const errorContent = JSON.stringify({
          error: `Tipo de ferramenta não suportado: ${rawToolCall.type}`,
        })
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: rawToolCall.id,
          content: errorContent,
        })
        await logToolCall({
          ctx,
          toolName: `[${rawToolCall.type}]`,
          input: {},
          output: { error: `Tipo de ferramenta não suportado: ${rawToolCall.type}` },
          status: 'ERROR',
        })
        continue
      }
      const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall

      const toolName = toolCall.function.name
      const toolDef = tools.find(t => t.name === toolName)

      // Unknown tool
      if (!toolDef) {
        const errorResult = { error: `Ferramenta "${toolName}" não reconhecida.` }
        const errorContent = JSON.stringify(errorResult)
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorContent,
        })
        // Log the unknown tool call as ERROR (Fix 1)
        let parsedArgs: unknown
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments)
        } catch {
          parsedArgs = {}
        }
        await logToolCall({
          ctx,
          toolName,
          input: parsedArgs,
          output: errorResult,
          status: 'ERROR',
        })
        continue
      }

      // Parse arguments (best-effort; Zod inside execute handles validation)
      let parsedArgs: unknown
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments)
      } catch {
        parsedArgs = {}
      }

      // --- Sensitive tool branch (Task 18 / COPILOT) ---
      if (toolDef.sensitive) {
        const logId = await logToolCall({
          ctx,
          toolName,
          input: parsedArgs,
          status: 'PENDING_CONFIRMATION',
          requiresConfirmation: true,
        })

        // M7: logToolCall returns '' on DB failure; a pendingAction with an
        // empty id cannot be confirmed, so return a visible error instead.
        if (!logId) {
          return {
            ok: true,
            data: {
              reply: 'Não consegui registrar a ação. Tente novamente.',
            },
          }
        }

        const pendingAction: PendingAction = {
          id: logId,
          toolName,
          summary: `Ação pendente de confirmação: ${toolName}`,
          args: parsedArgs,
        }

        return {
          ok: true,
          data: {
            reply: 'Esta ação requer aprovação do operador antes de ser executada.',
            pendingAction,
          },
        }
      }

      // --- Execute tool (catch any unexpected throw) ---
      let rawResult: unknown
      let logStatus: 'EXECUTED' | 'ERROR' = 'EXECUTED'

      try {
        rawResult = await toolDef.execute(parsedArgs, ctx)
      } catch (err) {
        rawResult = {
          error:
            err instanceof Error
              ? err.message
              : 'Erro inesperado na execução da ferramenta.',
        }
        logStatus = 'ERROR'
      }

      // Detect requiresConfirmation flag from the tool result
      const requiresConfirmation =
        typeof rawResult === 'object' &&
        rawResult !== null &&
        '_requiresConfirmation' in rawResult &&
        (rawResult as Record<string, unknown>)._requiresConfirmation === true

      // Strip internal flag before sending to model
      let resultForModel: unknown
      if (requiresConfirmation && typeof rawResult === 'object' && rawResult !== null) {
        const { _requiresConfirmation: _removed, ...rest } = rawResult as Record<
          string,
          unknown
        >
        void _removed
        resultForModel = rest
      } else {
        resultForModel = rawResult
      }

      // Fix 4: Detect Zod-validation failures (error-only result objects)
      // When a tool returns {error: '...'} with no other keys, log as ERROR (unless it's a guard-trip)
      if (
        logStatus === 'EXECUTED' &&
        !requiresConfirmation &&
        typeof resultForModel === 'object' &&
        resultForModel !== null
      ) {
        const keys = Object.keys(resultForModel as Record<string, unknown>)
        if (keys.length === 1 && keys[0] === 'error') {
          logStatus = 'ERROR'
        }
      }

      // Log every tool call
      await logToolCall({
        ctx,
        toolName,
        input: parsedArgs,
        output: resultForModel,
        status: logStatus,
        requiresConfirmation,
      })

      toolResultMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(resultForModel),
      })
    }

    // Add all tool results to messages and loop
    messages.push(...toolResultMessages)
  }

  // Iteration cap reached
  return { ok: true, data: { reply: FALLBACK_REPLY } }
}
