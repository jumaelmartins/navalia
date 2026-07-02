import { NextRequest, NextResponse } from 'next/server'

/**
 * Next.js 16 Proxy (previously "Middleware") — cheap session-cookie presence
 * check for /dashboard/* routes.
 *
 * Actual session validation and tenant lookup happen server-side inside
 * requireMember() — this proxy only gate-keeps with a cookie check so that
 * unauthenticated users are redirected without an extra DB round-trip.
 *
 * Better Auth sets the session token cookie as one of:
 *   better-auth.session_token            (http / localhost)
 *   __Secure-better-auth.session_token   (https, non-strict)
 *   __Host-better-auth.session_token     (https strict)
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/dashboard')) {
    const hasSession =
      request.cookies.has('better-auth.session_token') ||
      request.cookies.has('__Secure-better-auth.session_token') ||
      request.cookies.has('__Host-better-auth.session_token')

    if (!hasSession) {
      const loginUrl = new URL('/login', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Inject pathname into REQUEST headers so server-component layouts can
  // gate-check per-route without triggering a redirect loop on exempt paths.
  //
  // SECURITY: We write into the *request* headers forwarded to the Next.js
  // server via NextResponse.next({ request: { headers } }).  This OVERWRITES
  // any x-pathname value the client may have sent, making header-spoofing
  // impossible.  Setting a *response* header (the previous approach) had no
  // effect on what `headers()` returns in RSC and could be spoofed by
  // including x-pathname in the incoming request.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
