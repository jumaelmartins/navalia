import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'

export async function GET() {
  let db = false
  let redis = false

  try {
    await prisma.$queryRaw`SELECT 1`
    db = true
  } catch {
    // DB unreachable
  }

  try {
    const pong = await getRedis().ping()
    redis = pong === 'PONG'
  } catch {
    // Redis unreachable
  }

  const ok = db && redis
  return NextResponse.json({ ok, db, redis }, { status: ok ? 200 : 503 })
}
