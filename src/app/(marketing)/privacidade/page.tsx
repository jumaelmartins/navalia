export const metadata = {
  title: 'Política de Privacidade',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold text-foreground">
        Política de Privacidade
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 14 de julho de 2026
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-lg font-semibold">1. Quem somos</h2>
          <p className="mt-2 text-muted-foreground">
            Esta plataforma é operada por Jumael Martins (pessoa física, MEI em
            processo de formalização), controlador dos dados pessoais tratados
            aqui. Dúvidas ou solicitações sobre seus dados podem ser enviadas
            para{' '}
            <a className="underline" href="mailto:jumaelmartins@gmail.com">
              jumaelmartins@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. Quais dados coletamos</h2>
          <p className="mt-2 text-muted-foreground">
            Nome, telefone e, opcionalmente, e-mail informados ao agendar um
            horário; histórico de agendamentos; e o conteúdo das mensagens
            trocadas com o assistente de atendimento, seja pelo WhatsApp ou
            pelo chat do site.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Para que usamos seus dados</h2>
          <p className="mt-2 text-muted-foreground">
            Para confirmar e gerenciar seus agendamentos, enviar lembretes e
            permitir que o assistente de atendimento (inteligência
            artificial) responda suas mensagens.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Com quem compartilhamos</h2>
          <p className="mt-2 text-muted-foreground">
            Compartilhamos dados estritamente necessários com prestadores de
            serviço que viabilizam o atendimento: a OpenAI, para processar
            mensagens do assistente de IA; a Evolution API, para envio e
            recebimento de mensagens de WhatsApp; e a Stripe, apenas para o
            pagamento da assinatura do dono do estabelecimento — não dados de
            clientes finais.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Base legal</h2>
          <p className="mt-2 text-muted-foreground">
            Tratamos dados de agendamento com base na execução do contrato de
            prestação de serviço entre você e o estabelecimento. O
            processamento das mensagens pelo assistente de inteligência
            artificial e o envio via WhatsApp têm base no seu consentimento,
            que pode ser revogado a qualquer momento pelo contato acima.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            6. Por quanto tempo guardamos seus dados
          </h2>
          <p className="mt-2 text-muted-foreground">
            Seus dados são mantidos enquanto durar seu vínculo com o
            estabelecimento. Hoje ainda não temos um processo automatizado de
            exclusão ou anonimização — estamos avaliando essa melhoria.
            Solicitações de exclusão podem ser feitas pelo contato acima e
            serão avaliadas manualmente.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Seus direitos</h2>
          <p className="mt-2 text-muted-foreground">
            Você pode solicitar, a qualquer momento e pelo contato acima:
            acesso aos seus dados, correção de dados incorretos, portabilidade
            e revogação do seu consentimento.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Segurança</h2>
          <p className="mt-2 text-muted-foreground">
            Os dados de cada estabelecimento são isolados dos demais e todo o
            tráfego com a plataforma é feito por conexão criptografada
            (HTTPS).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Alterações desta política</h2>
          <p className="mt-2 text-muted-foreground">
            Podemos atualizar esta política conforme a plataforma evolui. A
            data no topo desta página sempre reflete a versão mais recente.
          </p>
        </section>
      </div>
    </main>
  )
}
