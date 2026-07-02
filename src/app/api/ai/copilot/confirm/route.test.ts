/**
 * route.test.ts — real handler tests for POST /api/ai/copilot/confirm
 *
 * Cases:
 * (a) unauthenticated → 401
 * (b) BARBER role → 403
 * (c) actionId of another tenant → 404
 * (d) status already CONFIRMED → 409
 * (e) happy confirm → mutation executed once + CONFIRMED + confirmedAt
 * (f) reject → REJECTED, mutation NOT executed
 * (g) concurrency: two POSTs for same actionId → mutation once, one 409
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mock declarations — referenced inside vi.mock factories via closure.
// vi.mock is hoisted but factories execute lazily (at module import time),
// so all vi.fn() variables are already initialised by then.
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()
const mockUserFindUnique = vi.fn()
const mockAiActionLogFindFirst = vi.fn()
const mockAiActionLogUpdateMany = vi.fn()
const mockAiActionLogUpdate = vi.fn()
const mockAuditLogCreate = vi.fn()
const mockToolExecute = vi.fn()

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    aiActionLog: {
      findFirst: (...args: unknown[]) => mockAiActionLogFindFirst(...args),
      updateMany: (...args: unknown[]) => mockAiActionLogUpdateMany(...args),
      update: (...args: unknown[]) => mockAiActionLogUpdate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => mockAuditLogCreate(...args),
    },
  },
}))

vi.mock('@/modules/ai/tools/copilot-tools', () => ({
  buildCopilotTools: vi.fn(() => [
    {
      name: 'blockSchedule',
      sensitive: true,
      execute: (...args: unknown[]) => mockToolExecute(...args),
    },
  ]),
}))

// Import the actual route handler (mocks are already registered above)
import { POST } from './route'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_USER = {
  id: 'user-owner-1',
  role: 'OWNER',
  barbershop: {
    id: 'shop-1',
    timezone: 'America/Sao_Paulo',
    onboardingCompleted: true,
  },
}

const PENDING_LOG = {
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
}

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/ai/copilot/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockAuditLogCreate.mockResolvedValue({ id: 'audit-1' })
  mockAiActionLogUpdate.mockResolvedValue({})
  mockToolExecute.mockResolvedValue({ success: true, blockId: 'block-1' })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/ai/copilot/confirm', () => {
  it('(a) unauthenticated → 401', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await POST(makeRequest({ actionId: 'action-1' }))

    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('autenticado')
  })

  it('(b) BARBER role → 403', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-barber-1' } })
    mockUserFindUnique.mockResolvedValue({
      id: 'user-barber-1',
      role: 'BARBER',
      barbershop: { id: 'shop-1', onboardingCompleted: true, timezone: 'America/Sao_Paulo' },
    })

    const res = await POST(makeRequest({ actionId: 'action-1' }))

    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('proprietário')
  })

  it('(c) actionId of another tenant → 404', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-owner-1' } })
    mockUserFindUnique.mockResolvedValue(OWNER_USER)
    mockAiActionLogFindFirst.mockResolvedValue(null) // tenant fence: not found

    const res = await POST(makeRequest({ actionId: 'action-foreign' }))

    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('não encontrada')
    // updateMany must NOT be called — short-circuits at 404
    expect(mockAiActionLogUpdateMany).not.toHaveBeenCalled()
  })

  it('(d) status already CONFIRMED → 409', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-owner-1' } })
    mockUserFindUnique.mockResolvedValue(OWNER_USER)
    // Record exists but its status is no longer PENDING_CONFIRMATION
    mockAiActionLogFindFirst.mockResolvedValue({ ...PENDING_LOG, status: 'CONFIRMED' })
    // updateMany WHERE status='PENDING_CONFIRMATION' matches 0 rows
    mockAiActionLogUpdateMany.mockResolvedValue({ count: 0 })

    const res = await POST(makeRequest({ actionId: 'action-1' }))

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('já foi processada')
  })

  it('(e) happy confirm → mutation executed once + CONFIRMED + confirmedAt', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-owner-1' } })
    mockUserFindUnique.mockResolvedValue(OWNER_USER)
    mockAiActionLogFindFirst.mockResolvedValue(PENDING_LOG)
    mockAiActionLogUpdateMany.mockResolvedValue({ count: 1 })

    const res = await POST(makeRequest({ actionId: 'action-1' }))

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; status: string }
    expect(body.ok).toBe(true)
    expect(body.status).toBe('CONFIRMED')

    // Sensitive tool mutation executed exactly once
    expect(mockToolExecute).toHaveBeenCalledOnce()

    // AiActionLog updated to CONFIRMED with confirmedAt
    expect(mockAiActionLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONFIRMED',
          confirmedAt: expect.any(Date),
        }),
      }),
    )

    // AuditLog written for confirmation
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'COPILOT_ACTION_CONFIRMED' }),
      }),
    )
  })

  it('(f) reject → REJECTED, mutation NOT executed', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-owner-1' } })
    mockUserFindUnique.mockResolvedValue(OWNER_USER)
    mockAiActionLogFindFirst.mockResolvedValue(PENDING_LOG)
    mockAiActionLogUpdateMany.mockResolvedValue({ count: 1 })

    const res = await POST(makeRequest({ actionId: 'action-1', reject: true }))

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; status: string }
    expect(body.ok).toBe(true)
    expect(body.status).toBe('REJECTED')

    // Tool mutation must NOT have been called
    expect(mockToolExecute).not.toHaveBeenCalled()

    // AuditLog written for rejection
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'COPILOT_ACTION_REJECTED' }),
      }),
    )
  })

  it('(g) concurrency: two POSTs for same actionId → mutation once, one 409', async () => {
    // Both requests authenticate and load the same pending log
    mockGetSession.mockResolvedValue({ user: { id: 'user-owner-1' } })
    mockUserFindUnique.mockResolvedValue(OWNER_USER)
    mockAiActionLogFindFirst.mockResolvedValue(PENDING_LOG)

    // DB atomic claim: first call wins (count=1), second loses (count=0)
    mockAiActionLogUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const [res1, res2] = await Promise.all([
      POST(makeRequest({ actionId: 'action-1' })),
      POST(makeRequest({ actionId: 'action-1' })),
    ])

    const statuses = [res1.status, res2.status]

    // One request must succeed (200) and the other must be rejected (409)
    expect(statuses).toContain(200)
    expect(statuses).toContain(409)

    // Tool mutation must have been executed exactly ONCE despite concurrent requests
    expect(mockToolExecute).toHaveBeenCalledOnce()
  })
})
