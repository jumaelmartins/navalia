'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { PhoneIcon, BotIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { reopenConversation } from '@/modules/whatsapp/conversation-actions'
import type { HumanConversation } from '@/modules/whatsapp/conversation-actions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPhone(phone: string): string {
  // Format as +55 (XX) XXXXX-XXXX or +55 (XX) XXXX-XXXX
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.startsWith('55') && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${phone}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HumanConversationsList({
  initialConversations,
}: {
  initialConversations: HumanConversation[]
}) {
  const [conversations, setConversations] = useState(initialConversations)
  const [loading, setLoading] = useState<string | null>(null)

  if (conversations.length === 0) return null

  async function handleReopen(conversationId: string) {
    setLoading(conversationId)
    try {
      const result = await reopenConversation(conversationId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setConversations(prev => prev.filter(c => c.id !== conversationId))
      toast.success('Atendimento automático reativado para este número.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <PhoneIcon className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">Conversas com atendimento humano</CardTitle>
        </div>
        <CardDescription>
          Estes números estão aguardando atendimento manual. Reative o bot quando o
          atendimento humano for concluído.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {conversations.map(conv => (
            <li
              key={conv.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {formatPhone(conv.customerPhone)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Última mensagem: {formatDate(conv.lastMessageAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading === conv.id}
                onClick={() => handleReopen(conv.id)}
                className="shrink-0"
              >
                <BotIcon className="mr-1.5 size-3.5" />
                {loading === conv.id ? 'Reativando…' : 'Reativar bot'}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
