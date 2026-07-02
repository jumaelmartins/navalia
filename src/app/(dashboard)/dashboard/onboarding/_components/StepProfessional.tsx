'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createFirstProfessional } from '@/modules/tenancy/onboarding-actions'
import { completeOnboarding } from '@/modules/tenancy/onboarding-actions'

interface Props {
  onNext: () => void
  onBack: () => void
}

export function StepProfessional({ onNext, onBack }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Create professional (auto-links to first service + creates availability rules)
      const profResult = await createFirstProfessional({ name })
      if (!profResult.ok) {
        setError(profResult.error)
        return
      }

      // Complete onboarding
      const doneResult = await completeOnboarding()
      if (!doneResult.ok) {
        setError(doneResult.error)
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
        <Label htmlFor="profName">Nome do profissional *</Label>
        <Input
          id="profName"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="João Silva"
        />
        <p className="text-xs text-muted-foreground">
          Pode ser você mesmo — adicione mais barbeiros depois no painel.
        </p>
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
          {loading ? 'Finalizando…' : 'Concluir configuração'}
        </Button>
      </div>
    </form>
  )
}
