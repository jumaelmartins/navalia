export function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Crie sua conta',
      description:
        'Cadastre-se em minutos. Nenhuma instalação, nenhum servidor para configurar — tudo na nuvem.',
    },
    {
      number: '02',
      title: 'Configure serviços e equipe',
      description:
        'Adicione seus serviços, preços, horários de funcionamento e profissionais. Leva menos de 10 minutos.',
    },
    {
      number: '03',
      title: 'Compartilhe o link e conecte o WhatsApp',
      description:
        'Envie o link de agendamento para seus clientes e conecte seu WhatsApp via QR code para ativar a IA.',
    },
  ]

  return (
    <section className="px-6 py-24 md:py-32 border-t border-border bg-muted/20">
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <div className="mb-16 max-w-xl">
          <p className="text-xs font-medium text-primary uppercase tracking-widest mb-4">
            Como funciona
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground leading-tight">
            Três passos para sua barbearia no automático.
          </h2>
        </div>

        {/* Steps */}
        <div className="grid gap-10 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.number} className="relative">
              {/* Connector line (desktop only) */}
              {index < steps.length - 1 && (
                <div
                  className="hidden md:block absolute top-7 left-full w-8 h-px bg-border"
                  aria-hidden="true"
                />
              )}

              {/* Number */}
              <div className="mb-5">
                <span className="font-display text-5xl font-semibold text-primary/20 leading-none select-none">
                  {step.number}
                </span>
              </div>

              <h3 className="text-base font-semibold text-foreground mb-3">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
