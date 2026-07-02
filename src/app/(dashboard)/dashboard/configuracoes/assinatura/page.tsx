import { Suspense } from 'react'
import { requireOwner } from '@/modules/tenancy/context'
import { AssinaturaClient } from './_components/AssinaturaClient'

export default async function AssinaturaPage() {
  const { barbershop } = await requireOwner()

  const priceCents = Number(process.env.PLAN_PRICE_CENTS ?? 9900)

  return (
    <main className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Assinatura</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie seu plano e dados de cobrança.
        </p>
      </div>

      {/* Suspense boundary required for useSearchParams() inside AssinaturaClient */}
      <Suspense fallback={null}>
        <AssinaturaClient
          status={barbershop.subscriptionStatus}
          trialEndsAt={barbershop.trialEndsAt.toISOString()}
          stripeCustomerId={barbershop.stripeCustomerId}
          priceCents={priceCents}
        />
      </Suspense>
    </main>
  )
}
