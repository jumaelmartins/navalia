/**
 * orchestrator.test.ts
 *
 * Tests the AI orchestrator loop.  OpenAI client is injected via the _client
 * parameter — NO live API calls.  Prisma and the booking engine are mocked.
 *
 * Test cases:
 * (a) Loop executes a tool call, feeds result back, ends with text
 * (b) createAppointment with confirmed:false → NEEDS_CONFIRMATION, engine NOT called
 * (c) Every executed tool → AiActionLog row (spy on logToolCall)
 * (d) Zod-invalid tool args → error surfaced to model, loop continues
 * (e) Iteration cap → fallback reply
 * (f) Sensitive tool → pendingAction returned, execute NOT called, log PENDING_CONFIRMATION
 * (g) WHATSAPP channel forces ctx.customerPhone (engine receives ctx phone, not model arg)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAssistant } from './orchestrator'
import type { ToolDef, ToolCtx } from './types'

// ---------------------------------------------------------------------------
// Mock: @/lib/prisma  (for log.ts → aiActionLog.create)
// ---------------------------------------------------------------------------
const mockAiActionLogCreate = vi.fn().mockResolvedValue({ id: 'log-id-1' })

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiActionLog: {
      create: (...args: unknown[]) => mockAiActionLogCreate(...args),
    },
  },
}))

// ---------------------------------------------------------------------------
// Mock: booking engine (used by public-tools.ts)
// ---------------------------------------------------------------------------
const mockEngineCreate = vi.fn()
const mockEngineCancel = vi.fn()

vi.mock('@/modules/booking/create-appointment', () => ({
  createAppointment: (...args: unknown[]) => mockEngineCreate(...args),
  cancelAppointment: (...args: unknown[]) => mockEngineCancel(...args),
  getAvailableSlots: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CTX: ToolCtx = {
  tenantId: 'shop-1',
  channel: 'AI_WEB',
}

const WHATSAPP_CTX: ToolCtx = {
  tenantId: 'shop-1',
  channel: 'WHATSAPP',
  customerPhone: '5571999990000',
}

/** Builds a minimal mock OpenAI client */
function buildMockClient(responses: object[]) {
  let call = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const resp = responses[call] ?? responses[responses.length - 1]
          call++
          return Promise.resolve(resp)
        }),
      },
    },
  }
}

/** OpenAI response with a tool call */
function toolCallResponse(id: string, name: string, args: object) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  }
}

/** OpenAI response with a text reply */
function textResponse(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content, tool_calls: [] } }],
  }
}

/** A simple echo tool (no Zod, always succeeds) */
function echoTool(): ToolDef {
  return {
    name: 'echoTool',
    description: 'Echoes the input',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: [] },
    async execute(args) {
      return { echo: (args as { value?: string }).value ?? '' }
    },
  }
}

/** A tool that validates with Zod and rejects invalid input */
function zodTool(): ToolDef {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod')
  return {
    name: 'zodTool',
    description: 'Requires a numeric value',
    parameters: { type: 'object', properties: { num: { type: 'number' } }, required: ['num'] },
    async execute(args) {
      const schema = z.object({ num: z.number() })
      const parsed = schema.safeParse(args)
      if (!parsed.success) {
        return { error: `Argumentos inválidos: ${parsed.error.issues.map((e: { message: string }) => e.message).join(', ')}` }
      }
      return { doubled: parsed.data.num * 2 }
    },
  }
}

/** A sensitive tool (copilot-gated) */
function sensitiveTool(): ToolDef {
  return {
    name: 'sensitiveAction',
    description: 'Does something privileged',
    parameters: { type: 'object', properties: {}, required: [] },
    sensitive: true,
    async execute() {
      // should never be called
      return { done: true }
    },
  }
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockAiActionLogCreate.mockResolvedValue({ id: 'log-id-1' })
})

// ---------------------------------------------------------------------------
// (a) Loop executes a tool call and feeds result back, ends with text
// ---------------------------------------------------------------------------

