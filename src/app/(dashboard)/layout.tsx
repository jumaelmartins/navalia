import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireOnboarded } from '@/modules/tenancy/context'
import { hasAccess } from '@/modules/billing/gate'
import { Toaster } from '@/components/ui/sonner'
import { DesktopSidebar, MobileSidebar } from './_components/SidebarNav'
import { TrialBanner } from './_components/TrialBanner'

// Routes that bypass the subscription gate so users can manage/reactivate
// their plan without triggering a redirect loop.
const GATE_EXEMPT_PATHS = ['/dashboard/configuracoes/assinatura']

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { barbershop, user } = await requireOnboarded()

  // Read current pathname injected by proxy.ts middleware
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  // Gate: block access when subscription is inactive (not exempt paths)
  const exempt = GATE_EXEMPT_PATHS.some(p => pathname.startsWith(p))
  if (!exempt && !hasAccess(barbershop)) {
    redirect('/dashboard/reativar')
  }

  const trialEndsAt = barbershop.trialEndsAt
  const isTrialing = barbershop.subscriptionStatus === 'TRIALING'
  const priceCents = Number(process.env.PLAN_PRICE_CENTS ?? 9900)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop fixed sidebar */}
      <DesktopSidebar shopName={barbershop.name} userName={user.name} />

      {/* Mobile hamburger + slide-in panel */}
      <MobileSidebar shopName={barbershop.name} userName={user.name} />

      {/* Page content — offset by sidebar on md+ */}
      <div className="md:pl-60">
        {/* Trial banner — rendered only while TRIALING (gate redirects when expired) */}
        {isTrialing && (
          <TrialBanner
            trialEndsAt={trialEndsAt.toISOString()}
            priceCents={priceCents}
          />
        )}

        {children}
      </div>

      <Toaster />
    </div>
  )
}
