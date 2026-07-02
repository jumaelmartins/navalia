import Link from 'next/link'

interface PricingProps {
  priceDisplay: string
}

const PLAN_BULLETS = [
  'Agendamentos ilimitados',
  'Página pública de agendamento',
  'WhatsApp com IA incluído',
  'Copiloto e insights',
  'Múltiplos profissionais',
  'Suporte por e-mail',
]

export function Pricing({ priceDisplay }: PricingProps) {
  return (
    <section id="preco" className="px-6 py-24 md:py-32 border-t border-border">
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <div className="mb-16 text-center max-w-xl mx-auto">
          <p className="text-xs font-medium text-primary uppercase tracking-widest mb-4">Preço</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground leading-tight">
            Um plano. Tudo incluso.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Sem cobrança por agendamento, sem taxas ocultas.
          </p>
        </div>

        {/* Pricing card */}
        <div className="mx-auto max-w-md">
          <div className="relative rounded-xl border border-primary/40 bg-card shadow-md overflow-hidden">
            {/* Brass top accent */}
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />

            <div className="p-8">
              {/* Plan label */}
              <p className="text-xs font-medium text-primary uppercase tracking-widest mb-6">
                Plano único
              </p>

              {/* Price */}
              <div className="mb-2 flex items-end gap-1">
                <span className="font-display text-5xl font-semibold text-foreground leading-none">
                  {priceDisplay}
                </span>
                <span className="text-base text-muted-foreground mb-1">/mês</span>
              </div>

              <p className="text-sm text-muted-foreground mb-8">
                7 dias grátis para experimentar
              </p>

              {/* Bullets */}
              <ul className="space-y-3 mb-8">
                {PLAN_BULLETS.map((bullet) => (
                  <li key={bullet} className="flex items-center gap-3 text-sm text-foreground">
                    <span
                      className="shrink-0 size-4 rounded-sm bg-primary/15 border border-primary/30 flex items-center justify-center"
                      aria-hidden="true"
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path
                          d="M1 3L3 5L7 1"
                          stroke="var(--primary)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href="/signup"
                className="flex h-12 w-full items-center justify-center text-base font-medium bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg transition-colors"
              >
                Começar teste grátis
              </Link>

              <p className="text-xs text-muted-foreground text-center mt-3">
                7 dias grátis · sem cartão de crédito · cancele quando quiser
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
