import 'server-only'
import { getRedis } from '@/lib/redis'

/**
 * scheduleDebounced — WhatsApp message burst aggregation
 *
 * Semantics (single-node):
 *  - Each call RPUSHes `payload` into `{key}:buf` (EXPIRE 120 s).
 *  - An atomic INCR on `{key}:tok` gives each call a monotonically
 *    increasing token. Only the last call's token survives in Redis.
 *  - A setTimeout(delayMs) callback reads the current token; if it
 *    still matches the caller's token (last-writer wins), it flushes
 *    all buffered fragments and deletes the buffer. Earlier timers
 *    see a newer token and no-op.
 *
 * NOTE: Relies on single-node Node.js setTimeout semantics.
 *       Not safe for multi-instance deployments without a distributed
 *       lock; single-node is the documented deployment target.
 *
 * @param key      Redis namespace key, e.g. `wa:{shopId}:{phone}`
 * @param payload  One message fragment (the full text of one WhatsApp message)
 * @param delayMs  Debounce window in ms (4000 in production)
 * @param flush    Called once per window with ALL buffered fragments in order
 */
export async function scheduleDebounced(
  key: string,
  payload: string,
  delayMs: number,
  flush: (merged: string[]) => Promise<void>,
): Promise<void> {
  const redis = getRedis()
  const bufKey = `${key}:buf`
  const tokKey = `${key}:tok`

  // 1. Buffer the payload (RPUSH preserves insertion order)
  await redis.rpush(bufKey, payload)
  await redis.expire(bufKey, 120)

  // 2. Claim a new monotonic token (INCR is atomic — last writer gets highest)
  const token = await redis.incr(tokKey)
  await redis.expire(tokKey, 120)

  // 3. Schedule flush; no-op if a newer token was issued before the timer fires
  setTimeout(async () => {
    try {
      const current = await redis.get(tokKey)
      if (current !== String(token)) return // superseded by a later call

      const fragments = await redis.lrange(bufKey, 0, -1)
      await redis.del(bufKey)

      if (fragments.length > 0) {
        await flush(fragments)
      }
    } catch (err) {
      console.error('[debounce] flush error', key, err)
    }
  }, delayMs)
}
