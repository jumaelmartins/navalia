import type { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/modules/billing/stripe'
import { mapStripeEvent } from '@/modules/billing/gate'

// ---------------------------------------------------------------------------
// POST /api/webhooks/stripe
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ── 1. Read raw body (required for signature verification) ───────────────
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
  if (!webhookSecret) {
    console.error('[webhook/stripe] STRIPE_WEBHOOK_SECRET not set')
    return new Response('Webhook secret not configured', { status: 500 })
  }

  // ── 2. Verify signature BEFORE any processing ────────────────────────────
  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[webhook/stripe] signature verification failed', err)
    return new Response('Invalid signature', { status: 400 })
  }

  // ── 3. Idempotency + mutations in ONE atomic transaction ─────────────────
  //
  // Why a single transaction:
  //   • webhookEvent.create acts as an idempotency lock (unique eventId).
  //   • Wrapping both the lock-insert AND the status mutation means that if
  //     the mutation throws, the entire tx is rolled back — including the
  //     idempotency row.  Stripe will retry the event (correct behaviour).
  //   • If the eventId already exists, Prisma throws P2002 inside the tx;
  //     we catch it and return 200 (already processed).
  //   • Unknown event types and shop-not-found break out of the switch so
  //     the tx commits with only the idempotency row — still deduplicated.
  //
  try {
    await prisma.$transaction(async (tx) => {
      // 3a. Record event — unique constraint throws P2002 for duplicates.
      await tx.webhookEvent.create({
        data: {
          provider: 'STRIPE',
          eventId: event.id,
        },
      })

      // 3b. Route by event type — all mutations use `tx` so they share the tx.
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          const barbershopId = session.client_reference_id
          const customerId =
            typeof session.customer === 'string' ? session.customer : session.customer?.id
          const subscriptionId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id

          if (!barbershopId) {
            console.warn('[webhook/stripe] checkout.session.completed: missing client_reference_id')
            break
          }

          const shop = await tx.barbershop.findUnique({ where: { id: barbershopId } })
          if (!shop) {
            console.warn('[webhook/stripe] checkout.session.completed: shop not found', barbershopId)
            break
          }

          await tx.barbershop.update({
            where: { id: barbershopId },
            data: {
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
              subscriptionStatus: 'ACTIVE',
            },
          })
          await tx.auditLog.create({
            data: {
              barbershopId,
              action: 'SUBSCRIPTION_checkout.session.completed',
              entity: 'Barbershop',
              entityId: barbershopId,
              payload: { eventId: event.id, customerId, subscriptionId },
            },
          })
          break
        }

        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice
          const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
          if (!customerId) break

          // Resolve the subscription id from the invoice (Stripe v22 structure)
          // In v22, subscription is nested under invoice.parent.subscription_details.subscription
          const rawSubId = invoice.parent?.subscription_details?.subscription ?? null
          const invoiceSubId =
            typeof rawSubId === 'string' ? rawSubId : (rawSubId as { id?: string } | null)?.id ?? null

          const newStatus = mapStripeEvent('invoice.paid')
          if (!newStatus) break // never null for this event type; guards typing

          const shop = await tx.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
          if (!shop) {
            console.warn('[webhook/stripe] invoice.paid: shop not found for customer', customerId)
            break
          }

          // I3: Only activate when invoice subscription matches the stored sub.
          // An old invoice arriving after cancellation must NOT resurrect the shop.
          if (invoiceSubId && shop.stripeSubscriptionId && invoiceSubId !== shop.stripeSubscriptionId) {
            console.warn(
              '[webhook/stripe] invoice.paid: subscription mismatch — expected',
              shop.stripeSubscriptionId,
              'got',
              invoiceSubId,
              '— no-op',
            )
            break
          }

          await tx.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: newStatus },
          })
          await tx.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_invoice.paid',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId, invoiceSubId, newStatus },
            },
          })
          break
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
          if (!customerId) break

          const newStatus = mapStripeEvent('invoice.payment_failed')
          if (!newStatus) break // never null for this event type; guards typing

          const shop = await tx.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
          if (!shop) {
            console.warn('[webhook/stripe] invoice.payment_failed: shop not found for customer', customerId)
            break
          }

          await tx.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: newStatus },
          })
          await tx.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_invoice.payment_failed',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId, newStatus },
            },
          })
          break
        }

        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription
          const customerId =
            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
          if (!customerId) break

          const newStatus = mapStripeEvent('customer.subscription.updated', sub.status)
          if (!newStatus) {
            console.warn('[webhook/stripe] customer.subscription.updated: unhandled stripe status', sub.status)
            break
          }

          const shop = await tx.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
          if (!shop) {
            console.warn('[webhook/stripe] customer.subscription.updated: shop not found for customer', customerId)
            break
          }

          await tx.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: newStatus },
          })
          await tx.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_customer.subscription.updated',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, stripeStatus: sub.status, newStatus },
            },
          })
          break
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription
          const customerId =
            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
          if (!customerId) break

          const newStatus = mapStripeEvent('customer.subscription.deleted')
          if (!newStatus) break // never null for this event type; guards typing

          const shop = await tx.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
          if (!shop) {
            console.warn('[webhook/stripe] customer.subscription.deleted: shop not found for customer', customerId)
            break
          }

          await tx.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: newStatus },
          })
          await tx.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_customer.subscription.deleted',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId, newStatus },
            },
          })
          break
        }

        default:
          // Unknown event type — idempotency row committed above; no mutation.
          // Returning 200 signals Stripe not to retry.
          break
      }
    })
  } catch (err) {
    // I4: Discriminate P2002 by constraint target.
    // Only treat it as a duplicate-event (idempotent 200) when the unique
    // violation is on the WebhookEvent.eventId constraint.
    // Any other P2002 (e.g. stripeCustomerId collision) → 500 so Stripe retries.
    if ((err as { code?: string }).code === 'P2002') {
      const target = (err as { meta?: { target?: string | string[] } }).meta?.target
      const isEventIdViolation =
        target === 'eventId' ||
        (Array.isArray(target) && target.some(t => t === 'eventId' || t.includes('eventId'))) ||
        (typeof target === 'string' && target.includes('eventId'))
      if (isEventIdViolation) {
        return new Response('Already processed', { status: 200 })
      }
    }
    // Any other error (DB unreachable, mutation rejected, etc.) → 500 so that
    // Stripe retries.  The transaction was rolled back, freeing the idempotency
    // row so the retry will be processed correctly.
    console.error('[webhook/stripe] transaction error for event', event.type, err)
    return new Response('Internal error', { status: 500 })
  }

  return new Response('OK', { status: 200 })
}
