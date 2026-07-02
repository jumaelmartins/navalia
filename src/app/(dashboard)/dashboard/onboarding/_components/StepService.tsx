'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createFirstService } from '@/modules/tenancy/onboarding-actions'
import { parseBRLToCents } from '@/modules/tenancy/money'

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hora' },
  { value: '90', label: '1h 30 min' },
]

interface Props {
  onNext: () => void
  onBack: () => void
}

export function StepService({ onNext, onBack }: Props) {
  const [name, setName] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [durationMin, setDurationMin] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const priceCents = parseBRLToCents(priceInput)
    if (priceCents === null || priceCents <= 0) {
      setError('Informe um preço válido (ex.: 39,90).')
      return
    }

    setLoading(true)
    try {
      const result = await createFirstService({
        name,
        priceCents,
        durationMin: parseInt(durationMin, 10),
      })
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="serviceName">Nome do serviço *</Label>
        <Input
          id="serviceName"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Corte masculino"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="price">Preço (R$) *</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
            R$
          </span>
          <Input
            id="price"
            required
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="39,90"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Use vírgula para centavos, ex.: 39,90
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Duração *</Label>
        <Select value={durationMin} onValueChange={(v) => setDurationMin(v ?? '30')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione a duração" />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
