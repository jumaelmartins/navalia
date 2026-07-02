/**
 * Shared helpers used by both create-appointment.ts and admin-actions.ts.
 * Extracted to avoid duplication (M4).
 */
import { Prisma } from '@prisma/client'

/** Derives weekday (0=Sun … 6=Sat) from a "YYYY-MM-DD" string without
 *  any timezone shifting: parse as UTC midnight and call getUTCDay(). */
export function dateToWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Business-hours map keyed 0-6 (Sun-Sat). */
export type BizHoursMap = Record<string, { start: string; end: string } | null>

/** Returns true for errors that warrant a single full-transaction retry. */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  // P2034: serialization / snapshot-isolation failure
  // P2002: unique constraint race — two concurrent new-customer upserts
  return err.code === 'P2034' || err.code === 'P2002'
}
