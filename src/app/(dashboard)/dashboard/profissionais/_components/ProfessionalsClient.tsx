'use client'

import { useState } from 'react'
import { UsersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NewProfessionalDialog } from './NewProfessionalDialog'
import { ProfessionalSheet } from './ProfessionalSheet'

// ---------------------------------------------------------------------------
// Types exported for reuse in sub-components
// ---------------------------------------------------------------------------

export type ProfessionalRow = {
  id: string
  name: string
  bio: string | null
  avatarUrl: string | null
  isActive: boolean
  services: {
    service: { id: string; name: string; isActive: boolean }
  }[]
  availabilityRules: {
    id: string
    weekday: number
    startTime: string
    endTime: string
  }[]
}

type ServiceOption = {
  id: string
  name: string
  isActive: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_SHORT: Record<number, string> = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
}

/**
 * Produces a compact summary of a professional's availability weekdays.
 * Examples: "Seg-Sex", "Seg, Qua, Sex", "5 dias"
 */
function formatRuleSummary(rules: { weekday: number }[]): string {
  if (rules.length === 0) return 'Sem disponibilidade'

  const weekdays = [...new Set(rules.map((r) => r.weekday))].sort((a, b) => a - b)

  if (weekdays.length === 1) return DAY_SHORT[weekdays[0]]

  const isConsecutive = weekdays.every((d, i) => i === 0 || d === weekdays[i - 1]! + 1)
  if (isConsecutive) {
    return `${DAY_SHORT[weekdays[0]!]}-${DAY_SHORT[weekdays[weekdays.length - 1]!]}`
  }

  if (weekdays.length <= 3) return weekdays.map((d) => DAY_SHORT[d]).join(', ')
  return `${weekdays.length} dias`
}

/**
 * Generates initials from a name for the avatar circle.
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '').toUpperCase()
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase()
}

// ---------------------------------------------------------------------------
// ProfessionalCard
// ---------------------------------------------------------------------------

function ProfessionalCard({
  professional,
  onManage,
}: {
  professional: ProfessionalRow
  onManage: (p: ProfessionalRow) => void
}) {
  const initials = getInitials(professional.name)
  const serviceChips = professional.services
    .filter((ps) => ps.service.isActive)
    .map((ps) => ps.service)
  const ruleSummary = formatRuleSummary(professional.availabilityRules)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      {/* Header: avatar + name + status */}
      <div className="flex items-start gap-3">
        {/* Avatar initials circle */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{professional.name}</p>
          {professional.bio && (
            <p className="truncate text-xs text-muted-foreground">{professional.bio}</p>
          )}
        </div>
        <Badge
          className={cn(
            'shrink-0 text-xs font-medium',
            professional.isActive
              ? 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]'
              : 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
          )}
        >
          {professional.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      </div>

      {/* Service chips */}
      {serviceChips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {serviceChips.map((svc) => (
            <Badge
              key={svc.id}
              variant="outline"
              className="text-xs"
            >
              {svc.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70">Nenhum serviço vinculado</p>
      )}

      {/* Footer: rule summary + manage button */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">{ruleSummary}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onManage(professional)}
        >
          Gerenciar
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProfessionalsClient — main export
// ---------------------------------------------------------------------------

interface Props {
  professionals: ProfessionalRow[]
  allServices: ServiceOption[]
}

export function ProfessionalsClient({ professionals, allServices }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sheetProfessional, setSheetProfessional] = useState<ProfessionalRow | null>(null)

  function openSheet(professional: ProfessionalRow) {
    setSheetProfessional(professional)
  }

  function closeSheet() {
    setSheetProfessional(null)
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Profissionais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie os profissionais da barbearia.
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="hover:bg-primary-hover"
        >
          Novo profissional
        </Button>
      </div>

      {/* Empty state (edge case: pre-onboarding) */}
      {professionals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <UsersIcon className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhum profissional cadastrado
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Adicione profissionais para gerenciar a agenda da barbearia.
          </p>
          <Button
            variant="default"
            size="sm"
            className="mt-4 hover:bg-primary-hover"
            onClick={() => setDialogOpen(true)}
          >
            Novo profissional
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {professionals.map((professional) => (
            <ProfessionalCard
              key={professional.id}
              professional={professional}
              onManage={openSheet}
            />
          ))}
        </div>
      )}

      {/* New professional dialog */}
      <NewProfessionalDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Detail sheet */}
      <ProfessionalSheet
        key={sheetProfessional?.id ?? 'none'}
        professional={sheetProfessional}
        allServices={allServices}
        open={sheetProfessional !== null}
        onOpenChange={(v) => { if (!v) closeSheet() }}
      />
    </main>
  )
}
