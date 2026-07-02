import type { Metadata } from 'next'
import { MapPin, Phone, Clock, Scissors } from 'lucide-react'
import { getPublicShop } from '@/modules/booking/public-actions'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import { BookingSection } from './_components/BookingSection'
import { ChatWidget } from './_components/ChatWidget'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const shop = await getPublicShop(slug)

  if (!shop) {
    return { title: 'Página indisponível' }
  }

  return {
    title: shop.name,
    description: shop.description ?? `Agende seu horário na ${shop.name}.`,
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default async function PublicShopPage({ params }: Props) {
  const { slug } = await params
  const shop = await getPublicShop(slug)

  if (!shop) {
    return (
      <div className="theme-dark min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Scissors className="mx-auto mb-6 size-12 text-muted-foreground/40" />
          <h1 className="font-display text-3xl font-semibold text-foreground mb-3">
            Página indisponível
          </h1>
          <p className="text-muted-foreground">
            Esta página de agendamentos não está disponível no momento.
          </p>
        </div>
      </div>
    )
  }

  return (
    <main>
      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pt-16 pb-12">
        {/* Subtle brass accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary opacity-60" />

        <div className="mx-auto max-w-5xl">
          <div className="mb-2">
            <span className="text-xs font-medium uppercase tracking-widest text-primary">
              Agendamento online
            </span>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-semibold text-foreground mb-4 leading-tight">
            {shop.name}
          </h1>

          {shop.description && (
            <p className="text-muted-foreground text-lg mb-6 max-w-2xl leading-relaxed">
              {shop.description}
            </p>
          )}

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {shop.address && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4 text-primary/70 shrink-0" />
                {shop.address}
              </span>
            )}
            {shop.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-4 text-primary/70 shrink-0" />
                {shop.phone}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Services ──────────────────────────────────────────────────────────── */}
      {shop.services.length > 0 && (
        <section className="px-4 py-10 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-2xl font-semibold text-foreground mb-6">
              Serviços
            </h2>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shop.services.map(service => (
                <div
                  key={service.id}
                  className="bg-card border border-border rounded-xl p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="font-medium text-foreground text-sm leading-snug">
                      {service.name}
                    </span>
                    <span className="font-display text-base font-semibold text-primary shrink-0">
                      {formatCentsToBRL(service.priceCents)}
                    </span>
                  </div>

                  {service.description && (
                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                      {service.description}
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5" />
                    {formatDuration(service.durationMin)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Professionals ─────────────────────────────────────────────────────── */}
      {shop.professionals.length > 0 && (
        <section className="px-4 py-10 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-2xl font-semibold text-foreground mb-6">
              Profissionais
            </h2>

            <div className="flex flex-wrap gap-4">
              {shop.professionals.map(professional => (
                <div
                  key={professional.id}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="size-14 rounded-full bg-muted border border-border flex items-center justify-center">
                    <span className="font-display text-base font-semibold text-primary">
                      {getInitials(professional.name)}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-foreground text-center max-w-[80px] leading-tight">
                    {professional.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Booking CTA Section ───────────────────────────────────────────────── */}
      <section id="agendar" className="px-4 py-12 border-t border-border">
        <div className="mx-auto max-w-5xl">
          <BookingSection shop={shop} />
        </div>
      </section>

      {/* ── AI chat widget (fixed floating) ───────────────────────────────────── */}
      <ChatWidget slug={shop.slug} shopName={shop.name} />
    </main>
  )
}
