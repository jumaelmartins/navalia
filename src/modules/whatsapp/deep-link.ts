/**
 * WhatsApp deep-link helpers for Navalia.
 *
 * buildWhatsAppLink  — contextual wa.me URL, message adapts to how much the
 *                      user has already selected (shop only / +service /
 *                      +professional / +date+time confirmation).
 *
 * buildConfirmationShareText — multi-line pt-BR summary for sharing a
 *                              confirmed appointment (no phone target).
 */

/** Strip non-digits; prefix '55' when 10 or 11 raw digits. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return '55' + digits
  return digits
}

/** "YYYY-MM-DD" → "DD/MM" */
function dateToDDMM(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" */
function dateToDDMMYYYY(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

export function buildWhatsAppLink(args: {
  phone: string
  shopName: string
  service?: string
  professional?: string
  date?: string  // "YYYY-MM-DD"
  time?: string  // "HH:mm"
}): string {
  const { phone, shopName, service, professional, date, time } = args

  let message: string

  if (service && date && time) {
    // Full confirmation intent
    message = `Olá! Gostaria de confirmar um agendamento de ${service} para ${dateToDDMM(date)} às ${time} na ${shopName}.`
  } else if (service && professional) {
    // Service + professional selected
    message = `Olá! Gostaria de agendar ${service} na ${shopName} com ${professional}.`
  } else if (service) {
    // Service selected only
    message = `Olá! Gostaria de agendar ${service} na ${shopName}.`
  } else {
    // Generic — just the shop
    message = `Olá! Gostaria de agendar um horário na ${shopName}.`
  }

  const normalizedPhone = normalizePhone(phone)
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`
}

export function buildConfirmationShareText(a: {
  serviceName: string
  professionalName: string
  date: string  // "YYYY-MM-DD"
  time: string  // "HH:mm"
  shopName: string
}): string {
  return [
    `Agendamento confirmado na ${a.shopName}!`,
    ``,
    `Serviço: ${a.serviceName}`,
    `Profissional: ${a.professionalName}`,
    `Data: ${dateToDDMMYYYY(a.date)}`,
    `Horário: ${a.time}`,
  ].join('\n')
}
