import { describe, it, expect } from 'vitest'
import { hasAccess, mapStripeEvent } from './gate'

// ---------------------------------------------------------------------------
// hasAccess — pure access gate
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)

describe('hasAccess', () => {
  it('TRIALING + future trialEndsAt → true', () => {
    expect(hasAccess({ subscriptionStatus: 'TRIALING', trialEndsAt: FUTURE })).toBe(true)
  })

  it('TRIALING + past trialEndsAt → false', () => {
    expect(hasAccess({ subscriptionStatus: 'TRIALING', trialEndsAt: PAST })).toBe(false)
  })

  it('ACTIVE → true (even with past trialEndsAt)', () => {
    expect(hasAccess({ subscriptionStatus: 'ACTIVE', trialEndsAt: PAST })).toBe(true)
  })

  it('PAST_DUE → false', () => {
    expect(hasAccess({ subscriptionStatus: 'PAST_DUE', trialEndsAt: FUTURE })).toBe(false)
  })

  it('CANCELED → false', () => {
    expect(hasAccess({ subscriptionStatus: 'CANCELED', trialEndsAt: FUTURE })).toBe(false)
  })

  it('accepts a custom `now` timestamp for deterministic testing', () => {
    const anchor = new Date('2026-01-15T12:00:00Z')
    const endsAt = new Date('2026-01-20T12:00:00Z') // future relative to anchor
    expect(hasAccess({ subscriptionStatus: 'TRIALING', trialEndsAt: endsAt }, anchor)).toBe(true)

    const expiredAt = new Date('2026-01-10T12:00:00Z') // past relative to anchor
    expect(hasAccess({ subscriptionStatus: 'TRIALING', trialEndsAt: expiredAt }, anchor)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mapStripeEvent — event-type → SubscriptionStatus
// ---------------------------------------------------------------------------

describe('mapStripeEvent', () => {
  it('checkout.session.completed → ACTIVE', () => {
    expect(mapStripeEvent('checkout.session.completed')).toBe('ACTIVE')
  })

  it('invoice.paid → ACTIVE', () => {
    expect(mapStripeEvent('invoice.paid')).toBe('ACTIVE')
  })

  it('invoice.payment_failed → PAST_DUE', () => {
    expect(mapStripeEvent('invoice.payment_failed')).toBe('PAST_DUE')
  })

  it('customer.subscription.deleted → CANCELED', () => {
    expect(mapStripeEvent('customer.subscription.deleted')).toBe('CANCELED')
  })

  it('customer.subscription.updated with active → ACTIVE', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'active')).toBe('ACTIVE')
  })

  it('customer.subscription.updated with trialing → ACTIVE (app-managed trial)', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'trialing')).toBe('ACTIVE')
  })

  it('customer.subscription.updated with past_due → PAST_DUE', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'past_due')).toBe('PAST_DUE')
  })

  it('customer.subscription.updated with unpaid → PAST_DUE', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'unpaid')).toBe('PAST_DUE')
  })

  it('customer.subscription.updated with canceled → CANCELED', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'canceled')).toBe('CANCELED')
  })

  it('unknown event type → null', () => {
    expect(mapStripeEvent('some.unknown.event')).toBeNull()
  })

  it('customer.subscription.updated with unknown stripe status → null', () => {
    expect(mapStripeEvent('customer.subscription.updated', 'incomplete')).toBeNull()
  })
})
