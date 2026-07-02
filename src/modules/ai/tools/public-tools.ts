import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import {
  getAvailableSlots,
  createAppointment as engineCreateAppointment,
  cancelAppointment as engineCancelAppointment,
} from '@/modules/booking/create-appointment'
import type { ToolDef, ToolCtx } from '../types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DAY_NAMES_FULL = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

function formatBusinessHoursReadable(
  bh: Record<string, { start: string; end: string } | null>,
): string {
  return Object.entries(bh)
    .map(([k, v]) => {
      const day = DAY_NAMES_FULL[parseInt(k)] ?? k
      return v ? `${day}: ${v.start} às ${v.end}` : `${day}: fechado`
    })
    .join('; ')
}

function mapEngineError(error: string): string {
  switch (error) {
    case 'SLOT_TAKEN':
      return 'Este horário já foi reservado. Por favor, escolha outro horário (use getSlots para ver opções).'
    case 'INVALID_SERVICE':
      return 'Serviço inválido. Use getServices para ver os serviços disponíveis.'
    case 'INVALID_PROFESSIONAL':
      return 'Profissional não disponível para este serviço. Use getSlots para ver profissionais disponíveis.'
    case 'OUTSIDE_AVAILABILITY':
      return 'Este horário não está dentro da disponibilidade. Use getSlots para ver horários válidos.'
    case 'INVALID_PHONE':
      return 'Número de telefone inválido. Informe um número com DDD (10 a 13 dígitos).'
    case 'NOT_FOUND':
      return 'Agendamento não encontrado.'
    default:
      return 'Erro ao processar a solicitação. Por favor, tente novamente.'
  }
}

// ---------------------------------------------------------------------------
// buildPublicTools
// ---------------------------------------------------------------------------

/**
 * Returns the full set of public-facing ToolDef objects.
 * All tools resolve the tenant from ctx (never from model output).
 */
