/**
 * Marketing layout — applies the dark-surface theme for the landing page.
 * Does NOT render <html>/<body> (those live in the root layout).
 * We put theme-dark on the wrapping div so the custom-variant fires correctly:
 *   @custom-variant dark (&:is(.theme-dark *))
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-dark min-h-screen bg-background text-foreground flex flex-col">
      {children}
    </div>
  )
}
