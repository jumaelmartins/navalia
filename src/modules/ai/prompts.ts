import type { Channel } from './types'

type ShopInfo = {
  name: string
  businessHours: Record<string, { start: string; end: string } | null>
  cancellationPolicy?: string | null
  address?: string | null
  phone?: string | null
}

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function formatBusinessHours(
  bh: Record<string, { start: string; end: string } | null>,
): string {
  return Object.entries(bh)
    .map(([k, v]) => {
      const day = DAY_NAMES[parseInt(k)] ?? k
      return v ? `${day}: ${v.start} às ${v.end}` : `${day}: fechado`
    })
    .join('\n')
}

/**
 * Builds the system prompt for the public-facing AI assistant.
 *
 * @param shop      Barbershop data (name, businessHours, etc.)
 * @param channel   Communication channel
 * @param today     Shop-local date string "YYYY-MM-DD" (caller computes it)
 */
export function publicSystemPrompt(
  shop: ShopInfo,
  channel: Channel,
  today: string,
): string {
  const isWhatsApp = channel === 'WHATSAPP'
  const hoursBlock = formatBusinessHours(
    shop.businessHours as Record<string, { start: string; end: string } | null>,
  )

  const toneGuide = isWhatsApp
    ? 'Responda de forma curta e direta, adequada para WhatsApp. Use linguagem amigável e informal, sem blocos longos de texto.'
    : 'Seja simpático, objetivo e profissional.'

  const addressLine = shop.address ? `Endereço: ${shop.address}` : ''
  const phoneLine = shop.phone ? `Telefone: ${shop.phone}` : ''
  const cancelLine = shop.cancellationPolicy
    ? `Política de cancelamento: ${shop.cancellationPolicy}`
    : ''

  const shopDetails = [addressLine, phoneLine, cancelLine].filter(Boolean).join('\n')

  return `Você é o assistente virtual da barbearia *${shop.name}*. ${toneGuide}

HOJE É: ${today}

HORÁRIOS DE FUNCIONAMENTO:
${hoursBlock}
${shopDetails ? '\nINFORMAÇÕES DA BARBEARIA:\n' + shopDetails : ''}

REGRAS OBRIGATÓRIAS — siga sempre, sem exceção:
1. Responda APENAS assuntos relacionados à barbearia: serviços, preços, horários, disponibilidade e agendamentos.
2. NUNCA invente horários disponíveis — use sempre a ferramenta getSlots para consultar disponibilidade real.
3. SEMPRE pergunte o nome do cliente antes de iniciar um agendamento (se ainda não souber).
4. NUNCA chame createAppointment sem que o cliente tenha confirmado explicitamente. Antes de agendar, apresente um resumo com serviço, data, hora e profissional, e aguarde a confirmação.
5. Para temas fora da barbearia (política, receitas, tecnologia etc.), redirecione educadamente: "Posso ajudar apenas com informações e agendamentos da ${shop.name}. Posso fazer algo por você?"
6. Se o cliente pedir para falar com um humano/atendente, inclua obrigatoriamente o marcador [HUMANO] na resposta.

FLUXO DE AGENDAMENTO:
• Use getServices para listar serviços disponíveis.
• Pergunte o nome do cliente (se não souber ainda).
• Use getSlots para consultar horários (informe serviceId e data no formato YYYY-MM-DD).
• Mostre as opções ao cliente.
• Apresente resumo completo e peça confirmação explícita.
• Somente após confirmação, chame createAppointment com confirmed: true.`
}
