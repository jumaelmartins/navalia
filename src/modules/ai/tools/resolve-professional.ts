import { prisma } from '@/lib/prisma'

/**
 * Resolves a professional by fuzzy name match within a tenant (barbershop).
 *
 * Returns `{ id: string }` on a unique match.
 * Returns `{ error: string }` when zero matches or multiple matches are found.
 */
export async function resolveProfessionalByName(
  tenantId: string,
  professionalName: string,
): Promise<{ id: string } | { error: string }> {
  const matches = await prisma.professional.findMany({
    where: {
      barbershopId: tenantId,
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
  return { id: matches[0].id }
}
