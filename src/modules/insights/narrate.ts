import 'server-only'
import { prisma } from '@/lib/prisma'
import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai'
import { getRedis } from '@/lib/redis'
import { getDashboardKpis, subtractDays } from './queries'
import type { AiResult } from '@/modules/ai/types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function shopToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Count customers with no non-cancelled appointment in the last N days. */
async function countInactiveCustomers(tenantId: string, days: number, today: string): Promise<number> {
  const cutoff = subtractDays(today, days)

  const [activeCustomers, allCustomers] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId: tenantId,
        date: { gte: cutoff },
        status: { not: 'CANCELLED' },
      },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
    prisma.customer.count({ where: { barbershopId: tenantId } }),
  ])

  return allCustomers - activeCustomers.length
}

// ---------------------------------------------------------------------------
// getInsightsSummary
// ---------------------------------------------------------------------------

const CACHE_KEY = (tenantId: string) => `insights:${tenantId}`
const CACHE_TTL = 3600 // 1 hour

/**
 * Returns an AI-narrated summary of the barbershop's key metrics.
 * Results are cached in Redis for 1 hour.
 * Returns an error Result when OpenAI is not configured or on failure.
 */
export async function getInsightsSummary(
  tenantId: string,
): Promise<AiResult<{ text: string; computedAt: string }>> {
  if (!isOpenAIConfigured()) {
    return { ok: false, error: 'Serviço de IA não configurado. Configure OPENAI_API_KEY para ver insights.' }
  }

  // Try cache first
  try {
    const redis = getRedis()
    const cached = await redis.get(CACHE_KEY(tenantId))
    if (cached) {
      const parsed = JSON.parse(cached) as { text: string; computedAt: string }
      return { ok: true, data: parsed }
    }
  } catch {
    // Redis unavailable — proceed without cache
  }

  // Aggregate metrics
  try {
    const shop = await prisma.barbershop.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })
    if (!shop) return { ok: false, error: 'Barbearia não encontrada.' }

    const today = shopToday(shop.timezone)
    const [kpis, inactiveCount] = await Promise.all([
      getDashboardKpis(tenantId),
      countInactiveCustomers(tenantId, 45, today),
    ])

    const metricsPayload = {
      data: today,
      agendamentosHoje: kpis.todayCount,
      agendamentosSemana: kpis.weekCount,
      receitaHoje: kpis.todayRevenueCents,
      receitaSemana: kpis.weekRevenueCents,
      ocupacaoPct: kpis.occupancyPct,
      taxaFalta: kpis.noShowRate,
      servicosPopulares: kpis.topServices,
      clientesInativos45dias: inactiveCount,
    }

    // Narrate with OpenAI
    const client = getOpenAIClient()
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Você é um analista de negócios especializado em barbearias. ' +
            'Narre os indicadores fornecidos em 3 a 5 frases em português do Brasil. ' +
            'Use APENAS os números fornecidos no JSON — nunca invente dados. ' +
            'Inclua UMA sugestão acionável ao final. Seja direto e profissional.',
        },
        {
          role: 'user',
          content: `Aqui estão os indicadores atuais da barbearia:\n${JSON.stringify(metricsPayload, null, 2)}\n\nNarre os destaques e dê uma sugestão.`,
        },
      ],
      max_tokens: 300,
      temperature: 0.5,
    })

    const text = response.choices?.[0]?.message?.content ?? ''
    if (!text) {
      return { ok: false, error: 'Resposta vazia da IA.' }
    }

    const result = { text, computedAt: new Date().toISOString() }

    // Cache the result
    try {
      const redis = getRedis()
      await redis.setex(CACHE_KEY(tenantId), CACHE_TTL, JSON.stringify(result))
    } catch {
      // Redis write failure is non-fatal
    }

    return { ok: true, data: result }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao gerar insights.',
    }
  }
}

/**
 * Busts the insights cache for a tenant.
 * Called by the dashboard "Atualizar" action.
 */
export async function bustInsightsCache(tenantId: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(CACHE_KEY(tenantId))
  } catch {
    // Non-fatal
  }
}
