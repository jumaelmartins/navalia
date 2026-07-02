'use server'

import { requireOwner } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import { getStripe } from './stripe'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

const ASSINATURA_URL = () => `${appUrl()}/dashboard/configuracoes/assinatura`

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Checkout Session for the logged-in owner's barbershop.
 *
 * - Creates or reuses the Stripe Customer (stored in stripeCustomerId)
 * - Returns the session URL on success
 * - Throws a graceful pt-BR error if Stripe is not configured
 */
export async function createCheckoutSession(): Promise<ActionResult<{ url: string }>> {
  try {
    const { barbershop } = await requireOwner()

    const priceId = process.env.STRIPE_PRICE_ID ?? ''
    if (!priceId) {
      return { ok: false, error: 'Stripe não configurado. Plano não encontrado.' }
    }

    let stripe: ReturnType<typeof getStripe>
    try {
      stripe = getStripe()
    } catch {
      return { ok: false, error: 'Stripe não configurado. Contate o suporte.' }
    }

    // Create or reuse Stripe customer
    let customerId = barbershop.stripeCustomerId ?? null

    if (!customerId) {
      const customer = await stripe.customers.create(
        { metadata: { barbershopId: barbershop.id } },
        { idempotencyKey: `customer-${barbershop.id}` },
      )
      customerId = customer.id

      await prisma.barbershop.update({
        where: { id: barbershop.id },
        data: { stripeCustomerId: customerId },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: barbershop.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${ASSINATURA_URL()}?status=success`,
      cancel_url: `${ASSINATURA_URL()}?status=cancelled`,
    })

    if (!session.url) {
      return { ok: false, error: 'Não foi possível criar a sessão de pagamento.' }
    }

    return { ok: true, data: { url: session.url } }
  } catch (err) {
    console.error('[createCheckoutSession]', err)
    if (err instanceof Error && err.message.includes('Stripe não configurado')) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: 'Erro ao iniciar assinatura. Tente novamente.' }
  }
}

// ---------------------------------------------------------------------------
// createPortalSession
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Billing Portal session for the logged-in owner.
 *
 * Requires an existing stripeCustomerId; returns an error if none found.
 */
export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  try {
    const { barbershop } = await requireOwner()

    if (!barbershop.stripeCustomerId) {
      return { ok: false, error: 'Nenhuma assinatura encontrada.' }
    }

    let stripe: ReturnType<typeof getStripe>
    try {
      stripe = getStripe()
    } catch {
      return { ok: false, error: 'Stripe não configurado. Contate o suporte.' }
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: barbershop.stripeCustomerId,
      return_url: ASSINATURA_URL(),
    })

    return { ok: true, data: { url: session.url } }
  } catch (err) {
    console.error('[createPortalSession]', err)
    if (err instanceof Error && err.message.includes('Stripe não configurado')) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: 'Erro ao acessar portal. Tente novamente.' }
  }
}
