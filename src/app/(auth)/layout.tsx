/**
 * Auth layout — applies the dark-surface theme for login / signup screens.
 * Does NOT render <html>/<body> (those live in the root layout).
 * We put theme-dark on the wrapping div so the custom-variant fires correctly:
 *   @custom-variant dark (&:is(.theme-dark *))
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-dark min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      {children}
    </div>
  )
}
