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

  // ── 3. Idempotency — record event BEFORE mutations ───────────────────────
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'STRIPE',
        eventId: event.id,
      },
    })
  } catch (err) {
    // P2002 = unique constraint violation → already processed
    if ((err as { code?: string }).code === 'P2002') {
      return new Response('Already processed', { status: 200 })
    }
    console.error('[webhook/stripe] failed to record event', err)
    return new Response('Database error', { status: 500 })
  }

  // ── 4. Route by event type ───────────────────────────────────────────────
  try {
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

        const shop = await prisma.barbershop.findUnique({ where: { id: barbershopId } })
        if (!shop) {
          console.warn('[webhook/stripe] checkout.session.completed: shop not found', barbershopId)
          break
        }

        await prisma.$transaction([
          prisma.barbershop.update({
            where: { id: barbershopId },
            data: {
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
              subscriptionStatus: 'ACTIVE',
            },
          }),
          prisma.auditLog.create({
            data: {
              barbershopId,
              action: 'SUBSCRIPTION_checkout.session.completed',
              entity: 'Barbershop',
              entityId: barbershopId,
              payload: { eventId: event.id, customerId, subscriptionId },
            },
          }),
        ])
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (!customerId) break

        const shop = await prisma.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
        if (!shop) {
          console.warn('[webhook/stripe] invoice.paid: shop not found for customer', customerId)
          break
        }

        await prisma.$transaction([
          prisma.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: 'ACTIVE' },
          }),
          prisma.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_invoice.paid',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId },
            },
          }),
        ])
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (!customerId) break

        const shop = await prisma.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
        if (!shop) {
          console.warn('[webhook/stripe] invoice.payment_failed: shop not found for customer', customerId)
          break
        }

        await prisma.$transaction([
          prisma.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: 'PAST_DUE' },
          }),
          prisma.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_invoice.payment_failed',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId },
            },
          }),
        ])
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

        const shop = await prisma.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
        if (!shop) {
          console.warn('[webhook/stripe] customer.subscription.updated: shop not found for customer', customerId)
          break
        }

        await prisma.$transaction([
          prisma.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: newStatus },
          }),
          prisma.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_customer.subscription.updated',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, stripeStatus: sub.status, newStatus },
            },
          }),
        ])
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
        if (!customerId) break

        const shop = await prisma.barbershop.findUnique({ where: { stripeCustomerId: customerId } })
        if (!shop) {
          console.warn('[webhook/stripe] customer.subscription.deleted: shop not found for customer', customerId)
          break
        }

        await prisma.$transaction([
          prisma.barbershop.update({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: 'CANCELED' },
          }),
          prisma.auditLog.create({
            data: {
              barbershopId: shop.id,
              action: 'SUBSCRIPTION_customer.subscription.deleted',
              entity: 'Barbershop',
              entityId: shop.id,
              payload: { eventId: event.id, customerId },
            },
          }),
        ])
        break
      }

      default:
        // Unknown event type — 200 no-op, no error
        break
    }
  } catch (err) {
    // Mutation errors should NOT 500 (that would cause Stripe to retry loops)
    console.error('[webhook/stripe] mutation error for event', event.type, err)
  }

  return new Response('OK', { status: 200 })
}
