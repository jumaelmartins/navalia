import { Toaster } from '@/components/ui/sonner'

/**
 * Minimal layout for routes that must be reachable even when the subscription
 * gate would block access (e.g. /dashboard/reativar).
 *
 * Architecture note: this route group lives OUTSIDE the (dashboard) group
 * so the gated (dashboard)/layout.tsx never runs for these pages.
 * The root app/layout.tsx (fonts, html/body) still applies.
 */
export default function UngatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
