'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, LockIcon, CalendarIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AgendaAppointment, AgendaBlock, AgendaData, WeekAgendaDay } from '@/modules/booking/admin-actions'
import {
  getAgenda,
  getWeekAgenda,
  completeAppointment,
  markNoShow,
  cancelAppointmentAdmin,
  rescheduleAppointment,
  createAppointmentAdmin,
  getAdminSlots,
} from '@/modules/booking/admin-actions'
import { createScheduleBlock, deleteScheduleBlock } from '@/modules/catalog/availability-actions'
import { normalizeCpf, isValidCpf } from '@/modules/tenancy/cpf'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Professional = { id: string; name: string }
type Service = { id: string; name: string; durationMin: number; isActive: boolean }
type BusinessHours = Record<string, { start: string; end: string } | null>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmado',
  PENDING: 'Pendente',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]',
  PENDING: 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
  COMPLETED: 'bg-[var(--status-completed)] text-[var(--status-completed-fg)]',
  CANCELLED: 'bg-[var(--status-cancelled)] text-[var(--status-cancelled-fg)]',
  NO_SHOW: 'bg-[var(--status-no-show)] text-[var(--status-no-show-fg)]',
}

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const ROW_HEIGHT = 64 // px per 30-min slot

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function addDaysToDate(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function getWeekStartFromDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  const daysToMon = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + daysToMon)
  return dt.toISOString().slice(0, 10)
}

function formatDisplayDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d}/${m}`
}

function generateTimeGrid(bhMap: BusinessHours): string[] {
  // Find the earliest open hour across all days
  let minMin = 24 * 60
  let maxMin = 0
  for (const day of Object.values(bhMap)) {
    if (!day) continue
    const s = toMin(day.start)
    const e = toMin(day.end)
    if (s < minMin) minMin = s
    if (e > maxMin) maxMin = e
  }
  if (minMin >= maxMin) { minMin = 8 * 60; maxMin = 20 * 60 }
  const rows: string[] = []
  for (let t = minMin; t < maxMin; t += 30) {
    const h = Math.floor(t / 60)
    const m = t % 60
    rows.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Appointment detail dialog
// ---------------------------------------------------------------------------

function AppointmentDialog({
  appt,
  open,
  onClose,
  onRefresh,
  professionals,
  services,
}: {
  appt: AgendaAppointment | null
  open: boolean
  onClose: () => void
  onRefresh: () => void
  professionals: Professional[]
  services: Service[]
}) {
  const [pending, startTransition] = useTransition()
  const [showReschedule, setShowReschedule] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!showReschedule) { setRescheduleDate(''); setRescheduleTime(''); setAvailableSlots([]) }
  }, [showReschedule])

  async function loadSlots(date: string) {
    if (!appt || !date) return
    setSlotsLoading(true)
    const result = await getAdminSlots({
      serviceId: appt.service.id,
      professionalId: appt.professional.id,
      date,
      excludeAppointmentId: appt.id,
    })
    setSlotsLoading(false)
    if (result.ok) setAvailableSlots(result.slots)
    else toast.error(result.error)
  }

  function handleComplete() {
    if (!appt) return
    startTransition(async () => {
      const res = await completeAppointment(appt.id)
      if (!res.ok) toast.error(res.error)
      else { toast.success('Agendamento concluído.'); onClose(); onRefresh() }
    })
  }

  function handleNoShow() {
    if (!appt) return
    startTransition(async () => {
      const res = await markNoShow(appt.id)
      if (!res.ok) toast.error(res.error)
      else { toast.success('Marcado como não compareceu.'); onClose(); onRefresh() }
    })
  }

  function handleCancel() {
    if (!appt) return
    startTransition(async () => {
      const res = await cancelAppointmentAdmin(appt.id)
      if (!res.ok) toast.error(res.error)
      else { toast.success('Agendamento cancelado.'); setShowCancelConfirm(false); onClose(); onRefresh() }
    })
  }

  function handleReschedule() {
    if (!appt || !rescheduleDate || !rescheduleTime) return
    startTransition(async () => {
      const res = await rescheduleAppointment({ id: appt.id, newDate: rescheduleDate, newStartTime: rescheduleTime })
      if (!res.ok) toast.error(res.error)
      else { toast.success('Agendamento remarcado.'); setShowReschedule(false); onClose(); onRefresh() }
    })
  }

  if (!appt) return null

  const canAct = appt.status === 'CONFIRMED' || appt.status === 'PENDING'
  const isConfirmed = appt.status === 'CONFIRMED'

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agendamento</DialogTitle>
        </DialogHeader>

        {/* Details */}
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Cliente</span>
            <span className="font-medium">{appt.customer.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Telefone</span>
            <span>{appt.customer.phone}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Serviço</span>
            <span>{appt.service.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Profissional</span>
            <span>{appt.professional.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Horário</span>
            <span>{appt.startTime} – {appt.endTime}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge className={cn('text-xs font-medium', STATUS_STYLES[appt.status])}>
              {STATUS_LABELS[appt.status]}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        {canAct && !showReschedule && !showCancelConfirm && (
          <div className="flex flex-wrap gap-2 pt-2">
            {isConfirmed && (
              <Button size="sm" onClick={handleComplete} disabled={pending} className="hover:bg-primary-hover">
                Concluir
              </Button>
            )}
            {isConfirmed && (
              <Button size="sm" variant="outline" onClick={handleNoShow} disabled={pending}>
                Não compareceu
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowReschedule(true)} disabled={pending}>
              Remarcar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setShowCancelConfirm(true)} disabled={pending}>
              Cancelar
            </Button>
          </div>
        )}

        {/* Reschedule sub-form */}
        {showReschedule && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">Remarcar para</p>
            <div className="space-y-1.5">
              <Label htmlFor="res-date" className="text-xs text-muted-foreground">Nova data</Label>
              <Input
                id="res-date"
                type="date"
                value={rescheduleDate}
                onChange={e => { setRescheduleDate(e.target.value); if (e.target.value) loadSlots(e.target.value) }}
              />
            </div>
            {rescheduleDate && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Horário</Label>
                {slotsLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando horários…</p>
                ) : availableSlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem horários disponíveis nessa data.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {availableSlots.map(slot => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setRescheduleTime(slot)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs transition-colors',
                          rescheduleTime === slot
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-muted',
                        )}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleReschedule} disabled={!rescheduleDate || !rescheduleTime || pending} className="hover:bg-primary-hover">
                Confirmar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowReschedule(false)}>
                Voltar
              </Button>
            </div>
          </div>
        )}

        {/* Cancel confirm */}
        {showCancelConfirm && (
          <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">Cancelar agendamento?</p>
            <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={handleCancel} disabled={pending}>
                Sim, cancelar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowCancelConfirm(false)}>
                Voltar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Block dialog (create)
// ---------------------------------------------------------------------------

function BlockDialog({
  open,
  onClose,
  onRefresh,
  professionals,
}: {
  open: boolean
  onClose: () => void
  onRefresh: () => void
  professionals: Professional[]
}) {
  const [pending, startTransition] = useTransition()
  const [professionalId, setProfessionalId] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reason, setReason] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await createScheduleBlock({ professionalId, date, startTime, endTime, reason: reason || undefined })
      if (!res.ok) toast.error(res.error)
      else { toast.success('Horário bloqueado.'); onClose(); onRefresh() }
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bloquear horário</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="blk-prof">Profissional *</Label>
            <select
              id="blk-prof"
              required
              value={professionalId}
              onChange={e => setProfessionalId(e.target.value)}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Selecionar…</option>
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blk-date">Data *</Label>
            <Input id="blk-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="blk-start">Início *</Label>
              <Input id="blk-start" type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blk-end">Fim *</Label>
              <Input id="blk-end" type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blk-reason">Motivo</Label>
            <Input id="blk-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Opcional" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} className="hover:bg-primary-hover">
              {pending ? 'Bloqueando…' : 'Bloquear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// New appointment dialog
// ---------------------------------------------------------------------------

function NewAppointmentDialog({
  open,
  onClose,
  onRefresh,
  professionals,
  services,
  initialDate,
}: {
  open: boolean
  onClose: () => void
  onRefresh: () => void
  professionals: Professional[]
  services: Service[]
  initialDate: string
}) {
  const [pending, startTransition] = useTransition()
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [startTime, setStartTime] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerCpf, setCustomerCpf] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  async function loadSlots(svcId: string, profId: string, dt: string) {
    if (!svcId || !profId || !dt) return
    setSlotsLoading(true)
    const res = await getAdminSlots({ serviceId: svcId, professionalId: profId, date: dt })
    setSlotsLoading(false)
    if (res.ok) setSlots(res.slots)
    else toast.error(res.error)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedCpf = normalizeCpf(customerCpf)
    if (!normalizedCpf || !isValidCpf(normalizedCpf)) {
      toast.error('CPF inválido. Verifique os números digitados.')
      return
    }
    startTransition(async () => {
      const res = await createAppointmentAdmin({
        serviceId,
        professionalId,
        date,
        startTime,
        customer: { name: customerName.trim(), cpf: normalizedCpf, phone: customerPhone.trim() },
      })
      if (!res.ok) toast.error(res.error)
      else { toast.success('Agendamento criado.'); onClose(); onRefresh() }
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Service */}
          <div className="space-y-1.5">
            <Label htmlFor="na-svc">Serviço *</Label>
            <select
              id="na-svc"
              required
              value={serviceId}
              onChange={e => { setServiceId(e.target.value); setStartTime(''); if (e.target.value && professionalId && date) loadSlots(e.target.value, professionalId, date) }}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Selecionar…</option>
              {services.filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {/* Professional */}
          <div className="space-y-1.5">
            <Label htmlFor="na-prof">Profissional *</Label>
            <select
              id="na-prof"
              required
              value={professionalId}
              onChange={e => { setProfessionalId(e.target.value); setStartTime(''); if (serviceId && e.target.value && date) loadSlots(serviceId, e.target.value, date) }}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Selecionar…</option>
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="na-date">Data *</Label>
            <Input id="na-date" type="date" required value={date} onChange={e => { setDate(e.target.value); setStartTime(''); if (serviceId && professionalId) loadSlots(serviceId, professionalId, e.target.value) }} />
          </div>
          {/* Slot picker */}
          {serviceId && professionalId && date && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Horário *</Label>
              {slotsLoading ? (
                <p className="text-xs text-muted-foreground">Carregando…</p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem horários disponíveis nessa data.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map(slot => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setStartTime(slot)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs transition-colors',
                        startTime === slot
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Customer */}
          <div className="space-y-1.5">
            <Label htmlFor="na-name">Nome do cliente *</Label>
            <Input id="na-name" required value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-cpf">CPF *</Label>
            <Input id="na-cpf" required value={customerCpf} onChange={e => setCustomerCpf(e.target.value)} placeholder="000.000.000-00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-phone">Telefone *</Label>
            <Input id="na-phone" required value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(11) 98765-4321" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !startTime} className="hover:bg-primary-hover">
              {pending ? 'Criando…' : 'Criar agendamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Day view time grid
// ---------------------------------------------------------------------------

function DayGrid({
  date,
  data,
  professionals,
  businessHours,
  onSelectAppt,
  onDeleteBlock,
}: {
  date: string
  data: AgendaData
  professionals: Professional[]
  businessHours: BusinessHours
  onSelectAppt: (appt: AgendaAppointment) => void
  onDeleteBlock: (blockId: string) => void
}) {
  const [, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(parseInt(date.split('-')[0]), m - 1, d))
  const weekday = dt.getUTCDay() // 0=Sun
  const bh = businessHours[String(weekday)]

  const timeSlots = generateTimeGrid(businessHours)
  if (timeSlots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CalendarIcon className="mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Barbearia fechada neste dia</p>
      </div>
    )
  }

  const gridStart = toMin(timeSlots[0])
  const gridEnd = toMin(timeSlots[timeSlots.length - 1]) + 30
  const totalMin = gridEnd - gridStart
  const totalHeight = (totalMin / 30) * ROW_HEIGHT

  // Filter to professionals that have appointments/blocks today or are active
  const activeProfIds = new Set([
    ...data.appointments.map(a => a.professional.id),
    ...data.blocks.map(b => b.professionalId),
    ...professionals.map(p => p.id),
  ])
  const visibleProfs = professionals.filter(p => activeProfIds.has(p.id))

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Header row */}
        <div className="flex border-b border-border bg-card sticky top-0 z-10">
          <div className="w-14 shrink-0 border-r border-border" />
          {visibleProfs.map(prof => (
            <div
              key={prof.id}
              className="flex-1 min-w-[160px] px-2 py-2 text-center text-xs font-medium text-muted-foreground border-r border-border last:border-r-0"
            >
              {prof.name}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex">
          {/* Time column */}
          <div className="w-14 shrink-0 border-r border-border">
            {timeSlots.map((slot, i) => (
              <div
                key={slot}
                className="flex items-start justify-end pr-2 text-[10px] text-muted-foreground"
                style={{ height: ROW_HEIGHT }}
              >
                {i % 2 === 0 ? slot : ''}
              </div>
            ))}
          </div>

          {/* Professional columns */}
          {visibleProfs.map(prof => {
            const profAppts = data.appointments.filter(a => a.professional.id === prof.id)
            const profBlocks = data.blocks.filter(b => b.professionalId === prof.id)

            return (
              <div
                key={prof.id}
                className="relative flex-1 min-w-[160px] border-r border-border last:border-r-0"
                style={{ height: totalHeight }}
              >
                {/* Grid lines */}
                {timeSlots.map((slot, i) => (
                  <div
                    key={slot}
                    className={cn(
                      'absolute inset-x-0 border-t',
                      i % 2 === 0 ? 'border-border/70' : 'border-border/30',
                    )}
                    style={{ top: i * ROW_HEIGHT }}
                  />
                ))}

                {/* Schedule blocks */}
                {profBlocks.map(block => {
                  const blockStart = toMin(block.startTime)
                  const blockEnd = toMin(block.endTime)
                  const top = ((blockStart - gridStart) / 30) * ROW_HEIGHT
                  const height = ((blockEnd - blockStart) / 30) * ROW_HEIGHT

                  return (
                    <div
                      key={block.id}
                      className="absolute inset-x-1 overflow-hidden rounded-md border border-muted-foreground/30"
                      style={{
                        top: top + 1,
                        height: height - 2,
                        background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)',
                        backgroundColor: 'var(--muted)',
                      }}
                    >
                      <div className="flex items-start justify-between p-1">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-muted-foreground truncate">
                            {block.startTime}–{block.endTime}
                          </p>
                          {block.reason && (
                            <p className="text-[10px] text-muted-foreground/70 truncate">{block.reason}</p>
                          )}
                        </div>
                        <button
                          onClick={() => onDeleteBlock(block.id)}
                          className="ml-0.5 shrink-0 rounded p-0.5 hover:bg-muted-foreground/20 text-muted-foreground"
                          title="Remover bloqueio"
                        >
                          <XIcon className="size-2.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Appointments */}
                {profAppts.map(appt => {
                  const apptStart = toMin(appt.startTime)
                  const apptEnd = toMin(appt.endTime)
                  const top = ((apptStart - gridStart) / 30) * ROW_HEIGHT
                  const height = Math.max(((apptEnd - apptStart) / 30) * ROW_HEIGHT - 2, 24)

                  const colorBand: Record<string, string> = {
                    CONFIRMED: 'border-[var(--status-confirmed)]',
                    PENDING: 'border-[var(--status-pending)]',
                    COMPLETED: 'border-[var(--status-completed)]',
                    NO_SHOW: 'border-[var(--status-no-show)]',
                  }

                  return (
                    <button
                      key={appt.id}
                      onClick={() => onSelectAppt(appt)}
                      className={cn(
                        'absolute inset-x-1 overflow-hidden rounded-md border-l-2 bg-card text-left shadow-sm hover:shadow-md transition-shadow',
                        colorBand[appt.status] ?? 'border-border',
                      )}
                      style={{ top: top + 1, height }}
                    >
                      <div className="p-1">
                        <p className="text-[10px] font-semibold text-foreground truncate leading-tight">
                          {appt.customer.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">
                          {appt.service.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          {appt.startTime}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------

function WeekView({
  weekStart,
  data,
  onDayClick,
}: {
  weekStart: string
  data: WeekAgendaDay[]
  onDayClick: (date: string) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {data.map((day, i) => (
        <button
          key={day.date}
          onClick={() => onDayClick(day.date)}
          className="flex flex-col min-h-[120px] rounded-lg border border-border bg-card p-2 text-left hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="mb-1">
            <p className="text-xs font-medium text-muted-foreground">{DAY_LABELS[i]}</p>
            <p className="text-sm font-semibold text-foreground">{formatShortDate(day.date)}</p>
          </div>
          {day.count > 0 ? (
            <>
              <Badge className="mb-1.5 w-fit text-xs bg-primary/10 text-primary border-0">
                {day.count} {day.count === 1 ? 'agend.' : 'agends.'}
              </Badge>
              <div className="space-y-0.5">
                {day.items.slice(0, 3).map(item => (
                  <div key={item.id} className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground shrink-0">{item.startTime}</span>
                    <span className="text-[10px] truncate text-foreground">{item.customerName.split(' ')[0]}</span>
                  </div>
                ))}
                {day.count > 3 && (
                  <p className="text-[10px] text-muted-foreground">+{day.count - 3} mais</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 mt-1">Sem agendamentos</p>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AgendaClient — main export
// ---------------------------------------------------------------------------

export function AgendaClient({
  initialDate,
  professionals,
  services,
  businessHours,
}: {
  initialDate: string
  professionals: Professional[]
  services: Service[]
  businessHours: BusinessHours
}) {
  const [view, setView] = useState<'day' | 'week'>('day')
  const [currentDate, setCurrentDate] = useState(initialDate)
  const [filterProfId, setFilterProfId] = useState('all')
  const [dayData, setDayData] = useState<AgendaData | null>(null)
  const [weekData, setWeekData] = useState<WeekAgendaDay[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<AgendaAppointment | null>(null)
  const [showNewAppt, setShowNewAppt] = useState(false)
  const [showBlock, setShowBlock] = useState(false)
  const [deletingBlock, startDeleteBlock] = useTransition()

  const weekStart = getWeekStartFromDate(currentDate)

  const refreshDay = useCallback(async (date: string, profId?: string) => {
    setLoading(true)
    try {
      const data = await getAgenda({ date, professionalId: profId === 'all' ? undefined : profId })
      setDayData(data)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshWeek = useCallback(async (ws: string, profId?: string) => {
    setLoading(true)
    try {
      const data = await getWeekAgenda({ weekStart: ws, professionalId: profId === 'all' ? undefined : profId })
      setWeekData(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view === 'day') refreshDay(currentDate, filterProfId)
    else refreshWeek(weekStart, filterProfId)
  }, [view, currentDate, filterProfId, weekStart, refreshDay, refreshWeek])

  function handlePrev() {
    if (view === 'day') setCurrentDate(d => addDaysToDate(d, -1))
    else setCurrentDate(addDaysToDate(weekStart, -7))
  }

  function handleNext() {
    if (view === 'day') setCurrentDate(d => addDaysToDate(d, 1))
    else setCurrentDate(addDaysToDate(weekStart, 7))
  }

  function handleToday() {
    setCurrentDate(initialDate)
  }

  function handleWeekDayClick(date: string) {
    setCurrentDate(date)
    setView('day')
  }

  function handleDeleteBlock(blockId: string) {
    startDeleteBlock(async () => {
      const res = await deleteScheduleBlock(blockId)
      if (!res.ok) toast.error(res.error)
      else {
        toast.success('Bloqueio removido.')
        refreshDay(currentDate, filterProfId)
      }
    })
  }

  function handleRefresh() {
    if (view === 'day') refreshDay(currentDate, filterProfId)
    else refreshWeek(weekStart, filterProfId)
  }

  const displayTitle = view === 'day'
    ? formatDisplayDate(currentDate)
    : `${formatShortDate(weekStart)} – ${formatShortDate(addDaysToDate(weekStart, 6))}`

  return (
    <main className="p-6 space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Agenda</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowBlock(true)}>
            <LockIcon className="size-3.5" />
            Bloquear horário
          </Button>
          <Button size="sm" onClick={() => setShowNewAppt(true)} className="hover:bg-primary-hover">
            <PlusIcon className="size-3.5" />
            Novo agendamento
          </Button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Prev/Next/Today */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={handlePrev} aria-label={view === 'day' ? 'Dia anterior' : 'Semana anterior'}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday}>
            Hoje
          </Button>
          <Button variant="outline" size="icon-sm" onClick={handleNext} aria-label={view === 'day' ? 'Próximo dia' : 'Próxima semana'}>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>

        {/* Date display / date picker */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize">{displayTitle}</span>
          {view === 'day' && (
            <input
              type="date"
              value={currentDate}
              onChange={e => setCurrentDate(e.target.value)}
              className="h-7 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Professional filter */}
          <select
            value={filterProfId}
            onChange={e => setFilterProfId(e.target.value)}
            aria-label="Filtrar por profissional"
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="all">Todos os profissionais</option>
            {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setView('day')}
              className={cn('px-3 py-1 text-xs transition-colors', view === 'day' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              Dia
            </button>
            <button
              onClick={() => setView('week')}
              className={cn('px-3 py-1 text-xs transition-colors border-l border-border', view === 'week' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              Semana
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : view === 'day' ? (
        dayData && (
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <DayGrid
              date={currentDate}
              data={dayData}
              professionals={professionals.filter(
                p => filterProfId === 'all' || p.id === filterProfId,
              )}
              businessHours={businessHours}
              onSelectAppt={setSelectedAppt}
              onDeleteBlock={handleDeleteBlock}
            />
          </div>
        )
      ) : (
        weekData && (
          <WeekView
            weekStart={weekStart}
            data={weekData}
            onDayClick={handleWeekDayClick}
          />
        )
      )}

      {/* Appointment detail dialog */}
      <AppointmentDialog
        appt={selectedAppt}
        open={!!selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onRefresh={handleRefresh}
        professionals={professionals}
        services={services}
      />

      {/* New appointment dialog */}
      <NewAppointmentDialog
        open={showNewAppt}
        onClose={() => setShowNewAppt(false)}
        onRefresh={handleRefresh}
        professionals={professionals}
        services={services}
        initialDate={currentDate}
      />

      {/* Block dialog */}
      <BlockDialog
        open={showBlock}
        onClose={() => setShowBlock(false)}
        onRefresh={handleRefresh}
        professionals={professionals}
      />
    </main>
  )
}
