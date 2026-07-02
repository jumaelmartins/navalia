'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  updateProfessional,
  toggleProfessional,
  setProfessionalServices,
} from '@/modules/catalog/professional-actions'
import { upsertAvailabilityRules } from '@/modules/catalog/availability-actions'
import type { ProfessionalRow } from './ProfessionalsClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceOption = {
  id: string
  name: string
  isActive: boolean
}

type WeekState = Record<number, { startTime: string; endTime: string } | null>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS: Record<number, string> = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
}

const DAY_KEYS = [0, 1, 2, 3, 4, 5, 6] as const

function buildInitialWeekState(
  rules: ProfessionalRow['availabilityRules'],
): WeekState {
  const state: WeekState = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
  // For each weekday, pick the first rule (UI supports one window per day)
  for (const rule of rules) {
    if (state[rule.weekday] === undefined || state[rule.weekday] === null) {
      state[rule.weekday] = { startTime: rule.startTime, endTime: rule.endTime }
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// DadosTab
// ---------------------------------------------------------------------------

function DadosTab({
  professional,
  onClose,
}: {
  professional: ProfessionalRow
  onClose: () => void
}) {
  const [name, setName] = useState(professional.name)
  const [bio, setBio] = useState(professional.bio ?? '')
  const [pending, startTransition] = useTransition()
  const [togglePending, startToggle] = useTransition()

  function handleSave(e: React.FormEvent) {
    e.preventDefault()

    const patch: Record<string, string> = {}
    if (name.trim() !== professional.name) patch.name = name.trim()
    const trimmedBio = bio.trim()
    if (trimmedBio !== (professional.bio ?? '')) patch.bio = trimmedBio || ''

    if (Object.keys(patch).length === 0) {
      toast.info('Nenhuma alteração para salvar.')
      return
    }

    startTransition(async () => {
      const result = await updateProfessional(professional.id, patch)
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Dados salvos.')
        onClose()
      }
    })
  }

  function handleToggle() {
    startToggle(async () => {
      const result = await toggleProfessional(professional.id)
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success(
          professional.isActive ? 'Profissional desativado.' : 'Profissional ativado.',
        )
        onClose()
      }
    })
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="prof-sheet-name">Nome *</Label>
        <Input
          id="prof-sheet-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prof-sheet-bio">Bio</Label>
        <textarea
          id="prof-sheet-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          disabled={pending}
          className="h-auto w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          placeholder="Especialidade, experiência…"
        />
      </div>

      {/* Status */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Status</p>
          <p className="text-xs text-muted-foreground">
            {professional.isActive ? 'Profissional ativo' : 'Profissional inativo'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'text-xs font-medium',
              professional.isActive
                ? 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]'
                : 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
            )}
          >
            {professional.isActive ? 'Ativo' : 'Inativo'}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleToggle}
            disabled={togglePending}
            className="text-xs"
          >
            {togglePending
              ? 'Salvando…'
              : professional.isActive
                ? 'Desativar'
                : 'Ativar'}
          </Button>
        </div>
      </div>

      <Button
        type="submit"
        className="w-full hover:bg-primary-hover"
        disabled={pending}
      >
        {pending ? 'Salvando…' : 'Salvar dados'}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// ServicosTab
// ---------------------------------------------------------------------------

function ServicosTab({
  professional,
  allServices,
  onClose,
}: {
  professional: ProfessionalRow
  allServices: ServiceOption[]
  onClose: () => void
}) {
  const initialIds = new Set(professional.services.map((ps) => ps.service.id))
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds))
  const [pending, startTransition] = useTransition()

  function toggle(serviceId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(serviceId)) {
        next.delete(serviceId)
      } else {
        next.add(serviceId)
      }
      return next
    })
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setProfessionalServices(professional.id, [...selected])
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Serviços atualizados.')
        onClose()
      }
    })
  }

  const activeServices = allServices.filter((s) => s.isActive)

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Selecione os serviços que este profissional realiza.
      </p>

      {activeServices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum serviço ativo cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {activeServices.map((service) => {
            const checked = selected.has(service.id)
            return (
              <label
                key={service.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(service.id)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm font-medium">{service.name}</span>
              </label>
            )
          })}
        </div>
      )}

      <Button
        onClick={handleSave}
        className="w-full hover:bg-primary-hover"
        disabled={pending}
      >
        {pending ? 'Salvando…' : 'Salvar serviços'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DisponibilidadeTab
// ---------------------------------------------------------------------------

function DisponibilidadeTab({
  professional,
  onClose,
}: {
  professional: ProfessionalRow
  onClose: () => void
}) {
  const [weekState, setWeekState] = useState<WeekState>(() =>
    buildInitialWeekState(professional.availabilityRules),
  )
  const [pending, startTransition] = useTransition()

  function toggleDay(day: number) {
    setWeekState((prev) => ({
      ...prev,
      [day]: prev[day] !== null ? null : { startTime: '09:00', endTime: '18:00' },
    }))
  }

  function updateTime(day: number, field: 'startTime' | 'endTime', value: string) {
    setWeekState((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, [field]: value } }
    })
  }

  function handleSave() {
    const rules = DAY_KEYS.filter((d) => weekState[d] !== null).map((d) => ({
      weekday: d,
      startTime: weekState[d]!.startTime,
      endTime: weekState[d]!.endTime,
    }))

    startTransition(async () => {
      const result = await upsertAvailabilityRules(professional.id, rules)
      if (!result.ok) {
        toast.error(result.error)
      } else {
        toast.success('Disponibilidade salva.')
        onClose()
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Configure os dias e horários em que este profissional está disponível.
      </p>

      <div className="space-y-2">
        {DAY_KEYS.map((day) => {
          const dayHours = weekState[day]
          const isOpen = dayHours !== null

          return (
            <div
              key={day}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              {/* Day label */}
              <div className="w-10 shrink-0">
                <span className="text-sm font-medium">{DAY_LABELS[day]}</span>
              </div>

              {/* Toggle switch */}
              <button
                type="button"
                onClick={() => toggleDay(day)}
                disabled={pending}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isOpen ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
                aria-pressed={isOpen}
                aria-label={`${isOpen ? 'Fechar' : 'Abrir'} ${DAY_LABELS[day]}`}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform',
                    isOpen ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>

              {isOpen ? (
                <div className="flex flex-1 items-center gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`avail-start-${day}`} className="text-xs text-muted-foreground">
                      Início
                    </Label>
                    <Input
                      id={`avail-start-${day}`}
                      type="time"
                      value={dayHours!.startTime}
                      onChange={(e) => updateTime(day, 'startTime', e.target.value)}
                      className="w-28"
                      disabled={pending}
                    />
                  </div>
                  <span className="mt-5 text-muted-foreground">–</span>
                  <div className="space-y-1">
                    <Label htmlFor={`avail-end-${day}`} className="text-xs text-muted-foreground">
                      Fim
                    </Label>
                    <Input
                      id={`avail-end-${day}`}
                      type="time"
                      value={dayHours!.endTime}
                      onChange={(e) => updateTime(day, 'endTime', e.target.value)}
                      className="w-28"
                      disabled={pending}
                    />
                  </div>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Indisponível</span>
              )}
            </div>
          )
        })}
      </div>

      <Button
        onClick={handleSave}
        className="w-full hover:bg-primary-hover"
        disabled={pending}
      >
        {pending ? 'Salvando…' : 'Salvar disponibilidade'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProfessionalSheet — exported component
// ---------------------------------------------------------------------------

interface Props {
  professional: ProfessionalRow | null
  allServices: ServiceOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfessionalSheet({ professional, allServices, open, onOpenChange }: Props) {
  if (!professional) return null

  function handleClose() {
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="text-base font-semibold">{professional.name}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <Tabs defaultValue="dados">
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">
                Dados
              </TabsTrigger>
              <TabsTrigger value="servicos" className="flex-1">
                Serviços
              </TabsTrigger>
              <TabsTrigger value="disponibilidade" className="flex-1">
                Disponibilidade
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dados" className="mt-4">
              <DadosTab
                key={`dados-${professional.id}`}
                professional={professional}
                onClose={handleClose}
              />
            </TabsContent>

            <TabsContent value="servicos" className="mt-4">
              <ServicosTab
                key={`servicos-${professional.id}`}
                professional={professional}
                allServices={allServices}
                onClose={handleClose}
              />
            </TabsContent>

            <TabsContent value="disponibilidade" className="mt-4">
              <DisponibilidadeTab
                key={`disp-${professional.id}`}
                professional={professional}
                onClose={handleClose}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}
