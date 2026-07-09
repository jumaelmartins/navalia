# Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Continuar com Google" to the login and signup pages, and auto-provision a placeholder barbershop the first time a barbershop-less Google user reaches the dashboard.

**Architecture:** Better Auth's built-in Google social provider handles the OAuth handshake via the existing `/api/auth/[...all]` catch-all route — no new route needed. The gap this plan closes is tenant provisioning: `requireMember()` currently redirects any authenticated user without a barbershop to `/signup` (a password form); it will instead auto-create a placeholder barbershop and continue, letting the existing onboarding wizard handle renaming.

**Tech Stack:** Next.js 16 (App Router), Better Auth (`socialProviders.google`), Prisma 7, Vitest.

## Global Constraints

- **Tenant scoping:** every query takes an explicit `barbershopId`.
- **Result pattern:** domain use cases return `{ ok: true, data: T } | { ok: false, error: string }`.
- **Design tokens:** no hardcoded colors — use the CSS custom properties in `src/app/globals.css`.
- **Stack:** Next.js 16, Prisma 7 (`npx prisma migrate dev`), Better Auth, Tailwind v4 + shadcn on Base UI. UI copy pt-BR; code/docs English.
- **Testing:** Vitest. Unit tests need no `DATABASE_URL`; integration tests use `describe.skipIf(!process.env.DATABASE_URL)`. CI runs unit tests only.

## Prerequisites (human, not an agent task)

The user already has a Google Cloud Console OAuth Client (Web application type). Before Task 3's manual verification step, confirm the client's **Authorized redirect URIs** include:

