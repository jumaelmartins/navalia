'use client'

import { useState, useTransition } from 'react'
import { ScissorsIcon, ChevronUpIcon, ChevronDownIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import { toggleService, reorderServices } from '@/modules/catalog/service-actions'
import { ServiceDialog } from './ServiceDialog'

export type ServiceRow = {
  id: string
  name: string
  description: string | null
  priceCents: number
  durationMin: number
  isActive: boolean
  sortOrder: number
  _count: { professionals: number }
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge
      className={cn(
        'text-xs font-medium',
        isActive
          ? 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]'
          : 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
      )}
    >
      {isActive ? 'Ativo' : 'Inativo'}
    </Badge>
  )
}

export function ServicesClient({ services }: { services: ServiceRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRow | null>(null)
  const [pending, startTransition] = useTransition()

  function openCreate() {
    setEditingService(null)
    setDialogOpen(true)
  }

  function openEdit(service: ServiceRow) {
    setEditingService(service)
    setDialogOpen(true)
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      await toggleService(id)
    })
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    startTransition(async () => {
      const ids = services.map((s) => s.id)
      ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
      await reorderServices(ids)
    })
  }

  function handleMoveDown(index: number) {
    if (index === services.length - 1) return
    startTransition(async () => {
      const ids = services.map((s) => s.id)
      ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
      await reorderServices(ids)
    })
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Serviços</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie os serviços oferecidos pela barbearia.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="hover:bg-primary-hover"
          disabled={pending}
        >
          Novo serviço
        </Button>
      </div>

      {/* Empty state */}
      {services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ScissorsIcon className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhum serviço cadastrado
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Adicione serviços para que seus clientes possam agendar.
          </p>
          <Button
            variant="default"
            size="sm"
            className="mt-4 hover:bg-primary-hover"
            onClick={openCreate}
          >
            Novo serviço
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Nome
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Preço
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Duração
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Profissionais
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service, index) => (
                <TableRow key={service.id} className="group hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">
                    <div>
                      <span className="text-sm">{service.name}</span>
                      {service.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {service.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatCentsToBRL(service.priceCents)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {service.durationMin} min
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {service._count.professionals}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge isActive={service.isActive} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {/* Reorder */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleMoveUp(index)}
                        disabled={pending || index === 0}
                        title="Mover para cima"
                      >
                        <ChevronUpIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleMoveDown(index)}
                        disabled={pending || index === services.length - 1}
                        title="Mover para baixo"
                      >
                        <ChevronDownIcon />
                      </Button>
                      {/* Edit */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(service)}
                        disabled={pending}
                        title="Editar"
                      >
                        <PencilIcon />
                      </Button>
                      {/* Toggle active/inactive */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(service.id)}
                        disabled={pending}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {service.isActive ? 'Desativar' : 'Ativar'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog — key forces remount when switching between create/edit */}
      <ServiceDialog
        key={editingService?.id ?? 'new'}
        service={editingService}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </main>
  )
}
