# Navalia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Navalia — a multi-tenant barbershop SaaS with public booking, a real WhatsApp AI chatbot (Evolution API), internal AI copilot, insights, and Stripe subscription billing (7-day app-managed trial) — deployable to a single VPS.

**Architecture:** Next.js 15 full-stack monolith (App Router). Domain logic in `src/modules/*` (framework-agnostic, tenant-explicit); UI/routes/webhooks in `src/app/*`; infra clients in `src/lib/*`. All channels (public page, WhatsApp, web assistant, copilot, admin) call the same booking use cases.

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4 + shadcn/ui (re-tokenized), Prisma + PostgreSQL 16, Redis (ioredis), Better Auth, Stripe, OpenAI SDK (`gpt-4o-mini`), Evolution API v2, Vitest, GitHub Actions, Docker Compose + Caddy.

## Global Constraints

- UI copy: **pt-BR**. Repo docs/README: **English**.
- Brand name via single token: `src/lib/brand.ts` exports `BRAND = { name: 'Navalia', ... }` — never hardcode "Navalia" in components.
- Every domain table has `barbershopId`; every query goes through tenant-scoped helpers. No raw `prisma.appointment.findMany` outside `src/modules/*`.
- Prices stored as **integer cents** (`priceCents`). Times as `"HH:mm"` strings + `date` as `YYYY-MM-DD` (shop-local, single `timezone` per shop).
- Money/LLM/env config via env vars: `PLAN_PRICE_CENTS` (default 9900), `OPENAI_MODEL` (default `gpt-4o-mini`).
- Domain functions return typed results: `type Result<T> = { ok: true; data: T } | { ok: false; error: string }`.
- AI never receives/derives `tenantId` from model output — always from server context.
- Sensitive AI actions (block/unblock schedule, cancel appointment via copilot) require human confirmation before execution.
- Design system: dark premium marketing/public (charcoal `#171412`, warm off-white `#F5F1EA`, brass `#C4964A`), light warm dashboard. Display font: Fraunces (or Instrument Serif); body: a grotesk (e.g. `Geist`/`Inter`). No purple gradients, no glassmorphism.
- Commit after every green test cycle. Conventional Commits.

**UI tasks note:** UI tasks specify structure, contracts, and acceptance checks; final JSX styling is produced at execution time following `docs/superpowers/design-system.md` (created in Task 4). This is intentional — visual code comes from the frontend-design pass, logic contracts come from this plan.

---

## Phase 0 — Foundation

### Task 1: Scaffold Next.js project + tooling

**Files:**
- Create: Next.js app in repo root (`package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `eslint.config.mjs`)
- Create: `vitest.config.ts`, `src/modules/health/health.test.ts`
- Create: `src/lib/brand.ts`

**Interfaces:**
- Produces: `BRAND` const `{ name: string; tagline: string }` from `src/lib/brand.ts`; `npm run dev|build|lint|test|typecheck` scripts.

- [ ] **Step 1:** Scaffold in-place (repo already has docs/.git):

```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
npm i -D vitest @vitest/coverage-v8
```

If create-next-app refuses non-empty dir, scaffold in `../navalia-tmp` and move everything except `.git`, `docs/`, `.gitignore`, `*.pdf` into root, merging `.gitignore`.

- [ ] **Step 2:** Add `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

Add scripts to `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`.

- [ ] **Step 3:** Create `src/lib/brand.ts`:

```ts
export const BRAND = {
  name: 'Navalia',
  tagline: 'Agenda inteligente para barbearias',
} as const
```

- [ ] **Step 4:** Smoke test `src/modules/health/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BRAND } from '@/lib/brand'

describe('scaffold', () => {
  it('exposes brand token', () => {
    expect(BRAND.name).toBe('Navalia')
  })
})
```

Run: `npm test` → PASS. Run `npm run build` → succeeds.

- [ ] **Step 5:** Commit: `chore: scaffold next.js 15 app with vitest`

### Task 2: Docker Compose dev + env

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.env` (local, gitignored)

**Interfaces:**
- Produces: Postgres on `:5432` (db `navalia`), Redis on `:6379`, Evolution API on `:8080`. Env contract (names below) used by all later tasks.

- [ ] **Step 1:** `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: navalia
      POSTGRES_PASSWORD: navalia
      POSTGRES_DB: navalia
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  evolution:
    image: atendai/evolution-api:v2.2.3
    ports: ["8080:8080"]
    environment:
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY:-navalia-dev-key}
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://navalia:navalia@postgres:5432/evolution?schema=public
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/1
    depends_on: [postgres, redis]
volumes:
  pgdata:
```

Note: Evolution needs its own DB — add init script or create manually: `docker compose exec postgres psql -U navalia -c 'CREATE DATABASE evolution'` (document in README later).

- [ ] **Step 2:** `.env.example` (copy to `.env`):

```env
DATABASE_URL=postgresql://navalia:navalia@localhost:5432/navalia
REDIS_URL=redis://localhost:6379/0
BETTER_AUTH_SECRET=dev-secret-change-me
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
PLAN_PRICE_CENTS=9900
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
EVOLUTION_URL=http://localhost:8080
EVOLUTION_API_KEY=navalia-dev-key
EVOLUTION_WEBHOOK_TOKEN=dev-webhook-token
```

- [ ] **Step 3:** `docker compose up -d` → all three healthy (`docker compose ps`). `curl -s localhost:8080` returns Evolution banner JSON.
- [ ] **Step 4:** Commit: `build: add dev docker compose (postgres, redis, evolution)`

### Task 3: Prisma schema + client

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`, `src/lib/redis.ts`
- Modify: `package.json` (scripts `db:migrate`, `db:push`, `db:studio`, `seed`)