- Dev: `http://localhost:3000/api/auth/callback/google`
- Prod: `https://<DOMAIN>/api/auth/callback/google` (from `.env.prod`'s `DOMAIN`)

Better Auth's catch-all route derives the callback path from the provider id (`google`) automatically — no code controls this path, only the Google Console config and `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` need to match the real origin.

---

### Task 1: `deriveBarbershopName` helper

**Files:**
- Modify: `src/modules/tenancy/context.ts`
- Test: `src/modules/tenancy/context.test.ts`

**Interfaces:**
- Produces: `deriveBarbershopName(userName: string): string` — exported from `src/modules/tenancy/context.ts`. Task 2 consumes it.

- [ ] **Step 1: Write the failing tests**

Add to `src/modules/tenancy/context.test.ts` (append after the existing `slugify` describe block, before `computeTrialEnd`):

```ts
import { slugify, computeTrialEnd, deriveBarbershopName } from './context'
```

(Replace the existing `import { slugify, computeTrialEnd } from './context'` line at the top of the file with the line above.)

```ts
describe('deriveBarbershopName', () => {
  it('uses the first name from a full name', () => {
    expect(deriveBarbershopName('João Silva')).toBe('Barbearia de João')
  })

  it('uses a single-word name as-is', () => {
    expect(deriveBarbershopName('Maria')).toBe('Barbearia de Maria')
  })

  it('collapses extra whitespace before extracting the first name', () => {
    expect(deriveBarbershopName('  Pedro   Alves ')).toBe('Barbearia de Pedro')
  })

  it('falls back to a generic name when empty', () => {
    expect(deriveBarbershopName('')).toBe('Minha Barbearia')
  })

  it('falls back to a generic name when only whitespace', () => {
    expect(deriveBarbershopName('   ')).toBe('Minha Barbearia')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- context.test.ts`
Expected: FAIL — `deriveBarbershopName` is not exported from `./context`.

- [ ] **Step 3: Implement `deriveBarbershopName`**

Add to `src/modules/tenancy/context.ts`, directly below the existing `slugify` function:

```ts
/**
 * Deriva um nome padrão de barbearia a partir do nome do usuário (Google
 * sign-in de tenants novos). Ex.: 'João Silva' → 'Barbearia de João'.
 */
export function deriveBarbershopName(userName: string): string {
  const firstName = userName.trim().split(/\s+/)[0]
  return firstName ? `Barbearia de ${firstName}` : 'Minha Barbearia'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- context.test.ts`
Expected: PASS (all `deriveBarbershopName` + existing `slugify`/`computeTrialEnd` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/tenancy/context.ts src/modules/tenancy/context.test.ts
git commit -m "feat(tenancy): add deriveBarbershopName helper"
```

---

### Task 2: `ensureBarbershop` + wire into `requireMember()`

**Files:**
- Modify: `src/modules/tenancy/context.ts`
- Test: `src/modules/tenancy/context.test.ts`

**Interfaces:**
- Consumes: `deriveBarbershopName(userName: string): string`, `slugify(name: string): string`, `computeTrialEnd(from: Date): Date` (all from Task 1 / existing code, same file).
- Produces: `ensureBarbershop(userId: string, userName: string): Promise<Barbershop>` — exported from `src/modules/tenancy/context.ts`. `requireMember()` (same file) is the only other caller.

- [ ] **Step 1: Write the failing integration test**

Add to the end of `src/modules/tenancy/context.test.ts`:

```ts
import 'dotenv/config'
import { afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { ensureBarbershop } from './context'

describe.skipIf(!process.env.DATABASE_URL)('ensureBarbershop (integration)', () => {
  const cleanupBarbershopIds: string[] = []
  const cleanupUserIds: string[] = []

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { barbershopId: { in: cleanupBarbershopIds } } })
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
    await prisma.barbershop.deleteMany({ where: { id: { in: cleanupBarbershopIds } } })
  })

  it('creates a barbershop, links the user as OWNER, and logs the signup', async () => {
    const user = await prisma.user.create({
      data: { name: 'Carlos Pereira', email: `carlos-${Date.now()}@example.com` },
    })
    cleanupUserIds.push(user.id)

    const barbershop = await ensureBarbershop(user.id, user.name)
    cleanupBarbershopIds.push(barbershop.id)

    expect(barbershop.name).toBe('Barbearia de Carlos')
    expect(barbershop.subscriptionStatus).toBe('TRIALING')

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updatedUser.role).toBe('OWNER')
    expect(updatedUser.barbershopId).toBe(barbershop.id)

    const auditLog = await prisma.auditLog.findFirst({
      where: { barbershopId: barbershop.id, action: 'SIGNUP' },
    })
    expect(auditLog).not.toBeNull()
  })

  it('generates a unique slug when the derived name collides', async () => {
    const existing = await prisma.barbershop.create({
      data: {
        name: 'Barbearia de Ana',
        slug: 'barbearia-de-ana',
        trialEndsAt: new Date(),
        businessHours: {},
      },
    })
    cleanupBarbershopIds.push(existing.id)

    const user = await prisma.user.create({
      data: { name: 'Ana Costa', email: `ana-${Date.now()}@example.com` },
    })
    cleanupUserIds.push(user.id)

    const barbershop = await ensureBarbershop(user.id, user.name)
    cleanupBarbershopIds.push(barbershop.id)

    expect(barbershop.slug).toBe('barbearia-de-ana-2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- context.test.ts`
Expected: FAIL (only if `DATABASE_URL` is set in your shell — see `.env`) — `ensureBarbershop` is not exported from `./context`. If `DATABASE_URL` is unset, the block reports as skipped; export it from `.env` first (`export $(grep DATABASE_URL .env)` or run via your usual local Postgres setup) so this test actually executes.

- [ ] **Step 3: Implement `ensureBarbershop` and wire it into `requireMember()`**

Add to `src/modules/tenancy/context.ts`, directly below `deriveBarbershopName`:

```ts
/**
 * Auto-provisiona uma barbearia placeholder para um usuário autenticado que
 * ainda não tem uma (primeiro login via Google). Espelha os steps 2-3 de
 * signUpBarbershop — a barbearia fica renomeável no wizard de onboarding.
 */
export async function ensureBarbershop(userId: string, userName: string): Promise<Barbershop> {
  const name = deriveBarbershopName(userName)
  const baseSlug = slugify(name)
  let slug = baseSlug
  let suffix = 2
  while (await prisma.barbershop.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`
  }

  return prisma.$transaction(async (tx) => {
    const barbershop = await tx.barbershop.create({
      data: {
        name,
        slug,
        subscriptionStatus: 'TRIALING',
        trialEndsAt: computeTrialEnd(new Date()),
        businessHours: {},
      },
    })

    await tx.user.update({
      where: { id: userId },
      data: { role: 'OWNER', barbershopId: barbershop.id },
    })

    await tx.auditLog.create({
      data: {
        barbershopId: barbershop.id,
        userId,
        action: 'SIGNUP',
        entity: 'Barbershop',
        entityId: barbershop.id,
        payload: { name, slug },
      },
    })

    return barbershop
  })
}
```

Now replace `requireMember()` in the same file:

```ts
export async function requireMember(): Promise<TenantContext> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { barbershop: true },
  })
  if (!user) redirect('/login')

  const { barbershop, ...rest } = user
  if (!barbershop) {
    const newBarbershop = await ensureBarbershop(user.id, user.name)
    return { user: { ...rest, barbershopId: newBarbershop.id }, barbershop: newBarbershop }
  }

  return { user: rest, barbershop }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- context.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tenancy/context.ts src/modules/tenancy/context.test.ts
