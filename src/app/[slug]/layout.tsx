import { Toaster } from '@/components/ui/sonner'
import { BRAND } from '@/lib/brand'
import Link from 'next/link'

export default function SlugLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-dark min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex-1">{children}</div>

      <footer className="border-t border-border py-6">
        <div className="mx-auto max-w-5xl px-4 flex items-center justify-center gap-1 text-sm text-muted-foreground">
          <span>Feito com</span>
          <Link
            href="/"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            {BRAND.name}
          </Link>
        </div>
      </footer>

      <Toaster />
    </div>
  )
}
