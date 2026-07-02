import { redirect } from 'next/navigation'
import { requireMember } from '@/modules/tenancy/context'
import { OnboardingWizard } from './_components/OnboardingWizard'

export const metadata = { title: 'Configurar barbearia — Navalia' }

export default async function OnboardingPage() {
  const { barbershop, user } = await requireMember()

  // Already onboarded — skip straight to the dashboard
  if (barbershop.onboardingCompleted) redirect('/dashboard')

  // Only owners can configure the barbershop; non-owners see a notice
  if (user.role !== 'OWNER') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="rounded-lg border border-border bg-card p-6 max-w-md shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Configuração pendente
          </h2>
          <p className="text-sm text-muted-foreground">
            Peça ao dono da barbearia para concluir a configuração.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <OnboardingWizard
        barbershopName={barbershop.name}
        barbershopSlug={barbershop.slug}
      />
    </div>
  )
}