git commit -m "feat(tenancy): auto-provision barbershop for barbershop-less members"
```

---

### Task 3: Better Auth Google provider + env config

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `.env`, `.env.example`, `.env.prod.example`, `Dockerfile`, `.github/workflows/ci.yml`, `docs/DEPLOY.md`

**Interfaces:**
- Produces: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` env vars, read by `src/lib/auth.ts`. No other task depends on their exact values, only on the provider being configured.

- [ ] **Step 1: Add the Google provider to Better Auth**

In `src/lib/auth.ts`, add `socialProviders` to the `betterAuth({...})` config, after `emailAndPassword`:

```ts
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'OWNER',
        input: false,
      },
      barbershopId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
})
```

- [ ] **Step 2: Add env vars to `.env`**

Append to `.env` (after `STRIPE_PRICE_ID`, before `PLAN_PRICE_CENTS` — keep it near the other auth-adjacent vars):

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Fill in the real values from your existing Google Cloud Console OAuth Client (this file is gitignored — paste the real client id/secret here yourself, not into any tracked file).

- [ ] **Step 3: Add placeholders to `.env.example`**

In `.env.example`, after the `STRIPE_PRICE_ID=price_...` line, add:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
```

- [ ] **Step 4: Add placeholders to `.env.prod.example`**

In `.env.prod.example`, in the `# ── Stripe ...` section, after `PLAN_PRICE_CENTS=4490`, add:

```

# ── Google OAuth ───────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
```

- [ ] **Step 5: Add build placeholders to `Dockerfile`**

In `Dockerfile`, after the `ENV PLAN_PRICE_CENTS=4490` line, add:

```
ENV GOOGLE_CLIENT_ID=build-placeholder.apps.googleusercontent.com
ENV GOOGLE_CLIENT_SECRET=GOCSPX-build-placeholder
```

- [ ] **Step 6: Add CI placeholders to `.github/workflows/ci.yml`**

In `.github/workflows/ci.yml`, after the `PLAN_PRICE_CENTS: "4490"` line, add:

```
          GOOGLE_CLIENT_ID: build-placeholder.apps.googleusercontent.com
          GOOGLE_CLIENT_SECRET: GOCSPX-ci-placeholder
```

- [ ] **Step 7: Add checklist entry to `docs/DEPLOY.md`**

In `docs/DEPLOY.md`, after the `- [ ] \`PLAN_PRICE_CENTS\` — ...` line, add:

```
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from the Google Cloud Console OAuth Client; confirm its Authorized redirect URI includes `https://<DOMAIN>/api/auth/callback/google`
```

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (the Dockerfile/CI placeholders are dummy strings — `betterAuth()` accepts any string for `clientId`/`clientSecret` at config time; only a real OAuth attempt would fail with them).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth.ts .env.example .env.prod.example Dockerfile .github/workflows/ci.yml docs/DEPLOY.md
git commit -m "feat(auth): configure Google OAuth provider"
```

Note: `.env` is gitignored and won't be included in this commit — verify with `git status` that it doesn't appear staged.

---

### Task 4: `GoogleSignInButton` component

**Files:**
- Create: `src/components/auth/GoogleSignInButton.tsx`

**Interfaces:**
- Consumes: `authClient.signIn.social` (`src/lib/auth-client.ts`), `Button` (`src/components/ui/button.tsx`, `variant="outline"`).
- Produces: `GoogleSignInButton({ errorCallbackURL }: { errorCallbackURL: string })` — a React component. Tasks 5 and 6 render it with `errorCallbackURL="/login"` and `errorCallbackURL="/signup"` respectively.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

interface GoogleSignInButtonProps {
  errorCallbackURL: string
}

