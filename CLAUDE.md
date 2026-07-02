# Navalia — Developer Guide

**Navalia** is a multi-tenant barbershop SaaS built with Next.js 16 (App Router, standalone), TypeScript, Prisma 7 + PostgreSQL 16, Redis, Better Auth, Stripe, OpenAI, and Evolution API v2.

> This project runs on **Next.js 16**, which has breaking changes from Next.js 13–15. Before touching framework code read `AGENTS.md` and check `node_modules/next/dist/docs/` for updated API references.

---

## Quick Start

```bash
cp .env.example .env        # fill Stripe + OpenAI keys
docker compose up -d        # postgres, redis, evolution
npx prisma migrate dev       # apply migrations + generate client
npm run seed                 # demo data
npm run dev                  # http://localhost:3000
```

---

## Key Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build (standalone output) |
| `npm test` | Run 237 Vitest tests |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Seed demo barbershop data |
| `npx prisma migrate dev` | Apply + create migrations |
| `npx prisma studio` | GUI for the database |

---

## Project Structure

```
src/
  app/                        Next.js App Router pages + API routes
    (marketing)/              Landing page
    (auth)/                   Login / signup
    (dashboard)/              Admin panel (gated by billing + auth)
    (ungated)/                Reactivation screen (no billing gate)
    [slug]/                   Public booking page
    api/webhooks/             stripe + evolution webhook handlers
    api/ai/                   assistant + copilot routes
    api/health/               GET /api/health → {ok, db, redis}
  modules/                    Domain logic — framework-agnostic
    booking/                  Slot engine + conflict-safe create
    billing/                  Gate, Stripe lifecycle, actions
    whatsapp/                 Evolution client, deep-link, instance actions
    ai/                       Orchestrator, tool registries, prompts
    catalog/                  Services + professionals + availability
    tenancy/                  Signup, context, business hours, money
    insights/                 Revenue/booking SQL aggregates
  lib/                        Shared infrastructure
    prisma.ts                 Prisma client (singleton, PrismaPg adapter)
    redis.ts                  ioredis singleton
    auth.ts                   Better Auth server config
    auth-client.ts            Better Auth client config
    brand.ts                  BRAND token (name, tagline, domain)
  proxy.ts                    Next.js 16 Proxy (middleware) — cookie check
```

---

## Architecture Conventions

### Tenant scoping rule

Every database query must receive an explicit `barbershopId`. Domain modules accept `tenantId` as a parameter — there is no "current tenant" global. Public routes resolve the tenant from the slug; dashboard routes resolve it from the authenticated session; webhook routes resolve it from the Evolution instance name.

Violating this rule leaks cross-tenant data. Add a lint rule or code review check before any new repository function that omits `where: { barbershopId }`.

### Result pattern

Domain use cases return `{ ok: true, data: T } | { ok: false, error: string }` — never throw for control flow. Route handlers convert results to HTTP responses. Example:

```typescript
const result = await createAppointment(...)
if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
return NextResponse.json(result.data)
```

### Design tokens

Tailwind v4 design tokens live in `src/app/globals.css`. The brand color palette, radius, and spacing scale are defined there. Do not hardcode color values; use CSS custom properties (`--color-primary`, etc.). See `src/lib/brand.ts` for the BRAND constant used in copy.

### AI tool rules

When adding a new AI tool:
1. Define input schema with Zod (validate tenant from context, never from model output)
2. Add to the appropriate registry in `src/modules/ai/` (public vs. copilot)
3. Sensitive tools must return `{ pendingAction: ... }` instead of executing immediately
4. Log every call to `AiActionLog`

---

## Documentation

| File | Content |
|------|---------|
| `docs/SPEC.md` | Product spec, business rules, acceptance criteria |
| `docs/ARCHITECTURE.md` | System design, data model, key decisions |
| `docs/WHATSAPP_WORKFLOW.md` | WhatsApp pipeline detail |
| `docs/DEPLOY.md` | VPS production runbook |

---

## Testing Notes

- Unit tests: `describe(...)` — no DATABASE_URL needed
- Integration tests: `describe.skipIf(!process.env.DATABASE_URL)(...)` — requires a running Postgres
- CI runs unit tests only (no DATABASE_URL set)
- Mocks live in `src/__mocks__/` (e.g., `server-only` stub for Vitest)
