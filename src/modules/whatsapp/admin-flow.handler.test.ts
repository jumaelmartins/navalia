import { describe, it, expect, vi } from 'vitest'
import { handleAdminTurn } from './admin-flow'
import { hashPin } from '@/lib/pin'
import { verifyPin } from '@/lib/pin'

const baseShop = {
  id: 'shop-1',
  name: 'X',
  timezone: 'America/Bahia',
  adminPinHash: null as string | null,
  adminPinExpiresAt: null as Date | null,
}

function deps(over: Partial<any> = {}) {
  return {
    runAssistant: vi.fn(),
    buildCopilotTools: vi.fn().mockReturnValue([]),
    adminPrompt: vi.fn().mockReturnValue('SYS'),
    confirmSensitiveAction: vi.fn(),
    verifyPin,
    ...over,
  } as any
}

const now = new Date('2026-07-03T12:00:00Z')

describe('handleAdminTurn', () => {
  it('runs a read command and returns the AI reply (no pending)', async () => {
    const d = deps({
      runAssistant: vi.fn().mockResolvedValue({ ok: true, data: { reply: 'Faturamento: R$ 100' } }),
    })
    const out = await handleAdminTurn({
      shop: baseShop,
      ownerUserId: 'u1',
      conversation: { pendingActionId: null, pendingActionExpiresAt: null },
      text: 'faturamento hoje?',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(out.reply).toContain('Faturamento')
    expect(out.setPending).toBeUndefined()
  })

  it('stores a pending action when the AI asks for confirmation', async () => {
    const d = deps({
      runAssistant: vi.fn().mockResolvedValue({
        ok: true,
        data: { reply: 'precisa confirmar', pendingAction: { id: 'act-1', toolName: 'cancelAppointment', summary: 'Cancelar 10:00', args: {} } },
      }),
    })
    const out = await handleAdminTurn({
      shop: baseShop,
      ownerUserId: 'u1',
      conversation: { pendingActionId: null, pendingActionExpiresAt: null },
      text: 'cancela o das 10h',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(out.setPending).toMatchObject({ actionId: 'act-1' })
    expect(out.reply.toLowerCase()).toContain('pin')
  })

  it('confirms with a valid PIN and clears pending + consumes pin', async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, data: { toolName: 'cancelAppointment', output: {}, rejected: false } })
    const d = deps({ confirmSensitiveAction: confirm })
    const out = await handleAdminTurn({
      shop: { ...baseShop, adminPinHash: hashPin('123456'), adminPinExpiresAt: new Date('2026-07-03T12:04:00Z') },
      ownerUserId: 'u1',
      conversation: { pendingActionId: 'act-1', pendingActionExpiresAt: new Date('2026-07-03T12:03:00Z') },
      text: '123456',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'act-1', channel: 'WHATSAPP_ADMIN', reject: false }))
    expect(out.setPending).toBeNull()
    expect(out.consumePin).toBe(true)
  })

  it('rejects a wrong PIN, keeps pending', async () => {
    const confirm = vi.fn()
    const d = deps({ confirmSensitiveAction: confirm })
    const out = await handleAdminTurn({
      shop: { ...baseShop, adminPinHash: hashPin('123456'), adminPinExpiresAt: new Date('2026-07-03T12:04:00Z') },
      ownerUserId: 'u1',
      conversation: { pendingActionId: 'act-1', pendingActionExpiresAt: new Date('2026-07-03T12:03:00Z') },
      text: '000000',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(out.setPending).toBeUndefined()
    expect(out.reply.toLowerCase()).toContain('pin')
  })

  it('treats an expired PIN as invalid', async () => {
    const confirm = vi.fn()
    const d = deps({ confirmSensitiveAction: confirm })
    const out = await handleAdminTurn({
      shop: { ...baseShop, adminPinHash: hashPin('123456'), adminPinExpiresAt: new Date('2026-07-03T11:00:00Z') },
      ownerUserId: 'u1',
      conversation: { pendingActionId: 'act-1', pendingActionExpiresAt: new Date('2026-07-03T12:03:00Z') },
      text: '123456',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(out.reply.toLowerCase()).toContain('expirou')
  })

  it('cancels a pending action on "cancelar"', async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, data: { toolName: 'cancelAppointment', output: null, rejected: true } })
    const d = deps({ confirmSensitiveAction: confirm })
    const out = await handleAdminTurn({
      shop: baseShop,
      ownerUserId: 'u1',
      conversation: { pendingActionId: 'act-1', pendingActionExpiresAt: new Date('2026-07-03T12:03:00Z') },
      text: 'cancelar',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ reject: true }))
    expect(out.setPending).toBeNull()
  })

  it('expires a stale pending action before classifying', async () => {
    const d = deps({
      runAssistant: vi.fn().mockResolvedValue({ ok: true, data: { reply: 'ok' } }),
    })
    const out = await handleAdminTurn({
      shop: baseShop,
      ownerUserId: 'u1',
      conversation: { pendingActionId: 'act-1', pendingActionExpiresAt: new Date('2026-07-03T11:00:00Z') }, // expired
      text: '123456',
      history: [],
      today: '2026-07-03',
      now,
      deps: d,
    })
    // pending already expired → treated as a fresh command, pending cleared
    expect(out.setPending).toBeNull()
  })
})
