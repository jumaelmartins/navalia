import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared time schema — HH:mm format validation
// ---------------------------------------------------------------------------

export const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato de hora inválido — use HH:mm.')

// ---------------------------------------------------------------------------
// RuleSchema — one availability window for a given weekday
// ---------------------------------------------------------------------------

export const RuleSchema = z
  .object({
    weekday: z
      .number()
      .int()
      .min(0, 'Dia da semana inválido.')
      .max(6, 'Dia da semana inválido.'),
    startTime: TimeSchema,
    endTime: TimeSchema,
  })
  .refine((r) => r.startTime < r.endTime, {
    message: 'O horário de início deve ser antes do horário de encerramento.',
  })

export type Rule = z.infer<typeof RuleSchema>

// ---------------------------------------------------------------------------
// Overlap detection — touching edges (12:00/12:00) are ALLOWED
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/**
 * Returns an error message if any two rules on the same weekday overlap,
 * or null if there are no overlaps.
 *
 * Two windows [A_start, A_end) and [B_start, B_end) overlap when
 * B_start < A_end (i.e., they share at least one minute).
 * Touching edges (A_end === B_start) is explicitly allowed.
 */
export function detectOverlaps(
  rules: { weekday: number; startTime: string; endTime: string }[],
): string | null {
  const byDay: Record<number, { startTime: string; endTime: string }[]> = {}

  for (const r of rules) {
    if (!byDay[r.weekday]) byDay[r.weekday] = []
    byDay[r.weekday].push({ startTime: r.startTime, endTime: r.endTime })
  }

  for (const [weekdayStr, windows] of Object.entries(byDay)) {
    if (windows.length < 2) continue

    const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime))

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      // Strict less-than: touching is allowed, overlap is not
      if (next.startTime < curr.endTime) {
        const dayName = DAY_NAMES[parseInt(weekdayStr, 10)]
        return `Faixas de horário sobrepostas na(o) ${dayName}.`
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Date validation — YYYY-MM-DD + calendar validity check
// ---------------------------------------------------------------------------

const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * Returns true only if dateStr is a syntactically valid YYYY-MM-DD and
 * also represents a real calendar date (e.g. "2026-02-30" is rejected).
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false
  // Force UTC midnight to avoid timezone drift; then compare back
  const d = new Date(dateStr + 'T00:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr
}

// ---------------------------------------------------------------------------
// BlockSchema — schedule block input validation
// ---------------------------------------------------------------------------

export const BlockSchema = z
  .object({
    professionalId: z.string().min(1, 'Profissional obrigatório.'),
    date: z
      .string()
      .regex(DATE_REGEX, 'Data inválida — use YYYY-MM-DD.')
      .refine(isValidCalendarDate, { message: 'Data inválida.' }),
    startTime: TimeSchema,
    endTime: TimeSchema,
    reason: z.string().optional(),
  })
  .refine((b) => b.startTime < b.endTime, {
    message: 'O horário de início deve ser antes do horário de encerramento.',
  })

export type BlockInput = z.infer<typeof BlockSchema>
