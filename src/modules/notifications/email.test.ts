import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMailMock = vi.fn()

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}))

import { sendEmail } from './email'

describe('sendEmail', () => {
  beforeEach(() => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user@example.com')
    vi.stubEnv('SMTP_PASSWORD', 'secret')
    vi.stubEnv('SMTP_FROM', 'Navalia <no-reply@example.com>')
    sendMailMock.mockReset()
  })

  it('sends mail with the given to/subject/text and returns ok', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' })

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(true)
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'Navalia <no-reply@example.com>',
      to: 'cliente@example.com',
      subject: 'Assunto',
      text: 'Corpo',
    })
  })

  it('returns ok:false when sendMail throws', async () => {
    sendMailMock.mockRejectedValue(new Error('Connection refused'))

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Connection refused')
  })

  it('returns ok:false when SMTP_HOST is not set', async () => {
    vi.stubEnv('SMTP_HOST', '')

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(false)
  })
})
