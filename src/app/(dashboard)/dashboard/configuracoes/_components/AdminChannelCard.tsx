'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon, XIcon, KeyRoundIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  saveAdminChannelConfig,
  generateAdminPin,
} from '@/modules/tenancy/settings-actions'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AdminChannelCardProps {
  adminPhones: string[]
  ownerNotifyPhone: string | null
  notifyOwnerWhatsapp: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminChannelCard(props: AdminChannelCardProps) {
  const [phones, setPhones] = useState<string[]>(props.adminPhones)
  const [newPhone, setNewPhone] = useState('')
  const [notifyPhone, setNotifyPhone] = useState(props.ownerNotifyPhone ?? '')
  const [notifyOn, setNotifyOn] = useState(props.notifyOwnerWhatsapp)
  const [pin, setPin] = useState<{ pin: string; expiresAt: string } | null>(null)
  const [loading, setLoading] = useState(false)

  function addPhone() {
    const trimmed = newPhone.trim()
    if (!trimmed) return
    if (phones.includes(trimmed)) {
      toast.error('Número já adicionado.')
      return
    }
    setPhones([...phones, trimmed])
    setNewPhone('')
  }

  function removePhone(p: string) {
    setPhones(phones.filter((x) => x !== p))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setPin(null)
    try {
      const result = await saveAdminChannelConfig({
        adminPhones: phones,
        ownerNotifyPhone: notifyPhone.trim() || undefined,
        notifyOwnerWhatsapp: notifyOn,
      })
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Configurações salvas com sucesso!')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGeneratePin() {
    setLoading(true)
    setPin(null)
    try {
      const result = await generateAdminPin()
      if (!result.ok) {
        toast.error(result.error)
      } else if (result.data) {
        setPin(result.data)
        toast.success('PIN gerado! Válido por 5 minutos.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Admin phones */}
      <div className="space-y-2">
        <Label>Números que operam o painel via WhatsApp</Label>
        <p className="text-xs text-muted-foreground">
          Apenas esses números pessoais poderão enviar comandos ao canal admin.
        </p>

        {phones.length > 0 && (
          <ul className="space-y-1.5">
            {phones.map((p) => (
              <li
                key={p}
                className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="font-mono">{p}</span>
                <button
                  type="button"
                  onClick={() => removePhone(p)}
                  aria-label={`Remover ${p}`}
                  className="ml-2 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPhone()
              }
            }}
            placeholder="Ex.: 5511999999999"
            type="tel"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={addPhone}
            aria-label="Adicionar número"
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Owner notifications */}
      <div className="space-y-3">
        <Label>Notificações de agendamento</Label>

        {/* Toggle */}
        <label className="flex cursor-pointer items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={notifyOn}
            onClick={() => setNotifyOn(!notifyOn)}
            className={[
              'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              notifyOn ? 'bg-primary' : 'bg-muted-foreground/30',
            ].join(' ')}
          >
            <span
              className={[
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm',
                'ring-0 transition-transform',
                notifyOn ? 'translate-x-4' : 'translate-x-0',
              ].join(' ')}
            />
          </button>
          <span className="text-sm">
            Receber aviso de novos agendamentos no WhatsApp
          </span>
        </label>

        {/* Notify phone */}
        <div className="space-y-1.5">
          <Label htmlFor="notifyPhone">Número para receber avisos</Label>
          <Input
            id="notifyPhone"
            value={notifyPhone}
            onChange={(e) => setNotifyPhone(e.target.value)}
            placeholder="Ex.: 5511999999999"
            type="tel"
            disabled={!notifyOn}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" className="hover:bg-primary-hover" disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar'}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleGeneratePin}
          disabled={loading}
          className="gap-2"
        >
          <KeyRoundIcon className="size-4" />
          Gerar PIN para confirmar ações
        </Button>
      </div>

      {/* PIN display */}
      {pin && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
          <p className="text-sm text-foreground">
            PIN gerado:{' '}
            <strong className="font-mono tracking-[0.25em] text-base">
              {pin.pin}
            </strong>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Válido por 5 minutos. Envie este código no WhatsApp para confirmar a
            ação pendente.
          </p>
        </div>
      )}
    </form>
  )
}
