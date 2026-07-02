/**
 * pipeline.test.ts
 *
 * Tests for:
 *  (a) parseMessagesUpsert — pure extractor (fromMe, group, non-text, text cases)
 *  (b) handleInboundMessage pipeline glue:
 *       - TRANSFERRED_TO_HUMAN skips bot
 *       - [HUMANO] marker strips marker, appends handoff line, flips state
 *       - Access denied sends reply once and closes; second call is silent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseMessagesUpsert, handleInboundMessage } from './pipeline'

// ---------------------------------------------------------------------------
// Mock: @/lib/prisma
// ---------------------------------------------------------------------------
const mockFindUniqueShop = vi.fn()
const mockFindUniqueConv = vi.fn()
const mockUpsertConv = vi.fn()
const mockUpdateConv = vi.fn()
const mockCreateMsg = vi.fn()
const mockFindManyMsgs = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    barbershop: {
      findUnique: (...args: unknown[]) => mockFindUniqueShop(...args),
    },
    whatsappConversation: {
      findUnique: (...args: unknown[]) => mockFindUniqueConv(...args),
      upsert: (...args: unknown[]) => mockUpsertConv(...args),
      update: (...args: unknown[]) => mockUpdateConv(...args),
    },
    whatsappMessage: {
      create: (...args: unknown[]) => mockCreateMsg(...args),
      findMany: (...args: unknown[]) => mockFindManyMsgs(...args),
    },
  },
}))

// ---------------------------------------------------------------------------
// Mock: evolution.sendText
// ---------------------------------------------------------------------------
const mockSendText = vi.fn().mockResolvedValue({ ok: true, data: {} })

vi.mock('./evolution-client', () => ({
  evolution: {
    sendText: (...args: unknown[]) => mockSendText(...args),
  },
}))

// ---------------------------------------------------------------------------
// Mock: runAssistant
// ---------------------------------------------------------------------------
const mockRunAssistant = vi.fn()

vi.mock('@/modules/ai/orchestrator', () => ({
  runAssistant: (...args: unknown[]) => mockRunAssistant(...args),
}))

// ---------------------------------------------------------------------------
// Mock: hasAccess (billing gate)
// ---------------------------------------------------------------------------
const mockHasAccess = vi.fn().mockReturnValue(true)

vi.mock('@/modules/billing/gate', () => ({
  hasAccess: (...args: unknown[]) => mockHasAccess(...args),
}))

// ---------------------------------------------------------------------------
// Mock: isOpenAIConfigured
// ---------------------------------------------------------------------------
const mockIsOpenAIConfigured = vi.fn().mockReturnValue(true)

vi.mock('@/lib/openai', () => ({
  isOpenAIConfigured: () => mockIsOpenAIConfigured(),
}))

// ---------------------------------------------------------------------------
// Mock: scheduleDebounced — calls flush immediately with single fragment
// ---------------------------------------------------------------------------
const mockScheduleDebounced = vi.fn()

vi.mock('./debounce', () => ({
  scheduleDebounced: (...args: unknown[]) => mockScheduleDebounced(...args),
}))

// ---------------------------------------------------------------------------
// Mock: rateLimit
// ---------------------------------------------------------------------------
const mockRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 29 })

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const SHOP = {
  id: 'shop-1',
  name: 'Barbearia Navalia',
  timezone: 'America/Bahia',
  businessHours: {},
  cancellationPolicy: null,
  address: null,
  phone: null,
  subscriptionStatus: 'ACTIVE' as const,
  trialEndsAt: new Date('2030-01-01'),
  evolutionInstanceId: 'nav_shop1',
}

const OPEN_CONV = {
  id: 'conv-1',
  barbershopId: 'shop-1',
  customerPhone: '5571999990001',
  state: 'OPEN' as const,
  lastMessageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}

const TRANSFERRED_CONV = {
  ...OPEN_CONV,
  state: 'TRANSFERRED_TO_HUMAN' as const,
}

const BASE_ARGS = {
  instanceName: 'nav_shop1',
  fromPhone: '5571999990001',
  text: 'Oi, quero agendar',
  messageId: 'msg-abc',
}

beforeEach(() => {
  vi.clearAllMocks()

  mockFindUniqueShop.mockResolvedValue(SHOP)
  mockHasAccess.mockReturnValue(true)
  // Default: conversation is OPEN (used by flushToAI re-read check, I8)
  mockFindUniqueConv.mockResolvedValue({ state: 'OPEN' })
  mockUpsertConv.mockResolvedValue(OPEN_CONV)
  mockUpdateConv.mockResolvedValue(OPEN_CONV)
  mockCreateMsg.mockResolvedValue({ id: 'wmsg-1' })
  mockFindManyMsgs.mockResolvedValue([])
  mockIsOpenAIConfigured.mockReturnValue(true)
  mockRunAssistant.mockResolvedValue({
    ok: true,
    data: { reply: 'Olá! Como posso ajudar?' },
  })
  mockSendText.mockResolvedValue({ ok: true, data: {} })

  // Default: call flush immediately with the single fragment
  mockScheduleDebounced.mockImplementation(
    async (
      _key: string,
      payload: string,
      _delay: number,
      flush: (frags: string[]) => Promise<void>,
    ) => {
      await flush([payload])
    },
  )
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29 })
})

// ===========================================================================
// (a) parseMessagesUpsert — pure extractor
// ===========================================================================

describe('parseMessagesUpsert', () => {
  function makePayload(overrides: Record<string, unknown> = {}) {
    return {
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-001',
              fromMe: false,
              remoteJid: '5571999990001@s.whatsapp.net',
            },
            message: {
              conversation: 'Oi, quero agendar',
            },
            ...overrides,
          },
        ],
      },
    }
  }

  it('returns parsed object for a valid text message', () => {
    const result = parseMessagesUpsert(makePayload())
    expect(result).not.toBeNull()
    expect(result?.instanceName).toBe('nav_shop1')
    expect(result?.fromPhone).toBe('5571999990001')
    expect(result?.text).toBe('Oi, quero agendar')
    expect(result?.messageId).toBe('msg-001')
  })

  it('strips @s.whatsapp.net from remoteJid', () => {
    const result = parseMessagesUpsert(makePayload())
    expect(result?.fromPhone).not.toContain('@')
  })

  it('returns null for fromMe = true', () => {
    const result = parseMessagesUpsert({
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-002',
              fromMe: true,
              remoteJid: '5571999990001@s.whatsapp.net',
            },
            message: { conversation: 'hi' },
          },
        ],
      },
    })
    expect(result).toBeNull()
  })

  it('returns null for group JID (@g.us)', () => {
    const result = parseMessagesUpsert({
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-003',
              fromMe: false,
              remoteJid: '120363000000@g.us',
            },
            message: { conversation: 'oi' },
          },
        ],
      },
    })
    expect(result).toBeNull()
  })

  it('returns null for status@broadcast', () => {
    const result = parseMessagesUpsert({
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-004',
              fromMe: false,
              remoteJid: 'status@broadcast',
            },
            message: { conversation: 'oi' },
          },
        ],
      },
    })
    expect(result).toBeNull()
  })

  it('returns text = null for non-text messages (e.g. audio)', () => {
    const result = parseMessagesUpsert({
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-005',
              fromMe: false,
              remoteJid: '5571999990001@s.whatsapp.net',
            },
            message: {
              audioMessage: { url: 'https://example.com/audio.ogg' },
            },
          },
        ],
      },
    })
    expect(result).not.toBeNull()
    expect(result?.text).toBeNull()
  })

  it('extracts text from extendedTextMessage.text', () => {
    const result = parseMessagesUpsert({
      instance: 'nav_shop1',
      data: {
        messages: [
          {
            key: {
              id: 'msg-006',
              fromMe: false,
              remoteJid: '5571999990001@s.whatsapp.net',
            },
            message: {
              extendedTextMessage: { text: 'Mensagem longa com link' },
            },
          },
        ],
      },
    })
    expect(result?.text).toBe('Mensagem longa com link')
  })

  it('returns null for empty payload', () => {
    expect(parseMessagesUpsert(null)).toBeNull()
    expect(parseMessagesUpsert({})).toBeNull()
    expect(parseMessagesUpsert({ data: {} })).toBeNull()
  })
})

// ===========================================================================
// (b) handleInboundMessage — pipeline glue
// ===========================================================================

describe('handleInboundMessage: TRANSFERRED_TO_HUMAN skips bot', () => {
  it('does NOT call scheduleDebounced when conversation is TRANSFERRED_TO_HUMAN', async () => {
    mockUpsertConv.mockResolvedValue(TRANSFERRED_CONV)

    await handleInboundMessage(BASE_ARGS)

    expect(mockScheduleDebounced).not.toHaveBeenCalled()
    expect(mockRunAssistant).not.toHaveBeenCalled()
  })

  it('still persists the INBOUND message when TRANSFERRED_TO_HUMAN', async () => {
    mockUpsertConv.mockResolvedValue(TRANSFERRED_CONV)

    await handleInboundMessage(BASE_ARGS)

    expect(mockCreateMsg).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          content: BASE_ARGS.text,
        }),
      }),
    )
  })
})

describe('handleInboundMessage: [HUMANO] marker handling', () => {
  it('strips [HUMANO] from sent text, appends handoff line, and updates state', async () => {
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: 'Claro! [HUMANO] Posso ajudar com mais alguma coisa?' },
    })

    await handleInboundMessage(BASE_ARGS)

    // sendText should NOT contain the raw marker
    const [, , sentText] = mockSendText.mock.calls[0] as [string, string, string]
    expect(sentText).not.toContain('[HUMANO]')
    expect(sentText).toContain('Claro!')
    expect(sentText).toContain('Um atendente da barbearia vai continuar a conversa por aqui.')

    // State should be updated to TRANSFERRED_TO_HUMAN
    expect(mockUpdateConv).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'TRANSFERRED_TO_HUMAN' }),
      }),
    )
  })

  it('persists OUTBOUND AI message with clean text (no [HUMANO])', async () => {
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: '[HUMANO] Transferindo para atendente.' },
    })

    await handleInboundMessage(BASE_ARGS)

    const aiMsgCall = mockCreateMsg.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { data: { senderType: string } }).data.senderType === 'AI',
    )
    expect(aiMsgCall).toBeDefined()
    const aiMsgContent = (aiMsgCall![0] as { data: { content: string } }).data.content
    expect(aiMsgContent).not.toContain('[HUMANO]')
    expect(aiMsgContent).toContain('Um atendente da barbearia vai continuar a conversa por aqui.')
  })

  it('normal reply (no marker) does NOT update state to TRANSFERRED_TO_HUMAN', async () => {
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: 'Seus horários disponíveis são às 10h e 14h.' },
    })

    await handleInboundMessage(BASE_ARGS)

    const updateCalls = mockUpdateConv.mock.calls as Array<Array<{ data?: { state?: string } }>>
    const humanTransfer = updateCalls.find(
      ([args]) => args?.data?.state === 'TRANSFERRED_TO_HUMAN',
    )
    expect(humanTransfer).toBeUndefined()
  })
})

describe('handleInboundMessage: access denied — send once and close', () => {
  beforeEach(() => {
    mockHasAccess.mockReturnValue(false)
  })

  it('sends ACCESS_DENIED reply when no prior conversation exists', async () => {
    mockFindUniqueConv.mockResolvedValue(null)
    mockUpsertConv.mockResolvedValue({ ...OPEN_CONV, state: 'CLOSED' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockSendText).toHaveBeenCalledWith(
      'nav_shop1',
      '5571999990001',
      'Este número não está disponível no momento.',
    )
  })

  it('sets conversation state to CLOSED after access denied', async () => {
    mockFindUniqueConv.mockResolvedValue(null)
    mockUpsertConv.mockResolvedValue({ ...OPEN_CONV, state: 'CLOSED' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockUpsertConv).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ state: 'CLOSED' }),
      }),
    )
  })

  it('does NOT send reply a second time when conversation is already CLOSED', async () => {
    mockFindUniqueConv.mockResolvedValue({ ...OPEN_CONV, state: 'CLOSED' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('does NOT run the bot (scheduleDebounced not called)', async () => {
    mockFindUniqueConv.mockResolvedValue(null)
    mockUpsertConv.mockResolvedValue({ ...OPEN_CONV, state: 'CLOSED' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockScheduleDebounced).not.toHaveBeenCalled()
  })
})

describe('handleInboundMessage: OpenAI not configured → fallback path', () => {
  it('sends fallback reply and sets TRANSFERRED_TO_HUMAN when OpenAI unconfigured', async () => {
    mockIsOpenAIConfigured.mockReturnValue(false)

    await handleInboundMessage(BASE_ARGS)

    expect(mockRunAssistant).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      'nav_shop1',
      '5571999990001',
      'Opa, tive um problema técnico. Um atendente da barbearia vai te responder em breve.',
    )
    expect(mockUpdateConv).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'TRANSFERRED_TO_HUMAN' }),
      }),
    )
  })
})

describe('handleInboundMessage: runAssistant error → fallback path', () => {
  it('sends fallback and TRANSFERRED_TO_HUMAN on AI error', async () => {
    mockRunAssistant.mockResolvedValue({ ok: false, error: 'OpenAI rate limit' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockSendText).toHaveBeenCalledWith(
      'nav_shop1',
      '5571999990001',
      'Opa, tive um problema técnico. Um atendente da barbearia vai te responder em breve.',
    )
  })
})

describe('handleInboundMessage: shop not found → silently ignored', () => {
  it('returns without doing anything if barbershop does not exist', async () => {
    mockFindUniqueShop.mockResolvedValue(null)

    await handleInboundMessage(BASE_ARGS)

    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockCreateMsg).not.toHaveBeenCalled()
  })
})

describe('handleInboundMessage: non-text message (text = null)', () => {
  it('sends non-text reply and persists OUTBOUND SYSTEM (does not run bot)', async () => {
    await handleInboundMessage({ ...BASE_ARGS, text: null })

    expect(mockSendText).toHaveBeenCalledWith(
      'nav_shop1',
      '5571999990001',
      'Por enquanto só consigo ler mensagens de texto.',
    )
    expect(mockScheduleDebounced).not.toHaveBeenCalled()
    expect(mockRunAssistant).not.toHaveBeenCalled()
  })
})

describe('handleInboundMessage: non-text + TRANSFERRED_TO_HUMAN → silent', () => {
  it('does NOT send NON_TEXT_REPLY when conversation is TRANSFERRED_TO_HUMAN', async () => {
    mockUpsertConv.mockResolvedValue(TRANSFERRED_CONV)

    await handleInboundMessage({ ...BASE_ARGS, text: null })

    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockCreateMsg).not.toHaveBeenCalled()
    expect(mockScheduleDebounced).not.toHaveBeenCalled()
  })
})

describe('flushToAI: history excludes last N INBOUND-CUSTOMER rows by tail-walk', () => {
  it('excludes burst row (b) and OUTBOUND-SYSTEM row from history; keeps prior row (a)', async () => {
    // Override debounce to flush with fragment 'b' specifically
    mockScheduleDebounced.mockImplementationOnce(
      async (
        _key: string,
        _payload: string,
        _delay: number,
        flush: (frags: string[]) => Promise<void>,
      ) => {
        await flush(['b'])
      },
    )

    // findMany returns rows in DESC order (most-recent first)
    mockFindManyMsgs.mockResolvedValueOnce([
      { id: '3', direction: 'INBOUND', senderType: 'CUSTOMER', content: 'b', createdAt: new Date(3) },
      { id: '2', direction: 'OUTBOUND', senderType: 'SYSTEM', content: 'x', createdAt: new Date(2) },
      { id: '1', direction: 'INBOUND', senderType: 'CUSTOMER', content: 'a', createdAt: new Date(1) },
    ])

    await handleInboundMessage(BASE_ARGS)

    // runAssistant should receive only the prior user message 'a' in history;
    // burst row 'b' (INBOUND-CUSTOMER tail) and OUTBOUND-SYSTEM 'x' are excluded.
    const callArgs = mockRunAssistant.mock.calls[0][0] as { history: Array<{ role: string; content: string }> }
    expect(callArgs.history).toEqual([{ role: 'user', content: 'a' }])
  })
})

describe('flushToAI: sendText failure → persist OUTBOUND SYSTEM with [FALHA NO ENVIO] prefix', () => {
  it('persists OUTBOUND SYSTEM with failure prefix when sendText fails; no AI row', async () => {
    mockSendText.mockResolvedValueOnce({ ok: false, error: 'Network timeout' })

    await handleInboundMessage(BASE_ARGS)

    // Find the OUTBOUND SYSTEM row with the failure prefix
    const sysMsgCall = mockCreateMsg.mock.calls.find(
      (call: unknown[]) => {
        const data = (call[0] as { data: { direction: string; senderType: string } }).data
        return data.direction === 'OUTBOUND' && data.senderType === 'SYSTEM'
      },
    )
    expect(sysMsgCall).toBeDefined()
    const content = (sysMsgCall![0] as { data: { content: string } }).data.content
    expect(content).toMatch(/^\[FALHA NO ENVIO\]/)

    // No OUTBOUND AI row should be persisted
    const aiMsgCall = mockCreateMsg.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { data: { senderType: string } }).data.senderType === 'AI',
    )
    expect(aiMsgCall).toBeUndefined()
  })
})

describe('handleInboundMessage: [HUMANO] marker — replaceAll removes all occurrences', () => {
  it('strips every [HUMANO] when reply contains the marker twice', async () => {
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: '[HUMANO] Transferindo. [HUMANO] Tenha um bom dia!' },
    })

    await handleInboundMessage(BASE_ARGS)

    const [, , sentText] = mockSendText.mock.calls[0] as [string, string, string]
    expect(sentText).not.toContain('[HUMANO]')
    expect(sentText).toContain('Transferindo.')
    expect(sentText).toContain('Tenha um bom dia!')
  })
})

// ===========================================================================
// I7: Rate limit — silent drop after message persisted
// ===========================================================================

describe('handleInboundMessage: rate limit exceeded → silent drop', () => {
  it('does NOT call scheduleDebounced when rate limit is exceeded', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })

    await handleInboundMessage(BASE_ARGS)

    // Message should still be persisted
    expect(mockCreateMsg).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ direction: 'INBOUND', senderType: 'CUSTOMER' }),
      }),
    )
    // But bot should not run
    expect(mockScheduleDebounced).not.toHaveBeenCalled()
    expect(mockRunAssistant).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('proceeds normally when rate limit is within bounds', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: true, remaining: 25 })

    await handleInboundMessage(BASE_ARGS)

    expect(mockScheduleDebounced).toHaveBeenCalled()
  })
})

// ===========================================================================
// I8: flushToAI — state flipped during debounce window → no AI call
// ===========================================================================

describe('flushToAI: conversation state flipped to TRANSFERRED_TO_HUMAN during window', () => {
  it('does NOT call runAssistant when conversation state is no longer OPEN', async () => {
    // Simulate: by the time flushToAI runs (after debounce), the conv is
    // TRANSFERRED_TO_HUMAN (human agent took over during the 4s window).
    // mockFindUniqueConv is called by flushToAI for the I8 re-read.
    mockFindUniqueConv.mockResolvedValue({ state: 'TRANSFERRED_TO_HUMAN' })

    await handleInboundMessage(BASE_ARGS)

    expect(mockRunAssistant).not.toHaveBeenCalled()
  })
})
