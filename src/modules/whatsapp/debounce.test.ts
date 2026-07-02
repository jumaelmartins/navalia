/**
 * debounce.test.ts — TDD-first for scheduleDebounced
 *
 * Uses an in-memory Redis stub (no ioredis-mock dependency) and
 * vi.useFakeTimers so the 4-second window runs in zero real time.
 *
 * RED→GREEN: this file is written before debounce.ts exists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory Redis stub — implements only ops used by scheduleDebounced:
//   rpush, lrange, del, expire, incr, get
// ---------------------------------------------------------------------------
class MemRedis {
  private strings = new Map<string, string>()
  private lists = new Map<string, string[]>()

  async rpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? []
    list.push(value)
    this.lists.set(key, list)
    return list.length
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const list = this.lists.get(key) ?? []
    const actualEnd = end === -1 ? list.length : end + 1
    return list.slice(start, actualEnd)
  }

  async del(key: string): Promise<number> {
    const a = this.lists.delete(key)
    const b = this.strings.delete(key)
    return a || b ? 1 : 0
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1 // no-op in tests (fake timers replace TTL semantics)
  }

  async incr(key: string): Promise<number> {
    const cur = this.strings.get(key)
    const next = (cur !== undefined ? parseInt(cur, 10) : 0) + 1
    this.strings.set(key, String(next))
    return next
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null
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
import { scheduleDebounced } from './debounce'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  memRedis = new MemRedis()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Test 1: 3 rapid pushes → one flush with all 3 fragments in order
// ---------------------------------------------------------------------------
describe('3 rapid pushes within window → single flush', () => {
  it('calls flush once with all 3 fragments in insertion order', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined)

    await scheduleDebounced('wa:shop1:phone1', 'A', 4000, flushFn)
    await scheduleDebounced('wa:shop1:phone1', 'B', 4000, flushFn)
    await scheduleDebounced('wa:shop1:phone1', 'C', 4000, flushFn)

    // Nothing flushed yet — window still open
    expect(flushFn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4100)

    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledWith(['A', 'B', 'C'])
  })

  it('earlier timers do NOT fire flush (only last-writer wins)', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined)

    await scheduleDebounced('wa:shop1:phone1', 'X', 4000, flushFn)
    await scheduleDebounced('wa:shop1:phone1', 'Y', 4000, flushFn)

    await vi.advanceTimersByTimeAsync(4100)

    // Only 1 flush, not 2
    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledWith(['X', 'Y'])
  })
})

// ---------------------------------------------------------------------------
// Test 2: second burst after flush → independent new flush
// ---------------------------------------------------------------------------
describe('second burst after first flush fires independently', () => {
  it('produces two separate flushes with correct fragments each time', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined)

    // First burst
    await scheduleDebounced('wa:shop1:phone1', 'X', 4000, flushFn)
    await scheduleDebounced('wa:shop1:phone1', 'Y', 4000, flushFn)
    await vi.advanceTimersByTimeAsync(4100)

    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenNthCalledWith(1, ['X', 'Y'])

    // Second burst (buffer cleared; new token)
    await scheduleDebounced('wa:shop1:phone1', 'Z', 4000, flushFn)
    await vi.advanceTimersByTimeAsync(4100)

    expect(flushFn).toHaveBeenCalledTimes(2)
    expect(flushFn).toHaveBeenNthCalledWith(2, ['Z'])
  })
})

// ---------------------------------------------------------------------------
// Test 3: concurrent keys are independent — no cross-contamination
// ---------------------------------------------------------------------------
describe('concurrent keys do not interfere with each other', () => {
  it('each key flushes only its own fragments', async () => {
    const flush1 = vi.fn().mockResolvedValue(undefined)
    const flush2 = vi.fn().mockResolvedValue(undefined)

    await scheduleDebounced('wa:shop1:phone1', 'A', 4000, flush1)
    await scheduleDebounced('wa:shop2:phone2', 'B', 4000, flush2)
    await scheduleDebounced('wa:shop1:phone1', 'C', 4000, flush1)

    await vi.advanceTimersByTimeAsync(4100)

    expect(flush1).toHaveBeenCalledTimes(1)
    expect(flush1).toHaveBeenCalledWith(['A', 'C'])

    expect(flush2).toHaveBeenCalledTimes(1)
    expect(flush2).toHaveBeenCalledWith(['B'])
  })
})

// ---------------------------------------------------------------------------
// Test 4: tokKey is deleted after successful flush
// ---------------------------------------------------------------------------
describe('tokKey is deleted from redis after successful flush', () => {
  it('tok key is null after the flush window closes', async () => {
    const key = 'wa:shop1:phone1'
    const flushFn = vi.fn().mockResolvedValue(undefined)

    await scheduleDebounced(key, 'A', 4000, flushFn)
    await vi.advanceTimersByTimeAsync(4100)

    expect(flushFn).toHaveBeenCalledTimes(1)

    // tokKey should have been deleted after the successful flush
    const tokValue = await memRedis.get(`${key}:tok`)
    expect(tokValue).toBeNull()
  })
})
