import { requireOwner } from '@/modules/tenancy/context'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ActivityIcon, ShieldIcon, ChevronDownIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate JSON string to maxBytes, appending "..." if truncated. */
function truncateJson(value: unknown, maxBytes = 2048): string {
  const str = JSON.stringify(value, null, 2)
  if (str.length <= maxBytes) return str
  return str.slice(0, maxBytes) + '\n...'
}

/** Format date as "dd/MM/yyyy HH:mm" (pt-BR). */
function fmtAbsolute(date: Date): string {
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format date as relative ("há 2 horas", "há 3 dias", etc.). */
function fmtRelative(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `há ${days} dia${days > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  return `há ${months} mês${months > 1 ? 'es' : ''}`
}

// ---------------------------------------------------------------------------
// Status badge configs
// ---------------------------------------------------------------------------

type AiStatus =
  | 'EXECUTED'
  | 'PENDING_CONFIRMATION'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'ERROR'

const AI_STATUS_CONFIG: Record<AiStatus, { label: string; className: string }> = {
  EXECUTED: {
    label: 'Executado',
    className: 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]',
  },
  CONFIRMED: {
    label: 'Confirmado',
    className: 'bg-[var(--status-completed)] text-[var(--status-completed-fg)]',
  },
  PENDING_CONFIRMATION: {
    label: 'Aguardando',
    className: 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
  },
  PROCESSING: {
    label: 'Processando',
    className: 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
  },
  REJECTED: {
    label: 'Rejeitado',
    className: 'bg-[var(--status-cancelled)] text-[var(--status-cancelled-fg)]',
  },
  ERROR: {
    label: 'Erro',
    className: 'bg-[var(--status-cancelled)] text-[var(--status-cancelled-fg)]',
  },
}

const CHANNEL_CONFIG: Record<string, { label: string; className: string }> = {
  WHATSAPP: {
    label: 'WhatsApp',
    className: 'bg-emerald-100 text-emerald-800',
  },
  AI_WEB: {
    label: 'IA Web',
    className: 'bg-blue-100 text-blue-800',
  },
  COPILOT: {
    label: 'Copiloto',
    className: 'bg-violet-100 text-violet-800',
  },
  INSIGHTS: {
    label: 'Insights',
    className: 'bg-amber-100 text-amber-800',
  },
}

function StatusBadge({ value, config }: { value: string; config: { label: string; className: string } | undefined }) {
  if (!config) {
    return (
      <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
        {value}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Collapsible payload
// ---------------------------------------------------------------------------

function PayloadCollapsible({ data }: { data: unknown }) {
  if (data === null || data === undefined) return <span className="text-muted-foreground text-xs">—</span>
  const pretty = truncateJson(data)
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline list-none">
        <ChevronDownIcon className="size-3 transition-transform group-open:rotate-180" />
        ver payload
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-all">
        {pretty}
      </pre>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Known filter values
// ---------------------------------------------------------------------------

const AI_CHANNELS = ['WHATSAPP', 'AI_WEB', 'COPILOT', 'INSIGHTS']
const AI_STATUSES = [
  'EXECUTED',
  'PENDING_CONFIRMATION',
  'PROCESSING',
  'CONFIRMED',
  'REJECTED',
  'ERROR',
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface LogsSearchParams {
  tab?: string
  channel?: string
  status?: string
  acao?: string
  take?: string
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<LogsSearchParams>
}) {
  const { barbershop } = await requireOwner()
  const params = await searchParams

  const tab = params.tab ?? 'ia'
  const channel = params.channel || undefined
  const statusFilter = params.status || undefined
  const acaoFilter = params.acao || undefined
  const take = Math.min(Math.max(parseInt(params.take ?? '50', 10), 50), 500)

  // Build "current URL without take" for filter form actions
  const baseTabUrl = `/dashboard/configuracoes/logs?tab=${tab}`

  // ---------------------------------------------------------------------------
  // Fetch AI logs
  // ---------------------------------------------------------------------------

  const aiLogs =
    tab === 'ia'
      ? await prisma.aiActionLog.findMany({
          where: {
            barbershopId: barbershop.id,
            ...(channel ? { channel } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
          },
          take: take + 1, // +1 to check if there are more
          orderBy: { createdAt: 'desc' },
        })
      : []

  const hasMoreAi = aiLogs.length > take
  const aiLogsPage = hasMoreAi ? aiLogs.slice(0, take) : aiLogs

  // ---------------------------------------------------------------------------
  // Fetch Audit logs
  // ---------------------------------------------------------------------------

  const auditLogs =
    tab === 'audit'
      ? await prisma.auditLog.findMany({
          where: {
            barbershopId: barbershop.id,
            ...(acaoFilter ? { action: acaoFilter } : {}),
          },
          take: take + 1,
          orderBy: { createdAt: 'desc' },
        })
      : []

  const hasMoreAudit = auditLogs.length > take
  const auditLogsPage = hasMoreAudit ? auditLogs.slice(0, take) : auditLogs

  // Resolve user names for audit log
  const userIds = [...new Set(auditLogsPage.map((l) => l.userId).filter(Boolean))] as string[]
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : []
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]))

  // Distinct audit actions for filter dropdown
  const distinctActions =
    tab === 'audit'
      ? await prisma.auditLog
          .findMany({
            where: { barbershopId: barbershop.id },
            select: { action: true },
            distinct: ['action'],
            orderBy: { action: 'asc' },
          })
          .then((rows) => rows.map((r) => r.action))
      : []

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tabClasses = (active: boolean) =>
    cn(
      'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
      active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
    )

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border">
        <Link
          href={`/dashboard/configuracoes/logs?tab=ia`}
          className={tabClasses(tab === 'ia')}
        >
          <span className="flex items-center gap-1.5">
            <ActivityIcon className="size-3.5" />
            Ações de IA
          </span>
        </Link>
        <Link
          href={`/dashboard/configuracoes/logs?tab=audit`}
          className={tabClasses(tab === 'audit')}
        >
          <span className="flex items-center gap-1.5">
            <ShieldIcon className="size-3.5" />
            Auditoria
          </span>
        </Link>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* AI ACTIONS TAB                                                     */}
      {/* ------------------------------------------------------------------ */}
      {tab === 'ia' && (
        <div className="space-y-4">
          {/* Filters */}
          <form method="GET" action="/dashboard/configuracoes/logs" className="flex flex-wrap gap-3 items-end">
            <input type="hidden" name="tab" value="ia" />
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Canal</label>
              <select
                name="channel"
                defaultValue={channel ?? ''}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todos</option>
                {AI_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_CONFIG[c]?.label ?? c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={statusFilter ?? ''}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todos</option>
                {AI_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {AI_STATUS_CONFIG[s as AiStatus]?.label ?? s}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Filtrar
            </button>
            {(channel || statusFilter) && (
              <Link
                href="/dashboard/configuracoes/logs?tab=ia"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Limpar
              </Link>
            )}
          </form>

          {/* Table */}
          {aiLogsPage.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ActivityIcon className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Nenhuma ação de IA registrada</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Ações do agente de IA aparecerão aqui.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Quando
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Canal
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Ferramenta
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Confirmação
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Payload
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {aiLogsPage.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className="text-sm text-foreground"
                            title={fmtAbsolute(log.createdAt)}
                          >
                            {fmtRelative(log.createdAt)}
                          </span>
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {fmtAbsolute(log.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            value={log.channel}
                            config={CHANNEL_CONFIG[log.channel]}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-muted rounded px-1.5 py-0.5">
                            {log.toolName}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            value={log.status}
                            config={AI_STATUS_CONFIG[log.status as AiStatus]}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {log.requiresConfirmation ? (
                            <span className="text-foreground">Sim</span>
                          ) : (
                            <span className="text-muted-foreground">Não</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <PayloadCollapsible
                            data={{ input: log.input, output: log.output }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Load more */}
          {hasMoreAi && (
            <div className="flex justify-center">
              <Link
                href={`${baseTabUrl}${channel ? `&channel=${channel}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}&take=${take + 50}`}
                className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Carregar mais
              </Link>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-right">
            Mostrando {aiLogsPage.length} registro{aiLogsPage.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* AUDIT TAB                                                           */}
      {/* ------------------------------------------------------------------ */}
      {tab === 'audit' && (
        <div className="space-y-4">
          {/* Filters */}
          <form method="GET" action="/dashboard/configuracoes/logs" className="flex flex-wrap gap-3 items-end">
            <input type="hidden" name="tab" value="audit" />
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Ação</label>
              <select
                name="acao"
                defaultValue={acaoFilter ?? ''}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todas</option>
                {distinctActions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Filtrar
            </button>
            {acaoFilter && (
              <Link
                href="/dashboard/configuracoes/logs?tab=audit"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Limpar
              </Link>
            )}
          </form>

          {/* Table */}
          {auditLogsPage.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldIcon className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Nenhum registro de auditoria</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Ações administrativas aparecerão aqui.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Quando
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Usuário
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Ação
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Entidade
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground tracking-wider">
                        Payload
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLogsPage.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className="text-sm text-foreground"
                            title={fmtAbsolute(log.createdAt)}
                          >
                            {fmtRelative(log.createdAt)}
                          </span>
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {fmtAbsolute(log.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {log.userId
                            ? (userMap[log.userId] ?? log.userId.slice(0, 8) + '…')
                            : <span className="text-muted-foreground">Sistema</span>}
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-muted rounded px-1.5 py-0.5">
                            {log.action}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {log.entity}
                          {log.entityId && (
                            <span className="ml-1 text-xs opacity-60">
                              #{log.entityId.slice(0, 6)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <PayloadCollapsible data={log.payload} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Load more */}
          {hasMoreAudit && (
            <div className="flex justify-center">
              <Link
                href={`${baseTabUrl}${acaoFilter ? `&acao=${acaoFilter}` : ''}&take=${take + 50}`}
                className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Carregar mais
              </Link>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-right">
            Mostrando {auditLogsPage.length} registro{auditLogsPage.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
