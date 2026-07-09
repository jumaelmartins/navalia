import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireMember } from '@/modules/tenancy/context'
import { hasAccess } from '@/modules/billing/gate'
import { Toaster } from '@/components/ui/sonner'
import { DesktopSidebar, MobileSidebar } from './_components/SidebarNav'
import { TrialBanner } from './_components/TrialBanner'
import { NotificationBell } from './dashboard/NotificationBell'

// Only the subscription management page bypasses the billing gate so locked
// tenants can still reach the checkout flow. Narrowed from the full
// /dashboard/configuracoes subtree (M2).
const GATE_EXEMPT_PATHS = ['/dashboard/configuracoes/assinatura', '/dashboard/reativar']

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Use requireMember so /dashboard/onboarding is accessible inside this layout
  // (C3 fix: requireOnboarded was causing ERR_TOO_MANY_REDIRECTS for fresh signups).
  // Each child page self-gates with requireOnboarded() where needed.
  const { barbershop, user } = await requireMember()

  // Read current pathname injected by proxy.ts middleware
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  // Gate: block access when subscription is inactive (not exempt paths).
  // Exact match for /dashboard/configuracoes/assinatura so locked tenants
  // can reach checkout but NOT the rest of settings/logs.
  const exempt = GATE_EXEMPT_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!exempt && !hasAccess(barbershop)) {
    redirect('/dashboard/reativar')
  }

  const trialEndsAt = barbershop.trialEndsAt
  const isTrialing = barbershop.subscriptionStatus === 'TRIALING'
  const priceCents = Number(process.env.PLAN_PRICE_CENTS ?? 4490)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop fixed sidebar */}
      <DesktopSidebar shopName={barbershop.name} userName={user.name} userRole={user.role} />

      {/* Mobile hamburger + slide-in panel */}
      <MobileSidebar shopName={barbershop.name} userName={user.name} userRole={user.role} />

      {/* Page content — offset by sidebar on md+ */}
      <div className="md:pl-60">
        {/* Top bar: notification bell (and future header actions) */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end border-b border-border bg-background/80 px-4 backdrop-blur-sm">
          <NotificationBell />
        </header>

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
