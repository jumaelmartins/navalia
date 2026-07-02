import {
  CalendarIcon,
  TrendingUpIcon,
  PercentIcon,
  AlertTriangleIcon,
  ScissorsIcon,
  ClockIcon,
  SparklesIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { requireOnboarded } from '@/modules/tenancy/context'
import { getDashboardKpis } from '@/modules/insights/queries'
import { getInsightsSummary, bustInsightsCache } from '@/modules/insights/narrate'
import { prisma } from '@/lib/prisma'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import { cn } from '@/lib/utils'
import { revalidatePath } from 'next/cache'

// ---------------------------------------------------------------------------
// Server action — bust insights cache
// ---------------------------------------------------------------------------

async function refreshInsightsAction(barbershopId: string) {
  'use server'
  await bustInsightsCache(barbershopId)
  revalidatePath('/dashboard')
}

// ---------------------------------------------------------------------------
// Insights card
// ---------------------------------------------------------------------------

async function InsightsCard({ tenantId, refreshAction }: {
  tenantId: string
  refreshAction: () => Promise<void>
}) {
  const summary = await getInsightsSummary(tenantId)

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Resumo IA</CardTitle>
          </div>
          <form action={refreshAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCwIcon className="size-3" />
              Atualizar
            </button>
          </form>
        </div>
        <CardDescription>Analise gerada pela IA com base nos dados reais</CardDescription>
      </CardHeader>
      <CardContent>
        {summary.ok ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground leading-relaxed">{summary.data.text}</p>
            <p className="text-xs text-muted-foreground/70">
              Gerado em {new Date(summary.data.computedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <SparklesIcon className="mb-2 size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {summary.error.includes('OPENAI_API_KEY')
                ? 'Configure OPENAI_API_KEY para ativar o resumo de IA.'
                : 'Nao foi possivel gerar o resumo agora.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Status labels
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

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string
  value: string
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs font-medium uppercase tracking-wider">
            {title}
          </CardDescription>
          <Icon className="size-4 text-muted-foreground/60" />
        </div>
      </CardHeader>
      <CardContent>
        <span className="font-display text-4xl font-semibold text-primary">{value}</span>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Próximos horários
// ---------------------------------------------------------------------------

type UpcomingAppt = {
  id: string
  startTime: string
  endTime: string
  status: string
  customer: { name: string }
  service: { name: string }
  professional: { name: string }
}

function UpcomingList({ appointments }: { appointments: UpcomingAppt[] }) {
  if (appointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <CalendarIcon className="mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Nenhum agendamento hoje</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Acesse a Agenda para criar novos horários.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {appointments.map(appt => (
        <li key={appt.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{appt.customer.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {appt.service.name} · {appt.professional.name}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-sm font-medium text-foreground">
              {appt.startTime}
            </span>
            <Badge className={cn('text-xs font-medium', STATUS_STYLES[appt.status])}>
              {STATUS_LABELS[appt.status] ?? appt.status}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Top services list
// ---------------------------------------------------------------------------

function TopServicesList({
  services,
}: {
  services: { name: string; count: number }[]
}) {
  if (services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ScissorsIcon className="mb-3 size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Sem dados ainda</p>
      </div>
    )
  }

  const max = services[0]?.count ?? 1

  return (
    <ul className="space-y-3">
      {services.map((svc, i) => (
        <li key={svc.name} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium truncate">{svc.name}</span>
            <span className="ml-2 shrink-0 text-muted-foreground">{svc.count}x</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((svc.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const { barbershop } = await requireOnboarded()

  // Bind the server action to this tenant
  const boundRefreshAction = refreshInsightsAction.bind(null, barbershop.id)

  // Current date/time in shop timezone for upcoming appointments
  const shopToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: barbershop.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const shopNowHHmm = (() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: barbershop.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const h = parts.find(p => p.type === 'hour')?.value ?? '00'
    const m = parts.find(p => p.type === 'minute')?.value ?? '00'
    const hour = h === '24' ? 0 : parseInt(h, 10)
    return `${String(hour).padStart(2, '0')}:${m}`
  })()

  // Fetch KPIs and upcoming appointments in parallel
  const [kpis, upcomingAppts] = await Promise.all([
    getDashboardKpis(barbershop.id),
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershop.id,
        date: shopToday,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startTime: { gte: shopNowHHmm },
      },
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        professional: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 5,
    }),
  ])

  // Format display date
  const displayDate = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: barbershop.timezone,
  }).format(new Date())

  const displayDateCap = displayDate.charAt(0).toUpperCase() + displayDate.slice(1)

  return (
    <main className="p-6 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">{displayDateCap}</p>
      </div>

      {/* KPI cards */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-foreground">Visão geral</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            title="Hoje"
            value={String(kpis.todayCount)}
            subtitle="agendamentos"
            icon={CalendarIcon}
          />
          <KpiCard
            title="Semana"
            value={String(kpis.weekCount)}
            subtitle="agendamentos"
            icon={TrendingUpIcon}
          />
          <KpiCard
            title="Receita hoje"
            value={formatCentsToBRL(kpis.todayRevenueCents)}
            subtitle="confirmados + concluídos"
            icon={TrendingUpIcon}
          />
          <KpiCard
            title="Receita semana"
            value={formatCentsToBRL(kpis.weekRevenueCents)}
            subtitle="confirmados + concluídos"
            icon={TrendingUpIcon}
          />
          <KpiCard
            title="Ocupação"
            value={`${kpis.occupancyPct}%`}
            subtitle="da semana atual"
            icon={PercentIcon}
          />
          <KpiCard
            title="Faltas"
            value={`${kpis.noShowRate}%`}
            subtitle="últimos 30 dias"
            icon={AlertTriangleIcon}
          />
        </div>
      </section>

      {/* Two-column section: upcoming + top services */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Upcoming appointments */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClockIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Próximos horários</CardTitle>
            </div>
            <CardDescription>Agendamentos de hoje a partir de agora</CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingList appointments={upcomingAppts} />
          </CardContent>
        </Card>

        {/* Top services */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScissorsIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Serviços populares</CardTitle>
            </div>
            <CardDescription>Top 3 dos últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <TopServicesList services={kpis.topServices} />
          </CardContent>
        </Card>
      </div>

      {/* AI insights card */}
      <InsightsCard tenantId={barbershop.id} refreshAction={boundRefreshAction} />
    </main>
  )
}
