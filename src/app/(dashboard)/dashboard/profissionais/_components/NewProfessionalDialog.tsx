'use client'

import { useState, useTransition } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { createProfessional } from '@/modules/catalog/professional-actions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewProfessionalDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await createProfessional({
        name: name.trim(),
        bio: bio.trim() || undefined,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setName('')
      setBio('')
      onOpenChange(false)
    })
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setName('')
      setBio('')
      setError(null)
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo profissional</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="prof-name">Nome *</Label>
            <Input
              id="prof-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="João Silva"
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prof-bio">Bio</Label>
            <textarea
              id="prof-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Especialidade, experiência…"
              disabled={pending}
              rows={2}
              className="h-auto w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="hover:bg-primary-hover"
              disabled={pending}
            >
              {pending ? 'Criando…' : 'Criar profissional'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
