export type TimeRange = { start: string; end: string } // "HH:mm"

export type SlotInput = {
  businessHours: TimeRange | null          // for the target weekday
  availabilityRules: TimeRange[]           // professional's rules for that weekday
  blocks: TimeRange[]                      // schedule blocks that date
  appointments: TimeRange[]                // PENDING/CONFIRMED that date
  durationMin: number
  stepMin?: number                         // default 15
  minStart?: string                        // e.g. "now" cutoff for today, optional
}

export type AppointmentSource =
  | 'PUBLIC_PAGE'
  | 'WHATSAPP'
  | 'ADMIN'
  | 'AI_WEB'
  | 'COPILOT'

export type BookingError =
  | 'SLOT_TAKEN'
  | 'INVALID_SERVICE'
  | 'INVALID_PROFESSIONAL'
  | 'OUTSIDE_AVAILABILITY'
  | 'INVALID_PHONE'
  | 'NOT_FOUND'
  | 'CONSENT_REQUIRED'

/** Single source of truth for pt-BR booking error messages. */
export const BOOKING_ERROR_PT_BR: Record<BookingError, string> = {
  SLOT_TAKEN: 'Esse horário acabou de ser reservado. Escolha outro.',
  INVALID_SERVICE: 'Serviço não encontrado.',
  INVALID_PROFESSIONAL: 'Profissional não encontrado.',
  OUTSIDE_AVAILABILITY: 'Horário fora da disponibilidade.',
  INVALID_PHONE: 'Telefone inválido.',
  NOT_FOUND: 'Agendamento não encontrado.',
  CONSENT_REQUIRED: 'Você precisa concordar com a Política de Privacidade para continuar.',
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingError }
