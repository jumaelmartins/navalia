'use client'

import { useState, useTransition } from 'react'
import { SearchIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import { saveCustomerNotes } from '../actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomerRow = {
  id: string
  name: string
  phone: string
  notes: string | null
  lastVisit: string | null   // "YYYY-MM-DD" or null
  totalSpentCents: number
  noShowCount: number
  isInactive: boolean        // no appointment in 45+ days
  history: Array<{
    id: string
    date: string
    startTime: string
    serviceName: string
    professionalName: string
    status: string
  }>
}

// ---------------------------------------------------------------------------
// Status styles
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

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) {
    const local = d.slice(2) // 11 digits
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return phone
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

// ---------------------------------------------------------------------------
// Customer detail sheet
// ---------------------------------------------------------------------------

function CustomerSheet({
  customer,
  open,
  onClose,
}: {
  customer: CustomerRow | null
  open: boolean
  onClose: () => void
}) {
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [pending, startTransition] = useTransition()

  // Sync notes when customer changes
  if (customer && notes !== (customer.notes ?? '') && !pending) {
    setNotes(customer.notes ?? '')
  }

  function handleSaveNotes() {
    if (!customer) return
    startTransition(async () => {
      const res = await saveCustomerNotes(customer.id, notes)
      if (!res.ok) toast.error(res.error)
      else toast.success('Notas salvas.')
    })
  }

  if (!customer) return null

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{customer.name}</SheetTitle>
          <SheetDescription>{formatPhone(customer.phone)}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-6 p-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-primary">
                {customer.history.filter(h => h.status === 'COMPLETED').length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Visitas</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
              <p className="font-display text-lg font-semibold text-primary leading-tight">
                {formatCentsToBRL(customer.totalSpentCents)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Gasto total</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-foreground">
                {customer.noShowCount}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Faltas</p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Observações</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              placeholder="Notas internas sobre o cliente…"
            />
            <Button
              size="sm"
              onClick={handleSaveNotes}
              disabled={pending}
              className="hover:bg-primary-hover"
            >
              {pending ? 'Salvando…' : 'Salvar notas'}
            </Button>
          </div>

          {/* Appointment history */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Histórico de agendamentos</p>
            {customer.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum agendamento registrado.</p>
            ) : (
              <div className="space-y-2">
                {customer.history.map(h => (
                  <div
                    key={h.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{h.serviceName}</p>
                        <p className="text-xs text-muted-foreground">
                          {h.professionalName} · {formatDate(h.date)} {h.startTime}
                        </p>
                      </div>
                      <Badge className={cn('shrink-0 text-xs font-medium', STATUS_STYLES[h.status])}>
                        {STATUS_LABELS[h.status] ?? h.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// ClientesClient — main export
// ---------------------------------------------------------------------------

export function ClientesClient({ customers }: { customers: CustomerRow[] }) {
  const [search, setSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)

  const filtered = customers.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.phone.includes(q)
  })

  return (
    <main className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customers.length} cliente{customers.length !== 1 ? 's' : ''} cadastrado{customers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="relative w-64">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="pl-8"
          />
        </div>
      </div>

      {/* Table or empty state */}
      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <UsersIcon className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Nenhum cliente cadastrado ainda</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Os clientes aparecem aqui automaticamente quando fazem agendamentos.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Nenhum resultado para &ldquo;{search}&rdquo;</p>
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
                  Telefone
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Última visita
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total gasto
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Faltas
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(customer => (
                <TableRow
                  key={customer.id}
                  className="hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setSelectedCustomer(customer)}
                >
                  <TableCell className="font-medium text-sm">{customer.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatPhone(customer.phone)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {customer.lastVisit ? formatDate(customer.lastVisit) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatCentsToBRL(customer.totalSpentCents)}
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    {customer.noShowCount > 0 ? (
                      <span className="text-[var(--status-no-show)]">{customer.noShowCount}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {customer.isInactive && (
                      <Badge className="text-xs bg-[var(--status-pending)] text-[var(--status-pending-fg)]">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Customer detail sheet */}
      <CustomerSheet
        customer={selectedCustomer}
        open={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
    </main>
  )
}
