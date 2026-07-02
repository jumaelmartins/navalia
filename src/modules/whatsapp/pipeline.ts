import 'server-only'
import { prisma } from '@/lib/prisma'
import { hasAccess } from '@/modules/billing/gate'
import { isOpenAIConfigured } from '@/lib/openai'
import { rateLimit } from '@/lib/rate-limit'
import { runAssistant } from '@/modules/ai/orchestrator'
import { buildPublicTools } from '@/modules/ai/tools/public-tools'
import { publicSystemPrompt } from '@/modules/ai/prompts'
import { evolution } from './evolution-client'
import { scheduleDebounced } from './debounce'
import type { ChatMsg } from '@/modules/ai/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 4000

const FALLBACK_REPLY =
  'Opa, tive um problema técnico. Um atendente da barbearia vai te responder em breve.'

const ACCESS_DENIED_REPLY =
  'Este número não está disponível no momento.'

const NON_TEXT_REPLY =
  'Por enquanto só consigo ler mensagens de texto.'

const HUMAN_MARKER = '[HUMANO]'

const HUMAN_HANDOFF_SUFFIX =
  '\nUm atendente da barbearia vai continuar a conversa por aqui.'

// ---------------------------------------------------------------------------
// parseMessagesUpsert — pure extractor for MESSAGES_UPSERT payloads
//
// Returns null for:
//   - malformed payload
//   - fromMe === true (own messages)
//   - group chats (@g.us)
//   - status broadcasts
// text is null for non-text messages (voice, image, sticker, etc.)
// ---------------------------------------------------------------------------