**Interfaces:**
- Produces: full data model; `prisma` singleton; `redis` singleton (ioredis). Enums: `Role`, `SubscriptionStatus`, `AppointmentStatus`, `AppointmentSource`, `WhatsappStatus`, `ConversationState`.

- [ ] **Step 1:** `npm i prisma @prisma/client ioredis && npx prisma init`. Write `prisma/schema.prisma`:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { OWNER BARBER }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED }
enum AppointmentStatus { PENDING CONFIRMED COMPLETED CANCELLED NO_SHOW }
enum AppointmentSource { PUBLIC_PAGE WHATSAPP ADMIN AI_WEB COPILOT }
enum WhatsappStatus { DISCONNECTED CONNECTING CONNECTED }
enum ConversationState { OPEN WAITING_CONFIRMATION APPOINTMENT_CREATED TRANSFERRED_TO_HUMAN CLOSED }

model Barbershop {
  id                   String   @id @default(cuid())
  name                 String
  slug                 String   @unique
  phone                String?
  address              String?
  description          String?
  logoUrl              String?
  timezone             String   @default("America/Bahia")
  businessHours        Json     // { "0": null, "1": {"start":"09:00","end":"19:00"}, ... } keys 0-6 (Sun-Sat)
  cancellationPolicy   String?
  subscriptionStatus   SubscriptionStatus @default(TRIALING)
  trialEndsAt          DateTime
  stripeCustomerId     String?  @unique
  stripeSubscriptionId String?
  evolutionInstanceId  String?  @unique
  whatsappStatus       WhatsappStatus @default(DISCONNECTED)
  onboardingCompleted  Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  users         User[]
  professionals Professional[]
  services      Service[]
  customers     Customer[]
  appointments  Appointment[]
}

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  emailVerified Boolean @default(false)
  image        String?
  role         Role     @default(OWNER)
  barbershopId String?
  barbershop   Barbershop? @relation(fields: [barbershopId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
  accounts     Account[]
}

// Session, Account, Verification: standard Better Auth models (generated by
// `npx @better-auth/cli generate` in Task 5 — keep whatever it outputs, plus
// the User fields above).

model Professional {
  id           String  @id @default(cuid())
  barbershopId String
  barbershop   Barbershop @relation(fields: [barbershopId], references: [id])
  name         String
  bio          String?
  avatarUrl    String?
  isActive     Boolean @default(true)
  userId       String? @unique
  services     ProfessionalService[]
  availabilityRules AvailabilityRule[]
  scheduleBlocks    ScheduleBlock[]
  appointments      Appointment[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([barbershopId])
}

model Service {
  id           String  @id @default(cuid())
  barbershopId String
  barbershop   Barbershop @relation(fields: [barbershopId], references: [id])
  name         String
  description  String?
  priceCents   Int
  durationMin  Int
  isActive     Boolean @default(true)
  sortOrder    Int     @default(0)
  professionals ProfessionalService[]
  appointments  Appointment[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([barbershopId])
}

model ProfessionalService {
  professionalId String
  serviceId      String
  professional   Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)
  service        Service      @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  @@id([professionalId, serviceId])
}

model AvailabilityRule {
  id             String @id @default(cuid())
  barbershopId   String
  professionalId String
  professional   Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)
  weekday        Int    // 0-6 Sun-Sat
  startTime      String // "HH:mm"
  endTime        String
  @@index([barbershopId, professionalId])
}

model ScheduleBlock {
  id             String @id @default(cuid())
  barbershopId   String
  professionalId String
  professional   Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)
  date           String // "YYYY-MM-DD"
  startTime      String
  endTime        String
  reason         String?
  source         String @default("USER") // USER | COPILOT
  createdAt      DateTime @default(now())
  @@index([barbershopId, professionalId, date])
}

