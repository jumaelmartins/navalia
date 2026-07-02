/**
 * copilot.test.ts
 *
 * Tests for:
 * (a) resolveProfessionalByName — zero / ambiguous / unique match
 * (b) buildCopilotTools role gating — BARBER has NO sensitive tools; OWNER has all
 * (c) blockSchedule Zod validation — bad HH:mm / start >= end
 * (d) Confirm flow (mocked prisma):
 *     - pending → confirm → CONFIRMED + confirmedAt + mutation called
 *     - pending → reject → REJECTED, no mutation
 *     - wrong tenant (not found) → 404 semantics
 *     - already CONFIRMED → 409 semantics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const mockPrismaFindMany = vi.fn()
const mockPrismaFindFirst = vi.fn()
const mockPrismaCreate = vi.fn()
const mockPrismaDelete = vi.fn()
const mockPrismaFindUnique = vi.fn()
const mockPrismaAiActionLogFindFirst = vi.fn()
const mockPrismaAiActionLogUpdate = vi.fn()
const mockPrismaAuditLogCreate = vi.fn()
const mockPrismaScheduleBlockCreate = vi.fn()
const mockPrismaScheduleBlockDelete = vi.fn()
const mockPrismaScheduleBlockFindMany = vi.fn()
const mockPrismaAppointmentFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professional: {
      findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
    },
    scheduleBlock: {
      create: (...args: unknown[]) => mockPrismaScheduleBlockCreate(...args),
      delete: (...args: unknown[]) => mockPrismaScheduleBlockDelete(...args),
      findMany: (...args: unknown[]) => mockPrismaScheduleBlockFindMany(...args),
    },
    appointment: {
      findMany: (...args: unknown[]) => mockPrismaAppointmentFindMany(...args),
    },
    aiActionLog: {
      findFirst: (...args: unknown[]) => mockPrismaAiActionLogFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaAiActionLogUpdate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => mockPrismaAuditLogCreate(...args),
    },
    customer: {
      findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
      count: vi.fn().mockResolvedValue(0),
    },
    service: {
      findFirst: (...args: unknown[]) => mockPrismaFindFirst(...args),
      findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
    },
    barbershop: {
      findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
    },
  },
}))

// Mock booking engine (used by cancelAppointment tool)
vi.mock('@/modules/booking/create-appointment', () => ({
  getAvailableSlots: vi.fn(),
  cancelAppointment: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockPrismaAuditLogCreate.mockResolvedValue({ id: 'audit-1' })
})

// ---------------------------------------------------------------------------
// (a) resolveProfessionalByName
// ---------------------------------------------------------------------------

describe('(a) resolveProfessionalByName', () => {
  it('returns error when no professional found', async () => {
    mockPrismaFindMany.mockResolvedValueOnce([])
    const { resolveProfessionalByName } = await import('./tools/resolve-professional')
    const result = await resolveProfessionalByName('shop-1', 'Joao')
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('não encontrado')
    }
  })

  it('returns error when multiple professionals match', async () => {
    mockPrismaFindMany.mockResolvedValueOnce([
      { id: 'p1', name: 'Joao Silva' },
      { id: 'p2', name: 'Joao Santos' },
    ])
    const { resolveProfessionalByName } = await import('./tools/resolve-professional')
    const result = await resolveProfessionalByName('shop-1', 'Joao')
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('ambíguo')
    }
  })

  it('returns id on unique match', async () => {
    mockPrismaFindMany.mockResolvedValueOnce([{ id: 'p1', name: 'Joao Silva' }])
    const { resolveProfessionalByName } = await import('./tools/resolve-professional')
    const result = await resolveProfessionalByName('shop-1', 'Joao')
    expect('id' in result).toBe(true)
    if ('id' in result) {
      expect(result.id).toBe('p1')
    }
  })
})

// ---------------------------------------------------------------------------
// (b) buildCopilotTools role gating
// ---------------------------------------------------------------------------

describe('(b) buildCopilotTools role gating', () => {
  it('BARBER toolset has NO sensitive tools', async () => {
    const { buildCopilotTools } = await import('./tools/copilot-tools')
    const tools = buildCopilotTools({ id: 'shop-1', timezone: 'America/Sao_Paulo' }, 'BARBER')
    const sensitiveTools = tools.filter(t => t.sensitive === true)
    expect(sensitiveTools).toHaveLength(0)
  })

  it('OWNER toolset has all 3 sensitive tools', async () => {
    const { buildCopilotTools } = await import('./tools/copilot-tools')
    const tools = buildCopilotTools({ id: 'shop-1', timezone: 'America/Sao_Paulo' }, 'OWNER')
    const sensitiveTools = tools.filter(t => t.sensitive === true)
    expect(sensitiveTools).toHaveLength(3)
    const sensitiveNames = sensitiveTools.map(t => t.name)
    expect(sensitiveNames).toContain('blockSchedule')
    expect(sensitiveNames).toContain('unblockSchedule')
    expect(sensitiveNames).toContain('cancelAppointment')
  })

  it('BARBER toolset has 6 read tools', async () => {
    const { buildCopilotTools } = await import('./tools/copilot-tools')
    const tools = buildCopilotTools({ id: 'shop-1', timezone: 'America/Sao_Paulo' }, 'BARBER')
    expect(tools).toHaveLength(6)
  })

  it('OWNER toolset has 9 tools (6 read + 3 sensitive)', async () => {
    const { buildCopilotTools } = await import('./tools/copilot-tools')
    const tools = buildCopilotTools({ id: 'shop-1', timezone: 'America/Sao_Paulo' }, 'OWNER')
    expect(tools).toHaveLength(9)
  })
})

// ---------------------------------------------------------------------------
// (c) blockSchedule Zod validation
// ---------------------------------------------------------------------------

describe('(c) blockSchedule Zod validation', () => {
  async function getBlockSchedule() {
    const { buildCopilotTools } = await import('./tools/copilot-tools')
    const tools = buildCopilotTools({ id: 'shop-1', timezone: 'America/Sao_Paulo' }, 'OWNER')
    return tools.find(t => t.name === 'blockSchedule')!
  }

  const ctx = { tenantId: 'shop-1', channel: 'COPILOT' as const }

  it('rejects invalid startTime format', async () => {
    const tool = await getBlockSchedule()
    const result = await tool.execute(
      {
        professionalName: 'Carlos',
        date: '2026-07-10',
        startTime: '9:00', // missing leading zero
        endTime: '18:00',
      },
      ctx,
    )
    expect(typeof result).toBe('object')
    expect((result as { error: string }).error).toContain('HH:mm')
  })

  it('rejects invalid endTime format', async () => {
    const tool = await getBlockSchedule()
    const result = await tool.execute(
      {
        professionalName: 'Carlos',
        date: '2026-07-10',
        startTime: '09:00',
        endTime: '1800', // no colon
      },
      ctx,
    )
    expect(typeof result).toBe('object')
    expect((result as { error: string }).error).toContain('HH:mm')
  })

  it('rejects when startTime >= endTime', async () => {
    const tool = await getBlockSchedule()
    const result = await tool.execute(
      {
        professionalName: 'Carlos',
        date: '2026-07-10',
        startTime: '18:00',
        endTime: '09:00', // end before start
      },
      ctx,
    )
    expect(typeof result).toBe('object')
    expect((result as { error: string }).error).toContain('anterior')
  })

  it('rejects missing required date field', async () => {
    const tool = await getBlockSchedule()
    const result = await tool.execute(
      {
        professionalName: 'Carlos',
        startTime: '09:00',
        endTime: '18:00',
        // date is missing
      },
      ctx,
    )
    expect(typeof result).toBe('object')
    expect((result as { error: string }).error).toContain('Argumentos inválidos')
  })

  it('executes successfully with valid args', async () => {
    mockPrismaFindMany.mockResolvedValueOnce([{ id: 'prof-1', name: 'Carlos' }])
    mockPrismaScheduleBlockCreate.mockResolvedValueOnce({
      id: 'block-1',
      barbershopId: 'shop-1',
      professionalId: 'prof-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '18:00',
      reason: 'Feriado',
      source: 'COPILOT',
    })

    const tool = await getBlockSchedule()
    const result = await tool.execute(
      {
        professionalName: 'Carlos',
        date: '2026-07-10',
        startTime: '09:00',
        endTime: '18:00',
        reason: 'Feriado',
      },
      ctx,
    )
    expect((result as { success: boolean }).success).toBe(true)
    expect(mockPrismaScheduleBlockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barbershopId: 'shop-1',
          date: '2026-07-10',
          startTime: '09:00',
          endTime: '18:00',
          source: 'COPILOT',
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// (d) Confirm flow — mocked logic
// ---------------------------------------------------------------------------

describe('(d) confirm flow', () => {
  /**
   * Simulate the confirm/reject logic inline (mirrors the route handler logic).
   * This avoids importing Next.js route internals in unit tests.
   */
  async function processConfirm(args: {
    actionId: string
    barbershopId: string
    userId: string
    reject?: boolean
  }) {
    const { buildCopilotTools } = await import('./tools/copilot-tools')

    const log = await mockPrismaAiActionLogFindFirst({
      where: { id: args.actionId, barbershopId: args.barbershopId },
    })

    if (!log) return { ok: false, status: 404, error: 'Ação não encontrada.' }
    if (log.status !== 'PENDING_CONFIRMATION') {
      return { ok: false, status: 409, error: `Ação já processada (status: ${log.status}).` }
    }

    if (args.reject) {
      await mockPrismaAiActionLogUpdate({
        where: { id: args.actionId },
        data: { status: 'REJECTED', output: { rejectedBy: args.userId } },
      })
      return { ok: true, status: 'REJECTED' }
    }

    // Find sensitive tool and execute
    const shop = { id: args.barbershopId, timezone: 'America/Sao_Paulo' }
    const tools = buildCopilotTools(shop, 'OWNER')
    const toolDef = tools.find(t => t.name === log.toolName && t.sensitive === true)
    if (!toolDef) return { ok: false, status: 500, error: 'Ferramenta não encontrada.' }

    const ctx = { tenantId: args.barbershopId, channel: 'COPILOT' as const, userId: args.userId }
    let execResult: unknown
    let execError: string | null = null
    try {
      execResult = await toolDef.execute(log.input, ctx)
      if (typeof execResult === 'object' && execResult !== null && 'error' in execResult) {
        execError = (execResult as { error: string }).error
      }
    } catch (err) {
      execError = err instanceof Error ? err.message : 'Erro'
    }

    if (execError) {
      await mockPrismaAiActionLogUpdate({
        where: { id: args.actionId },
        data: { status: 'ERROR', output: { error: execError } },
      })
      return { ok: false, status: 200, error: execError }
    }

    await mockPrismaAiActionLogUpdate({
      where: { id: args.actionId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), output: execResult },
    })
    return { ok: true, status: 'CONFIRMED', result: execResult }
  }

  it('pending → confirm → CONFIRMED + confirmedAt + mutation called', async () => {
    // Setup: log in PENDING_CONFIRMATION for blockSchedule
    mockPrismaAiActionLogFindFirst.mockResolvedValue({
      id: 'action-1',
      barbershopId: 'shop-1',
      toolName: 'blockSchedule',
      status: 'PENDING_CONFIRMATION',
      input: {
        professionalName: 'Carlos',
        date: '2026-07-10',
        startTime: '09:00',
        endTime: '18:00',
        reason: 'Feriado',
      },
    })

    // Professional resolution returns match
    mockPrismaFindMany.mockResolvedValueOnce([{ id: 'prof-1', name: 'Carlos' }])

    // ScheduleBlock creation
    mockPrismaScheduleBlockCreate.mockResolvedValueOnce({
      id: 'block-1',
      professionalId: 'prof-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '18:00',
    })

    mockPrismaAiActionLogUpdate.mockResolvedValue({ id: 'action-1', status: 'CONFIRMED' })

    const result = await processConfirm({
      actionId: 'action-1',
      barbershopId: 'shop-1',
      userId: 'user-1',
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('CONFIRMED')

    // Mutation was called
    expect(mockPrismaScheduleBlockCreate).toHaveBeenCalledOnce()

    // AiActionLog was updated to CONFIRMED
    expect(mockPrismaAiActionLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    )
  })

  it('pending → reject → REJECTED, no mutation', async () => {
    mockPrismaAiActionLogFindFirst.mockResolvedValue({
      id: 'action-2',
      barbershopId: 'shop-1',
      toolName: 'blockSchedule',
      status: 'PENDING_CONFIRMATION',
      input: { professionalName: 'Carlos', date: '2026-07-10', startTime: '09:00', endTime: '18:00' },
    })

    mockPrismaAiActionLogUpdate.mockResolvedValue({ id: 'action-2', status: 'REJECTED' })

    const result = await processConfirm({
      actionId: 'action-2',
      barbershopId: 'shop-1',
      userId: 'user-1',
      reject: true,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('REJECTED')

    // No mutation should have been called
    expect(mockPrismaScheduleBlockCreate).not.toHaveBeenCalled()
    expect(mockPrismaScheduleBlockDelete).not.toHaveBeenCalled()

    // Log was updated to REJECTED
    expect(mockPrismaAiActionLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    )
  })

  it('wrong tenant → not found (404)', async () => {
    mockPrismaAiActionLogFindFirst.mockResolvedValue(null) // different tenant → null

    const result = await processConfirm({
      actionId: 'action-3',
      barbershopId: 'shop-OTHER',
      userId: 'user-1',
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect((result as { error: string }).error).toContain('não encontrada')
  })

  it('already CONFIRMED → 409 conflict', async () => {
    mockPrismaAiActionLogFindFirst.mockResolvedValue({
      id: 'action-4',
      barbershopId: 'shop-1',
      toolName: 'blockSchedule',
      status: 'CONFIRMED', // already processed
      input: {},
    })

    const result = await processConfirm({
      actionId: 'action-4',
      barbershopId: 'shop-1',
      userId: 'user-1',
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
  })

  it('already REJECTED → 409 conflict', async () => {
    mockPrismaAiActionLogFindFirst.mockResolvedValue({
      id: 'action-5',
      barbershopId: 'shop-1',
      toolName: 'blockSchedule',
      status: 'REJECTED',
      input: {},
    })

    const result = await processConfirm({
      actionId: 'action-5',
      barbershopId: 'shop-1',
      userId: 'user-1',
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// (e) public-tools regression — getSlots still uses resolveProfessionalByName
// ---------------------------------------------------------------------------

describe('(e) public-tools regression — professionalName resolution', () => {
  it('getSlots uses resolveProfessionalByName (unique match → resolves id)', async () => {
    // Mock: prisma.professional.findMany for resolve
    mockPrismaFindMany.mockResolvedValueOnce([{ id: 'prof-x', name: 'Carlos Silva' }])

    // Mock: getAvailableSlots result
    const { getAvailableSlots } = await import('@/modules/booking/create-appointment')
    vi.mocked(getAvailableSlots).mockResolvedValueOnce({
      ok: true,
      data: [{ professionalId: 'prof-x', slots: ['10:00', '11:00'] }],
    })

    // Mock: professional name lookup after slots
    mockPrismaFindMany.mockResolvedValueOnce([{ id: 'prof-x', name: 'Carlos Silva' }])

    const { buildPublicTools } = await import('./tools/public-tools')
    const slotsTool = buildPublicTools().find(t => t.name === 'getSlots')!
    const ctx = { tenantId: 'shop-1', channel: 'AI_WEB' as const }

    const result = await slotsTool.execute(
      { serviceId: 'svc-1', date: '2026-08-01', professionalName: 'Carlos' },
      ctx,
    )

    expect(Array.isArray(result)).toBe(true)
    expect((result as Array<{ professionalName: string }>)[0].professionalName).toBe('Carlos Silva')
  })

  it('getSlots returns error on ambiguous professional name', async () => {
    mockPrismaFindMany.mockResolvedValueOnce([
      { id: 'p1', name: 'Carlos A' },
      { id: 'p2', name: 'Carlos B' },
    ])

    const { buildPublicTools } = await import('./tools/public-tools')
    const slotsTool = buildPublicTools().find(t => t.name === 'getSlots')!
    const ctx = { tenantId: 'shop-1', channel: 'AI_WEB' as const }

    const result = await slotsTool.execute(
      { serviceId: 'svc-1', date: '2026-08-01', professionalName: 'Carlos' },
      ctx,
    )

    expect((result as { error: string }).error).toContain('ambíguo')
  })
})
