'use client'

import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, MessageCircle, Calendar, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPublicSlots,
  createPublicAppointment,
  type PublicShop,
} from '@/modules/booking/public-actions'
import { buildWhatsAppLink } from '@/modules/whatsapp/deep-link'
import { formatCentsToBRL } from '@/modules/tenancy/money'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function formatDateFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Generate next N calendar days as "YYYY-MM-DD", starting from today */
function generateNextDays(n: number): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    result.push(`${y}-${mo}-${day}`)
  }
  return result
}

/** Get weekday (0=Sun…6=Sat) from "YYYY-MM-DD" without timezone shift */
function dateToWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
            i < step ? 'bg-primary' : 'bg-border'
          }`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  shop: PublicShop
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BookingSection({ shop }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0)

  // Selections
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [professionalId, setProfessionalId] = useState<string | null | 'any'>('any')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [resolvedProfessionalId, setResolvedProfessionalId] = useState<string | null>(null)

  // Slots state
  const [slotsMap, setSlotsMap] = useState<{ professionalId: string; slots: string[] }[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  // Customer form
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedService = shop.services.find(s => s.id === serviceId) ?? null
  const selectedProfessional =
    professionalId !== 'any' && professionalId !== null
      ? shop.professionals.find(p => p.id === professionalId) ?? null
      : null

  // ── WhatsApp link (reflects current selection) ──────────────────────────

  const whatsAppHref = shop.phone
    ? buildWhatsAppLink({
        phone: shop.phone,
        shopName: shop.name,
        service: selectedService?.name,
        professional: selectedProfessional?.name,
        date: selectedDate ?? undefined,
        time: selectedSlot ?? undefined,
      })
    : null

  // ── Fetch slots ──────────────────────────────────────────────────────────

  const fetchSlots = useCallback(
    async (date: string, profId: string | null) => {
      if (!serviceId) return
      setSlotsLoading(true)
      setSlotsError(null)
      setSlotsMap([])
      setSelectedSlot(null)
      setResolvedProfessionalId(null)

      const result = await getPublicSlots({
        slug: shop.slug,
        serviceId,
        professionalId: profId === 'any' ? null : profId,
        date,
      })

      setSlotsLoading(false)

      if (!result.ok) {
        setSlotsError(result.error)
        return
      }

      setSlotsMap(result.data)
    },
    [serviceId, shop.slug],
  )

  // Derive merged unique slots when professionalId === 'any'
  const mergedSlots: string[] = []
  const slotToProfId: Record<string, string> = {}

  if (professionalId === 'any') {
    for (const { professionalId: pid, slots } of slotsMap) {
      for (const slot of slots) {
        if (!(slot in slotToProfId)) {
          slotToProfId[slot] = pid
          mergedSlots.push(slot)
        }
      }
    }
    mergedSlots.sort()
  } else {
    const match = slotsMap.find(s => s.professionalId === professionalId)
    if (match) mergedSlots.push(...match.slots)
  }

  // ── Business days ────────────────────────────────────────────────────────

  const allDays = generateNextDays(14)
  const openDays = allDays.filter(d => {
    const weekday = dateToWeekday(d)
    return shop.businessHours[String(weekday)] !== null
  })

  // ── Step handlers ────────────────────────────────────────────────────────

  function handleSelectService(id: string) {
    setServiceId(id)
    setSelectedDate(null)
    setSelectedSlot(null)
    setSlotsMap([])
    setStep(2)
  }

  function handleSelectProfessional(id: string | 'any') {
    setProfessionalId(id)
    setSelectedDate(null)
    setSelectedSlot(null)
    setSlotsMap([])
    setStep(3)
  }

  async function handleSelectDate(date: string) {
    setSelectedDate(date)
    setSelectedSlot(null)
    await fetchSlots(date, professionalId)
  }

  function handleSelectSlot(slot: string) {
    setSelectedSlot(slot)
    if (professionalId === 'any') {
      setResolvedProfessionalId(slotToProfId[slot] ?? null)
    } else {
      setResolvedProfessionalId(professionalId)
    }
    setStep(4)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!serviceId || !selectedDate || !selectedSlot || !resolvedProfessionalId) {
      setFormError('Dados de agendamento incompletos. Volte e selecione novamente.')
      return
    }

    if (!customerName.trim()) {
      setFormError('Informe seu nome.')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Informe seu telefone.')
      return
    }

    startTransition(async () => {
      const result = await createPublicAppointment({
        slug: shop.slug,
        serviceId,
        professionalId: resolvedProfessionalId,
        date: selectedDate,
        startTime: selectedSlot,
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          email: customerEmail.trim() || undefined,
        },
      })

      if (!result.ok) {
        if (result.slotTaken) {
          toast.error(result.error)
          // Refresh slots and return to step 3
          setSelectedSlot(null)
          setResolvedProfessionalId(null)
          await fetchSlots(selectedDate, professionalId)
          setStep(3)
          return
        }
        setFormError(result.error)
        return
      }

      router.push(`/${shop.slug}/sucesso/${result.data.appointmentId}`)
    })
  }

  // ── Pre-booking CTA (step 0) ─────────────────────────────────────────────

  if (step === 0) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <button
          onClick={() => setStep(1)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-8 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary-hover transition-colors"
        >
          <Calendar className="size-4" />
          Agendar horário
        </button>

        {whatsAppHref && (
          <a
            href={whatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <MessageCircle className="size-4 text-primary" />
            Agendar pelo WhatsApp
          </a>
        )}
      </div>
    )
  }

  // ── Booking flow wrapper ─────────────────────────────────────────────────

  return (
    <div className="max-w-xl">
      {/* Header with back button and WhatsApp link */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (step === 1) setStep(0)
              else setStep((step - 1) as 0 | 1 | 2 | 3 | 4)
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" />
            Voltar
          </button>

          <span className="text-xs text-muted-foreground">
            Passo {step} de 4
          </span>
        </div>

        {whatsAppHref && shop.phone && (
          <a
            href={whatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <MessageCircle className="size-3.5" />
            WhatsApp
          </a>
        )}
      </div>

      <ProgressBar step={step} total={4} />

      {/* ── Step 1: Service ──────────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
            Escolha o serviço
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Selecione o serviço que deseja agendar.
          </p>

          <div className="space-y-2">
            {shop.services.map(service => (
              <button
                key={service.id}
                onClick={() => handleSelectService(service.id)}
                className={`w-full text-left rounded-xl border p-4 transition-all hover:border-primary/50 hover:bg-card ${
                  serviceId === service.id
                    ? 'border-primary bg-card'
                    : 'border-border bg-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block font-medium text-foreground text-sm">
                      {service.name}
                    </span>
                    {service.description && (
                      <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">
                        {service.description}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground mt-1.5">
                      {formatDuration(service.durationMin)}
                    </span>
                  </div>
                  <span className="font-display text-base font-semibold text-primary shrink-0">
                    {formatCentsToBRL(service.priceCents)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: Professional ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
            Escolha o profissional
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Selecione quem vai te atender.
          </p>

          <div className="space-y-2">
            {/* "Any professional" option */}
            <button
              onClick={() => handleSelectProfessional('any')}
              className={`w-full text-left rounded-xl border p-4 transition-all hover:border-primary/50 hover:bg-card ${
                professionalId === 'any'
                  ? 'border-primary bg-card'
                  : 'border-border bg-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                  <span className="text-xs font-medium text-muted-foreground">?</span>
                </div>
                <div>
                  <span className="block font-medium text-foreground text-sm">
                    Qualquer profissional
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Ver todos os horários disponíveis
                  </span>
                </div>
              </div>
            </button>

            {/* Filter professionals who can do the selected service */}
            {shop.professionals
              .filter(p => !serviceId || p.serviceIds.includes(serviceId))
              .map(professional => (
                <button
                  key={professional.id}
                  onClick={() => handleSelectProfessional(professional.id)}
                  className={`w-full text-left rounded-xl border p-4 transition-all hover:border-primary/50 hover:bg-card ${
                    professionalId === professional.id
                      ? 'border-primary bg-card'
                      : 'border-border bg-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                      <span className="font-display text-sm font-semibold text-primary">
                        {getInitials(professional.name)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-medium text-foreground text-sm">
                        {professional.name}
                      </span>
                      {professional.bio && (
                        <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {professional.bio}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ── Step 3: Date & Time ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
            Escolha a data e horário
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Selecione um dia e horário disponíveis.
          </p>

          {/* Horizontal date scroller */}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-6 -mx-1 px-1">
            {openDays.map(day => (
              <button
                key={day}
                onClick={() => handleSelectDate(day)}
                className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2.5 border text-xs font-medium shrink-0 transition-all ${
                  selectedDate === day
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                <span className="uppercase text-[10px] tracking-wide">
                  {formatDateShort(day).split(',')[0]}
                </span>
                <span className="text-base font-semibold font-display">
                  {day.split('-')[2]}
                </span>
                <span className="text-[10px] uppercase tracking-wide">
                  {new Date(
                    Number(day.split('-')[0]),
                    Number(day.split('-')[1]) - 1,
                    Number(day.split('-')[2])
                  ).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                </span>
              </button>
            ))}
          </div>

          {/* Slot grid */}
          {!selectedDate && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Selecione um dia para ver os horários.
            </p>
          )}

          {selectedDate && slotsLoading && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          )}

          {selectedDate && !slotsLoading && slotsError && (
            <p className="text-sm text-destructive text-center py-8">{slotsError}</p>
          )}

          {selectedDate && !slotsLoading && !slotsError && mergedSlots.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-muted-foreground">Sem horários disponíveis</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Escolha outro dia ou profissional.
              </p>
            </div>
          )}

          {selectedDate && !slotsLoading && mergedSlots.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {formatDateFull(selectedDate)} — {mergedSlots.length} horário(s) disponível(is)
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {mergedSlots.map(slot => (
                  <button
                    key={slot}
                    onClick={() => handleSelectSlot(slot)}
                    className={`h-10 rounded-lg border text-sm font-medium transition-all ${
                      selectedSlot === slot
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-transparent text-foreground hover:border-primary/50 hover:bg-card'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step 4: Customer data ─────────────────────────────────────────────── */}
      {step === 4 && (
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
            Seus dados
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Informe seus dados para confirmar o agendamento.
          </p>

          {/* Summary card */}
          {selectedService && selectedDate && selectedSlot && (
            <div className="bg-card border border-border rounded-xl p-4 mb-6 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Serviço</span>
                <span className="font-medium text-foreground">{selectedService.name}</span>
              </div>
              {selectedProfessional && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Profissional</span>
                  <span className="font-medium text-foreground">{selectedProfessional.name}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Data</span>
                <span className="font-medium text-foreground">
                  {new Date(
                    Number(selectedDate.split('-')[0]),
                    Number(selectedDate.split('-')[1]) - 1,
                    Number(selectedDate.split('-')[2])
                  ).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Horário</span>
                <span className="font-medium text-primary font-display text-base">
                  {selectedSlot}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-border pt-2 mt-2">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-display font-semibold text-primary">
                  {formatCentsToBRL(selectedService.priceCents)}
                </span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="booking-name">Nome *</Label>
              <Input
                id="booking-name"
                required
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Seu nome completo"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="booking-phone">Telefone *</Label>
              <Input
                id="booking-phone"
                required
                type="tel"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                placeholder="(71) 99999-9999"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="booking-email">
                E-mail <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Input
                id="booking-email"
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                disabled={isPending}
              />
            </div>

            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-sm font-medium hover:bg-primary-hover"
              disabled={isPending}
            >
              {isPending ? 'Confirmando…' : 'Confirmar agendamento'}
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
