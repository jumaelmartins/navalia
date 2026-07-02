'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createCheckoutSession, createPortalSession } from '@/modules/billing/actions'
import { formatCentsToBRL } from '@/modules/tenancy/money'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  TRIALING: { label: 'Teste ativo', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  ACTIVE: { label: 'Ativa', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  PAST_DUE: { label: 'Pagamento pendente', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  CANCELED: { label: 'Cancelada', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
} as const

type SubscriptionStatus = keyof typeof STATUS_CONFIG

interface AssinaturaClientProps {
  status: SubscriptionStatus
  trialEndsAt: string      // ISO string
  stripeCustomerId: string | null
  priceCents: number
}

export function AssinaturaClient({
  status,
  trialEndsAt,
  stripeCustomerId,
  priceCents,
}: AssinaturaClientProps) {
  const searchParams = useSearchParams()
  const [loadingCheckout, setLoadingCheckout] = useState(false)
  const [loadingPortal, setLoadingPortal] = useState(false)

  // Handle ?status= query param from Stripe redirects
  useEffect(() => {
    const s = searchParams.get('status')
    if (s === 'success') {
      toast.success('Assinatura ativada com sucesso!')
    } else if (s === 'cancelled') {
      toast.info('Assinatura cancelada. Você pode assinar a qualquer momento.')
    }
  }, [searchParams])

  async function handleCheckout() {
    setLoadingCheckout(true)
    try {
      const result = await createCheckoutSession()
      if (result.ok) {
        window.location.href = result.data.url
      } else {
        toast.error(result.error)
        setLoadingCheckout(false)
      }
    } catch {
      toast.error('Erro ao iniciar assinatura. Tente novamente.')
      setLoadingCheckout(false)
    }
  }

  async function handlePortal() {
    setLoadingPortal(true)
    try {
      const result = await createPortalSession()
      if (result.ok) {
        window.location.href = result.data.url
      } else {
        toast.error(result.error)
        setLoadingPortal(false)
      }
    } catch {
      toast.error('Erro ao acessar portal. Tente novamente.')
      setLoadingPortal(false)
    }
  }

  const { label, className } = STATUS_CONFIG[status]
  const priceLabel = formatCentsToBRL(priceCents)

  const trialDate = new Date(trialEndsAt)
  const daysLeft = Math.ceil((trialDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  const showCheckout = status === 'TRIALING' || status === 'CANCELED' || status === 'PAST_DUE'
  const showPortal = !!stripeCustomerId

  return (
    <div className="space-y-6">
      {/* Plan card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Plano mensal</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Navalia · Barbearia SaaS</p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
            {label}
          </span>
        </div>

        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl font-semibold text-primary">{priceLabel}</span>
          <span className="text-sm text-muted-foreground">/mês</span>
        </div>

        {/* Status-specific info */}
        {status === 'TRIALING' && daysLeft > 0 && (
          <p className="text-sm text-muted-foreground">
            Período de teste: termina em{' '}
            <strong className="text-foreground">
              {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}
            </strong>{' '}
            ({trialDate.toLocaleDateString('pt-BR')})
          </p>
        )}

        {status === 'ACTIVE' && (
          <p className="text-sm text-muted-foreground">
            Assinatura ativa. Próxima renovação automática via cartão cadastrado.
          </p>
        )}

        {status === 'PAST_DUE' && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Pagamento pendente. Atualize seu cartão no portal para reativar.
          </p>
        )}

        {status === 'CANCELED' && (
          <p className="text-sm text-muted-foreground">
            Assinatura cancelada. Seus dados estão preservados — assine novamente para reativar.
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {showCheckout && (
          <button
            onClick={handleCheckout}
            disabled={loadingCheckout}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {loadingCheckout ? 'Aguarde…' : 'Assinar agora'}
          </button>
        )}

        {showPortal && (
          <button
            onClick={handlePortal}
            disabled={loadingPortal}
            className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {loadingPortal ? 'Aguarde…' : 'Gerenciar assinatura'}
          </button>
        )}
      </div>
    </div>
  )
}
