# Google Sign-In (Design Spec)

**Status:** approved design — feeds the implementation plan.
**Date:** 2026-07-08

## Overview

Add "Continuar com Google" to the login and signup pages, backed by Better
Auth's built-in Google provider (`docs/ROADMAP.md` v1.1 — "Small"). The
non-trivial part isn't the OAuth wiring itself but what happens on a
**brand-new** Google sign-in: Better Auth creates the `User` row directly in
the OAuth callback, with no `barbershopId` — unlike the email/password path,
where `signUpBarbershop` creates the `Barbershop` explicitly before the user
ever reaches the dashboard. Today, any authenticated user with no barbershop
hits `requireMember()` and gets bounced to `/signup` (a password form),
which is wrong for someone who just authenticated via Google.

**Decision:** auto-provision a placeholder barbershop the first time a
barbershop-less authenticated user reaches `requireMember()`, then let the
existing onboarding wizard (`/dashboard/onboarding`, `StepBasics`) handle
renaming. No new screen, no extra form.

## Global Constraints

Inherited from `CLAUDE.md`:

- **Tenant scoping:** every query takes an explicit `barbershopId`.
- **Result pattern:** domain use cases return
  `{ ok: true, data: T } | { ok: false, error: string }`.
- **Design tokens:** no hardcoded colors — use `src/app/globals.css` CSS
  custom properties.
- **Stack:** Next.js 16, Prisma 7, Better Auth, Tailwind v4 + shadcn. UI copy
  pt-BR; code/docs English.
- **Testing:** Vitest; unit tests need no `DATABASE_URL`.

## Architecture

### 1. Better Auth config (`src/lib/auth.ts`)

Add the Google social provider:

```ts
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
  },
},
```

New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. User already has
credentials from Google Cloud Console — add placeholders to `.env`,
`.env.example`, `.env.prod.example`, `Dockerfile` (build placeholder),
`.github/workflows/ci.yml` (CI placeholder), and the `docs/DEPLOY.md`
checklist. Better Auth's Prisma adapter links a Google sign-in to an existing
`User` by matching email automatically — no extra account-linking code needed.

### 2. Auto-provisioning (`src/modules/tenancy/context.ts`)

`requireMember()` currently does:

```ts
if (!user || !user.barbershop) redirect('/signup')
```

Change: when the session is valid but the user has no barbershop, provision
one instead of redirecting. New function `ensureBarbershop(userId, userName)`
(same file), mirroring steps 2–3 of `signUpBarbershop`
(`src/modules/tenancy/signup-action.ts`):

1. Derive a name: `Barbearia de {primeiro nome}` from `user.name`, falling
   back to `"Minha Barbearia"` if `user.name` is empty.
2. Compute a unique slug via the existing `slugify` + suffix-loop pattern.
3. In one `$transaction`: create `Barbershop` (`TRIALING`,
   `trialEndsAt: computeTrialEnd(new Date())`, `businessHours: {}`), update
   `User` (`role: 'OWNER'`, `barbershopId`), write an `AuditLog`
   (`action: 'SIGNUP'`, same shape as the email path).
4. Return the created barbershop; `requireMember` uses it directly instead of
   re-querying.

This only ever fires for Google users — the email/password path always has a
barbershop by the time it reaches `requireMember()`, so existing behavior for
that path is unchanged. No Better Auth hook needed; the check-and-provision
happens lazily on first dashboard access, at the one call site every
dashboard route already funnels through.

**Accepted edge case:** two concurrent first requests from a brand-new Google
user (e.g. duplicate tab) could both pass the `!user.barbershop` check before
either transaction commits, creating two barbershops (one becomes an orphan,
last write wins on `User.barbershopId`). Not locked against — same
best-effort posture as the rest of the signup path, and the window is a
single first-navigation race that self-heals (the orphan is just an unused
row). Not worth the added complexity for a first-login edge case.

### 3. UI

New `GoogleSignInButton` component (`src/components/auth/GoogleSignInButton.tsx`):
outline button, inline Google "G" SVG icon, label "Continuar com Google".
Calls:

```ts
authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })
```

Added to both `src/app/(auth)/login/page.tsx` and
`src/app/(auth)/signup/page.tsx`, separated from the email/password form by
an "ou" divider. Same `callbackURL: '/dashboard'` works for both pages and
both new/returning users:

- Returning user with a barbershop → `requireOnboarded()` passes straight
  through to the dashboard.
- Brand-new Google user → `requireMember()` (called inside
  `requireOnboarded()`) auto-provisions the barbershop; `onboardingCompleted`
  defaults `false`, so `requireOnboarded()` redirects to
  `/dashboard/onboarding` where `StepBasics` pre-fills the placeholder name
  for editing.

### 4. Error handling

- OAuth failure/cancel: Better Auth redirects back to the originating page
  with an `?error=` query param. Both pages read it on mount and render it
  through the existing `text-destructive` error slot (same visual treatment
  as email/password errors).
- Provisioning transaction failure: logged server-side
  (`console.error('[ensureBarbershop] ...')`); `requireMember()` re-throws so
  the user sees the framework error boundary rather than a silent redirect
  loop — consistent with how the rest of `context.ts` has no try/catch around
  DB reads today.

## Testing

- Unit: name-fallback logic (`Barbearia de {nome}` vs. `"Minha Barbearia"`)
  and slug-uniqueness loop for `ensureBarbershop`, following the existing
  pattern in `signup-action.ts` (no `DATABASE_URL` needed for the pure parts;
  integration-gate the transactional test like other DB-touching tests).
- No automated test for the live Google OAuth handshake (requires external
  credentials) — verified manually against real Google credentials in dev
  before shipping, documented as a manual check in `docs/DEPLOY.md`.

## Out of scope

- Account linking UI/consent screens beyond Better Auth's default
  email-match linking.
- Staff/multi-owner invite flows (none exist yet — out of scope here).
- Avatar/profile-picture sync from Google.
