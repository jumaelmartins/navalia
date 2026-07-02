/* ─── Feature blocks (alternating layout) ──────────────────────────────────── */

import { BRAND } from '@/lib/brand'

export function Features() {
  return (
    <section id="funcionalidades" className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl space-y-28">
        {/* Feature 1: Agenda inteligente */}
        <FeatureBlock
          eyebrow="01 — Agenda inteligente"
          headline="Conflito zero. Controle total."
          body="Defina serviços, horários e profissionais uma vez. O sistema gerencia bloqueios, remarcações e intervalos automaticamente — você vê tudo em tempo real."
          bullets={[
            'Bloqueio de horários por profissional',
            'Remarcação em um clique',
            'Intervalo entre atendimentos configurável',
            'Página pública de agendamento para clientes',
          ]}
          mock={<AgendaFeatureMock />}
          reverse={false}
        />

        {/* Feature 2: Chatbot WhatsApp */}
        <FeatureBlock
          eyebrow="02 — WhatsApp com IA"
          headline="Chatbot que agenda sozinho, no seu número."
          body="Seu cliente manda mensagem, a IA consulta os horários disponíveis em tempo real e confirma o agendamento — sem você precisar responder nada."
          bullets={[
            'Conexão via QR code no seu próprio número',
            'IA consulta disponibilidade real antes de confirmar',
            'Envio automático de confirmação e lembrete',
            'Sem aplicativo extra para o cliente',
          ]}
          mock={<WhatsappMock />}
          reverse={true}
        />

        {/* Feature 3: Copiloto e insights */}
        <FeatureBlock
          eyebrow="03 — Copiloto e insights"
          headline="Pergunte. Receba. Decida."
          body="Chega de planilha. Converse com o copiloto da sua barbearia e obtenha respostas sobre faturamento, clientes mais frequentes e serviços mais populares."
          bullets={[
            '"Quanto faturei essa semana?"',
            '"Qual serviço mais vendeu esse mês?"',
            '"Quantos clientes novos essa semana?"',
            'Insights automáticos sem configuração',
          ]}
          mock={<CopilotMock />}
          reverse={false}
        />
      </div>
    </section>
  )
}

/* ─── Feature block layout ──────────────────────────────────────────────────── */

interface FeatureBlockProps {
  eyebrow: string
  headline: string
  body: string
  bullets: string[]
  mock: React.ReactNode
  reverse: boolean
}

