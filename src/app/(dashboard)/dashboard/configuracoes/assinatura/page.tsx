import { Suspense } from 'react'
import { requireOwner } from '@/modules/tenancy/context'
import { AssinaturaClient } from './_components/AssinaturaClient'

export default async function AssinaturaPage() {
  const { barbershop } = await requireOwner()

  const priceCents = Number(process.env.PLAN_PRICE_CENTS ?? 9900)

  return (
    <Suspense fallback={null}>
      <AssinaturaClient
        status={barbershop.subscriptionStatus}
        trialEndsAt={barbershop.trialEndsAt.toISOString()}
        stripeCustomerId={barbershop.stripeCustomerId}
        priceCents={priceCents}
      />
    </Suspense>
  )
}
