import Stripe from 'stripe'

// ---------------------------------------------------------------------------
// Lazy Stripe client singleton
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null

/**
 * Returns the Stripe client, lazily initialised.
 *
 * Throws a descriptive pt-BR error if the secret key is missing or looks like
 * a placeholder (must start with "sk_" and be longer than 20 characters).
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe

  const key = process.env.STRIPE_SECRET_KEY ?? ''

  if (!key.startsWith('sk_') || key.length <= 20) {
    throw new Error(
      'Stripe não configurado. Defina STRIPE_SECRET_KEY com uma chave válida (sk_live_... ou sk_test_...).',
    )
  }

  _stripe = new Stripe(key, {
    apiVersion: '2026-06-24.dahlia',
    typescript: true,
  })

  return _stripe
}
