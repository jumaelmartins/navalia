import Link from 'next/link'
import { requireMember } from '@/modules/tenancy/context'
import { Toaster } from '@/components/ui/sonner'

// Temporary minimal nav — Task 11 replaces with full sidebar
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { barbershop } = await requireMember()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <span className="font-display text-sm font-semibold text-primary">
            {barbershop.name}
          </span>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/servicos"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Serviços
          </Link>
        </div>
      </nav>
      {children}
      <Toaster />
    </div>
  )
}
