'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveBusinessHours } from '@/modules/tenancy/onboarding-actions'

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

const DEFAULT_HOURS: WeekHours = {
  '0': null,
  '1': { start: '09:00', end: '19:00' },
  '2': { start: '09:00', end: '19:00' },
  '3': { start: '09:00', end: '19:00' },
  '4': { start: '09:00', end: '19:00' },
  '5': { start: '09:00', end: '19:00' },
  '6': { start: '09:00', end: '17:00' },
}

interface Props {
  onNext: () => void
  onBack: () => void
}

export function StepHours({ onNext, onBack }: Props) {
  const [hours, setHours] = useState<WeekHours>({ ...DEFAULT_HOURS })
  const [error, setError] = useState<string | null>(null)
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
    setError(null)
    setLoading(true)
    try {
      const result = await saveBusinessHours(hours)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onNext()
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
              {/* Day label + closed toggle */}
              <div className="w-12 shrink-0">
                <span className="text-sm font-medium text-foreground">
                  {DAY_LABELS[day]}
                </span>
              </div>

              {/* Toggle button */}
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

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Voltar
        </Button>
        <Button
          type="submit"
          className="hover:bg-primary-hover"
          disabled={loading}
        >
          {loading ? 'Salvando…' : 'Continuar'}
        </Button>
      </div>
    </form>
  )
}
