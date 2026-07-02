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

export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingError }
