'use client'

import { useState, useTransition } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { parseBRLToCents } from '@/modules/tenancy/money'
import { createService, updateService } from '@/modules/catalog/service-actions'
import type { ServiceRow } from './ServicesClient'

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hora' },
  { value: '90', label: '1h 30 min' },
  { value: '120', label: '2 horas' },
]

interface Props {
  service: ServiceRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ServiceDialog({ service, open, onOpenChange }: Props) {
  const isEdit = service !== null

  const [name, setName] = useState(service?.name ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [priceInput, setPriceInput] = useState(
    service ? (service.priceCents / 100).toFixed(2).replace('.', ',') : '',
  )
  const [duration, setDuration] = useState(String(service?.durationMin ?? 30))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const priceCents = parseBRLToCents(priceInput)
    if (priceCents === null || priceCents <= 0) {
      setError('Informe um preço válido (ex.: 39,90).')
      return
    }

    const durationMin = parseInt(duration, 10)

    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        priceCents,
        durationMin,
      }

      const result = isEdit
        ? await updateService(service.id, payload)
        : await createService(payload)

      if (!result.ok) {
        setError(result.error)
        return
      }

      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar serviço' : 'Novo serviço'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Nome *</Label>
            <Input
              id="svc-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Corte masculino"
              disabled={pending}
            />
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="svc-desc">Descrição</Label>
            <textarea
              id="svc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição opcional do serviço"
              disabled={pending}
              rows={2}
              className="h-auto w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>

          {/* Preço */}
          <div className="space-y-1.5">
            <Label htmlFor="svc-price">Preço (R$) *</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="svc-price"
                required
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="39,90"
                className="pl-9"
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Use vírgula para centavos, ex.: 39,90
            </p>
          </div>

          {/* Duração */}
          <div className="space-y-1.5">
            <Label>Duração *</Label>
            <Select
              value={duration}
              onValueChange={(v) => setDuration(v ?? '30')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a duração" />
              </SelectTrigger>
              <SelectContent>
                {/* Inject current value as extra option when not in the preset list */}
                {!DURATION_OPTIONS.some((o) => o.value === duration) && (
                  <SelectItem value={duration}>{duration} min</SelectItem>
                )}
                {DURATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="hover:bg-primary-hover"
              disabled={pending}
            >
              {pending ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar serviço'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
