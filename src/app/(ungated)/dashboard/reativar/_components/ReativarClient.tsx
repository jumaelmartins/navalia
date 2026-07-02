'use client'

import { useState } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { createCheckoutSession } from '@/modules/billing/actions'
import { formatCentsToBRL } from '@/modules/tenancy/money'

interface ReativarClientProps {
  status: string
  isExpiredTrial: boolean
  priceCents: number
  hasStripeCustomer: boolean
}

export function ReativarClient({
  status,
  isExpiredTrial,
  priceCents,
}: ReativarClientProps) {
  const [loading, setLoading] = useState(false)

  const heading =
    isExpiredTrial || status === 'TRIALING'
      ? 'Seu período de teste terminou'
      : 'Sua assinatura está inativa'

  const description =
    isExpiredTrial || status === 'TRIALING'
      ? 'O período de avaliação gratuito expirou. Assine para continuar usando o Navalia.'
      : status === 'PAST_DUE'
        ? 'Não conseguimos processar o último pagamento. Atualize seu cartão para reativar.'
        : 'Sua assinatura foi cancelada. Assine novamente para recuperar o acesso.'

  async function handleSubscribe() {
    setLoading(true)
    try {
      const result = await createCheckoutSession()
      if (result.ok) {
        window.location.href = result.data.url
      } else {
        toast.error(result.error)
        setLoading(false)
      }
    } catch {
      toast.error('Erro ao iniciar assinatura. Tente novamente.')
      setLoading(false)
    }
  }

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = '/login'
  }

  const priceLabel = formatCentsToBRL(priceCents)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg space-y-6 text-center">
        {/* Icon */}
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <AlertTriangleIcon className="size-7 text-amber-600 dark:text-amber-400" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>

        {/* Data preserved reassurance */}
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Seus dados estão salvos. Ao reativar, tudo volta ao normal.
          </p>
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? 'Aguarde…' : `Assinar por ${priceLabel}/mês`}
          </button>

          <button
            onClick={handleSignOut}
            className="w-full rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  )
}
