'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { toast } from 'sonner'
import { SendIcon, BotIcon, UserIcon, CheckIcon, XIcon, LoaderIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'BARBER'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type PendingAction = {
  id: string
  toolName: string
  summary: string
  args: unknown
}

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Quantos agendamentos tenho amanhã?',
  'Qual foi o faturamento desta semana?',
  'Bloqueie minha sexta à tarde',
  'Quais clientes sumiram há 45 dias?',
]

// ---------------------------------------------------------------------------
// Tool name labels (pt-BR)
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  blockSchedule: 'Bloquear agenda',
  unblockSchedule: 'Desbloquear agenda',
  cancelAppointment: 'Cancelar agendamento',
}

// ---------------------------------------------------------------------------
// Args table labels
// ---------------------------------------------------------------------------

const ARG_LABELS: Record<string, string> = {
  professionalName: 'Profissional',
  date: 'Data',
  startTime: 'Horário início',
  endTime: 'Horário fim',
  reason: 'Motivo',
  appointmentId: 'ID do agendamento',
  blockId: 'ID do bloqueio',
}

function ArgsTable({ args }: { args: unknown }) {
  if (typeof args !== 'object' || args === null) return null
  const entries = Object.entries(args as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (entries.length === 0) return null

  return (
    <table className="mt-2 w-full text-xs border-collapse">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-amber-200/60 last:border-0">
            <td className="py-1 pr-3 font-medium text-amber-900/70 w-32">
              {ARG_LABELS[k] ?? k}
            </td>
            <td className="py-1 text-amber-900">{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// PendingActionCard
// ---------------------------------------------------------------------------

function PendingActionCard({
  action,
  onConfirm,
  onReject,
  disabled,
}: {
  action: PendingAction
  onConfirm: () => void
  onReject: () => void
  disabled: boolean
}) {
  const label = TOOL_LABELS[action.toolName] ?? action.toolName

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-2 mb-2">
        <BotIcon className="size-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">{label} — confirmacao necessaria</p>
          <p className="mt-1 text-xs text-amber-800">{action.summary}</p>
          <ArgsTable args={action.args} />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          disabled={disabled}
          onClick={onConfirm}
          className="bg-amber-600 hover:bg-amber-700 text-white h-8 gap-1.5"
        >
          <CheckIcon className="size-3.5" />
          Confirmar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onReject}
          className="h-8 gap-1.5 border-amber-400 text-amber-800 hover:bg-amber-100"
        >
          <XIcon className="size-3.5" />
          Rejeitar
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <BotIcon className="size-4 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        }`}
      >
        {message.content}
      </div>
      {isUser && (
        <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
          <UserIcon className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TypingIndicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex gap-2 justify-start">
      <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <BotIcon className="size-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CopilotClient
// ---------------------------------------------------------------------------

export function CopilotClient({ role }: { role: Role }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [isConfirming, startConfirmTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, pendingAction])

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return
    setInput('')
    setPendingAction(null)

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    const history = messages.map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, message: text.trim() }),
      })
      const data = await res.json() as { reply?: string; pendingAction?: PendingAction; error?: string }

      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Erro ao contatar o copiloto.')
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.error ?? 'Erro ao processar sua mensagem.',
        }])
        return
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply ?? '',
      }
      setMessages(prev => [...prev, assistantMsg])

      if (data.pendingAction) {
        setPendingAction(data.pendingAction)
      }
    } catch {
      toast.error('Falha ao conectar ao copiloto.')
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Erro ao conectar ao copiloto. Tente novamente.',
      }])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleConfirm(reject: boolean) {
    if (!pendingAction) return
    startConfirmTransition(async () => {
      try {
        const res = await fetch('/api/ai/copilot/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionId: pendingAction.id, reject }),
        })
        const data = await res.json() as { ok: boolean; error?: string; status?: string }

        if (!res.ok || !data.ok) {
          toast.error(data.error ?? 'Erro ao processar confirmacao.')
          return
        }

        setPendingAction(null)

        const followUp: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reject ? 'Acao rejeitada.' : 'Feito! A acao foi executada com sucesso.',
        }
        setMessages(prev => [...prev, followUp])

        if (!reject) {
          toast.success('Acao confirmada e executada.')
        } else {
          toast.info('Acao rejeitada.')
        }
      } catch {
        toast.error('Falha ao processar confirmacao.')
      }
    })
  }

  const canSend = input.trim().length > 0 && !isLoading

  return (
    <Card className="shadow-sm flex flex-col h-[calc(100vh-10rem)] min-h-[500px]">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <BotIcon className="size-5 text-primary" />
          <CardTitle className="text-base">Copiloto IA</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pergunte sobre agendamentos, faturamento, clientes e mais.{' '}
          <a href="/dashboard/configuracoes/logs" className="underline underline-offset-2 hover:text-foreground">
            Ver historico de acoes
          </a>
        </p>
      </CardHeader>

      {/* Messages area */}
      <CardContent className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
            <BotIcon className="size-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Como posso ajudar?</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Pergunte sobre a barbearia ou escolha uma sugestao abaixo.
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS
                .filter(s => role === 'OWNER' || !s.toLowerCase().includes('bloqueie'))
                .map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && <TypingIndicator />}

        {pendingAction && role === 'OWNER' && !isLoading && (
          <PendingActionCard
            action={pendingAction}
            onConfirm={() => handleConfirm(false)}
            onReject={() => handleConfirm(true)}
            disabled={isConfirming}
          />
        )}

        <div ref={bottomRef} />
      </CardContent>

      {/* Input area */}
      <div className="border-t border-border p-4">
        {messages.length > 0 && !isLoading && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {SUGGESTIONS
              .filter(s => role === 'OWNER' || !s.toLowerCase().includes('bloqueie'))
              .map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
          </div>
        )}
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pergunte algo sobre a barbearia..."
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
            maxLength={1000}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!canSend}
            className="h-10 w-10 p-0 shrink-0"
          >
            {isLoading ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </Card>
  )
}
