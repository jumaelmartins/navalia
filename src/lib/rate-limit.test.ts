/**
 * rate-limit.test.ts — TDD-first for rateLimit
 *
 * Uses an in-memory Redis stub (no ioredis-mock dependency).
 * RED→GREEN: this file covers the contract before implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory Redis stub — implements ops used by rateLimit: incr, expire, ttl
// ---------------------------------------------------------------------------
class MemRedis {
  private strings = new Map<string, string>()
  private keysTTL = new Map<string, number>() // Track which keys have TTL set
  expireCalls: { key: string; seconds: number }[] = [] // Track expire() calls for testing

  async incr(key: string): Promise<number> {
    const cur = this.strings.get(key)
    const next = (cur !== undefined ? parseInt(cur, 10) : 0) + 1
    this.strings.set(key, String(next))
    return next
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expireCalls.push({ key, seconds })
    this.keysTTL.set(key, seconds)
    return 1
  }

  async ttl(key: string): Promise<number> {
    // Return -1 if key exists but has no TTL, -2 if key doesn't exist, or remaining TTL
    if (!this.strings.has(key)) return -2
    if (this.keysTTL.has(key)) return this.keysTTL.get(key)!
    return -1 // Key exists but no TTL set (orphaned key)
  }
}

// ---------------------------------------------------------------------------
// Mock @/lib/redis to return our in-memory stub
// ---------------------------------------------------------------------------
let memRedis: MemRedis

vi.mock('@/lib/redis', () => ({
  getRedis: () => memRedis,
}))

// Import AFTER the mock is registered
import { rateLimit } from './rate-limit'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  memRedis = new MemRedis()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rateLimit — under limit', () => {
  it('allows first request and reports correct remaining count', async () => {
    const result = await rateLimit('test:under', 5, 300)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('allows requests exactly at the limit boundary (count === max)', async () => {
    for (let i = 0; i < 4; i++) {
      await rateLimit('test:boundary', 5, 300)
    }
    const atLimit = await rateLimit('test:boundary', 5, 300)
    expect(atLimit.allowed).toBe(true)
    expect(atLimit.remaining).toBe(0)
  })
})

describe('rateLimit — over limit', () => {
  it('denies the (max + 1)th request and reports 0 remaining', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimit('test:over', 5, 300)
    }
    const overLimit = await rateLimit('test:over', 5, 300)
    expect(overLimit.allowed).toBe(false)
    expect(overLimit.remaining).toBe(0)
  })
})

describe('rateLimit — key isolation', () => {
  it('different keys have independent counters', async () => {
    await rateLimit('key:A', 2, 300)
    await rateLimit('key:A', 2, 300)
    const overA = await rateLimit('key:A', 2, 300)
    const firstB = await rateLimit('key:B', 2, 300)

    expect(overA.allowed).toBe(false)
    expect(firstB.allowed).toBe(true)
    expect(firstB.remaining).toBe(1)
  })
})

describe('rateLimit — self-healing TTL (orphaned key recovery)', () => {
  it('re-applies expiry when a key loses its TTL', async () => {
    // Pre-seed a key without TTL (orphaned key scenario)
    await memRedis.incr('orphaned:key')
    // Verify it exists but has no TTL
    expect(await memRedis.ttl('orphaned:key')).toBe(-1)

    // Call rateLimit on the orphaned key
    const result = await rateLimit('orphaned:key', 5, 300)

    // Should detect the missing TTL and re-apply it
    expect(result.allowed).toBe(true)
    // Verify that expire() was called to heal the key
    const expireCalls = memRedis.expireCalls.filter(c => c.key === 'orphaned:key')
    expect(expireCalls.length).toBeGreaterThan(0)
    expect(expireCalls[expireCalls.length - 1].seconds).toBe(300)
  })
})
