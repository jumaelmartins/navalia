import { getRedis } from './redis'

/**
 * Fixed-window rate limiter using Redis INCR + EXPIRE (NX-style via count===1).
 *
 * Algorithm:
 *   1. INCR the key → get current count for this window.
 *   2. If count === 1 (first hit), set EXPIRE to start the window TTL.
 *   3. allowed = count <= max; remaining = max(0, max - count).
 *
 * @param key       Redis key to increment (caller prefixes, e.g. `rl:web:${ip}`)
 * @param max       Maximum allowed requests in the window
 * @param windowSec Window duration in seconds
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) {
    // First hit in this window — set the TTL so the counter auto-expires
    await redis.expire(key, windowSec)
  }
  const allowed = count <= max
  const remaining = Math.max(0, max - count)
  return { allowed, remaining }
}