export function parseMessagesUpsert(payload: unknown): {
  instanceName: string
  fromPhone: string
  text: string | null
  messageId: string
} | null {
  if (typeof payload !== 'object' || payload === null) return null

  const p = payload as Record<string, unknown>
  const instanceName = typeof p.instance === 'string' ? p.instance : ''
  if (!instanceName) return null

  const data =
    typeof p.data === 'object' && p.data !== null
      ? (p.data as Record<string, unknown>)
      : {}

  const messages = Array.isArray(data.messages) ? data.messages : []
  const msg = messages[0] as Record<string, unknown> | undefined
  if (!msg) return null

  const key =
    typeof msg.key === 'object' && msg.key !== null
      ? (msg.key as Record<string, unknown>)
      : null
  if (!key) return null

  // Ignore outbound (bot's own messages echoed back by Evolution)
  if (key.fromMe === true) return null

  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : ''
  if (!remoteJid) return null

  // Ignore group chats and status broadcasts
  if (remoteJid.endsWith('@g.us')) return null
  if (remoteJid === 'status@broadcast') return null

  // Strip JID suffix to get the plain phone number
  const fromPhone = remoteJid.replace(/@s\.whatsapp\.net$/, '')

  const messageId = typeof key.id === 'string' ? key.id : ''

  // Extract text (conversation or extendedTextMessage only)
  const message =
    typeof msg.message === 'object' && msg.message !== null
      ? (msg.message as Record<string, unknown>)
      : null

  const extMsg =
    message &&
    typeof message.extendedTextMessage === 'object' &&
    message.extendedTextMessage !== null
      ? (message.extendedTextMessage as Record<string, unknown>)
      : null

  const text: string | null = message
    ? typeof message.conversation === 'string'
      ? message.conversation
      : typeof extMsg?.text === 'string'
        ? extMsg.text
        : null
    : null

  return { instanceName, fromPhone, text, messageId }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns shop-local date as "YYYY-MM-DD" using Intl. */
function getShopLocalDate(timezone: string): string {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type ShopRecord = {
  id: string
  name: string
  timezone: string
  businessHours: unknown
  cancellationPolicy: string | null
  address: string | null
  phone: string | null
  subscriptionStatus: import('@prisma/client').SubscriptionStatus
  trialEndsAt: Date
  evolutionInstanceId: string | null
}

type ConvRecord = {
  id: string
  state: import('@prisma/client').ConversationState
}

/** Persist a WhatsappMessage row (best-effort; logs on failure). */
async function persistMessage(
  shop: ShopRecord,
  conversation: ConvRecord,
  direction: 'INBOUND' | 'OUTBOUND',
  senderType: 'CUSTOMER' | 'AI' | 'SYSTEM',
  content: string,
): Promise<void> {
  await prisma.whatsappMessage
    .create({
      data: {
        barbershopId: shop.id,
        conversationId: conversation.id,
        direction,
        senderType,
        content,
      },
    })
    .catch(err => console.error('[pipeline] persistMessage error', err))
}

/**
 * Send a static fallback reply, persist OUTBOUND SYSTEM message,
 * and transition conversation to TRANSFERRED_TO_HUMAN.
 */
async function sendFallback(
  shop: ShopRecord,
  instanceName: string,
  fromPhone: string,
  conversation: ConvRecord,
): Promise<void> {
  // Persist SYSTEM message first (so at least the audit trail exists even if send fails)
  await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', FALLBACK_REPLY)

  const sendResult = await evolution.sendText(instanceName, fromPhone, FALLBACK_REPLY)
  if (!sendResult.ok) {
    console.error('[pipeline] sendText fallback failed', sendResult.error)
  }

  await prisma.whatsappConversation
    .update({ where: { id: conversation.id }, data: { state: 'TRANSFERRED_TO_HUMAN' } })
    .catch(err => console.error('[pipeline] state→TRANSFERRED error', err))
}

// ---------------------------------------------------------------------------
// handleInboundMessage — public pipeline entry point
// ---------------------------------------------------------------------------

/**
 * Full inbound message pipeline:
 *   resolve shop → access gate → upsert conversation → persist INBOUND
 *   → debounce → AI → persist OUTBOUND → sendText
 *
 * Nothing is allowed to throw out of this function.
 * The webhook route calls this awaited; Evolution retries are deduped
 * via WebhookEvent idempotency in the route.
 */
export async function handleInboundMessage({
  instanceName,
  fromPhone,
  text,
  messageId: _messageId,
}: {
  instanceName: string
  fromPhone: string
  text: string | null
  messageId: string
}): Promise<void> {
  try {
    // ── 1. Resolve barbershop ───────────────────────────────────────────────
    const shop = await prisma.barbershop
      .findUnique({
        where: { evolutionInstanceId: instanceName },
        select: {
          id: true,
          name: true,
          timezone: true,
          businessHours: true,
          cancellationPolicy: true,
          address: true,
          phone: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          evolutionInstanceId: true,
        },
      })
      .catch(() => null)

    if (!shop) return

    // ── 2. Billing access gate ──────────────────────────────────────────────
    if (!hasAccess(shop)) {
      // Find existing conversation to avoid spamming the denial reply
      const existing = await prisma.whatsappConversation
        .findUnique({
          where: {
            barbershopId_customerPhone: {
              barbershopId: shop.id,
              customerPhone: fromPhone,
            },
          },
        })
        .catch(() => null)

      if (existing?.state === 'CLOSED') {
        // Already denied — stay silent.
        // TOCTOU: a tiny race remains on single-node (two concurrent reads before
        // either write completes); accepted without a distributed lock.
        return
      }

      // Narrow the race: write CLOSED to DB BEFORE sending the denial so that a
      // concurrent second webhook sees CLOSED on its own findUnique and exits above.
      const conv = await prisma.whatsappConversation.upsert({
        where: {
          barbershopId_customerPhone: {
            barbershopId: shop.id,
            customerPhone: fromPhone,
          },
        },
        create: {
          barbershopId: shop.id,
          customerPhone: fromPhone,
          state: 'CLOSED',
          lastMessageAt: new Date(),
        },
        update: { state: 'CLOSED', lastMessageAt: new Date() },
      })

      const sendResult = await evolution.sendText(instanceName, fromPhone, ACCESS_DENIED_REPLY)
      if (!sendResult.ok) {
        console.error('[pipeline] access-denied sendText failed', sendResult.error)
      }

      if (text !== null) {
        await persistMessage(shop, conv, 'INBOUND', 'CUSTOMER', text)
      }
      await persistMessage(shop, conv, 'OUTBOUND', 'SYSTEM', ACCESS_DENIED_REPLY)
      return
    }

    // ── 3. Upsert conversation ──────────────────────────────────────────────
    let conversation = await prisma.whatsappConversation.upsert({
      where: {
        barbershopId_customerPhone: {
          barbershopId: shop.id,
          customerPhone: fromPhone,
        },
      },
      create: {
        barbershopId: shop.id,
        customerPhone: fromPhone,
        state: 'OPEN',
        lastMessageAt: new Date(),
      },
      update: { lastMessageAt: new Date() },
    })

    // Reopen if shop regained access after a CLOSED state
    if (conversation.state === 'CLOSED') {
      conversation = await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { state: 'OPEN' },
      })
    }

    // ── 4. Human-transferred gate (MUST precede non-text handling) ──────────────
    // If a human agent has taken over, persist text INBOUND for audit then
    // return without any bot reply. Non-text is ignored silently.
    if (conversation.state === 'TRANSFERRED_TO_HUMAN') {
      if (text !== null) {
        await persistMessage(shop, conversation, 'INBOUND', 'CUSTOMER', text)
      }
      return
    }

    // ── 5. Handle non-text messages (bot is active at this point) ───────────────
    if (text === null) {
      await evolution.sendText(instanceName, fromPhone, NON_TEXT_REPLY)
      await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', NON_TEXT_REPLY)
      return
    }

    // ── 6. Persist INBOUND message ──────────────────────────────────────────────
    await persistMessage(shop, conversation, 'INBOUND', 'CUSTOMER', text)

    // ── 6b. Rate limit — 30 messages per 5-minute window per (shop, phone) ──
    // Silently drop after message is persisted so audit trail is intact.
    // I7: protects OpenAI costs and prevents DoS via the public WhatsApp number.
    try {
      const rl = await rateLimit(`rl:wa:${shop.id}:${fromPhone}`, 30, 300)
      if (!rl.allowed) return
    } catch {
      // Redis unavailable — fail open (don't block WhatsApp traffic)
    }

    // ── 7. Debounce — collect burst; flush to AI after window closes ────────
    await scheduleDebounced(
      `wa:${shop.id}:${fromPhone}`,
      text,
      DEBOUNCE_MS,
      async (fragments: string[]) => {
        try {
          await flushToAI({ shop, instanceName, fromPhone, conversation, fragments })
        } catch (err) {
          console.error('[pipeline] flushToAI error', err)
        }
      },
    )
  } catch (err) {
    console.error('[pipeline] unhandled error in handleInboundMessage', err)
  }
}

