import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'

// 3-second timeout helper for probe operations
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

export async function GET() {
  let db = false
  let redis = false

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 3000)
    db = true
  } catch {
    // DB unreachable or timed out
  }

  try {
    const pong = await withTimeout(getRedis().ping(), 3000)
    redis = pong === 'PONG'
  } catch {
    // Redis unreachable or timed out
  }

  const ok = db && redis
  return NextResponse.json({ ok, db, redis }, { status: ok ? 200 : 503 })
}