function FeatureBlock({ eyebrow, headline, body, bullets, mock, reverse }: FeatureBlockProps) {
  return (
    <div
      className={`grid gap-12 lg:grid-cols-2 lg:items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}
    >
      {/* Text */}
      <div>
        <p className="text-xs font-medium text-primary uppercase tracking-widest mb-4">{eyebrow}</p>
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground leading-tight mb-5">
          {headline}
        </h2>
        <p className="text-base text-muted-foreground leading-relaxed mb-8">{body}</p>
        <ul className="space-y-3">
          {bullets.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary/70 mt-1.5" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Mock */}
      <div className={reverse ? 'lg:order-first' : ''}>{mock}</div>
    </div>
  )
}

/* ─── Agenda feature mock ───────────────────────────────────────────────────── */

function AgendaFeatureMock() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground font-display">Julho 2026</p>
        <div className="flex gap-1">
          {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
            <div key={i} className="w-8 text-center text-xs text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Week row */}
        <div className="flex gap-1">
          {[29, 30, 1, 2, 3, 4, 5].map((day, i) => (
            <div
              key={i}
              className={`w-8 h-8 flex items-center justify-center text-xs rounded-md font-medium
                ${day === 1 ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}
                ${day > 20 ? 'text-muted-foreground' : ''}
              `}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground mb-3">Horários — 1 jul</p>
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-10">09:00</span>
              <div className="flex-1 rounded bg-primary/10 border-l-2 border-primary px-2 py-1.5">
                <p className="text-xs font-medium text-foreground">Carlos S. — Corte + Barba</p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-10">10:00</span>
              <div className="flex-1 rounded border border-dashed border-border/50 px-2 py-1.5 text-xs text-muted-foreground/40">
                disponível
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-10">10:30</span>
              <div className="flex-1 rounded bg-[var(--status-completed)]/10 border-l-2 border-[var(--status-completed)] px-2 py-1.5">
                <p className="text-xs font-medium text-foreground">Rafael M. — Corte</p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-10">11:00</span>
              <div className="flex-1 rounded bg-primary/10 border-l-2 border-primary px-2 py-1.5">
                <p className="text-xs font-medium text-foreground">João P. — Barba</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── WhatsApp chat mock ────────────────────────────────────────────────────── */

function WhatsappMock() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-md overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-3">
        <div className="size-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
          <span className="text-xs font-semibold text-primary font-display">IA</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{BRAND.name} — Assistente</p>
          <p className="text-xs text-muted-foreground">WhatsApp conectado</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="size-2 rounded-full bg-[var(--status-completed)]" />
          <span className="text-xs text-muted-foreground">online</span>
        </div>
      </div>

      {/* Chat messages */}
      <div className="p-4 space-y-3 bg-background">
        <ChatBubble from="client" text="Oi! Quero agendar um corte amanhã à tarde, tem horário?" />
        <ChatBubble
          from="ai"
          text="Olá! Amanhã temos horários às 14h e 15h30 com o Marcos. Qual você prefere?"
        />
        <ChatBubble from="client" text="14h, por favor." />
        <ChatBubble
          from="ai"
          text="Pronto! Agendado para amanhã às 14h00. Corte com Marcos — Barbearia Estilo. Até lá!"
        />
        <div className="flex justify-start">
          <div className="bg-[var(--status-completed)]/15 border border-[var(--status-completed)]/30 rounded-lg px-3 py-2 max-w-[80%]">
            <p className="text-xs text-[var(--status-completed)] font-medium">Confirmado automaticamente</p>
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-border flex items-center gap-2">
        <div className="flex-1 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground/50">
          Mensagem
        </div>
        <div className="size-8 rounded-full bg-primary flex items-center justify-center shrink-0 text-primary-foreground">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M11 1L6 6M11 1H7M11 1V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ from, text }: { from: 'client' | 'ai'; text: string }) {
  const isClient = from === 'client'
  return (
    <div className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed
          ${isClient
            ? 'bg-primary/20 text-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
          }
        `}
      >
        {text}
      </div>
    </div>
  )
}

/* ─── Copilot mock ──────────────────────────────────────────────────────────── */

function CopilotMock() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-md overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2">
        <div className="size-2 rounded-full bg-primary" />
        <p className="text-sm font-semibold text-foreground font-display">Copiloto</p>
      </div>

      {/* Conversation */}
      <div className="p-4 space-y-4">
        {/* User question */}
        <div className="flex justify-end">
          <div className="bg-muted rounded-lg rounded-tr-sm px-3 py-2 max-w-[80%]">
            <p className="text-xs text-foreground">Quanto faturei essa semana?</p>
          </div>
        </div>

        {/* AI response */}
        <div className="bg-card border border-border rounded-lg rounded-tl-sm p-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Esta semana você faturou
          </p>
          <p className="font-display text-3xl font-semibold text-primary">R$ 1.840</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            em 23 atendimentos. Terça foi o dia mais movido, com 6 agendamentos.
          </p>

          {/* Mini bar chart */}
          <div className="pt-1 space-y-1.5">
            {[
              { day: 'Seg', value: 65 },
              { day: 'Ter', value: 100 },
              { day: 'Qua', value: 80 },
              { day: 'Qui', value: 55 },
              { day: 'Sex', value: 90 },
            ].map(({ day, value }) => (
              <div key={day} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-6">{day}</span>
                <div className="flex-1 bg-muted rounded-sm h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-primary/70 rounded-sm"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <div className="flex-1 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground/50">
            Pergunte algo sobre sua barbearia...
          </div>
          <div className="size-7 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M9 1L5 5M9 1H6M9 1V4" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
