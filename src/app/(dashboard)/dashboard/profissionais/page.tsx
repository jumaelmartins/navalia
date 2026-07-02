import type { Metadata } from 'next'
import { requireOnboarded } from '@/modules/tenancy/context'
import { listProfessionals } from '@/modules/catalog/professional-actions'
import { listServices } from '@/modules/catalog/service-actions'
import { ProfessionalsClient } from './_components/ProfessionalsClient'

export const metadata: Metadata = { title: 'Profissionais — Navalia' }

export default async function ProfissionaisPage() {
  await requireOnboarded()

  const [profResult, svcResult] = await Promise.all([listProfessionals(), listServices()])

  const professionals = profResult.data
  const allServices = svcResult.data

  return <ProfessionalsClient professionals={professionals} allServices={allServices} />
}
