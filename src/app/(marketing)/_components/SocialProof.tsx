export function SocialProof() {
  return (
    <section className="border-y border-border bg-muted/30 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-8">
          {/* Label */}
          <p className="text-sm font-medium text-muted-foreground text-center sm:text-left">
            Feito para barbearias brasileiras
          </p>

          {/* Divider — desktop only */}
          <div className="hidden sm:block w-px h-8 bg-border" aria-hidden="true" />

          {/* Stats */}
          <div className="flex flex-col sm:flex-row items-center gap-8 sm:gap-12">
            <Stat value="Agendamento 24/7" label="Clientes marcam a qualquer hora" />
            <div className="hidden sm:block w-px h-8 bg-border" aria-hidden="true" />
            <Stat value="IA no WhatsApp" label="Agenda sozinha sem intervenção" />
            <div className="hidden sm:block w-px h-8 bg-border" aria-hidden="true" />
            <Stat value="7 dias grátis" label="Sem cartão de crédito" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-base font-semibold text-primary">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}
