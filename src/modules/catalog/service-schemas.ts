import { z } from 'zod'

export const ServiceSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres.'),
  description: z.string().optional(),
  priceCents: z.number().int().positive('Preço deve ser maior que zero.'),
  durationMin: z
    .number()
    .int()
    .min(5, 'Duração mínima é 5 minutos.')
    .max(480, 'Duração máxima é 480 minutos.'),
})

export const ServicePatchSchema = ServiceSchema.partial()

export type ServiceInput = z.infer<typeof ServiceSchema>
export type ServicePatch = z.infer<typeof ServicePatchSchema>
