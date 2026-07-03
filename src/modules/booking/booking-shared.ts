/**
 * Shared helpers used by both create-appointment.ts and admin-actions.ts.
 * Extracted to avoid duplication (M4).
 */
import { Prisma } from '@prisma/client'
import { isDriverAdapterError } from '@prisma/driver-adapter-utils'

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
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: serialization / snapshot-isolation failure
    // P2002: unique constraint race — two concurrent new-customer upserts
    return err.code === 'P2034' || err.code === 'P2002'
  }
  // DriverAdapterError: TransactionWriteConflict — serialization failure surfaced
  // directly from @prisma/adapter-pg (PgAdapter path) without being wrapped as P2034.
  // Match on cause.kind (the stable discriminant) rather than err.message, which is a
  // fallback from payload.kind only when payload has no "message" field — fragile.
  if (isDriverAdapterError(err) && err.cause.kind === 'TransactionWriteConflict') {
    return true
  }
  return false
}
