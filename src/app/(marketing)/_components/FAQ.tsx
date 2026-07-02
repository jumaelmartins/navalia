const FAQ_ITEMS = [
  {
    question: 'Preciso de cartão de crédito para testar?',
    answer:
      'Não. O período de teste de 7 dias é completamente gratuito e não exige cartão de crédito. Você só insere os dados de pagamento ao decidir continuar após o trial.',
  },
  {
    question: 'Como funciona o WhatsApp com IA?',
    answer:
      'Você conecta o seu próprio número de WhatsApp escaneando um QR code no painel. A partir daí, quando um cliente envia mensagem, a IA consulta sua agenda em tempo real, apresenta os horários disponíveis e confirma o agendamento automaticamente — tudo no próprio WhatsApp, sem precisar de um número avulso ou chip extra.',
  },
  {
    question: 'Posso cancelar quando quiser?',
    answer:
      'Sim. Não há contrato de fidelidade. Você pode cancelar a qualquer momento pelo painel, sem multa ou burocracia. O acesso segue ativo até o fim do ciclo já pago.',
  },
  {
    question: 'Meus clientes precisam baixar algum aplicativo?',
    answer:
      'Não. O agendamento online funciona via link no navegador — o cliente acessa a página da sua barbearia, escolhe o serviço, profissional e horário, sem instalar nada. O WhatsApp, que a maioria já tem, cuida do restante.',
  },
  {
    question: 'Quantos profissionais posso cadastrar?',
    answer:
      'O plano inclui múltiplos profissionais sem custo adicional por cadastro. Cada profissional tem sua própria agenda, horários e serviços associados.',
  },
]

export function FAQ() {
  return (
    <section id="faq" className="px-6 py-24 md:py-32 border-t border-border bg-muted/20">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[280px_1fr] lg:gap-20">
          {/* Left: heading */}
          <div>
            <p className="text-xs font-medium text-primary uppercase tracking-widest mb-4">FAQ</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground leading-tight">
              Perguntas frequentes.
            </h2>
          </div>

          {/* Right: items */}
          <div>
            {FAQ_ITEMS.map((item, index) => (
              <details
                key={index}
                className="group border-b border-border py-5 first:border-t"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span
                    className="ml-auto shrink-0 size-5 rounded-sm border border-border flex items-center justify-center text-muted-foreground transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M5 1v8M1 5h8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </summary>
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed pr-8">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
