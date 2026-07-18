import 'server-only'
import { createTransport } from 'nodemailer'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function requireEnv(name: string): string | null {
  const value = process.env[name]
  return value && value.length > 0 ? value : null
}

/** Sends a plain-text email via the operator's own SMTP account. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<Result<void>> {
  const host = requireEnv('SMTP_HOST')
  const port = requireEnv('SMTP_PORT')
  const user = requireEnv('SMTP_USER')
  const pass = requireEnv('SMTP_PASSWORD')
  const from = requireEnv('SMTP_FROM')

  if (!host || !port || !user || !pass || !from) {
    return { ok: false, error: 'Configuração de e-mail (SMTP) ausente.' }
  }

  try {
    const transporter = createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    })
    await transporter.sendMail({ from, to, subject, text })
    return { ok: true, data: undefined }
  } catch (err) {
    return {
      ok: false,
      error: `Erro ao enviar e-mail: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
    }
  }
}