export function buildPublicTools(): ToolDef[] {
  return [
    // -----------------------------------------------------------------------
    // 1. getServices
    // -----------------------------------------------------------------------
    {
      name: 'getServices',
      description:
        'Lista os serviços ativos da barbearia com id, nome, preço em BRL e duração em minutos.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(_args: unknown, ctx: ToolCtx) {
        try {
          const services = await prisma.service.findMany({
            where: { barbershopId: ctx.tenantId, isActive: true },
            select: { id: true, name: true, priceCents: true, durationMin: true },
            orderBy: { sortOrder: 'asc' },
          })
          return services.map(s => ({
            id: s.id,
            name: s.name,
            price: formatCentsToBRL(s.priceCents),
            durationMin: s.durationMin,
          }))
        } catch (err) {
          return {
            error: `Erro ao buscar serviços: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 2. getBusinessInfo
    // -----------------------------------------------------------------------
    {
      name: 'getBusinessInfo',
      description:
        'Retorna informações gerais da barbearia: nome, endereço, telefone, horários de funcionamento e política de cancelamento.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(_args: unknown, ctx: ToolCtx) {
        try {
          const shop = await prisma.barbershop.findUnique({
            where: { id: ctx.tenantId },
            select: {
              name: true,
              address: true,
              phone: true,
              businessHours: true,
              cancellationPolicy: true,
            },
          })
          if (!shop) return { error: 'Barbearia não encontrada.' }
          return {
            name: shop.name,
            address: shop.address ?? 'Não informado',
            phone: shop.phone ?? 'Não informado',
            businessHours: formatBusinessHoursReadable(
              shop.businessHours as Record<string, { start: string; end: string } | null>,
            ),
            cancellationPolicy: shop.cancellationPolicy ?? 'Não informado',
          }
        } catch (err) {
          return {
            error: `Erro ao buscar informações da barbearia: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 3. getSlots
    // -----------------------------------------------------------------------
    {
      name: 'getSlots',
      description:
        'Consulta horários disponíveis para um serviço em uma data. Retorna lista de horários por profissional.',
      parameters: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', description: 'ID do serviço (obtenha via getServices)' },
          date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD (use a data de hoje ou futura)',
          },
          professionalName: {
            type: 'string',
            description:
              'Nome parcial do profissional (opcional). Busca case-insensitive por conteúdo.',
          },
        },
        required: ['serviceId', 'date'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          serviceId: z.string().min(1, 'serviceId é obrigatório'),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          professionalName: z.string().optional(),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return {
            error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}`,
          }
        }
        const { serviceId, date, professionalName } = parsed.data

        try {
          let professionalId: string | null = null

          if (professionalName) {
            const matches = await prisma.professional.findMany({
              where: {
                barbershopId: ctx.tenantId,
                isActive: true,
                name: { contains: professionalName, mode: 'insensitive' },
              },
              select: { id: true, name: true },
            })

            if (matches.length === 0) {
              return {
                error: `Profissional "${professionalName}" não encontrado. Tente outro nome ou omita para ver todos.`,
              }
            }
            if (matches.length > 1) {
              const names = matches.map(p => p.name).join(', ')
              return {
                error: `Nome ambíguo — profissionais encontrados: ${names}. Por favor, seja mais específico.`,
              }
            }
            professionalId = matches[0].id
          }

          const result = await getAvailableSlots({
            tenantId: ctx.tenantId,
            serviceId,
            professionalId,
            date,
          })

          if (!result.ok) {
            return { error: mapEngineError(result.error) }
          }

          // Fetch professional names to include in the response
          const profIds = result.data.map(r => r.professionalId)
          const profMap = new Map<string, string>()
          if (profIds.length > 0) {
            const profs = await prisma.professional.findMany({
              where: { id: { in: profIds }, barbershopId: ctx.tenantId },
              select: { id: true, name: true },
            })
            profs.forEach(p => profMap.set(p.id, p.name))
          }

          return result.data.map(r => ({
            professionalId: r.professionalId,
            professionalName: profMap.get(r.professionalId) ?? r.professionalId,
            availableSlots: r.slots,
          }))
        } catch (err) {
          return {
            error: `Erro ao consultar horários: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 4. createAppointment
    // -----------------------------------------------------------------------
    {
      name: 'createAppointment',
      description:
        'Cria um agendamento. ATENÇÃO: só chame com confirmed: true após o cliente ter confirmado explicitamente os detalhes (serviço, data, hora, profissional). Nunca presuma confirmação.',
      parameters: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', description: 'ID do serviço' },
          professionalId: { type: 'string', description: 'ID do profissional' },
          date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
          startTime: { type: 'string', description: 'Horário de início no formato HH:mm' },
          customerName: { type: 'string', description: 'Nome do cliente' },
          customerPhone: {
            type: 'string',
            description: 'Telefone do cliente com DDD (obrigatório no canal AI_WEB)',
          },
          confirmed: {
            type: 'boolean',
            description:
              'DEVE ser true — confirma que o cliente revisou e confirmou todos os detalhes do agendamento',
          },
        },
        required: [
          'serviceId',
          'professionalId',
          'date',
          'startTime',
          'customerName',
          'confirmed',
        ],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        const schema = z.object({
          serviceId: z.string().min(1),
          professionalId: z.string().min(1),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
          startTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/, 'Horário deve estar no formato HH:mm'),
          customerName: z.string().min(1, 'Nome do cliente é obrigatório'),
          customerPhone: z.string().optional(),
          confirmed: z.boolean(),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return {
            error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}`,
          }
        }
        const { serviceId, professionalId, date, startTime, customerName, confirmed } =
          parsed.data

        // --- THE GUARD ---
        if (confirmed !== true) {
          return {
            error:
              'NEEDS_CONFIRMATION — faça um resumo dos detalhes (serviço, data, hora, profissional) e aguarde a confirmação explícita do cliente antes de agendar.',
            _requiresConfirmation: true as const,
          }
        }

        // Phone resolution — tenant/phone NEVER from model output in WHATSAPP
        let phone: string
        if (ctx.channel === 'WHATSAPP') {
          if (!ctx.customerPhone) {
            return { error: 'Número de telefone do cliente não disponível nesta conversa.' }
          }
          phone = ctx.customerPhone // always from server context
        } else {
          // AI_WEB: require customerPhone arg
          const rawPhone = parsed.data.customerPhone
          if (!rawPhone) {
            return {
              error:
                'Informe o número de telefone do cliente para concluir o agendamento (com DDD).',
            }
          }
          const digits = rawPhone.replace(/\D/g, '')
          if (digits.length < 10 || digits.length > 13) {
            return {
              error: 'Número de telefone inválido. Informe um número com DDD (10 a 13 dígitos).',
            }
          }
          phone = rawPhone
        }

        const source = ctx.channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI_WEB'

        try {
          const result = await engineCreateAppointment({
            tenantId: ctx.tenantId,
            serviceId,
            professionalId,
            date,
            startTime,
            customer: { name: customerName, phone },
            source,
          })

          if (!result.ok) {
            return { error: mapEngineError(result.error) }
          }

          return {
            success: true,
            appointmentId: result.data.appointmentId,
            service: result.data.serviceName,
            professional: result.data.professionalName,
            date,
            startTime,
            endTime: result.data.endTime,
          }
        } catch (err) {
          return {
            error: `Erro ao criar agendamento: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          }
        }
      },
    },

    // -----------------------------------------------------------------------
    // 5. cancelAppointment
    // -----------------------------------------------------------------------
    {
      name: 'cancelAppointment',
      description:
        'Cancela um agendamento. No canal WHATSAPP cancela o próximo agendamento do cliente (opcionalmente filtrado por data/hora). No canal AI_WEB não é suportado — oriente o cliente a ligar.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Filtro opcional de data (YYYY-MM-DD) para identificar o agendamento',
          },
          startTime: {
            type: 'string',
            description: 'Filtro opcional de horário (HH:mm)',
          },
          confirmed: {
            type: 'boolean',
            description: 'DEVE ser true após o cliente confirmar o cancelamento',
          },
        },
        required: ['confirmed'],
      },
      async execute(args: unknown, ctx: ToolCtx) {
        // AI_WEB limitation
        if (ctx.channel === 'AI_WEB') {
          return {
            error:
              'Cancelamento pelo site: entre em contato com a barbearia diretamente para cancelar seu agendamento.',
          }
        }

        const schema = z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
            .optional(),
          startTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/, 'Horário deve estar no formato HH:mm')
            .optional(),
          confirmed: z.boolean(),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          return {
            error: `Argumentos inválidos: ${parsed.error.issues.map(e => e.message).join(', ')}`,
          }
        }
        const { date, startTime, confirmed } = parsed.data

        if (!ctx.customerPhone) {
          return {
            error: 'Número de telefone do cliente não disponível para buscar agendamentos.',
          }
        }

        try {
          // Find the customer record first by phone
          const customer = await prisma.customer.findFirst({
            where: { barbershopId: ctx.tenantId, phone: ctx.customerPhone },
            select: { id: true },
          })

          if (!customer) {
            return { error: 'Nenhum agendamento encontrado para o seu número.' }
          }

          const appointment = await prisma.appointment.findFirst({
            where: {
              barbershopId: ctx.tenantId,
              customerId: customer.id,
              status: { in: ['PENDING', 'CONFIRMED'] },
              ...(date ? { date } : {}),
              ...(startTime ? { startTime } : {}),
            },
            select: {
              id: true,
              date: true,
              startTime: true,
              service: { select: { name: true } },
              professional: { select: { name: true } },
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
          })

          if (!appointment) {
            return { error: 'Nenhum agendamento futuro encontrado para o seu número.' }
          }

          // --- THE GUARD ---
          if (confirmed !== true) {
            return {
              error: `NEEDS_CONFIRMATION — confirme o cancelamento do agendamento:\nServiço: ${appointment.service.name}\nProfissional: ${appointment.professional.name}\nData: ${appointment.date} às ${appointment.startTime}\n\nResponda "sim" para confirmar o cancelamento.`,
              _requiresConfirmation: true as const,
            }
          }

          const result = await engineCancelAppointment({
            tenantId: ctx.tenantId,
            appointmentId: appointment.id,
            by: `WHATSAPP:${ctx.customerPhone}`,
          })

          if (!result.ok) {
            return { error: mapEngineError(result.error) }
          }

          return {
            success: true,
            message: `Agendamento cancelado: ${appointment.service.name} em ${appointment.date} às ${appointment.startTime}.`,
          }
        } catch (err) {
          return {
            error: `Erro ao cancelar agendamento: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          }
        }
      },
    },
  ]
}