model Customer {
  id           String  @id @default(cuid())
  barbershopId String
  barbershop   Barbershop @relation(fields: [barbershopId], references: [id])
  name         String
  phone        String
  email        String?
  notes        String?
  appointments Appointment[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([barbershopId, phone])
}

model Appointment {
  id             String @id @default(cuid())
  barbershopId   String
  barbershop     Barbershop @relation(fields: [barbershopId], references: [id])
  customerId     String
  customer       Customer @relation(fields: [customerId], references: [id])
  professionalId String
  professional   Professional @relation(fields: [professionalId], references: [id])
  serviceId      String
  service        Service @relation(fields: [serviceId], references: [id])
  date           String // "YYYY-MM-DD"
  startTime      String // "HH:mm"
  endTime        String
  status         AppointmentStatus @default(CONFIRMED)
  source         AppointmentSource
  notes          String?
  cancelledAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([barbershopId, professionalId, date, status])
  @@index([barbershopId, date])
}

model WhatsappConversation {
  id            String @id @default(cuid())
  barbershopId  String
  customerPhone String
  state         ConversationState @default(OPEN)
  lastMessageAt DateTime @default(now())
  messages      WhatsappMessage[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([barbershopId, customerPhone])
}

model WhatsappMessage {
  id             String @id @default(cuid())
  barbershopId   String
  conversationId String
  conversation   WhatsappConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction      String // INBOUND | OUTBOUND
  senderType     String // CUSTOMER | AI | SYSTEM
  content        String
  createdAt      DateTime @default(now())
  @@index([conversationId])
}

model AiActionLog {
  id                   String @id @default(cuid())
  barbershopId         String
  channel              String // WHATSAPP | AI_WEB | COPILOT | INSIGHTS
  toolName             String
  input                Json
  output               Json?
  status               String // EXECUTED | PENDING_CONFIRMATION | CONFIRMED | REJECTED | ERROR
  requiresConfirmation Boolean @default(false)
  confirmedAt          DateTime?
  userId               String?
  createdAt            DateTime @default(now())
  @@index([barbershopId, createdAt])
}

model AuditLog {
  id           String @id @default(cuid())
  barbershopId String
  userId       String?
  action       String
  entity       String
  entityId     String?
  payload      Json?
  createdAt    DateTime @default(now())
  @@index([barbershopId, createdAt])
}

model WebhookEvent {
  id          String   @id @default(cuid())
  provider    String   // STRIPE | EVOLUTION
  eventId     String
  processedAt DateTime @default(now())
  @@unique([provider, eventId])
}
```

- [ ] **Step 2:** `src/lib/prisma.ts` (singleton) and `src/lib/redis.ts` (ioredis singleton, lazy). Standard global-caching pattern for dev hot-reload.
- [ ] **Step 3:** `npx prisma migrate dev --name init` → migration applied. `npx prisma generate`.
- [ ] **Step 4:** Commit: `feat(db): add prisma schema and infra clients`

### Task 4: Design system tokens

**Files:**
- Create: `docs/superpowers/design-system.md`, update `src/app/globals.css`, `src/app/layout.tsx` (fonts)
- Run: `npx shadcn@latest init` + add base components (`button input label card dialog select table tabs badge sonner sheet dropdown-menu calendar popover skeleton`)

**Interfaces:**
- Produces: CSS custom properties consumed by every UI task: `--background/--foreground/--primary(brass)/--card/...` in dark (marketing/public) and light (dashboard) scopes; font vars `--font-display` (Fraunces), `--font-sans` (Geist/Inter).

- [ ] **Step 1:** Install fonts via `next/font/google` (Fraunces + Inter) in `layout.tsx`; expose as CSS vars.
- [ ] **Step 2:** Re-tokenize shadcn theme in `globals.css`: warm charcoal darks (`#171412`, elevated `#211D19`), warm off-white lights (`#F5F1EA`, paper `#FBF9F5`), brass primary (`#C4964A`, hover `#B0843C`), muted warm grays; radius `0.5rem`; subtle shadows only. Two theme scopes: `.theme-dark` (marketing/public/auth) and default light (dashboard).
- [ ] **Step 3:** Write `docs/superpowers/design-system.md`: palette table, type scale (Fraunces display for h1/h2/stat numbers; Inter for UI), spacing rhythm, component conventions (buttons, cards, tables, empty states, status badges per AppointmentStatus color), anti-patterns list (no purple gradients, no glass, no emoji-heavy UI).
- [ ] **Step 4:** `npm run build` passes. Commit: `feat(ui): navalia design tokens and shadcn base`

---

## Phase 1 — Auth & Tenancy

### Task 5: Better Auth + signup→tenant + guards

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, `src/modules/tenancy/context.ts`, `src/middleware.ts`
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`
- Test: `src/modules/tenancy/context.test.ts`

**Interfaces:**
- Produces: `auth` (Better Auth server instance, email+password, Prisma adapter); `requireOwner()` / `requireMember()` server helpers in `tenancy/context.ts` returning `{ user, barbershop }` or redirecting; `signUpBarbershop(input)` server action that creates User + Barbershop in one transaction with `subscriptionStatus: TRIALING`, `trialEndsAt: now + 7 days`, slug from shop name (slugified, uniquified with suffix).

- [ ] **Step 1:** `npm i better-auth`. Configure `src/lib/auth.ts` with `emailAndPassword: { enabled: true }`, Prisma adapter, session cookie. Run `npx @better-auth/cli generate` → merge generated Session/Account/Verification models into schema, `prisma migrate dev --name auth`.
- [ ] **Step 2 (failing test):** `context.test.ts` — unit test pure helpers: `slugify('Barbearia do João') === 'barbearia-do-joao'`; `computeTrialEnd(new Date('2026-07-01T12:00:00Z'))` → 2026-07-08. Run → FAIL.
- [ ] **Step 3:** Implement `slugify`, `computeTrialEnd`, `signUpBarbershop` action (auth signup + tx: create Barbershop TRIALING + link user as OWNER + AuditLog `SIGNUP`). Run tests → PASS.
- [ ] **Step 4:** Login/signup pages (dark theme, brand, Fraunces headline; signup asks: your name, email, password, shop name). `src/middleware.ts`: `/dashboard/*` requires session, redirect `/login`.
- [ ] **Step 5:** Manual check: signup → row in Barbershop with trialEndsAt +7d → redirected to `/dashboard/onboarding`. Commit: `feat(auth): better-auth signup creating trialing barbershop`

### Task 6: Onboarding wizard

**Files:**
- Create: `src/app/(dashboard)/onboarding/page.tsx` (+ step components), `src/modules/tenancy/onboarding-actions.ts`

**Interfaces:**
- Consumes: `requireOwner()`.
- Produces: server actions `saveShopBasics`, `saveBusinessHours`, `createFirstService`, `createFirstProfessional`, `completeOnboarding` (sets `onboardingCompleted: true`). Dashboard layout redirects to `/dashboard/onboarding` while incomplete.

- [ ] **Step 1:** 4-step wizard (dados da barbearia → horários de funcionamento (per weekday, closed toggle) → primeiro serviço (nome, preço, duração) → primeiro profissional (nome; auto-link to the service)). Final screen shows public URL `/{slug}` + copy button + "Ir para o painel".
- [ ] **Step 2:** Business hours stored as the `businessHours` Json shape from Task 3. Zod-validate `HH:mm` and start<end.
- [ ] **Step 3:** Manual: complete wizard → `onboardingCompleted=true`, service+professional exist and linked. Commit: `feat(onboarding): 4-step shop setup wizard`

---

## Phase 2 — Catalog

### Task 7: Services CRUD

**Files:**
- Create: `src/app/(dashboard)/servicos/page.tsx`, `src/modules/catalog/service-actions.ts`
- Test: `src/modules/catalog/catalog.test.ts` (zod schema validation: rejects priceCents ≤ 0, durationMin not in 5..480)

**Interfaces:**
- Produces: `listServices(tenantId)`, `createService`, `updateService`, `toggleService`, `reorderServices` server actions, all tenant-scoped via `requireOwner()`.

- [ ] Steps: failing zod test → implement schemas + actions → page with table (nome, preço BRL-formatted, duração, status badge, profissionais vinculados count), dialog form create/edit, activate/deactivate, drag-or-buttons reorder → tests pass → manual check → commit `feat(catalog): services crud`.

### Task 8: Professionals + availability + blocks

**Files:**
- Create: `src/app/(dashboard)/profissionais/page.tsx` (+ detail sheet), `src/modules/catalog/professional-actions.ts`, `src/modules/catalog/availability-actions.ts`

**Interfaces:**
- Produces: `createProfessional`, `updateProfessional`, `toggleProfessional`, `setProfessionalServices(professionalId, serviceIds[])`, `upsertAvailabilityRules(professionalId, rules[])` (rules: `{weekday, startTime, endTime}[]`, replace-all semantics), `createScheduleBlock`, `deleteScheduleBlock`.
- Produces for booking: availability rules + blocks data shapes used by Task 9.

- [ ] Steps: professional list page with cards (avatar initials, nome, serviços chips, status) → detail sheet with 3 tabs: dados / serviços (checkbox list) / disponibilidade (weekly grid editor: per weekday enable + start/end) → blocks managed in agenda screen (Task 11) but action created here → zod tests for rule validation (start<end, weekday 0-6) → commit `feat(catalog): professionals with availability rules`.

---

## Phase 3 — Booking Core

### Task 9: Booking engine (TDD, the heart)

**Files:**
- Create: `src/modules/booking/slots.ts`, `src/modules/booking/create-appointment.ts`, `src/modules/booking/types.ts`
- Test: `src/modules/booking/slots.test.ts`, `src/modules/booking/conflict.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type TimeRange = { start: string; end: string } // "HH:mm"
export type SlotInput = {
  businessHours: TimeRange | null          // for the target weekday
  availabilityRules: TimeRange[]           // professional's rules for that weekday
  blocks: TimeRange[]                      // schedule blocks that date
  appointments: TimeRange[]                // PENDING/CONFIRMED that date
  durationMin: number
  stepMin?: number                         // default 15
  minStart?: string                        // e.g. "now" cutoff for today, optional
}
// slots.ts — PURE, no IO
export function computeSlots(input: SlotInput): string[]           // start times "HH:mm"
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean
export function addMinutes(hhmm: string, min: number): string
// create-appointment.ts — IO
export async function getAvailableSlots(args: {
  tenantId: string; serviceId: string; professionalId: string | null; date: string
}): Promise<Result<{ professionalId: string; slots: string[] }[]>>
export async function createAppointment(args: {
  tenantId: string; serviceId: string; professionalId: string; date: string; startTime: string
  customer: { name: string; phone: string; email?: string }
  source: AppointmentSource
}): Promise<Result<{ appointmentId: string; endTime: string; professionalName: string; serviceName: string }>>
export async function cancelAppointment(args: { tenantId: string; appointmentId: string; by: string }): Promise<Result<{}>>
```

- [ ] **Step 1 (failing tests):** `slots.test.ts` — the spec §16 cases, minimum set:

```ts
import { describe, expect, it } from 'vitest'
import { computeSlots, overlaps, addMinutes } from './slots'

const bh = { start: '08:00', end: '18:00' }
const avail = [{ start: '09:00', end: '17:00' }]

describe('overlaps', () => {
  it('detects newStart < existingEnd && newEnd > existingStart', () => {
    expect(overlaps('10:15', '10:45', '10:00', '10:30')).toBe(true)
    expect(overlaps('10:30', '11:00', '10:00', '10:30')).toBe(false) // touching edges ok
  })
})

describe('computeSlots', () => {
  it('intersects business hours with availability', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30, stepMin: 30 })
    expect(slots[0]).toBe('09:00')
    expect(slots.at(-1)).toBe('16:30') // 16:30+30 = 17:00 fits
  })
  it('removes lunch block', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [{ start: '12:00', end: '13:00' }], appointments: [], durationMin: 30, stepMin: 30 })
    expect(slots).not.toContain('12:00')
    expect(slots).not.toContain('12:30')
    expect(slots).toContain('13:00')
  })
  it('removes booked ranges and partial overlaps', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [{ start: '10:00', end: '10:30' }], durationMin: 60, stepMin: 30 })
    expect(slots).not.toContain('09:30') // 09:30+60 crosses 10:00
    expect(slots).not.toContain('10:00')
    expect(slots).toContain('10:30')
  })
  it('closed day → empty', () => {
    expect(computeSlots({ businessHours: null, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30 })).toEqual([])
  })
  it('service longer than any window → empty', () => {
    expect(computeSlots({ businessHours: bh, availabilityRules: [{ start: '09:00', end: '09:30' }], blocks: [], appointments: [], durationMin: 60 })).toEqual([])
  })
  it('respects minStart cutoff', () => {
    const slots = computeSlots({ businessHours: bh, availabilityRules: avail, blocks: [], appointments: [], durationMin: 30, stepMin: 30, minStart: '15:00' })
    expect(slots[0]).toBe('15:00')
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2:** Implement `slots.ts` pure functions (minutes-since-midnight math; intersect windows; walk step grid; filter candidates whose `[start, start+duration)` fits a window and hits no block/appointment via `overlaps`). Run → PASS.
- [ ] **Step 3:** Implement `create-appointment.ts`:
  - `getAvailableSlots`: load service (active, tenant), eligible professionals (active + linked, or the one requested), their rules for weekday, blocks + PENDING/CONFIRMED appointments for date, shop businessHours for weekday; today → `minStart = now` in shop timezone; map through `computeSlots`.
  - `createAppointment`: `prisma.$transaction` with `isolationLevel: 'Serializable'` + retry-once-on-serialization-error: validate service/professional active + linked → recompute conflicts with a fresh in-tx query using overlap condition (`startTime < newEnd AND endTime > newStart`, status in PENDING/CONFIRMED) → upsert Customer on `(barbershopId, phone)` → create Appointment CONFIRMED → AuditLog. Return typed errors: `'SLOT_TAKEN' | 'INVALID_SERVICE' | 'INVALID_PROFESSIONAL' | 'OUTSIDE_AVAILABILITY'` (also re-verify slot ∈ computeSlots inside tx).
  - `cancelAppointment`: set status CANCELLED + cancelledAt + AuditLog.
- [ ] **Step 4:** `conflict.test.ts` — integration against dev Postgres (guard with `describe.skipIf(!process.env.DATABASE_URL)`): seed tenant/service/professional/rule; create 10:00 appointment; assert 10:15 same professional fails `SLOT_TAKEN`; 10:30 succeeds; cancelled appointment frees slot; two parallel `createAppointment` for same slot → exactly one ok. Run → PASS.
- [ ] **Step 5:** Commit: `feat(booking): slot engine and conflict-safe appointment creation`

### Task 10: Public booking page `/{slug}`

**Files:**
- Create: `src/app/[slug]/page.tsx`, `src/app/[slug]/agendar/` step flow (client component), `src/app/[slug]/sucesso/[appointmentId]/page.tsx`, `src/modules/booking/public-actions.ts`, `src/modules/whatsapp/deep-link.ts`
- Test: `src/modules/whatsapp/deep-link.test.ts`

**Interfaces:**
- Consumes: `getAvailableSlots`, `createAppointment` (source `PUBLIC_PAGE`).
- Produces: `getPublicShop(slug)` (null if not found OR subscription invalid → page shows "indisponível"); `buildWhatsAppLink(args: { phone: string; shopName: string; service?: string; professional?: string; date?: string; time?: string }): string`; `buildConfirmationShareText(appointment): string`.

- [ ] **Step 1 (failing test):** deep-link tests: generic message when only shop; includes service name when selected; includes date/time intent when both present; URL-encodes (`Corte + Barba` → `Corte%20%2B%20Barba`); phone normalized to digits with country code `55` prefix when missing.
- [ ] **Step 2:** Implement `deep-link.ts` (`https://wa.me/{phone}?text={encodeURIComponent(msg)}`). Tests PASS. Commit `feat(whatsapp): contextual wa.me deep links`.
- [ ] **Step 3:** Public page (dark premium theme): hero (nome, descrição, endereço/telefone), services list with price/duration, professionals, CTA "Agendar agora" + secondary "Agendar pelo WhatsApp" (deep link reflects current selection). Booking flow steps: serviço → profissional ("Qualquer profissional" option) → data (next 14 days) + horários (from `getAvailableSlots`) → dados (nome, telefone, email opcional) → confirmar. Success page: recap card, código (appointment id short), política de cancelamento, "Compartilhar no WhatsApp" (share text builder). SEO: `generateMetadata` from shop.
- [ ] **Step 4:** Manual: full booking → appears in DB; invalid-subscription shop → unavailable page. Commit: `feat(public): booking page with step flow and whatsapp links`

### Task 11: Dashboard (KPIs, agenda, customers)

**Files:**
- Create: `src/app/(dashboard)/layout.tsx` (sidebar nav + trial banner slot), `src/app/(dashboard)/dashboard/page.tsx`, `src/app/(dashboard)/agenda/page.tsx`, `src/app/(dashboard)/clientes/page.tsx` (+ `[id]` detail), `src/modules/booking/admin-actions.ts`, `src/modules/insights/queries.ts`

**Interfaces:**
- Consumes: booking engine; catalog actions.
- Produces: `getDashboardKpis(tenantId)` → `{ todayCount, weekCount, todayRevenueCents, weekRevenueCents, occupancyPct, noShowRate, topServices: {name, count}[] }` (SQL aggregates in `insights/queries.ts` — reused by Task 18); admin actions `completeAppointment`, `markNoShow`, `cancelAppointment` (reuse), `rescheduleAppointment(appointmentId, newDate, newStart)` (validates via engine), `createAppointmentAdmin` (source ADMIN), `createScheduleBlock`/`deleteScheduleBlock` wiring.
- Sidebar routes: `/dashboard`, `/agenda`, `/clientes`, `/servicos`, `/profissionais`, `/copiloto`, `/whatsapp`, `/configuracoes` (+billing), `/configuracoes/logs`.

- [ ] **Step 1:** Dashboard page: KPI stat cards (Fraunces numerals), today's next appointments list, top services, insights card placeholder (Task 18 fills).
- [ ] **Step 2:** Agenda: day view (time grid per professional column, appointment cards with status color, blocks rendered hatched) + week view (compact). Filter by professional. Card actions: concluir / não compareceu / cancelar / remarcar (dialog: date+slot picker via engine) . "Novo agendamento" + "Bloquear horário" buttons.
- [ ] **Step 3:** Clientes: searchable table (nome, telefone, última visita, total gasto, no-shows), detail with appointment history.
- [ ] **Step 4:** Manual acceptance: booking from public page appears in agenda; block prevents public slots; reschedule revalidates. Commit: `feat(dashboard): kpis, agenda views, customers`

---

## Phase 4 — Billing

### Task 12: Stripe subscription lifecycle

**Files:**
- Create: `src/modules/billing/stripe.ts`, `src/modules/billing/actions.ts`, `src/modules/billing/gate.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/app/(dashboard)/configuracoes/assinatura/page.tsx`, `src/app/(dashboard)/reativar/page.tsx`, trial banner component
- Test: `src/modules/billing/gate.test.ts`

**Interfaces:**
- Produces:

```ts
// gate.ts — PURE
export function hasAccess(s: { subscriptionStatus: SubscriptionStatus; trialEndsAt: Date }, now?: Date): boolean
// actions.ts
export async function createCheckoutSession(tenantId): Promise<Result<{ url: string }>>
export async function createPortalSession(tenantId): Promise<Result<{ url: string }>>
// webhook route: handles checkout.session.completed, invoice.paid,
// invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
// idempotent via WebhookEvent(provider='STRIPE', eventId)
```

- [ ] **Step 1 (failing test):** `gate.test.ts`: TRIALING+future trialEndsAt → true; TRIALING+past → false; ACTIVE → true; PAST_DUE → false; CANCELED → false. FAIL → implement → PASS.
- [ ] **Step 2:** `npm i stripe`. Checkout session: `mode: 'subscription'`, `line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }]`, `client_reference_id: tenantId`, success/cancel URLs. Portal session from `stripeCustomerId`.
- [ ] **Step 3:** Webhook route: verify signature with `STRIPE_WEBHOOK_SECRET`; insert WebhookEvent first (unique violation → 200 early); map events → update Barbershop (`checkout.session.completed`: store customer+subscription ids, ACTIVE; `invoice.paid`: ACTIVE; `invoice.payment_failed`: PAST_DUE; `subscription.deleted`: CANCELED; `subscription.updated`: map Stripe status incl. Stripe-side trial edge cases) + AuditLog.
- [ ] **Step 4:** Enforce gate: dashboard layout calls `hasAccess` → redirect `/reativar` (reactivation screen: message, checkout button, portal link; logout available). Public page uses same check (Task 10 already consumes). Trial banner in dashboard header: "X dias restantes no teste" + CTA "Assinar — R$ 99/mês" (from `PLAN_PRICE_CENTS`).
- [ ] **Step 5:** Manual with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`: checkout test card `4242...` → ACTIVE; cancel in portal → CANCELED → gate blocks. Commit: `feat(billing): stripe subscription with app-managed trial gate`

### Task 13: Marketing landing

**Files:**
- Create: `src/app/(marketing)/page.tsx` (move scaffold `page.tsx`), section components under `src/app/(marketing)/_components/`

**Interfaces:**
- Consumes: `BRAND`, design tokens (dark theme), `PLAN_PRICE_CENTS`.

- [ ] **Step 1:** Sections: nav (logo wordmark, login, CTA), hero (headline pt-BR sobre agenda + WhatsApp com IA; product mock screenshot placeholder styled as browser frame), social-proof strip, 3 feature blocks (Agenda inteligente / Chatbot WhatsApp que agenda sozinho / Copiloto e insights), how-it-works (3 steps), pricing card (plano único, trial 7 dias sem cartão, bullets), FAQ (5 itens incl. "preciso de cartão?" e "como funciona o WhatsApp?"), footer. CTA → `/signup`.
- [ ] **Step 2:** Lighthouse sanity (no blocking images, next/image). Commit: `feat(marketing): landing page`

---

## Phase 5 — WhatsApp + AI

### Task 14: Evolution client + connect UI

**Files:**
- Create: `src/modules/whatsapp/evolution-client.ts`, `src/modules/whatsapp/instance-actions.ts`, `src/app/(dashboard)/whatsapp/page.tsx`, `src/app/api/webhooks/evolution/route.ts` (status events only; messages in Task 16)
- Test: `src/modules/whatsapp/evolution-client.test.ts` (URL/payload builders, fetch mocked)

**Interfaces:**
- Produces:

```ts
export const evolution = {
  createInstance(instanceName: string, webhookUrl: string): Promise<Result<{ qrBase64: string | null }>>,
  getConnectionState(instanceName: string): Promise<Result<'open' | 'connecting' | 'close'>>,
  getQr(instanceName: string): Promise<Result<{ qrBase64: string }>>,
  sendText(instanceName: string, toPhone: string, text: string): Promise<Result<{}>>,
  logout(instanceName: string): Promise<Result<{}>>,
}
// instance name convention: `nav_${barbershopId}`
```

Evolution v2 endpoints used: `POST /instance/create` (with `webhook` config: url + events `MESSAGES_UPSERT, CONNECTION_UPDATE`, header token), `GET /instance/connectionState/{name}`, `GET /instance/connect/{name}` (QR), `POST /message/sendText/{name}` body `{ number, text }`, `DELETE /instance/logout/{name}`. Auth header: `apikey: EVOLUTION_API_KEY`.

- [ ] Steps: builder tests (payload shapes, phone normalization `55DDDNUMBER@s.whatsapp.net` vs plain digits per endpoint) → implement client (thin fetch wrapper, Result-typed) → `/whatsapp` page: status card (badge por `whatsappStatus`), connect button → shows QR (poll state every 3s until `open`), disconnect button → webhook route handles `CONNECTION_UPDATE` (verify `EVOLUTION_WEBHOOK_TOKEN` header; map open/connecting/close → CONNECTED/CONNECTING/DISCONNECTED) → manual: scan with real phone → CONNECTED. Commit: `feat(whatsapp): per-tenant evolution instance with qr connect`

### Task 15: AI orchestrator + public tools

**Files:**
- Create: `src/modules/ai/orchestrator.ts`, `src/modules/ai/tools/public-tools.ts`, `src/modules/ai/prompts.ts`, `src/modules/ai/log.ts`
- Test: `src/modules/ai/orchestrator.test.ts` (OpenAI mocked)

**Interfaces:**
- Produces:

```ts
export type Channel = 'WHATSAPP' | 'AI_WEB' | 'COPILOT'
export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type ToolDef = {
  name: string; description: string; parameters: object // JSON schema
  execute(args: unknown, ctx: ToolCtx): Promise<unknown>
  sensitive?: boolean // copilot-only: return pendingAction instead of executing
}
export type ToolCtx = { tenantId: string; channel: Channel; userId?: string; customerPhone?: string }
export async function runAssistant(args: {
  channel: Channel; tenantId: string; history: ChatMsg[]; userMessage: string
  tools: ToolDef[]; systemPrompt: string; ctx: ToolCtx
}): Promise<Result<{ reply: string; pendingAction?: PendingAction }>>
export type PendingAction = { id: string; toolName: string; summary: string; args: unknown } // id = AiActionLog id
```

Public tools (Zod-validated args, all resolve tenant from ctx): `getServices`, `getBusinessInfo`, `getSlots({serviceId|serviceName, professionalName?, date})`, `createAppointment({serviceId, professionalId, date, startTime, customerName, confirmed: boolean})` — **returns error `NEEDS_CONFIRMATION` unless `confirmed === true`**, phone always from `ctx.customerPhone`; `cancelAppointment({appointmentId?, date?}, confirmed)`. Prompts in `prompts.ts` (pt-BR, short WhatsApp register, domain-only, confirm-before-book, ask name).

- [ ] **Step 1 (failing tests, OpenAI mocked):** loop executes tool call and feeds result back until text answer (max 6 iterations); `createAppointment` with `confirmed:false` → tool returns needs-confirmation, no booking call made; every executed tool → `AiActionLog` row (assert via prisma mock or test db); tool arg failing Zod → error surfaced to model, loop continues.
- [ ] **Step 2:** `npm i openai zod`. Implement loop with `client.chat.completions.create({ model: OPENAI_MODEL, messages, tools })`, standard function-calling iteration; wrap tool execution with logging (`log.ts` writes AiActionLog). Tests PASS.
- [ ] **Step 3:** Commit: `feat(ai): orchestrator with guarded public booking tools`

### Task 16: WhatsApp inbound pipeline

**Files:**
- Modify: `src/app/api/webhooks/evolution/route.ts` (add MESSAGES_UPSERT)
- Create: `src/modules/whatsapp/pipeline.ts`, `src/modules/whatsapp/debounce.ts`
- Test: `src/modules/whatsapp/debounce.test.ts` (ioredis-mock or fake timers + in-memory stub)

**Interfaces:**
- Consumes: `runAssistant` + public tools; `evolution.sendText`.
- Produces: `handleInboundMessage({ instanceName, fromPhone, text, messageId })` — full pipeline; `debounceKey = wa:${tenantId}:${phone}`.

- [ ] **Step 1 (failing test):** debounce semantics: `scheduleDebounced(key, payload, 4000, flushFn)` — 3 pushes within window → single flush with concatenated texts; new push after flush → new window. Implement over Redis (`RPUSH` buffer + `SET key EX` marker + `setTimeout` in route runtime; simple and adequate for single-node deploy). PASS.
- [ ] **Step 2:** Pipeline: resolve tenant by `evolutionInstanceId = instanceName` (unknown → 200 drop); ignore `fromMe`; WebhookEvent idempotency on messageId; upsert conversation + persist INBOUND msg; if state `TRANSFERRED_TO_HUMAN` → skip bot; debounce; on flush: last 20 messages as history → `runAssistant('WHATSAPP', ...)` with `ctx.customerPhone = fromPhone` → persist OUTBOUND + `sendText`. Error path → send fallback "Opa, tive um problema aqui 😅 Vou chamar alguém da equipe pra te ajudar!" → state TRANSFERRED_TO_HUMAN. Detect human-handoff intent via tool-free instruction in prompt (model replies with marker `[HUMANO]` → pipeline flips state).
- [ ] **Step 3:** Wire `MESSAGES_UPSERT` in webhook route (token check; extract `key.remoteJid` phone, `message.conversation` or `extendedTextMessage.text`).
- [ ] **Step 4:** Manual E2E with real phone + cloudflared tunnel: greet → services → slots → book with confirmation → appointment in agenda with source WHATSAPP; conflict retry offers alternatives. Commit: `feat(whatsapp): inbound pipeline with debounce and ai booking`

### Task 17: Web assistant widget

**Files:**
- Create: `src/app/api/ai/assistant/route.ts`, `src/app/[slug]/_components/chat-widget.tsx`

**Interfaces:**
- Consumes: `runAssistant` with public tools; rate limit via Redis (`rl:${ip}` 20 msg/5min → 429).
- Produces: POST `{ slug, history: ChatMsg[], message, customerPhone? }` → `{ reply }`. Widget: floating button → panel (dark theme), suggestion chips ("Quais horários amanhã?", "Quanto custa corte e barba?"). Phone asked by the AI in-flow (needed before booking; passed back as `customerPhone` once captured — widget extracts from a `[TELEFONE:...]`-free approach: assistant asks, user types, widget sends full history; `createAppointment` uses phone captured via tool arg `customerPhone` in AI_WEB channel only).

Note: in AI_WEB channel, `createAppointment` accepts `customerPhone` as a tool arg (validated E.164-ish); in WHATSAPP channel it is forced from ctx. Implement as channel-conditional Zod schema in public-tools.

- [ ] Steps: route (resolve tenant by slug + subscription check + rate limit) → widget UI → manual booking through widget (source AI_WEB) → commit `feat(ai): public web assistant widget`.

### Task 18: Copilot + insights

**Files:**
- Create: `src/modules/ai/tools/copilot-tools.ts`, `src/app/api/ai/copilot/route.ts`, `src/app/api/ai/copilot/confirm/route.ts`, `src/app/(dashboard)/copiloto/page.tsx`, `src/modules/insights/narrate.ts`, insights card on dashboard
- Test: `src/modules/ai/copilot.test.ts`

**Interfaces:**
- Copilot tools — read (execute directly): `getAppointmentsByDate({date, professionalName?})`, `getRevenueSummary({period: 'day'|'week'|'month'})`, `getTopServices({period})`, `getInactiveCustomers({days})` (no appointment since N days), `getNoShows({period})`, `getFreeSlots({date, professionalName?})`. Sensitive (`sensitive: true` → PendingAction): `blockSchedule({professionalName, date, startTime, endTime, reason?})`, `unblockSchedule({blockId})`, `cancelAppointment({appointmentId})`.
- Confirm endpoint: POST `{ actionId }` → loads AiActionLog PENDING_CONFIRMATION → executes mapped mutation → status CONFIRMED + confirmedAt + AuditLog. Reject: POST `{ actionId, reject: true }` → REJECTED.
- `narrate.ts`: `getInsightsSummary(tenantId)` → aggregates from `insights/queries.ts` (Task 11) → OpenAI narration (pt-BR, 3-5 frases, no invented numbers — prompt injects JSON) → Redis cache `insights:${tenantId}` EX 3600.

- [ ] **Step 1 (failing tests):** sensitive tool call → orchestrator returns `pendingAction`, AiActionLog row status PENDING_CONFIRMATION, **no ScheduleBlock created**; confirm endpoint executes and stamps `confirmedAt`; read tool executes directly with status EXECUTED.
- [ ] **Step 2:** Implement tools + endpoints. Copilot page: chat panel, suggestion chips ("Quantos agendamentos tenho amanhã?", "Bloqueie minha sexta à tarde", "Faturamento da semana?", "Clientes sumidos há 45 dias"), pending-action confirmation card (summary + Confirmar/Cancelar), link to logs.
- [ ] **Step 3:** Insights card on dashboard consuming `getInsightsSummary` (with refresh button busting cache). Tests PASS. Manual: block via copilot with confirmation → block visible in agenda. Commit: `feat(ai): internal copilot with confirmed sensitive actions and insights`

---

## Phase 6 — Ship

### Task 19: Logs UI + settings + seed

**Files:**
- Create: `src/app/(dashboard)/configuracoes/page.tsx` (shop data, hours, cancellation policy, public link), `src/app/(dashboard)/configuracoes/logs/page.tsx`, `prisma/seed.ts`

**Interfaces:**
- Logs page: merged view tabs — IA (AiActionLog: quando, canal, tool, status, payload collapsible) and Auditoria (AuditLog). Filter by channel/status.
- Seed: shop "Barbearia Demo" (slug `barbearia-demo`, TRIALING valid), 2 professionals (João Silva, Carlos Mendes), 4 services (Corte R$40/30min, Barba R$35/25min, Corte+Barba R$70/60min, Sobrancelha R$20/15min), availability Mon–Sat 09–19, ~15 customers, appointments spread yesterday/today/tomorrow/this week incl. some COMPLETED/NO_SHOW for KPIs. Owner login `demo@navalia.app` / `demo1234` (via Better Auth API).

- [ ] Steps: settings page (reuse onboarding actions) → logs pages → seed script + `npm run seed` → verify dashboard KPIs populated → commit `feat: settings, ai/audit log views, demo seed`.

### Task 20: README + CI + prod compose + deploy

**Files:**
- Create: `README.md` (English), `.github/workflows/ci.yml`, `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `docs/DEPLOY.md`

**Interfaces:**
- `Dockerfile`: multi-stage, `next build` standalone output, `node server.js`, `prisma migrate deploy` on boot (entrypoint script).
- `docker-compose.prod.yml`: app + postgres + redis + evolution + caddy; env via `.env.prod`; volumes for pg/evolution; Caddyfile: `{$DOMAIN} { reverse_proxy app:3000 }` and `{$EVOLUTION_DOMAIN} { reverse_proxy evolution:8080 }` (Evolution must be publicly reachable only if webhooks originate externally — they don't; internal network suffices, so expose only app. Webhook URL for Evolution = internal `http://app:3000/api/webhooks/evolution`).
- CI: on push/PR → `npm ci`, lint, typecheck, `vitest run` (unit only; integration tests skipped without DATABASE_URL), build.
- README: what/why, screenshots placeholders, features, architecture diagram (ascii from ARCHITECTURE.md), stack badges, local setup (compose + env + migrate + seed), WhatsApp setup, Stripe test setup, deploy pointer, roadmap, license MIT.

- [ ] Steps: Dockerfile + prod compose + Caddyfile → CI yml → README + DEPLOY.md (VPS runbook: DNS, .env.prod, `docker compose -f docker-compose.prod.yml up -d`, stripe webhook endpoint config, Evolution key rotation) → `npm run build` + `docker build .` pass locally → commit `build: production compose, ci and readme` → deploy to VPS following DEPLOY.md → smoke test acceptance criteria from SPEC §6.

---

## Self-review notes

- Spec coverage: SPEC §3 core→Tasks 5–11; billing→12; WhatsApp→14–16; AI surfaces→15–18; platform→4, 13, 19–20; acceptance §6 mapped in Task 20 smoke test.
- Type consistency: `Result<T>` global; `ToolCtx.customerPhone` channel rules stated in Tasks 15/17; instance naming `nav_${barbershopId}` consistent in 14/16.
- Known deliberate deviations: UI JSX produced at execution time per Global Constraints note; Better Auth generated models kept as CLI outputs them.
