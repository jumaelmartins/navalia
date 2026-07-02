import type { Metadata } from 'next'
import { requireOnboarded } from '@/modules/tenancy/context'
import { listServices } from '@/modules/catalog/service-actions'
import { ServicesClient } from './_components/ServicesClient'

export const metadata: Metadata = { title: 'Serviços — Navalia' }

export default async function ServicosPage() {
  await requireOnboarded()
  const result = await listServices()
  const services = result.data

  return <ServicesClient services={services} />
}
