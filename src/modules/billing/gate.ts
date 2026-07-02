import type { SubscriptionStatus } from '@prisma/client'

// ---------------------------------------------------------------------------
// hasAccess — pure subscription access gate
// ---------------------------------------------------------------------------

/**
 * Returns true if the given barbershop subscription is currently active.
 *
 * Rules (single source of truth — also used by public booking page):
 *  - TRIALING: allowed only while trialEndsAt > now
 *  - ACTIVE:   always allowed (regardless of trialEndsAt)
 *  - PAST_DUE: blocked
 *  - CANCELED: blocked
 *
 * @param s   Subscription shape pulled from Barbershop record
 * @param now Optional override for "current time" — useful for deterministic tests
 */
export function hasAccess(
  s: { subscriptionStatus: SubscriptionStatus; trialEndsAt: Date },
  now: Date = new Date(),
): boolean {
  if (s.subscriptionStatus === 'ACTIVE') return true
  if (s.subscriptionStatus === 'TRIALING' && s.trialEndsAt > now) return true
  return false
}

// ---------------------------------------------------------------------------
// mapStripeEvent — pure event-type → SubscriptionStatus mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Stripe webhook event type (and optional Stripe subscription status)
 * to an app SubscriptionStatus.
 *
 * Returns null for unknown events or unhandled stripe status values so callers
 * can safely no-op without throwing.
 *
 * NOTE: Stripe-side trialing maps to ACTIVE because we manage our own trial
 * period (trialEndsAt) rather than using Stripe's trial feature.
 */
export function mapStripeEvent(
  eventType: string,
  stripeStatus?: string,
): SubscriptionStatus | null {
  switch (eventType) {
    case 'checkout.session.completed':
      return 'ACTIVE'

    case 'invoice.paid':
      return 'ACTIVE'

    case 'invoice.payment_failed':
      return 'PAST_DUE'

    case 'customer.subscription.deleted':
      return 'CANCELED'

    case 'customer.subscription.updated': {
      if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE'
      if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'PAST_DUE'
      if (stripeStatus === 'canceled') return 'CANCELED'
      return null
    }

    default:
      return null
  }
}