describe('(a) tool call → result fed back → text reply', () => {
  it('executes echoTool and returns final text answer', async () => {
    const client = buildMockClient([
      toolCallResponse('call-1', 'echoTool', { value: 'hello' }),
      textResponse('Aqui está o resultado: hello'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test message',
      tools: [echoTool()],
      systemPrompt: 'You are a test assistant.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('not ok')
    expect(result.data.reply).toBe('Aqui está o resultado: hello')
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// (b) createAppointment with confirmed:false → NEEDS_CONFIRMATION, engine NOT called
// ---------------------------------------------------------------------------

describe('(b) createAppointment confirmed:false → NEEDS_CONFIRMATION, engine not called', () => {
  it('blocks booking and returns error to model without calling engine', async () => {
    // Import the actual public-tools to get the real createAppointment tool
    const { buildPublicTools } = await import('./tools/public-tools')

    // Mock prisma for getServices/barbershop queries used by other tools
    // (not needed here — createAppointment doesn't hit DB when guard trips)

    const tools = buildPublicTools()
    const createTool = tools.find(t => t.name === 'createAppointment')!

    const client = buildMockClient([
      toolCallResponse('call-1', 'createAppointment', {
        serviceId: 'svc-1',
        professionalId: 'prof-1',
        date: '2026-08-01',
        startTime: '10:00',
        customerName: 'João',
        customerPhone: '11999990001',
        confirmed: false,
      }),
      textResponse('Precisa confirmar antes de agendar.'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Quero agendar',
      tools: [createTool],
      systemPrompt: 'You are a test assistant.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    // Engine must NOT have been called
    expect(mockEngineCreate).not.toHaveBeenCalled()

    // The second OpenAI call should have received the NEEDS_CONFIRMATION error in the tool result
    const secondCall = client.chat.completions.create.mock.calls[1]
    const messages = secondCall[0].messages as Array<{ role: string; content: string }>
    const toolResultMsg = messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolResultMsg?.content).toContain('NEEDS_CONFIRMATION')
  })
})

// ---------------------------------------------------------------------------
// (c) Every executed tool → AiActionLog row
// ---------------------------------------------------------------------------

describe('(c) every executed tool → AiActionLog row', () => {
  it('logs one entry per tool call', async () => {
    const client = buildMockClient([
      toolCallResponse('call-1', 'echoTool', { value: 'test' }),
      textResponse('Done'),
    ])

    await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test',
      tools: [echoTool()],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(mockAiActionLogCreate).toHaveBeenCalledTimes(1)
    expect(mockAiActionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barbershopId: 'shop-1',
          channel: 'AI_WEB',
          toolName: 'echoTool',
          status: 'EXECUTED',
        }),
      }),
    )
  })

  it('logs multiple tool calls when multiple tools are called across iterations', async () => {
    const client = buildMockClient([
      toolCallResponse('call-1', 'echoTool', { value: 'first' }),
      toolCallResponse('call-2', 'echoTool', { value: 'second' }),
      textResponse('Done'),
    ])

    await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test',
      tools: [echoTool()],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(mockAiActionLogCreate).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// (d) Zod-invalid tool args → error surfaced to model, loop continues
// ---------------------------------------------------------------------------

describe('(d) zod-invalid tool args → error surfaced, loop continues', () => {
  it('passes error string back to model and continues loop', async () => {
    const client = buildMockClient([
      toolCallResponse('call-1', 'zodTool', { num: 'not-a-number' }), // invalid
      textResponse('Desculpe, houve um erro.'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test',
      tools: [zodTool()],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    // The tool result message should contain an error
    const secondCall = client.chat.completions.create.mock.calls[1]
    const messages = secondCall[0].messages as Array<{ role: string; content: string }>
    const toolMsg = messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg?.content).toContain('error')
    // Loop continued and returned the text reply
    if (!result.ok) throw new Error()
    expect(result.data.reply).toBe('Desculpe, houve um erro.')
  })
})

// ---------------------------------------------------------------------------
// (e) Iteration cap → fallback reply
// ---------------------------------------------------------------------------

describe('(e) iteration cap → fallback reply', () => {
  it('returns fallback after 6 iterations without text reply', async () => {
    // Always returns a tool call — never text
    const client = buildMockClient(
      Array.from({ length: 10 }, () =>
        toolCallResponse('call-x', 'echoTool', { value: 'loop' }),
      ),
    )

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Infinite loop test',
      tools: [echoTool()],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error()
    expect(result.data.reply).toContain('Desculpe')
    // Should have hit exactly MAX_ITERATIONS (6) OpenAI calls
    expect(client.chat.completions.create).toHaveBeenCalledTimes(6)
  })
})

// ---------------------------------------------------------------------------
// (f) Sensitive tool → pendingAction returned, execute NOT called, log PENDING_CONFIRMATION
// ---------------------------------------------------------------------------

describe('(f) sensitive tool → pendingAction, execute not called', () => {
  it('returns pendingAction and logs PENDING_CONFIRMATION without calling execute', async () => {
    const execSpy = vi.fn().mockResolvedValue({ done: true })
    const sensitive: ToolDef = { ...sensitiveTool(), execute: execSpy }

    const client = buildMockClient([
      toolCallResponse('call-s', 'sensitiveAction', { param: 'value' }),
    ])

    const result = await runAssistant({
      channel: 'COPILOT',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Do the sensitive thing',
      tools: [sensitive],
      systemPrompt: 'Test.',
      ctx: { tenantId: 'shop-1', channel: 'COPILOT' },
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error()

    // execute must NOT have been called
    expect(execSpy).not.toHaveBeenCalled()

    // pendingAction should be returned
    expect(result.data.pendingAction).toBeDefined()
    expect(result.data.pendingAction?.toolName).toBe('sensitiveAction')
    expect(result.data.pendingAction?.id).toBe('log-id-1')

    // AiActionLog must have been created with PENDING_CONFIRMATION
    expect(mockAiActionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_CONFIRMATION',
          requiresConfirmation: true,
          toolName: 'sensitiveAction',
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// (g) WHATSAPP channel forces ctx.customerPhone over model-supplied arg
// ---------------------------------------------------------------------------

describe('(g) WHATSAPP channel forces ctx.customerPhone', () => {
  it('passes ctx.customerPhone to the engine, ignoring model-supplied phone', async () => {
    const { buildPublicTools } = await import('./tools/public-tools')
    const tools = buildPublicTools()
    const createTool = tools.find(t => t.name === 'createAppointment')!

    mockEngineCreate.mockResolvedValue({
      ok: true,
      data: {
        appointmentId: 'appt-1',
        endTime: '11:00',
        professionalName: 'Carlos',
        serviceName: 'Corte',
      },
    })

    const client = buildMockClient([
      // Model supplies a different phone — should be ignored in WHATSAPP channel
      toolCallResponse('call-1', 'createAppointment', {
        serviceId: 'svc-1',
        professionalId: 'prof-1',
        date: '2026-08-01',
        startTime: '10:00',
        customerName: 'João',
        customerPhone: '5511000000000', // model-supplied — should be IGNORED
        confirmed: true,
      }),
      textResponse('Agendado com sucesso!'),
    ])

    await runAssistant({
      channel: 'WHATSAPP',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Quero agendar',
      tools: [createTool],
      systemPrompt: 'Test.',
      ctx: WHATSAPP_CTX, // customerPhone = '5571999990000'
      _client: client as unknown as import('openai').default,
    })

    expect(mockEngineCreate).toHaveBeenCalledTimes(1)
    const callArgs = mockEngineCreate.mock.calls[0][0] as { customer: { phone: string } }
    // Engine must have received ctx.customerPhone, not the model-supplied phone
    expect(callArgs.customer.phone).toBe('5571999990000')
    expect(callArgs.customer.phone).not.toBe('5511000000000')
  })
})

// ---------------------------------------------------------------------------
// (h) Unknown-tool-name call → AiActionLog ERROR row written
// ---------------------------------------------------------------------------

describe('(h) unknown-tool-name call → AiActionLog ERROR row written', () => {
  it('logs ERROR when model calls a non-existent tool', async () => {
    const client = buildMockClient([
      toolCallResponse('call-bad', 'nonExistentTool', { param: 'value' }),
      textResponse('Desculpe, não consegui encontrar essa ferramenta.'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Call a tool that does not exist',
      tools: [echoTool()],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)

    // AiActionLog should have been created with ERROR status for the unknown tool
    expect(mockAiActionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: 'nonExistentTool',
          status: 'ERROR',
          barbershopId: 'shop-1',
          channel: 'AI_WEB',
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// (i) createAppointment with confirmed: "true" (string) → validation error
// ---------------------------------------------------------------------------

describe('(i) createAppointment with invalid confirmed type', () => {
  it('rejects confirmed as string, not boolean; logs ERROR; engine not called', async () => {
    const { buildPublicTools } = await import('./tools/public-tools')

    const tools = buildPublicTools()
    const createTool = tools.find(t => t.name === 'createAppointment')!

    const client = buildMockClient([
      toolCallResponse('call-string-bool', 'createAppointment', {
        serviceId: 'svc-1',
        professionalId: 'prof-1',
        date: '2026-08-01',
        startTime: '10:00',
        customerName: 'João',
        customerPhone: '11999990001',
        confirmed: 'true', // STRING, not boolean
      }),
      textResponse('Houve um erro na validação.'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Agendar',
      tools: [createTool],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)

    // Engine must NOT have been called
    expect(mockEngineCreate).not.toHaveBeenCalled()

    // AiActionLog should have ERROR status (Zod validation failure)
    expect(mockAiActionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: 'createAppointment',
          status: 'ERROR',
        }),
      }),
    )

    // The tool result message should contain an error about invalid arguments
    const secondCall = client.chat.completions.create.mock.calls[1]
    const messages = secondCall[0].messages as Array<{ role: string; content: string }>
    const toolMsg = messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg?.content).toContain('Argumentos inválidos')
  })
})

// ---------------------------------------------------------------------------
// Extra: OpenAI API error → Result.ok: false
// ---------------------------------------------------------------------------

describe('OpenAI API error handling', () => {
  it('returns ok: false when OpenAI throws', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      },
    }

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test',
      tools: [],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.error).toContain('API rate limit')
  })
})

// ---------------------------------------------------------------------------
// Extra: tool throw does NOT crash the loop
// ---------------------------------------------------------------------------

describe('tool throw is caught and loop continues', () => {
  it('returns text reply even when a tool throws unexpectedly', async () => {
    const throwingTool: ToolDef = {
      name: 'throwingTool',
      description: 'Throws unexpectedly',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        throw new Error('DB connection lost')
      },
    }

    const client = buildMockClient([
      toolCallResponse('call-1', 'throwingTool', {}),
      textResponse('Desculpe, ocorreu um erro.'),
    ])

    const result = await runAssistant({
      channel: 'AI_WEB',
      tenantId: 'shop-1',
      history: [],
      userMessage: 'Test',
      tools: [throwingTool],
      systemPrompt: 'Test.',
      ctx: BASE_CTX,
      _client: client as unknown as import('openai').default,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error()
    expect(result.data.reply).toBe('Desculpe, ocorreu um erro.')

    // Log should reflect ERROR status
    expect(mockAiActionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ERROR' }),
      }),
    )
  })
})
