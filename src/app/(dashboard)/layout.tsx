import { requireOnboarded } from '@/modules/tenancy/context'
import { Toaster } from '@/components/ui/sonner'
import { DesktopSidebar, MobileSidebar } from './_components/SidebarNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { barbershop, user } = await requireOnboarded()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop fixed sidebar */}
      <DesktopSidebar shopName={barbershop.name} userName={user.name} />

      {/* Mobile hamburger + slide-in panel */}
      <MobileSidebar shopName={barbershop.name} userName={user.name} />

      {/* Page content — offset by sidebar on md+ */}
      <div className="md:pl-60">
        {children}
      </div>

      <Toaster />
    </div>
  )
}
