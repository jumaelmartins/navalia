import Link from 'next/link'
import { BRAND } from '@/lib/brand'

export function Hero() {
  return (
    <section className="relative px-6 pt-20 pb-24 md:pt-28 md:pb-32 overflow-hidden">
      {/* Subtle brass accent line at the top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-primary/40" />

      {/* Background depth: very subtle warm vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 70% 50%, color-mix(in srgb, var(--primary) 4%, transparent) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          {/* Left: Copy */}
          <div>
            <p className="text-xs font-medium text-primary uppercase tracking-widest mb-6">
              Para barbearias brasileiras
            </p>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-foreground leading-[1.05] tracking-tight mb-6">
              Sua barbearia
              <br />
              no piloto
              <br />
              automático.
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-md">
              Agenda inteligente, WhatsApp com IA que marca horários sozinho e pagamento integrado
              — tudo em um só lugar.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div>
                <Link
                  href="/signup"
                  className="inline-flex h-12 items-center px-7 text-base font-medium bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg transition-colors"
                >
                  Testar grátis por 7 dias
                </Link>
                <p className="text-xs text-muted-foreground mt-2 pl-0.5">
                  Sem cartão de crédito
                </p>
              </div>

              <a
                href="#funcionalidades"
                className="inline-flex h-12 items-center px-6 text-base font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Ver funcionalidades
              </a>
            </div>
          </div>

          {/* Right: Product mock */}
          <div className="relative">
            <AgendaMock />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── Agenda mini-mock ──────────────────────────────────────────────────────── */

function AgendaMock() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-md overflow-hidden">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/60">
        <div className="flex gap-1.5" aria-hidden="true">
          <div className="size-2.5 rounded-full bg-border" />
          <div className="size-2.5 rounded-full bg-border" />
          <div className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 ml-2 rounded-md bg-background/70 px-3 py-1 text-xs text-muted-foreground font-mono tracking-tight">
          {`app.${BRAND.domain}/agenda`}
        </div>
      </div>

      {/* Dashboard sub-header */}
      <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Agenda</p>
          <p className="text-sm font-semibold text-foreground font-display">Terça, 1 jul</p>
        </div>
        <div className="h-7 px-3 rounded-md bg-primary text-xs flex items-center text-primary-foreground font-medium">
          + Novo
        </div>
      </div>

      {/* Appointments list */}
      <div className="p-4 space-y-2">
        <AppointmentRow
          time="09:00"
          name="Carlos S."
          service="Corte + Barba"
          duration="45 min"
          variant="confirmed"
        />

        <SlotEmpty time="10:00" />

        <AppointmentRow
          time="10:30"
          name="Rafael M."
          service="Corte"
          duration="30 min"
          variant="completed"
        />

        <AppointmentRow
          time="11:00"
          name="João P."
          service="Barba"
          duration="30 min"
          variant="confirmed"
        />

        <SlotEmpty time="11:30" />

        <AppointmentRow
          time="14:00"
          name="Lucas A."
          service="Corte Infantil"
          duration="20 min"
          variant="pending"
        />
      </div>
    </div>
  )
}

type AppointmentVariant = 'confirmed' | 'completed' | 'pending'

const VARIANT_STYLES: Record<AppointmentVariant, { row: string; badge: string; label: string }> = {
  confirmed: {
    row: 'border-l-2 border-primary bg-primary/10',
    badge: 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]',
    label: 'Confirmado',
  },
  completed: {
    row: 'border-l-2 border-[var(--status-completed)] bg-[var(--status-completed)]/10',
    badge: 'bg-[var(--status-completed)] text-[var(--status-completed-fg)]',
    label: 'Concluído',
  },
  pending: {
    row: 'border-l-2 border-[var(--status-pending)] bg-muted',
    badge: 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
    label: 'Pendente',
  },
}

function AppointmentRow({
  time,
  name,
  service,
  duration,
  variant,
}: {
  time: string
  name: string
  service: string
  duration: string
  variant: AppointmentVariant
}) {
  const styles = VARIANT_STYLES[variant]
  return (
    <div className="flex gap-3 items-start">
      <span className="text-xs text-muted-foreground w-10 shrink-0 pt-2">{time}</span>
      <div className={`flex-1 rounded px-2.5 py-2 ${styles.row}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground leading-tight">{name}</p>
            <p className="text-xs text-muted-foreground">
              {service} · {duration}
            </p>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm shrink-0 ${styles.badge}`}>
            {styles.label}
          </span>
        </div>
      </div>
    </div>
  )
}

function SlotEmpty({ time }: { time: string }) {
  return (
    <div className="flex gap-3 items-center">
      <span className="text-xs text-muted-foreground/50 w-10 shrink-0">{time}</span>
      <div className="flex-1 border border-dashed border-border/50 rounded px-2.5 py-1.5 text-xs text-muted-foreground/40">
        disponível
      </div>
    </div>
  )
}