export function GoogleSignInButton({ errorCallbackURL }: GoogleSignInButtonProps) {
  async function handleClick() {
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
      errorCallbackURL,
    })
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick}>
      <svg viewBox="0 0 18 18" aria-hidden="true" className="size-4">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        />
      </svg>
      Continuar com Google
    </Button>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors (the file isn't imported anywhere yet, so this only validates its own syntax/types).

- [ ] **Step 3: Commit**

```bash
git add src/components/auth/GoogleSignInButton.tsx
git commit -m "feat(auth): add GoogleSignInButton component"
```

---

### Task 5: Wire into the login page

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `GoogleSignInButton` (Task 4).

- [ ] **Step 1: Replace the file contents**

```tsx
'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { BRAND } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('error')) {
      setError('Não foi possível entrar com Google. Tente novamente.')
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await authClient.signIn.email(
        { email, password, callbackURL: '/dashboard' },
        {
          onSuccess: () => {
            router.push('/dashboard')
          },
          onError: (ctx) => {
            setError(
              ctx.error.status === 401
                ? 'E-mail ou senha incorretos.'
                : 'Não foi possível entrar. Tente novamente.',
            )
          },
        },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <Link href="/" className="font-display text-2xl font-semibold text-primary">
        {BRAND.name}
      </Link>
      <Card className="w-full max-w-sm shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-semibold font-display">Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua barbearia</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full hover:bg-primary-hover"
            disabled={loading}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <GoogleSignInButton errorCallbackURL="/login" />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Ainda não tem conta?{' '}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Criar conta
          </Link>
        </p>
      </CardContent>
    </Card>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual browser verification**

Run: `npm run dev`, open `http://localhost:3000/login`.

Expected:
- Page renders the email/password form, an "ou" divider, then the Google button.
- Clicking "Continuar com Google" navigates to `accounts.google.com`'s consent screen (confirms `GOOGLE_CLIENT_ID`/`SECRET` in `.env` are the real values from Task 3 Step 2, not the placeholders).
- Completing consent redirects back to `/dashboard`.
- If you deny consent on Google's screen, you land back on `/login` with the "Não foi possível entrar com Google" message visible.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/login/page.tsx"
git commit -m "feat(auth): add Google sign-in button to login page"
```

---

### Task 6: Wire into the signup page, update roadmap, final verification

**Files:**
- Modify: `src/app/(auth)/signup/page.tsx`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `GoogleSignInButton` (Task 4).

- [ ] **Step 1: Replace the file contents**

```tsx
'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { signUpBarbershop } from '@/modules/tenancy/signup-action'
import { BRAND } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    shopName: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('error')) {
      setError('Não foi possível entrar com Google. Tente novamente.')
    }
  }, [searchParams])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await signUpBarbershop(form)

      if (!result.ok) {
        setError(result.error)
        return
      }

      // Account created — now sign in to obtain the session cookie
      await authClient.signIn.email(
        {
          email: form.email,
          password: form.password,
          callbackURL: '/dashboard/onboarding',
        },
        {
          onSuccess: () => {
            router.push('/dashboard/onboarding')
          },
          onError: () => {
            // Account exists — redirect to login so they can sign in manually
            router.push('/login')
          },
        },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <Link href="/" className="font-display text-2xl font-semibold text-primary">
        {BRAND.name}
      </Link>
      <Card className="w-full max-w-sm shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-semibold font-display">Criar conta</CardTitle>
        <CardDescription>Comece seu período de teste gratuito de 7 dias</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Seu nome</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="João Silva"
              value={form.name}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@exemplo.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              placeholder="Mínimo 8 caracteres"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shopName">Nome da barbearia</Label>
            <Input
              id="shopName"
              name="shopName"
              type="text"
              required
              placeholder="Barbearia do João"
              value={form.shopName}
              onChange={handleChange}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full hover:bg-primary-hover"
            disabled={loading}
          >
            {loading ? 'Criando conta…' : 'Criar conta'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <GoogleSignInButton errorCallbackURL="/signup" />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
    </div>
  )
}
```

- [ ] **Step 2: Mark the roadmap item shipped**

In `docs/ROADMAP.md`, change:

```
### Google sign-in
```

to:

```
### Google sign-in  ✅ shipped (2026-07-08)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`, open `http://localhost:3000/signup`.

Expected:
- Page renders the signup form, an "ou" divider, then the Google button.
- Clicking "Continuar com Google" with a Google account that has never signed into Navalia lands on `/dashboard/onboarding` with `StepBasics`'s "Nome da barbearia" field pre-filled with `Barbearia de {primeiro nome do Google}`.
- Signing out and clicking "Continuar com Google" again with the same account lands straight on `/dashboard` (no duplicate barbershop created — re-run the Task 2 integration test suite if unsure: `npm test -- context.test.ts`).

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass (237+ tests, including the new ones from Tasks 1–2).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)/signup/page.tsx" docs/ROADMAP.md
git commit -m "feat(auth): add Google sign-in button to signup page, mark roadmap item shipped"
```
