# Navalia

**Smart scheduling for barbershops — with a real WhatsApp AI chatbot, an internal copilot, and subscription billing.**

[![CI](https://github.com/YOUR_ORG/navalia/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/navalia/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748)

---

## What is Navalia?

Navalia (*navalha* — straight razor — + *IA* — AI) is a multi-tenant SaaS for barbershops. It gives each shop a public online booking page, a WhatsApp chatbot that books real appointments through natural conversation, an internal AI copilot for owners and barbers, business insights, and a subscription tier with a 7-day free trial.

The product is built as a single full-stack Next.js 16 monolith — one repository, one Docker image, one VPS. Domain logic (booking engine, billing, WhatsApp channel, AI orchestrator) lives in framework-agnostic modules so every channel (web page, WhatsApp, copilot, admin panel) shares the same use cases. Nothing is simulated: Stripe processes real payments, Evolution API connects real WhatsApp numbers, OpenAI runs real function-calling agents.

---

## Features

### Booking

- Multi-tenant shared database; every domain table carries `barbershopId`
- Onboarding wizard: barbershop info → business hours → first service → first professional → public link
- Services and professionals CRUD; per-professional weekly availability rules + schedule blocks
- **Booking engine**: available-slot computation that intersects business hours with professional rules, subtracts blocks and existing appointments, and steps by service duration
- Conflict-safe appointment creation inside a Serializable transaction — double bookings are impossible
- Public booking page at `/{slug}` (step-by-step flow, WhatsApp deep link, confirmation sharing)
- Admin dashboard: KPIs, day/week schedule views, appointment actions (complete, cancel, no-show, reschedule), customer history

### WhatsApp AI

- Each barbershop connects its own WhatsApp number by scanning a QR code (Evolution API v2, per-tenant instance `nav_{barbershopId}`)
- Inbound messages debounced 4 s per conversation in Redis (merges fragmented messages), then routed through the AI orchestrator
- The chatbot checks real availability, asks for the customer's name, and **never creates an appointment without an explicit confirmation**
- Fallback to human: on AI failure or on customer request, the conversation is flagged `TRANSFERRED_TO_HUMAN`
- Full conversation history in `WhatsappConversation` / `WhatsappMessage`; idempotent webhook delivery via `WebhookEvent`

> **Risk note**: Evolution API uses Baileys (unofficial WhatsApp protocol). Numbers flagged for spam can be banned by Meta. This risk is disclosed to shop owners. The adapter is isolated so a future migration to the official WhatsApp Cloud API touches only the transport layer.

### Copilot & Insights

- Internal dashboard chat for owners and barbers
- **Read tools** execute immediately: `getAppointmentsByDate`, `getRevenueSummary`, `getInactiveCustomers`, `getNoShows`, `getTopServices`
- **Sensitive tools** — `blockSchedule`, `unblockSchedule`, `cancelAppointment` — do **not** execute on the first call; they return a `pendingAction` that the UI renders as a confirmation card; on confirm, a separate endpoint executes and stamps `confirmedAt`
- Insights: SQL aggregates computed by the backend, LLM narrates the JSON, response cached in Redis for 1 h
- Every tool call is recorded in `AiActionLog`; sensitive actions record confirmation timestamps

### Billing

- 7-day free trial, app-managed, **no card required at signup**
- Single monthly plan (configurable via `PLAN_PRICE_CENTS`; default R$ 99/month)
- Stripe Checkout for subscription start; Stripe Billing Portal for card changes and cancellations
- Webhook-driven lifecycle (`checkout.session.completed` → `ACTIVE`; `invoice.payment_failed` → `PAST_DUE`; `customer.subscription.deleted` → `CANCELED`); idempotent via `WebhookEvent`
- Access gate enforced in middleware + layout: `TRIALING` (not expired) or `ACTIVE` required; anything else → reactivation screen; public page returns 404-style "unavailable"
- Billing gate is non-spoofable: proxy overwrites `x-pathname` in the request header before it reaches the server

### Platform

- Marketing landing page (hero, features, pricing, trial CTA)
- Audit log for critical actions (`AuditLog`)
- Demo seed data (`npm run seed`)
- 237 tests covering booking engine, conflict rules, subscription transitions, WhatsApp link generation, AI tool guards, and copilot confirmation concurrency
- Docker Compose for dev and prod; GitHub Actions CI (lint, typecheck, test, build); single-VPS deploy with auto-TLS via Caddy

---

## Architecture

```
Browser / WhatsApp
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  Next.js 16 app (standalone)                        │
│                                                     │
│  app/(marketing)     landing page                   │
│  app/(auth)          login / signup                 │
│  app/(dashboard)     admin panel (gated)            │
│  app/[slug]          public booking page            │
│  app/api/webhooks/stripe                            │
│  app/api/webhooks/evolution                         │
│  app/api/ai/*        web assistant + copilot        │
│  app/api/health      readiness probe                │
│                                                     │
│  src/modules/        domain logic (framework-free)  │
│    booking/          slots + conflict engine        │
│    billing/          gate + Stripe lifecycle        │
│    whatsapp/         Evolution client + deep-link   │
│    ai/               orchestrator + tool registry   │
│    catalog/          services + professionals       │
│    tenancy/          signup + context + business-hrs│
│    insights/         SQL aggregates                 │
└──────┬──────────┬──────────┬──────────┬────────────┘
       │          │          │          │
  PostgreSQL   Redis    Evolution    OpenAI / Stripe
   (Prisma)            API v2        (external)
```

Multi-tenancy is enforced at the repository layer: every query requires an explicit `barbershopId`. There is no code path that returns cross-tenant data.

---

## Tech Stack

| Concern        | Choice                                          |
|----------------|-------------------------------------------------|
| Framework      | Next.js 16 — App Router, standalone output      |
| Language       | TypeScript 5, strict mode                       |
| Styling        | Tailwind v4 + shadcn (Base UI, re-tokenized)    |
| ORM / DB       | Prisma 7 + PostgreSQL 16                        |
| Cache          | Redis 7 (ioredis)                               |
| Auth           | Better Auth 1.6 (email+password, Prisma adapter)|
| Payments       | Stripe (Checkout, Billing Portal, webhooks)     |
| WhatsApp       | Evolution API v2 (self-hosted, per-tenant QR)   |
| LLM            | OpenAI `gpt-4o-mini` (function calling)         |
| Tests          | Vitest 4 — 237 tests                            |
| CI             | GitHub Actions                                  |
| Deploy         | Single VPS, Docker Compose, Caddy (auto-TLS)    |

---

## AI Safety Design

The AI layer is one of the main differentiators. Key properties:

1. **Whitelisted tools only** — the model can only call a fixed set of pre-validated functions; it never executes arbitrary code or queries the database directly.
2. **Tenant from context, never from the model** — `tenantId` is resolved server-side from the authenticated session or the webhook payload; the model cannot supply or override it.
3. **Booking requires explicit confirmation** — the chatbot asks for the customer's name and presents a recap before calling `createAppointment`. Implicit booking is impossible.
4. **Sensitive copilot actions require UI confirmation** — `blockSchedule`, `unblockSchedule`, and `cancelAppointment` return a `pendingAction` object instead of executing. A separate endpoint (authenticated, idempotent via `AiActionLog.status`) performs the mutation only after the operator clicks confirm.
5. **Full audit log** — every tool call is persisted in `AiActionLog` with inputs, outputs, status, and `confirmedAt` for sensitive actions.
6. **SQL computes, LLM narrates** — insight aggregates are computed by deterministic SQL queries; the model only writes prose around the numbers it receives.

---

## Screenshots

<!-- screenshot: marketing landing page hero -->
<!-- screenshot: public booking page (step 2 — select professional) -->
<!-- screenshot: admin dashboard (agenda view) -->
<!-- screenshot: WhatsApp conversation (booking flow) -->
<!-- screenshot: copilot confirmation card -->
<!-- screenshot: insights panel -->

---

## Getting Started

### Prerequisites

- Node.js 22+
- Docker Desktop (for dev dependencies: Postgres, Redis, Evolution API)
- A Stripe account (test mode keys are fine)
- An OpenAI API key

### Local setup

```bash
# 1. Clone
git clone https://github.com/YOUR_ORG/navalia.git
cd navalia

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in Stripe and OpenAI keys (see comments in the file)

# 4. Start dev dependencies
docker compose up -d

# 5. Run migrations and generate Prisma client
npx prisma migrate dev

# 6. Seed demo data
npm run seed

# 7. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Demo login: `demo@navalia.app` / `demo1234`

> **Windows note**: Docker port mappings on Windows bind to `127.0.0.1` (not `localhost`/`::1`). The `.env.example` already uses `127.0.0.1`.

---

## WhatsApp Setup

1. Open the admin dashboard → **WhatsApp** tab.
2. Click **Criar instância** — the app calls Evolution API to create a per-tenant instance and pre-registers the webhook.
3. Scan the QR code with the shop's phone (**WhatsApp → Linked Devices**).
4. Status changes to `CONNECTED`. Inbound messages now route through the AI orchestrator.

**Local development**: Evolution API is included in `docker-compose.yml`. To receive webhooks from the container, the app must be reachable from inside Docker:
- Use `EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3000` in `.env` (Docker Desktop adds this host automatically on Mac/Windows).
- On Linux, use `--add-host host.docker.internal:host-gateway` or a `cloudflared` tunnel.

---

## Stripe Test Setup

```bash
# Install the Stripe CLI
# macOS: brew install stripe/stripe-cli/stripe
# https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# The CLI prints the webhook signing secret — paste it into .env as STRIPE_WEBHOOK_SECRET
```

Create a test subscription product and price in the Stripe dashboard; paste the price ID into `STRIPE_PRICE_ID`.

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Typecheck
npm run typecheck

# Lint
npm run lint
```

### What is covered

| Module | Type | Count |
|--------|------|-------|
| Booking engine — slots | Unit | 60+ |
| Booking engine — conflicts | Integration (skipIf no DB) | — |
| Billing gate + Stripe event mapping | Unit | 21 |
| Catalog validation (services, availability) | Unit | 30+ |
| Tenancy (slug, trial, business hours, onboarding) | Unit | 40+ |
| WhatsApp deep-link generation | Unit | 20+ |
| Insights date helpers | Unit | 20+ |
| AI copilot confirm — concurrency + auth guards | Unit (mocked) | 7 |
| Rate limiter | Unit | 30+ |

Integration tests (booking conflicts against a real DB) are guarded with `describe.skipIf(!process.env.DATABASE_URL)` and are skipped in CI.

---

## Deployment

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full single-VPS runbook (provision, DNS, `.env.prod`, Docker Compose, Stripe webhook registration, Evolution QR, backups).

---

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/SPEC.md](docs/SPEC.md) | Full product specification and acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model, module overview |
| [docs/WHATSAPP_WORKFLOW.md](docs/WHATSAPP_WORKFLOW.md) | WhatsApp channel pipeline in detail |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Production deploy runbook |

---

## Roadmap

- Official WhatsApp Cloud API adapter (per-business Meta verification; architecture already accommodates the swap — only the transport layer changes)
- Email / SMS notifications for appointment reminders and cancellations
- Multi-plan tiers (per-professional pricing, higher-tier features)
- Human takeover inbox inside the dashboard for `TRANSFERRED_TO_HUMAN` conversations
- PWA / installable app for the public booking page
- Google Calendar sync

---

## License

MIT — see [LICENSE](LICENSE).

Copyright 2026 Navalia
