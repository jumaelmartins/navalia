import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import {
  getAvailableSlots,
  cancelAppointment as engineCancelAppointment,
} from '@/modules/booking/create-appointment'
import {
  getWeekStart,
  getWeekEnd,
  subtractDays,
} from '@/modules/insights/queries'
import { resolveProfessionalByName } from './resolve-professional'
import type { ToolDef, ToolCtx } from '../types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ShopCtx = { id: string; timezone: string }

/** Returns "YYYY-MM-DD" for today in the shop's timezone. */
function shopToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Returns the first and last day of the current month in the shop's timezone. */
function getMonthRange(today: string): { start: string; end: string } {
  const [y, m] = today.split('-').map(Number)
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

/** Returns date range based on period relative to today. */
function getDateRange(
  period: 'day' | 'week' | 'month',
  today: string,
): { start: string; end: string } {
  if (period === 'day') return { start: today, end: today }
  if (period === 'week') return { start: getWeekStart(today), end: getWeekEnd(today) }
  return getMonthRange(today)
}

// ---------------------------------------------------------------------------
// buildCopilotTools
// ---------------------------------------------------------------------------

/**
 * Returns the full copilot ToolDef set.
 * BARBER role: read tools only (no sensitive tools).
 * OWNER role: read + sensitive tools.
 */
export function buildCopilotTools(shopCtx: ShopCtx, role: 'OWNER' | 'BARBER'): ToolDef[] {
  const tenantId = shopCtx.id
  const timezone = shopCtx.timezone

  // -------------------------------------------------------------------------
  // READ TOOLS — both roles
  // -------------------------------------------------------------------------

  const readTools: ToolDef[] = [
    // -----------------------------------------------------------------------
    // 1. getAppointmentsByDate
    // -----------------------------------------------------------------------
    {
      name: 'getAppointmentsByDate',
      description:
        'Lista os agendamentos de uma data específica com horários, clientes, serviços e status. Pode filtrar por profissional.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD',
          },
          professionalName: {
            type: 'string',
            description: 'Nome parcial do profissional para filtrar (opcional)',
          },
        },
        required: ['date'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          professionalName: z.string().optional(),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { date, professionalName } = parsed.data

        try {
          let professionalId: string | undefined
          if (professionalName) {
            const resolved = await resolveProfessionalByName(ctx.tenantId, professionalName)
            if ('error' in resolved) return { error: resolved.error }
            professionalId = resolved.id
          }

          const appointments = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date,
              ...(professionalId ? { professionalId } : {}),
              status: { notIn: ['CANCELLED'] },
            },
            include: {
              customer: { select: { name: true, phone: true } },
              professional: { select: { name: true } },
              service: { select: { name: true, priceCents: true } },
            },
            orderBy: [{ startTime: 'asc' }],
          })

          if (appointments.length === 0) {
            return { message: `Nenhum agendamento encontrado para ${date}.`, appointments: [] }
          }

          return {
            date,
            total: appointments.length,
            appointments: appointments.map(a => ({
              id: a.id,
              startTime: a.startTime,
              endTime: a.endTime,
              status: a.status,
              customer: a.customer.name,
              phone: a.customer.phone,
              professional: a.professional.name,
              service: a.service.name,
              price: formatCentsToBRL(a.service.priceCents),
            })),
          }
        } catch (err) {
          return { error: `Erro ao buscar agendamentos: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 2. getRevenueSummary
    // -----------------------------------------------------------------------
    {
      name: 'getRevenueSummary',
      description:
        'Retorna o faturamento (agendamentos CONFIRMED+COMPLETED) para o período: "day" = hoje, "week" = semana atual, "month" = mês atual.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description: 'Período de análise',
          },
        },
        required: ['period'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({ period: z.enum(['day', 'week', 'month']) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { period } = parsed.data

        try {
          const today = shopToday(timezone)
          const { start, end } = getDateRange(period, today)

          const appointments = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date: { gte: start, lte: end },
              status: { in: ['CONFIRMED', 'COMPLETED'] },
            },
            select: {
              status: true,
              service: { select: { priceCents: true } },
            },
          })

          const totalCents = appointments.reduce((s, a) => s + a.service.priceCents, 0)
          const confirmedCount = appointments.filter(a => a.status === 'CONFIRMED').length
          const completedCount = appointments.filter(a => a.status === 'COMPLETED').length

          const PERIOD_LABEL: Record<string, string> = { day: 'hoje', week: 'esta semana', month: 'este mês' }

          return {
            period: PERIOD_LABEL[period],
            dateRange: { start, end },
            totalRevenue: formatCentsToBRL(totalCents),
            totalRevenueCents: totalCents,
            confirmedAppointments: confirmedCount,
            completedAppointments: completedCount,
            totalAppointments: appointments.length,
          }
        } catch (err) {
          return { error: `Erro ao calcular faturamento: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 3. getTopServices
    // -----------------------------------------------------------------------
    {
      name: 'getTopServices',
      description:
        'Lista os serviços mais agendados no período ("day", "week" ou "month"), com contagem de agendamentos.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description: 'Período de análise',
          },
        },
        required: ['period'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({ period: z.enum(['day', 'week', 'month']) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { period } = parsed.data

        try {
          const today = shopToday(timezone)
          const { start, end } = getDateRange(period, today)

          const appointments = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date: { gte: start, lte: end },
              status: { not: 'CANCELLED' },
            },
            select: { service: { select: { name: true } } },
          })

          const svcMap = new Map<string, number>()
          for (const a of appointments) {
            const name = a.service.name
            svcMap.set(name, (svcMap.get(name) ?? 0) + 1)
          }

          const PERIOD_LABEL: Record<string, string> = { day: 'hoje', week: 'esta semana', month: 'este mês' }

          return {
            period: PERIOD_LABEL[period],
            topServices: Array.from(svcMap.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([name, count]) => ({ name, count })),
          }
        } catch (err) {
          return { error: `Erro ao buscar serviços: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 4. getInactiveCustomers
    // -----------------------------------------------------------------------
    {
      name: 'getInactiveCustomers',
      description:
        'Lista clientes que não tiveram nenhum agendamento (exceto cancelados) nos últimos N dias. Padrão: 45 dias.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Número de dias de inatividade (padrão 45)',
          },
        },
        required: [],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({ days: z.number().int().min(1).max(365).default(45) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { days } = parsed.data

        try {
          const today = shopToday(timezone)
          const cutoff = subtractDays(today, days)

          // Find customers who had at least one appointment (non-cancelled) after cutoff
          const activeCustomers = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date: { gte: cutoff },
              status: { not: 'CANCELLED' },
            },
            select: { customerId: true },
            distinct: ['customerId'],
          })
          const activeIds = new Set(activeCustomers.map(a => a.customerId))

          // All customers of the shop
          const allCustomers = await prisma.customer.findMany({
            where: { barbershopId: ctx.tenantId },
            select: { id: true, name: true, phone: true },
            orderBy: { name: 'asc' },
          })

          const inactive = allCustomers.filter(c => !activeIds.has(c.id))

          return {
            days,
            cutoffDate: cutoff,
            inactiveCount: inactive.length,
            customers: inactive.slice(0, 50).map(c => ({ name: c.name, phone: c.phone })),
          }
        } catch (err) {
          return { error: `Erro ao buscar clientes inativos: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 5. getNoShows
    // -----------------------------------------------------------------------
    {
      name: 'getNoShows',
      description:
        'Lista os agendamentos com status NO_SHOW (não compareceu) no período ("day", "week" ou "month").',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description: 'Período de análise',
          },
        },
        required: ['period'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({ period: z.enum(['day', 'week', 'month']) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { period } = parsed.data

        try {
          const today = shopToday(timezone)
          const { start, end } = getDateRange(period, today)

          const appointments = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date: { gte: start, lte: end },
              status: 'NO_SHOW',
            },
            include: {
              customer: { select: { name: true, phone: true } },
              professional: { select: { name: true } },
              service: { select: { name: true } },
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
          })

          const PERIOD_LABEL: Record<string, string> = { day: 'hoje', week: 'esta semana', month: 'este mês' }

          return {
            period: PERIOD_LABEL[period],
            noShowCount: appointments.length,
            appointments: appointments.map(a => ({
              date: a.date,
              startTime: a.startTime,
              customer: a.customer.name,
              phone: a.customer.phone,
              professional: a.professional.name,
              service: a.service.name,
            })),
          }
        } catch (err) {
          return { error: `Erro ao buscar faltas: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 6. getFreeSlots
    // -----------------------------------------------------------------------
    {
      name: 'getFreeSlots',
      description:
        'Consulta horários livres para uma data. Se serviceId não for informado, usa o serviço ativo mais curto para granularidade de slots. Pode filtrar por profissional.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD',
          },
          professionalName: {
            type: 'string',
            description: 'Nome parcial do profissional para filtrar (opcional)',
          },
          serviceId: {
            type: 'string',
            description: 'ID do serviço para granularidade de slots (opcional)',
          },
        },
        required: ['date'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          professionalName: z.string().optional(),
          serviceId: z.string().optional(),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { date, professionalName, serviceId: serviceIdArg } = parsed.data

        try {
          let professionalId: string | null = null
          if (professionalName) {
            const resolved = await resolveProfessionalByName(ctx.tenantId, professionalName)
            if ('error' in resolved) return { error: resolved.error }
            professionalId = resolved.id
          }

          // If no serviceId, use shortest active service for slot granularity
          let resolvedServiceId = serviceIdArg
          if (!resolvedServiceId) {
            const shortest = await prisma.service.findFirst({
              where: { barbershopId: ctx.tenantId, isActive: true },
              orderBy: { durationMin: 'asc' },
              select: { id: true, name: true, durationMin: true },
            })
            if (!shortest) return { error: 'Nenhum serviço ativo encontrado.' }
            resolvedServiceId = shortest.id
          }

          const result = await getAvailableSlots({
            tenantId: ctx.tenantId,
            serviceId: resolvedServiceId,
            professionalId,
            date,
          })

          if (!result.ok) {
            return { error: `Erro ao buscar horários: ${result.error}` }
          }

          // Fetch professional names
          const profIds = result.data.map(r => r.professionalId)
          const profMap = new Map<string, string>()
          if (profIds.length > 0) {
            const profs = await prisma.professional.findMany({
              where: { id: { in: profIds }, barbershopId: ctx.tenantId },
              select: { id: true, name: true },
            })
            profs.forEach(p => profMap.set(p.id, p.name))
          }

          return {
            date,
            slots: result.data.map(r => ({
              professional: profMap.get(r.professionalId) ?? r.professionalId,
              availableSlots: r.slots,
              slotCount: r.slots.length,
            })),
          }
        } catch (err) {
          return { error: `Erro ao buscar horários livres: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },
  ]

  // -------------------------------------------------------------------------
  // SENSITIVE TOOLS — OWNER only
  // -------------------------------------------------------------------------

  const sensitiveTools: ToolDef[] = [
    // -----------------------------------------------------------------------
    // 7. blockSchedule
    // -----------------------------------------------------------------------
    {
      name: 'blockSchedule',
      description:
        'Bloqueia um intervalo de horário na agenda de um profissional em uma data específica. ' +
        'Exemplo de resumo para confirmação: "Bloquear agenda de [profissional] em [data] das [startTime] às [endTime] — motivo: [reason]".',
      parameters: {
        type: 'object',
        properties: {
          professionalName: {
            type: 'string',
            description: 'Nome do profissional',
          },
          date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD',
          },
          startTime: {
            type: 'string',
            description: 'Horário de início no formato HH:mm',
          },
          endTime: {
            type: 'string',
            description: 'Horário de fim no formato HH:mm',
          },
          reason: {
            type: 'string',
            description: 'Motivo do bloqueio (opcional)',
          },
        },
        required: ['professionalName', 'date', 'startTime', 'endTime'],
      },
      sensitive: true,
      async execute(args: unknown, ctx: ToolCtx) {
        const timeRegex = /^\d{2}:\d{2}$/
        const schema = z.object({
          professionalName: z.string().min(1, 'Nome do profissional é obrigatório'),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          startTime: z.string().regex(timeRegex, 'startTime deve estar no formato HH:mm'),
          endTime: z.string().regex(timeRegex, 'endTime deve estar no formato HH:mm'),
          reason: z.string().optional(),
        }).refine(d => d.startTime < d.endTime, {
          message: 'startTime deve ser anterior a endTime',
          path: ['startTime'],
        })

        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { professionalName, date, startTime, endTime, reason } = parsed.data

        try {
          const resolved = await resolveProfessionalByName(ctx.tenantId, professionalName)
          if ('error' in resolved) return { error: resolved.error }

          const block = await prisma.scheduleBlock.create({
            data: {
              barbershopId: ctx.tenantId,
              professionalId: resolved.id,
              date,
              startTime,
              endTime,
              reason: reason ?? null,
              source: 'COPILOT',
            },
          })

          return {
            success: true,
            blockId: block.id,
            professional: professionalName,
            date,
            startTime,
            endTime,
            reason: reason ?? null,
          }
        } catch (err) {
          return { error: `Erro ao bloquear agenda: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 8. unblockSchedule
    // -----------------------------------------------------------------------
    {
      name: 'unblockSchedule',
      description:
        'Remove um bloqueio de agenda de um profissional em uma data. ' +
        'Se houver múltiplos bloqueios na data, informe startTime para especificar qual remover. ' +
        'Exemplo de resumo: "Desbloquear agenda de [profissional] em [data] às [startTime]".',
      parameters: {
        type: 'object',
        properties: {
          professionalName: {
            type: 'string',
            description: 'Nome do profissional',
          },
          date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD',
          },
          startTime: {
            type: 'string',
            description: 'Horário de início do bloqueio (HH:mm), para identificar um bloqueio específico quando há mais de um na data',
          },
        },
        required: ['professionalName', 'date'],
      },
      sensitive: true,
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          professionalName: z.string().min(1, 'Nome do profissional é obrigatório'),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          startTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/, 'startTime deve estar no formato HH:mm')
            .optional(),
        })

        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { professionalName, date, startTime } = parsed.data

        try {
          const resolved = await resolveProfessionalByName(ctx.tenantId, professionalName)
          if ('error' in resolved) return { error: resolved.error }

          const blocks = await prisma.scheduleBlock.findMany({
            where: {
              barbershopId: ctx.tenantId,
              professionalId: resolved.id,
              date,
              ...(startTime ? { startTime } : {}),
            },
            orderBy: { startTime: 'asc' },
          })

          if (blocks.length === 0) {
            return { error: `Nenhum bloqueio encontrado para ${professionalName} em ${date}${startTime ? ` às ${startTime}` : ''}.` }
          }

          if (blocks.length > 1) {
            const list = blocks.map(b => `${b.startTime}–${b.endTime}${b.reason ? ` (${b.reason})` : ''}`).join(', ')
            return {
              error: `Múltiplos bloqueios encontrados em ${date}: ${list}. Especifique o startTime para remover apenas um.`,
            }
          }

          await prisma.scheduleBlock.delete({ where: { id: blocks[0].id } })

          return {
            success: true,
            removedBlock: {
              professional: professionalName,
              date,
              startTime: blocks[0].startTime,
              endTime: blocks[0].endTime,
            },
          }
        } catch (err) {
          return { error: `Erro ao desbloquear agenda: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 9. cancelAppointment (copilot)
    // -----------------------------------------------------------------------
    {
      name: 'cancelAppointment',
      description:
        'Cancela um agendamento identificado por data e horário de início. ' +
        'Pode filtrar por nome de profissional para resolver ambiguidades. ' +
        'Exemplo de resumo: "Cancelar agendamento de [cliente] em [data] às [startTime] com [professional]".',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data do agendamento no formato YYYY-MM-DD',
          },
          startTime: {
            type: 'string',
            description: 'Horário de início no formato HH:mm',
          },
          professionalName: {
            type: 'string',
            description: 'Nome do profissional para resolver ambiguidades (opcional)',
          },
        },
        required: ['date', 'startTime'],
      },
      sensitive: true,
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime deve estar no formato HH:mm'),
          professionalName: z.string().optional(),
        })

        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return { error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}` }
        }
        const { date, startTime, professionalName } = parsed.data

        try {
          let professionalId: string | undefined
          if (professionalName) {
            const resolved = await resolveProfessionalByName(ctx.tenantId, professionalName)
            if ('error' in resolved) return { error: resolved.error }
            professionalId = resolved.id
          }

          const matches = await prisma.appointment.findMany({
            where: {
              barbershopId: ctx.tenantId,
              date,
              startTime,
              status: { in: ['PENDING', 'CONFIRMED'] },
              ...(professionalId ? { professionalId } : {}),
            },
            include: {
              customer: { select: { name: true } },
              professional: { select: { name: true } },
              service: { select: { name: true } },
            },
          })

          if (matches.length === 0) {
            return { error: `Nenhum agendamento PENDING ou CONFIRMED encontrado em ${date} às ${startTime}.` }
          }

          if (matches.length > 1) {
            const list = matches
              .map(a => `${a.customer.name} / ${a.professional.name} — ${a.service.name}`)
              .join('; ')
            return {
              error: `Múltiplos agendamentos em ${date} às ${startTime}: ${list}. Especifique o professionalName para resolver.`,
            }
          }

          const appt = matches[0]
          const result = await engineCancelAppointment({
            tenantId: ctx.tenantId,
            appointmentId: appt.id,
            by: `COPILOT:${ctx.userId ?? 'unknown'}`,
          })

          if (!result.ok) {
            return { error: `Erro ao cancelar agendamento: ${result.error}` }
          }

          return {
            success: true,
            cancelled: {
              customer: appt.customer.name,
              professional: appt.professional.name,
              service: appt.service.name,
              date,
              startTime,
            },
          }
        } catch (err) {
          return { error: `Erro ao cancelar agendamento: ${err instanceof Error ? err.message : 'erro desconhecido'}` }
        }
      },
    },
  ]

  if (role === 'OWNER') {
    return [...readTools, ...sensitiveTools]
  }
  return readTools
}
