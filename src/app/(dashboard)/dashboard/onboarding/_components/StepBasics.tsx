'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveShopBasics } from '@/modules/tenancy/onboarding-actions'

interface Props {
  initialName: string
  onNext: () => void
}

export function StepBasics({ initialName, onNext }: Props) {
  const [form, setForm] = useState({
    name: initialName,
    description: '',
    phone: '',
    address: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await saveShopBasics({
        name: form.name,
        description: form.description || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
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

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end pt-2">
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
