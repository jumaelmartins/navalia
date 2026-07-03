import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getUnreadCount,
  listRecent,
  markRead,
  markAllRead,
} from '@/modules/notifications/queries'

export const runtime = 'nodejs'

async function resolveTenant(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { barbershopId: true },
  })
  return user?.barbershopId ?? null
}

export async function GET() {
  const tenantId = await resolveTenant()
  if (!tenantId) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const [unread, items] = await Promise.all([
    getUnreadCount(tenantId),
    listRecent(tenantId, 20),
  ])
  return NextResponse.json({ unread, items })
}

export async function POST(req: NextRequest) {
  const tenantId = await resolveTenant()
  if (!tenantId) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let body: { ids?: string[]; all?: boolean }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  if (body.all) await markAllRead(tenantId)
  else if (Array.isArray(body.ids)) await markRead(tenantId, body.ids)

  return NextResponse.json({ ok: true })
}
