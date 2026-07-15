import Link from 'next/link'
import { BRAND } from '@/lib/brand'

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
          {/* Brand */}
          <div>
            <p className="font-display text-xl font-semibold text-foreground mb-1">{BRAND.name}</p>
            <p className="text-sm text-muted-foreground">{BRAND.tagline}</p>
          </div>

          {/* Links */}
          <nav aria-label="Links do rodapé" className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Criar conta
            </Link>
            <Link
              href="/privacidade"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacidade
            </Link>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground">
            &copy; 2026 {BRAND.name}. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  )
}
