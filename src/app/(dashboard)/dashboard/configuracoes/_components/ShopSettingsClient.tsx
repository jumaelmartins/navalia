'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, LinkIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveShopSettings } from '@/modules/tenancy/settings-actions'
import { saveBusinessHours } from '@/modules/tenancy/onboarding-actions'
import type { BusinessHours } from '@/modules/tenancy/business-hours'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DayHours = { start: string; end: string } | null

type WeekHours = {
  '0': DayHours
  '1': DayHours
  '2': DayHours
  '3': DayHours
  '4': DayHours
  '5': DayHours
  '6': DayHours
}

const DAY_LABELS: Record<string, string> = {
  '0': 'Dom',
  '1': 'Seg',
  '2': 'Ter',
  '3': 'Qua',
  '4': 'Qui',
  '5': 'Sex',
  '6': 'Sáb',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ShopSettingsClientProps {
  barbershop: {
    name: string
    slug: string
    description: string | null
    phone: string | null
    address: string | null
    timezone: string
    cancellationPolicy: string | null
    businessHours: BusinessHours
  }
  publicUrl: string
}

// ---------------------------------------------------------------------------
// Public Link + Copy
// ---------------------------------------------------------------------------

function PublicLinkCard({ publicUrl }: { publicUrl: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      toast.success('Link copiado!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar o link.')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <LinkIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Link público de agendamento</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm text-foreground font-mono">
          {publicUrl}
        </code>
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="shrink-0"
          aria-label="Copiar link"
        >
          {copied ? (
            <CheckIcon className="size-4 text-[var(--status-completed)]" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shop data form
// ---------------------------------------------------------------------------

function ShopDataForm({
  initial,
}: {
  initial: ShopSettingsClientProps['barbershop']
}) {
  const [form, setForm] = useState({
    name: initial.name,
    description: initial.description ?? '',
    phone: initial.phone ?? '',
    address: initial.address ?? '',
    cancellationPolicy: initial.cancellationPolicy ?? '',
  })
  const [loading, setLoading] = useState(false)

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await saveShopSettings({
        name: form.name,
        description: form.description || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        cancellationPolicy: form.cancellationPolicy || undefined,
      })
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Dados salvos com sucesso!')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome da barbearia *</Label>
        <Input
          id="name"
          name="name"
          required
          value={form.name}
          onChange={handleChange}
          placeholder="Barbearia do João"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Input
          id="description"
          name="description"
          value={form.description}
          onChange={handleChange}
          placeholder="Especialistas em cortes masculinos desde 2010"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Telefone (com DDD)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={handleChange}
          placeholder="(71) 99999-9999"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="address">Endereço</Label>
        <Input
          id="address"
          name="address"
          value={form.address}
          onChange={handleChange}
          placeholder="Rua das Flores, 123 — Salvador, BA"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cancellationPolicy">Política de cancelamento</Label>
        <textarea
          id="cancellationPolicy"
          name="cancellationPolicy"
          rows={3}
          value={form.cancellationPolicy}
          onChange={handleChange}
          placeholder="Ex.: Cancele com até 2 horas de antecedência sem cobrança."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Fuso horário</Label>
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {initial.timezone}
          <span className="ml-2 text-xs">(somente leitura)</span>
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          className="hover:bg-primary-hover"
          disabled={loading}
        >
          {loading ? 'Salvando…' : 'Salvar dados'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Business hours editor
// ---------------------------------------------------------------------------

function BusinessHoursEditor({ initial }: { initial: BusinessHours }) {
  const [hours, setHours] = useState<WeekHours>({
    '0': (initial as WeekHours)['0'] ?? null,
    '1': (initial as WeekHours)['1'] ?? null,
    '2': (initial as WeekHours)['2'] ?? null,
    '3': (initial as WeekHours)['3'] ?? null,
    '4': (initial as WeekHours)['4'] ?? null,
    '5': (initial as WeekHours)['5'] ?? null,
    '6': (initial as WeekHours)['6'] ?? null,
  })
  const [loading, setLoading] = useState(false)

  function toggleDay(day: string) {
    setHours((prev) => ({
      ...prev,
      [day]: prev[day as keyof WeekHours]
        ? null
        : { start: '09:00', end: '19:00' },
    }))
  }

  function updateTime(day: string, field: 'start' | 'end', value: string) {
    setHours((prev) => {
      const current = prev[day as keyof WeekHours]
      if (!current) return prev
      return { ...prev, [day]: { ...current, [field]: value } }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await saveBusinessHours(hours)
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Horários salvos com sucesso!')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        {(['0', '1', '2', '3', '4', '5', '6'] as const).map((day) => {
          const dayHours = hours[day]
          const isOpen = dayHours !== null

          return (
            <div
              key={day}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="w-12 shrink-0">
                <span className="text-sm font-medium text-foreground">
                  {DAY_LABELS[day]}
                </span>
              </div>

              {/* Toggle */}
              <button
                type="button"
                onClick={() => toggleDay(day)}
                className={[
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  isOpen ? 'bg-primary' : 'bg-muted-foreground/30',
                ].join(' ')}
                aria-pressed={isOpen}
                aria-label={`${isOpen ? 'Fechar' : 'Abrir'} ${DAY_LABELS[day]}`}
              >
                <span
                  className={[
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm',
                    'ring-0 transition-transform',
                    isOpen ? 'translate-x-4' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>

              {isOpen ? (
                <div className="flex items-center gap-2 flex-1">
                  <div className="space-y-1">
                    <Label
                      htmlFor={`start-${day}`}
                      className="text-xs text-muted-foreground"
                    >
                      Abre
                    </Label>
                    <Input
                      id={`start-${day}`}
                      type="time"
                      value={dayHours!.start}
                      onChange={(e) => updateTime(day, 'start', e.target.value)}
                      className="w-28"
                    />
                  </div>
                  <span className="mt-5 text-muted-foreground">–</span>
                  <div className="space-y-1">
                    <Label
                      htmlFor={`end-${day}`}
                      className="text-xs text-muted-foreground"
                    >
                      Fecha
                    </Label>
                    <Input
                      id={`end-${day}`}
                      type="time"
                      value={dayHours!.end}
                      onChange={(e) => updateTime(day, 'end', e.target.value)}
                      className="w-28"
                    />
                  </div>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Fechado</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          className="hover:bg-primary-hover"
          disabled={loading}
        >
          {loading ? 'Salvando…' : 'Salvar horários'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ShopSettingsClient({ barbershop, publicUrl }: ShopSettingsClientProps) {
  return (
    <div className="space-y-8">
      {/* Public link */}
      <PublicLinkCard publicUrl={publicUrl} />

      {/* Shop data */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Dados da barbearia</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Informações exibidas na página pública de agendamento.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <ShopDataForm initial={barbershop} />
        </div>
      </section>

      {/* Business hours */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Horários de funcionamento</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Defina os dias e horários em que a barbearia atende.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <BusinessHoursEditor initial={barbershop.businessHours} />
        </div>
      </section>
    </div>
  )
}
