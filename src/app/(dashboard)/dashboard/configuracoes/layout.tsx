import { headers } from 'next/headers'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Dados', href: '/dashboard/configuracoes' },
  { label: 'Assinatura', href: '/dashboard/configuracoes/assinatura' },
  { label: 'Logs', href: '/dashboard/configuracoes/logs' },
]

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  return (
    <div>
      {/* Page header */}
      <div className="border-b border-border bg-card/40">
        <div className="max-w-3xl px-6 pt-6 pb-0">
          <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground mb-4">
            Gerencie os dados, plano e registros da sua barbearia.
          </p>

          {/* Sub-nav tabs */}
          <nav className="flex gap-0 -mb-px" aria-label="Configurações">
            {TABS.map((tab) => {
              const isActive =
                tab.href === '/dashboard/configuracoes'
                  ? pathname === '/dashboard/configuracoes' ||
                    pathname === '/dashboard/configuracoes/'
                  : pathname.startsWith(tab.href)

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                  )}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-3xl px-6 py-6">{children}</div>
    </div>
  )
}
