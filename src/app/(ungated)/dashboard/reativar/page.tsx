import { requireMember } from '@/modules/tenancy/context'
import { ReativarClient } from './_components/ReativarClient'

/**
 * /dashboard/reativar — shown when the subscription gate blocks access.
 *
 * Lives in (ungated) route group so the gated (dashboard)/layout.tsx
 * never runs here, avoiding an infinite redirect loop.
 */
export default async function ReativarPage() {
  const { barbershop } = await requireMember()

  const isExpiredTrial = barbershop.subscriptionStatus === 'TRIALING'
  const priceCents = Number(process.env.PLAN_PRICE_CENTS ?? 4490)

  return (
    <ReativarClient
      status={barbershop.subscriptionStatus}
      isExpiredTrial={isExpiredTrial}
      priceCents={priceCents}
      hasStripeCustomer={!!barbershop.stripeCustomerId}
    />
  )
}
