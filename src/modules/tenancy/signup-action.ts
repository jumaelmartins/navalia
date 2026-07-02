'use server'

import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify, computeTrialEnd } from '@/modules/tenancy/context'

const SignUpSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres'),
  shopName: z.string().min(2, 'Nome da barbearia deve ter ao menos 2 caracteres'),
})

export type SignUpInput = z.infer<typeof SignUpSchema>

type SignUpResult = { ok: true } | { ok: false; error: string }

export async function signUpBarbershop(input: SignUpInput): Promise<SignUpResult> {
  const parsed = SignUpSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }

  const { name, email, password, shopName } = parsed.data

  // Step 1: create the auth user (Better Auth handles password hashing + session)
  let userId: string
  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
      asResponse: false,
    })
    if (!result?.user?.id) {
      return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
    }
    userId = result.user.id
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 422) {
      return { ok: false, error: 'Este e-mail já está em uso.' }
    }
    console.error('[signUpBarbershop] signUpEmail error', err)
    return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
  }

  // Step 2: compute a unique slug (base → base-2 → base-3 …)
  const baseSlug = slugify(shopName)
  let slug = baseSlug
  let suffix = 2
  while (await prisma.barbershop.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`
  }

  // Step 3: create Barbershop + link user as OWNER + audit log — all in one tx
  try {
    await prisma.$transaction(async (tx) => {
      const barbershop = await tx.barbershop.create({
        data: {
          name: shopName,
          slug,
          subscriptionStatus: 'TRIALING',
          trialEndsAt: computeTrialEnd(new Date()),
          businessHours: {},
        },
      })

      await tx.user.update({
        where: { id: userId },
        data: { role: 'OWNER', barbershopId: barbershop.id },
      })

      await tx.auditLog.create({
        data: {
          barbershopId: barbershop.id,
          userId,
          action: 'SIGNUP',
          entity: 'Barbershop',
          entityId: barbershop.id,
          payload: { name: shopName, slug },
        },
      })
    })

    return { ok: true }
  } catch (err) {
    console.error('[signUpBarbershop] transaction error', err)
    // Compensate: delete the auth user so a retry with the same e-mail works.
    // Session and Account have onDelete: Cascade, so deleting the user is enough.
    try {
      await prisma.user.delete({ where: { id: userId } })
    } catch (deleteErr) {
      console.error('[signUpBarbershop] compensating delete failed', deleteErr)
    }
    return { ok: false, error: 'Erro ao criar barbearia. Tente novamente.' }
  }
}
