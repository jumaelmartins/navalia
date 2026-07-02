import { z } from 'zod'

/**
 * Validates a single "HH:mm" time string.
 */
const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido — use HH:mm.')

/**
 * A single day's schedule: null means the shop is closed that day.
 * When open, start must be strictly before end (lexicographic comparison
 * works correctly for zero-padded "HH:mm" strings).
 */
const DaySchema = z.union([
  z.null(),
  z
    .object({ start: TimeSchema, end: TimeSchema })
    .refine((d) => d.start < d.end, {
      message: 'O horário de início deve ser antes do horário de encerramento.',
    }),
])

/**
 * Full businessHours object — keys "0" (Sunday) through "6" (Saturday).
 * At least one day must be open (not null).
 */
export const BusinessHoursSchema = z
  .object({
    '0': DaySchema,
    '1': DaySchema,
    '2': DaySchema,
    '3': DaySchema,
    '4': DaySchema,
    '5': DaySchema,
    '6': DaySchema,
  })
  .refine((h) => Object.values(h).some((v) => v !== null), {
    message: 'A barbearia precisa abrir pelo menos um dia.',
  })

export type BusinessHours = z.infer<typeof BusinessHoursSchema>
export type DayHours = z.infer<typeof DaySchema>
