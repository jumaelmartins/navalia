'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMsg = { role: 'user' | 'assistant'; content: string }

interface Props {
  slug: string
  shopName: string
}

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Quais horários amanhã?',
  'Quanto custa corte e barba?',
  'Quais serviços vocês têm?',
]

// ---------------------------------------------------------------------------
// ChatWidget
// ---------------------------------------------------------------------------

export function ChatWidget({ slug, shopName }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom when messages or pending state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending])

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
  }, [open])

  // Escape closes the panel
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || pending) return

      const userMsg: ChatMsg = { role: 'user', content: trimmed }
      // Capture history BEFORE appending the new user message
      const historySnapshot = messages

      setMessages(prev => [...prev, userMsg])
      setInput('')
      setPending(true)

      try {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            history: historySnapshot,
            message: trimmed,
          }),
        })

        const data = (await res.json()) as { reply?: string; error?: string }
        const replyText =
          data.reply ?? data.error ?? 'Ocorreu um erro. Tente novamente.'

        setMessages(prev => [...prev, { role: 'assistant', content: replyText }])
      } catch {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: 'Erro de conexão. Tente novamente.' },
        ])
      } finally {
        setPending(false)
      }
    },
    [messages, pending, slug],
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <>
      {/* ── Floating action button ─────────────────────────────────────────── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Falar com o assistente"
          className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MessageCircle className="size-6" aria-hidden="true" />
        </button>
      )}

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-label={`Assistente ${shopName}`}
            aria-modal="true"
            className={[
              // Base
              'fixed z-50 flex flex-col bg-card border border-border',
              // Mobile: bottom sheet, full height
              'inset-x-0 bottom-0 rounded-t-2xl h-[92svh]',
              // Desktop: floating card bottom-right
              'sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:max-h-[600px] sm:h-auto sm:rounded-xl',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary"
                  aria-hidden="true"
                >
                  <MessageCircle className="size-4 text-primary-foreground" />
                </div>
                <span className="font-medium text-foreground text-sm truncate">
                  Assistente {shopName}
                </span>
              </div>

              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar assistente"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* Privacy notice */}
            <div className="px-4 py-1.5 border-b border-border shrink-0">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Atendimento com IA — mensagens podem ser processadas por serviços de terceiros.{' '}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Política de Privacidade
                </a>
              </p>
            </div>

            {/* Messages list */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
              role="log"
              aria-live="polite"
            >
              {/* Empty state — suggestion chips */}
              {messages.length === 0 && !pending && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Tire suas dúvidas ou agende um horário.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="w-full text-left rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground hover:border-primary/60 hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message bubbles */}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={[
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words',
                      msg.role === 'user'
                        ? 'bg-primary/20 text-foreground rounded-tr-sm'
                        : 'bg-muted text-foreground rounded-tl-sm',
                    ].join(' ')}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {pending && (
                <div className="flex justify-start" aria-label="Assistente digitando">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-2 px-4 py-3 border-t border-border shrink-0"
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Digite sua mensagem..."
                disabled={pending}
                aria-label="Mensagem para o assistente"
                className="flex-1 min-w-0 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                aria-label="Enviar mensagem"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </>
      )}
    </>
  )
}