// ---------------------------------------------------------------------------
// flushToAI — runs the AI assistant loop after debounce window closes
// ---------------------------------------------------------------------------

async function flushToAI({
  shop,
  instanceName,
  fromPhone,
  conversation,
  fragments,
}: {
  shop: ShopRecord
  instanceName: string
  fromPhone: string
  conversation: ConvRecord
  fragments: string[]
}): Promise<void> {
  // I8: Re-read conversation state — the debounce window (4 s) is wide enough
  // for a human agent to transfer the conversation. If state has changed to
  // TRANSFERRED_TO_HUMAN (or CLOSED), skip the AI call entirely.
  const freshConv = await prisma.whatsappConversation
    .findUnique({ where: { id: conversation.id }, select: { state: true } })
    .catch(() => null)
  if (!freshConv || freshConv.state !== 'OPEN') return

  // Merge fragments (multi-message burst) into a single user message
  const userMessage = fragments.join('\n')

  // Load conversation history, excluding the current burst messages.
  // The burst messages are the last `fragments.length` INBOUND entries
  // already persisted; we exclude them so they don't duplicate userMessage.
  const rawMsgs = await prisma.whatsappMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 20 + fragments.length,
  })

  const chronological = rawMsgs.reverse()

  // Exclude exactly `fragments.length` INBOUND-CUSTOMER rows from the tail.
  // A positional slice misfires when SYSTEM rows are interleaved between burst
  // INBOUND rows (e.g. a non-text reply arrived mid-burst), leaving burst
  // messages duplicated in the AI context.
  const toExclude = new Set<number>()
  let remaining = fragments.length
  for (let i = chronological.length - 1; i >= 0 && remaining > 0; i--) {
    const m = chronological[i]
    if (m.direction === 'INBOUND' && m.senderType === 'CUSTOMER') {
      toExclude.add(i)
      remaining--
    }
  }
  const historySubset = chronological.filter((_, i) => !toExclude.has(i))

  const history: ChatMsg[] = historySubset
    .filter(m => !(m.direction === 'OUTBOUND' && m.senderType === 'SYSTEM'))
    .slice(-20)
    .map(m => ({
      role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))

  // If OpenAI is not configured, skip AI and send fallback immediately
  if (!isOpenAIConfigured()) {
    await sendFallback(shop, instanceName, fromPhone, conversation)
    return
  }

  // Build AI context
  const tools = buildPublicTools()
  const today = getShopLocalDate(shop.timezone)
  const systemPrompt = publicSystemPrompt(
    {
      name: shop.name,
      businessHours: shop.businessHours as Record<
        string,
        { start: string; end: string } | null
      >,
      cancellationPolicy: shop.cancellationPolicy,
      address: shop.address,
      phone: shop.phone,
    },
    'WHATSAPP',
    today,
  )

  const result = await runAssistant({
    channel: 'WHATSAPP',
    tenantId: shop.id,
    history,
    userMessage,
    tools,
    systemPrompt,
    ctx: {
      tenantId: shop.id,
      channel: 'WHATSAPP',
      customerPhone: fromPhone,
    },
  })

  if (!result.ok) {
    console.error('[pipeline] runAssistant error', result.error)
    await sendFallback(shop, instanceName, fromPhone, conversation)
    return
  }

  let reply = result.data.reply
  let isHumanHandoff = false

  // Detect [HUMANO] marker — strip ALL occurrences and append handoff notice
  if (reply.includes(HUMAN_MARKER)) {
    reply = reply.replace(/\[HUMANO\]/g, '').trim()
    reply = reply + HUMAN_HANDOFF_SUFFIX
    isHumanHandoff = true
  }

  // Send via Evolution FIRST — persist only after knowing the delivery outcome.
  const sendResult = await evolution.sendText(instanceName, fromPhone, reply)
  if (sendResult.ok) {
    await persistMessage(shop, conversation, 'OUTBOUND', 'AI', reply)
  } else {
    console.error('[pipeline] sendText failed', sendResult.error)
    await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', '[FALHA NO ENVIO] ' + reply)
  }

  // Transition state when human handoff is requested
  if (isHumanHandoff) {
    await prisma.whatsappConversation
      .update({
        where: { id: conversation.id },
        data: { state: 'TRANSFERRED_TO_HUMAN' },
      })
      .catch(err => console.error('[pipeline] state→TRANSFERRED error', err))
  }
}
