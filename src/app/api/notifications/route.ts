import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getUnreadCount,
  listRecent,
  markRead,
  markAllRead,
} from '@/modules/notifications/queries'

const MarkBody = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
})

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

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    rawBody = {}
  }

  const parsed = MarkBody.safeParse(rawBody)
  const data = parsed.success ? parsed.data : {}

  if (data.all) await markAllRead(tenantId)
  else if (data.ids && data.ids.length) await markRead(tenantId, data.ids)

  return NextResponse.json({ ok: true })
}
