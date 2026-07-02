'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { createCheckoutSession } from '@/modules/billing/actions'
import { formatCentsToBRL } from '@/modules/tenancy/money'

interface TrialBannerProps {
  trialEndsAt: string  // ISO string from server component
  priceCents: number   // passed from layout so client doesn't need env var
}

export function TrialBanner({ trialEndsAt, priceCents }: TrialBannerProps) {
  const [loading, setLoading] = useState(false)

  const daysLeft = useMemo(() => Math.ceil(
    // eslint-disable-next-line react-hooks/purity
    (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  ), [trialEndsAt])

  // Gate already blocks when trial expires; don't render for 0 or negative
  if (daysLeft <= 0) return null

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

  const priceLabel = formatCentsToBRL(priceCents)

  return (
    <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="font-medium">
        Seu teste termina em{' '}
        <strong>
          {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}
        </strong>
      </span>

      <button
        onClick={handleSubscribe}
        disabled={loading}
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
      >
        {loading ? 'Aguarde…' : `Assinar por ${priceLabel}/mês`}
      </button>
    </div>
  )
}
