import { describe, it, expect, vi } from 'vitest'
import { pushNewAppointmentToOwner } from './push'

function fakePrisma(shop: unknown) {
  return {
    barbershop: { findUnique: vi.fn().mockResolvedValue(shop) },
    appointment: {
      findFirst: vi.fn().mockResolvedValue({
        date: '2099-01-05',
        startTime: '10:00',
        customer: { name: 'Ana' },
        service: { name: 'Corte' },
        professional: { name: 'João' },
      }),
    },
  } as never
}

describe('pushNewAppointmentToOwner', () => {
  it('does nothing when notifications are off', async () => {
    const sendText = vi.fn()
    await pushNewAppointmentToOwner('shop-1', 'appt-1', {
      prisma: fakePrisma({ notifyOwnerWhatsapp: false }),
      sendText,
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('does nothing when WhatsApp is not connected', async () => {
    const sendText = vi.fn()
    await pushNewAppointmentToOwner('shop-1', 'appt-1', {
      prisma: fakePrisma({
        notifyOwnerWhatsapp: true,
        ownerNotifyPhone: '5511999990000',
        evolutionInstanceId: 'nav_x',
        whatsappStatus: 'DISCONNECTED',
      }),
      sendText,
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('sends a summary when enabled + connected', async () => {
    const sendText = vi.fn().mockResolvedValue({})
    await pushNewAppointmentToOwner('shop-1', 'appt-1', {
      prisma: fakePrisma({
        notifyOwnerWhatsapp: true,
        ownerNotifyPhone: '5511999990000',
        evolutionInstanceId: 'nav_x',
        whatsappStatus: 'CONNECTED',
      }),
      sendText,
    })
    expect(sendText).toHaveBeenCalledTimes(1)
    const [instance, to, text] = sendText.mock.calls[0]
    expect(instance).toBe('nav_x')
    expect(to).toBe('5511999990000')
    expect(text).toContain('Corte')
  })

  it('never throws when sendText rejects', async () => {
    const sendText = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      pushNewAppointmentToOwner('shop-1', 'appt-1', {
        prisma: fakePrisma({
          notifyOwnerWhatsapp: true,
          ownerNotifyPhone: '5511999990000',
          evolutionInstanceId: 'nav_x',
          whatsappStatus: 'CONNECTED',
        }),
        sendText,
      }),
    ).resolves.toBeUndefined()
  })
})
