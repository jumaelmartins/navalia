'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import {
  LayoutDashboardIcon,
  CalendarIcon,
  UsersIcon,
  ScissorsIcon,
  UserIcon,
  MessageSquareIcon,
  BotIcon,
  SettingsIcon,
  MenuIcon,
  LogOutIcon,
  XIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { authClient } from '@/lib/auth-client'

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  comingSoon?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboardIcon },
  { label: 'Agenda', href: '/dashboard/agenda', icon: CalendarIcon },
  { label: 'Clientes', href: '/dashboard/clientes', icon: UsersIcon },
  { label: 'Serviços', href: '/dashboard/servicos', icon: ScissorsIcon },
  { label: 'Profissionais', href: '/dashboard/profissionais', icon: UserIcon },
  { label: 'WhatsApp', href: '/dashboard/whatsapp', icon: MessageSquareIcon },
  { label: 'Copiloto IA', href: '#', icon: BotIcon, comingSoon: true },
  { label: 'Configurações', href: '/dashboard/configuracoes/assinatura', icon: SettingsIcon },
]

// ---------------------------------------------------------------------------
// NavLink
// ---------------------------------------------------------------------------

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname()
  const isActive =
    item.href !== '#' &&
    (item.href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname.startsWith(item.href))

  const base =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors relative'
  const active = 'bg-muted text-foreground font-medium'
  const inactive = 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'

  if (item.comingSoon) {
    return (
      <button
        className={cn(base, inactive, 'group w-full cursor-default opacity-60')}
        title="Em breve"
        tabIndex={-1}
        type="button"
      >
        {isActive && (
          <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-primary" />
        )}
        <item.icon className="size-4 shrink-0" />
        {item.label}
        <span className="ml-auto text-[10px] text-muted-foreground/60">em breve</span>
      </button>
    )
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(base, isActive ? active : inactive)}
    >
      {isActive && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <item.icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// SidebarContent
// ---------------------------------------------------------------------------

function SidebarContent({
  shopName,
  userName,
  onClose,
}: {
  shopName: string
  userName: string
  onClose?: () => void
}) {
  const router = useRouter()

  async function handleSignOut() {
    await authClient.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <span className="font-display text-base font-semibold text-primary leading-tight">
          {shopName}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-0.5">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.href + item.label} item={item} onClick={onClose} />
          ))}
        </div>
      </nav>

      {/* Bottom: user + signout */}
      <div className="border-t border-border p-3">
        <div className="flex items-center justify-between rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{userName}</p>
            <p className="text-xs text-muted-foreground">Proprietário</p>
          </div>
          <button
            onClick={handleSignOut}
            className="ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Sair"
          >
            <LogOutIcon className="size-3.5" />
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop sidebar (exported)
// ---------------------------------------------------------------------------

export function DesktopSidebar({
  shopName,
  userName,
}: {
  shopName: string
  userName: string
}) {
  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-60 flex-col border-r border-border bg-card">
      <SidebarContent shopName={shopName} userName={userName} />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Mobile sidebar (hamburger + sheet)
// ---------------------------------------------------------------------------

export function MobileSidebar({
  shopName,
  userName,
}: {
  shopName: string
  userName: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 flex size-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm"
        aria-label="Abrir menu"
      >
        <MenuIcon className="size-4" />
      </button>

      {/* Mobile sheet overlay */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card shadow-md">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg hover:bg-muted"
              aria-label="Fechar menu"
            >
              <XIcon className="size-4" />
            </button>
            <SidebarContent
              shopName={shopName}
              userName={userName}
              onClose={() => setOpen(false)}
            />
          </aside>
        </>
      )}
    </>
  )
}
