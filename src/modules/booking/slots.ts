import type { SlotInput } from './types'

// ---------------------------------------------------------------------------
// Date canonicalization guard
// ---------------------------------------------------------------------------

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Returns true only when `date` is a valid ISO calendar date in the form
 * "YYYY-MM-DD" with no padding shortcuts (e.g. "2026-7-6" → false) and
 * the calendar date actually exists (e.g. "2026-02-30" → false).
 */
export function isCanonicalDate(date: string): boolean {
  if (!DATE_REGEX.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

// ---------------------------------------------------------------------------
// Low-level helpers — minutes-since-midnight, no Date objects
// ---------------------------------------------------------------------------

function toMin(hhmm: string): number {
  const colon = hhmm.indexOf(':')
  return parseInt(hhmm.slice(0, colon), 10) * 60 + parseInt(hhmm.slice(colon + 1), 10)
}

function toHHmm(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Returns true when [aStart, aEnd) overlaps [bStart, bEnd).
 * Touching edges (e.g. aEnd === bStart) do NOT overlap.
 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return toMin(aStart) < toMin(bEnd) && toMin(aEnd) > toMin(bStart)
}

/**
 * Adds `min` minutes to an "HH:mm" string, returning a new "HH:mm" string.
 */
export function addMinutes(hhmm: string, min: number): string {
  return toHHmm(toMin(hhmm) + min)
}

/**
 * Pure slot computation. Returns sorted, unique "HH:mm" start times where a
 * [start, start+durationMin) window:
 *  - fits entirely inside the intersection of businessHours and each availability rule window
 *  - does not overlap any block or appointment
 *  - starts >= minStart (when provided)
 */
export function computeSlots(input: SlotInput): string[] {
  const {
    businessHours,
    availabilityRules,
    blocks,
    appointments,
    durationMin,
    stepMin = 15,
    minStart,
  } = input

  if (!businessHours) return []

  const bhStart = toMin(businessHours.start)
  const bhEnd = toMin(businessHours.end)
  const minStartMin = minStart !== undefined ? toMin(minStart) : null

  const seen = new Set<string>()

  for (const rule of availabilityRules) {
    const ruleStart = toMin(rule.start)
    const ruleEnd = toMin(rule.end)

    // Intersect business hours with this availability window
    const winStart = Math.max(bhStart, ruleStart)
    const winEnd = Math.min(bhEnd, ruleEnd)

    if (winStart >= winEnd) continue

    // Walk the grid from the window start
    let current = winStart
    while (current + durationMin <= winEnd) {
      // Apply minStart cutoff
      if (minStartMin !== null && current < minStartMin) {
        current += stepMin
        continue
      }

      const candidateStart = toHHmm(current)
      const candidateEnd = toHHmm(current + durationMin)

      let blocked = false

      for (const b of blocks) {
        if (overlaps(candidateStart, candidateEnd, b.start, b.end)) {
          blocked = true
          break
        }
      }

      if (!blocked) {
        for (const a of appointments) {
          if (overlaps(candidateStart, candidateEnd, a.start, a.end)) {
            blocked = true
            break
          }
        }
      }

      if (!blocked) {
        seen.add(candidateStart)
      }

      current += stepMin
    }
  }

  return Array.from(seen).sort()
}
