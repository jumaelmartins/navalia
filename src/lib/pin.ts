import { createHash, timingSafeEqual } from 'node:crypto'

/** sha256 hex of the PIN. PINs are low-entropy + short-lived + single-use;
 *  sha256 is sufficient here and keeps compare cheap and constant-time. */
export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}

/** Timing-safe compare. False (never throws) on any length/format mismatch. */
export function verifyPin(pin: string, hash: string): boolean {
  const candidate = hashPin(pin)
  if (candidate.length !== hash.length) return false
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}
