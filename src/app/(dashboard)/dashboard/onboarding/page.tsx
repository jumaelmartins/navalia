import { redirect } from 'next/navigation'
import { requireOwner } from '@/modules/tenancy/context'
import { OnboardingWizard } from './_components/OnboardingWizard'

export const metadata = { title: 'Configurar barbearia — Navalia' }

export default async function OnboardingPage() {
  const { barbershop } = await requireOwner()

  // Already onboarded — skip straight to the dashboard
  if (barbershop.onboardingCompleted) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-background">
      <OnboardingWizard
        barbershopName={barbershop.name}
        barbershopSlug={barbershop.slug}
      />
    </div>
  )
}
