import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// POST /api/webhooks/evolution
// ---------------------------------------------------------------------------
//
// Receives Evolution API webhook events.
//
// Auth: Evolution is configured (in createInstance) to send the header
//   X-Navalia-Token: <EVOLUTION_WEBHOOK_TOKEN>
// We fail-closed: missing or wrong token → 401.
//
// Supported events:
//   CONNECTION_UPDATE → persist whatsappStatus (open→CONNECTED etc.)
//   MESSAGES_UPSERT   → idempotency insert + TODO (Task 16 AI pipeline)
//
// Unknown instance or unknown event → 200 drop (never retry junk).
// Parse defensively — never 500 on malformed payloads.
//
// Evolution v2.2.3 webhook payload shape (verified against container):
//   {
//     event: "connection.update" | "messages.upsert" | ...
//     instance: "instanceName"
//     data: { state?: "open"|"connecting"|"close", ... }
//   }
// Note: event names use dot-notation in the payload even though registration
// uses SCREAMING_SNAKE_CASE (CONNECTION_UPDATE → "connection.update").
// ---------------------------------------------------------------------------

export const runtime = 'nodejs'

const STATUS_MAP: Record<string, 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'> = {
  open: 'CONNECTED',
  connecting: 'CONNECTING',
  close: 'DISCONNECTED',
}

export async function POST(req: NextRequest) {
  // ── 1. Token verification (fail closed) ──────────────────────────────────
  const token = req.headers.get('x-navalia-token') ?? ''
  const expected = process.env.EVOLUTION_WEBHOOK_TOKEN ?? ''

  if (!expected || token !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  // ── 2. Parse payload defensively ─────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    // Junk / non-JSON body → drop
    return new Response('OK', { status: 200 })
  }

  if (typeof payload !== 'object' || payload === null) {
    return new Response('OK', { status: 200 })
  }

  const event = typeof payload.event === 'string' ? payload.event : ''
  const instanceName =
    typeof payload.instance === 'string' ? payload.instance : ''
  const data =
    typeof payload.data === 'object' && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {}

  if (!instanceName) {
    return new Response('OK', { status: 200 })
  }

  // ── 3. Resolve barbershop by instance name ────────────────────────────────
  const barbershop = await prisma.barbershop
    .findUnique({ where: { evolutionInstanceId: instanceName } })
    .catch(() => null)

  if (!barbershop) {
    // Unknown instance — drop silently (never log secrets, avoid retry storms)
    return new Response('OK', { status: 200 })
  }

  // ── 4. Route by event ─────────────────────────────────────────────────────
  try {
    switch (event) {
      // ── connection.update ────────────────────────────────────────────────
      case 'connection.update':
      case 'CONNECTION_UPDATE': {
        const rawState = typeof data.state === 'string' ? data.state : ''
        const newStatus = STATUS_MAP[rawState]

        if (newStatus) {
          await prisma.barbershop.update({
            where: { id: barbershop.id },
            data: { whatsappStatus: newStatus },
          })
        }
        break
      }

      // ── messages.upsert ──────────────────────────────────────────────────
      case 'messages.upsert':
      case 'MESSAGES_UPSERT': {
        // Idempotency insert — generate a stable event id from the first
        // message key id if available; fall back to a timestamp-based id.
        const messages = Array.isArray(data.messages) ? data.messages : []
        const firstMsgId =
          typeof (messages[0] as Record<string, unknown> | undefined)?.key === 'object'
            ? ((messages[0] as Record<string, unknown>)?.key as Record<string, unknown>)?.id
            : undefined
        const eventId =
          typeof firstMsgId === 'string'
            ? `msg_${firstMsgId}`
            : `msg_${barbershop.id}_${Date.now()}`

        try {
          await prisma.webhookEvent.create({
            data: { provider: 'EVOLUTION', eventId },
          })
        } catch (err) {
          // P2002 = duplicate → already processed
          if ((err as { code?: string }).code === 'P2002') break
          throw err
        }

        // TODO(Task 16): Route incoming message into AI conversation pipeline.
        // The message payload is in `data.messages[0]`.
        // Pipeline entry: src/modules/whatsapp/conversation-pipeline.ts
        break
      }

      default:
        // Unknown event type — drop; still return 200 so Evolution won't retry
        break
    }
  } catch (err) {
    console.error('[webhook/evolution] error processing event', event, err)
    // Return 200 to avoid retry storms on persistent errors
    return new Response('OK', { status: 200 })
  }

  return new Response('OK', { status: 200 })
}
