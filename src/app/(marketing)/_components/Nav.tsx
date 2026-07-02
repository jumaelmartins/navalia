import Link from 'next/link'
import { BRAND } from '@/lib/brand'

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Brand wordmark */}
          <Link
            href="/"
            className="font-display text-xl font-semibold text-foreground tracking-tight hover:text-primary transition-colors"
          >
            {BRAND.name}
          </Link>

          {/* Desktop nav links */}
          <nav aria-label="Navegação principal" className="hidden md:flex items-center gap-8">
            <a
              href="#funcionalidades"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Funcionalidades
            </a>
            <a
              href="#preco"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Preço
            </a>
            <a
              href="#faq"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              FAQ
            </a>
          </nav>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden sm:inline-flex h-9 items-center px-4 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center px-4 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg transition-colors"
            >
              Começar grátis
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
