'use server'

import { prisma } from '@/lib/prisma'
import { hasAccess } from '@/modules/billing/gate'
import { getAvailableSlots, createAppointment } from './create-appointment'
import { BOOKING_ERROR_PT_BR } from './types'

// ---------------------------------------------------------------------------
// Access rule helper — delegates to billing gate (single source of truth)
// ---------------------------------------------------------------------------

function isShopAccessible(shop: {
  onboardingCompleted: boolean
  subscriptionStatus: Parameters<typeof hasAccess>[0]['subscriptionStatus']
  trialEndsAt: Date
}): boolean {
  if (!shop.onboardingCompleted) return false
  return hasAccess(shop)
}

// ---------------------------------------------------------------------------
// getPublicShop
// ---------------------------------------------------------------------------

export type PublicProfessional = {
  id: string
  name: string
  bio: string | null
  avatarUrl: string | null
  serviceIds: string[]
}

export type PublicService = {
  id: string
  name: string
  description: string | null
  priceCents: number
  durationMin: number
  sortOrder: number
}

export type PublicShop = {
  id: string
  name: string
  slug: string
  description: string | null
  phone: string | null
  address: string | null
  logoUrl: string | null
  timezone: string
  businessHours: Record<string, { start: string; end: string } | null>
  cancellationPolicy: string | null
  services: PublicService[]
  professionals: PublicProfessional[]
}

export async function getPublicShop(slug: string): Promise<PublicShop | null> {
  const shop = await prisma.barbershop.findUnique({
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          durationMin: true,
          sortOrder: true,
        },
      },
      professionals: {
        where: { isActive: true },
        include: {
          services: {
            select: { serviceId: true },
          },
        },
      },
    },
  })

  if (!shop) return null
  if (!isShopAccessible(shop)) return null

  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    description: shop.description,
    phone: shop.phone,
    address: shop.address,
    logoUrl: shop.logoUrl,
    timezone: shop.timezone,
    businessHours: shop.businessHours as Record<string, { start: string; end: string } | null>,
    cancellationPolicy: shop.cancellationPolicy,
    services: shop.services,
    professionals: shop.professionals.map(p => ({
      id: p.id,
      name: p.name,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      serviceIds: p.services.map(s => s.serviceId),
    })),
  }
}

// ---------------------------------------------------------------------------
// getPublicSlots
// ---------------------------------------------------------------------------

type SlotsResult =
  | { ok: true; data: { professionalId: string; slots: string[] }[] }
  | { ok: false; error: string }

export async function getPublicSlots(args: {
  slug: string
  serviceId: string
  professionalId: string | null
  date: string
}): Promise<SlotsResult> {
  try {
    const shop = await prisma.barbershop.findUnique({
      where: { slug: args.slug },
      select: {
        id: true,
        onboardingCompleted: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    })

    if (!shop || !isShopAccessible(shop)) {
      return { ok: false, error: 'Página indisponível.' }
    }

    const result = await getAvailableSlots({
      tenantId: shop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
    })

    if (!result.ok) {
      return { ok: false, error: BOOKING_ERROR_PT_BR[result.error] }
    }

    return { ok: true, data: result.data }
  } catch (err) {
    console.error('[getPublicSlots]', err)
    return { ok: false, error: 'Erro ao buscar horários. Tente novamente.' }
  }
}

// ---------------------------------------------------------------------------
// createPublicAppointment
// ---------------------------------------------------------------------------

type AppointmentResult =
  | {
      ok: true
      data: {
        appointmentId: string
        endTime: string
        professionalName: string
        serviceName: string
      }
    }
  | { ok: false; error: string; slotTaken?: boolean }

export async function createPublicAppointment(args: {
  slug: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; cpf: string; phone: string; email?: string }
  consent: boolean
}): Promise<AppointmentResult> {
  try {
    const shop = await prisma.barbershop.findUnique({
      where: { slug: args.slug },
      select: {
        id: true,
        onboardingCompleted: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    })

    if (!shop || !isShopAccessible(shop)) {
      return { ok: false, error: 'Página indisponível.' }
    }

    const result = await createAppointment({
      tenantId: shop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
      startTime: args.startTime,
      customer: args.customer,
      source: 'PUBLIC_PAGE',
      consent: args.consent,
    })

    if (!result.ok) {
      return {
        ok: false,
        error: BOOKING_ERROR_PT_BR[result.error],
        slotTaken: result.error === 'SLOT_TAKEN',
      }
    }

    return { ok: true, data: result.data }
  } catch (err) {
    console.error('[createPublicAppointment]', err)
    return { ok: false, error: 'Erro ao criar agendamento. Tente novamente.' }
  }
}
