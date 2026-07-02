import { requireOwner } from '@/modules/tenancy/context'
import { BRAND } from '@/lib/brand'
import type { BusinessHours } from '@/modules/tenancy/business-hours'
import { ShopSettingsClient } from './_components/ShopSettingsClient'

export default async function ConfiguracoesPage() {
  const { barbershop } = await requireOwner()

  const publicUrl = `https://${BRAND.domain}/${barbershop.slug}`

  return (
    <ShopSettingsClient
      barbershop={{
        name: barbershop.name,
        slug: barbershop.slug,
        description: barbershop.description,
        phone: barbershop.phone,
        address: barbershop.address,
        timezone: barbershop.timezone,
        cancellationPolicy: barbershop.cancellationPolicy,
        businessHours: barbershop.businessHours as BusinessHours,
      }}
      publicUrl={publicUrl}
    />
  )
}
