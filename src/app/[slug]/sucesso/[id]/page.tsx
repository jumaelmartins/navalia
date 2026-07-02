import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, MessageCircle, ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { buildConfirmationShareText } from '@/modules/whatsapp/deep-link'

interface Props {
  params: Promise<{ slug: string; id: string }>
}

function dateToDDMMYYYY(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export default async function SuccessPage({ params }: Props) {
  const { slug, id } = await params

  // Verify appointment belongs to this slug's tenant — never trust the URL id alone
  const shop = await prisma.barbershop.findUnique({
    where: { slug },
    select: { id: true, name: true, cancellationPolicy: true },
  })

  if (!shop) notFound()

  const appointment = await prisma.appointment.findFirst({
    where: { id, barbershopId: shop.id },
    include: {
      service: { select: { name: true } },
      professional: { select: { name: true } },
      customer: { select: { name: true } },
    },
  })

  if (!appointment) notFound()

  const shortCode = appointment.id.slice(-6).toUpperCase()

  const shareText = buildConfirmationShareText({
    serviceName: appointment.service.name,
    professionalName: appointment.professional.name,
    date: appointment.date,
    time: appointment.startTime,
    shopName: shop.name,
  })

  const shareHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  return (
    <main className="px-4 py-16">
      <div className="mx-auto max-w-md">
        {/* Success icon */}
        <div className="flex justify-center mb-6">
          <div className="size-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
            <CheckCircle2 className="size-8 text-primary" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-semibold text-foreground mb-2">
            Agendamento confirmado!
          </h1>
          <p className="text-muted-foreground text-sm">
            Esperamos você, {appointment.customer.name.split(' ')[0]}.
          </p>
        </div>

        {/* Recap card */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6 shadow-sm">
          {/* Short code */}
          <div className="text-center mb-5 pb-5 border-b border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
              Código do agendamento
            </p>
            <p className="font-display text-3xl font-semibold text-primary tracking-widest">
              {shortCode}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between text-sm gap-4">
              <span className="text-muted-foreground shrink-0">Serviço</span>
              <span className="font-medium text-foreground text-right">
                {appointment.service.name}
              </span>
            </div>

            <div className="flex items-start justify-between text-sm gap-4">
              <span className="text-muted-foreground shrink-0">Profissional</span>
              <span className="font-medium text-foreground text-right">
                {appointment.professional.name}
              </span>
            </div>

            <div className="flex items-start justify-between text-sm gap-4">
              <span className="text-muted-foreground shrink-0">Data</span>
              <span className="font-medium text-foreground text-right">
                {dateToDDMMYYYY(appointment.date)}
              </span>
            </div>

            <div className="flex items-start justify-between text-sm gap-4">
              <span className="text-muted-foreground shrink-0">Horário</span>
              <span className="font-display text-lg font-semibold text-primary">
                {appointment.startTime}
              </span>
            </div>

            <div className="flex items-start justify-between text-sm gap-4 pt-3 border-t border-border">
              <span className="text-muted-foreground shrink-0">Cliente</span>
              <span className="font-medium text-foreground text-right">
                {appointment.customer.name}
              </span>
            </div>
          </div>
        </div>

        {/* Cancellation policy */}
        {shop.cancellationPolicy && (
          <div className="bg-muted/60 border border-border rounded-xl p-4 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              Política de cancelamento
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {shop.cancellationPolicy}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          <a
            href={shareHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            <MessageCircle className="size-4" />
            Compartilhar no WhatsApp
          </a>

          <Link
            href={`/${slug}`}
            className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg border border-border bg-transparent text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowLeft className="size-4" />
            Voltar para {shop.name}
          </Link>
        </div>
      </div>
    </main>
  )
}
