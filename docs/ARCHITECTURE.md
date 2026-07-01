# Navalia — Architecture

## 1. Overview

Navalia is a **full-stack Next.js 15 monolith** (App Router, TypeScript). UI, API route handlers, and webhooks ship as one deployable unit. Domain logic lives in framework-agnostic modules so channels (web, WhatsApp, copilot) share the same use cases.

```
Browser / WhatsApp
      │
      ▼
┌─────────────────────────────────────────────┐
│ Next.js app (standalone)                    │
│  app/(marketing)   landing                  │
│  app/(auth)        login/signup             │
│  app/(dashboard)   admin panel              │
│  app/[slug]        public booking page      │
│  app/api/webhooks/stripe                    │
│  app/api/webhooks/evolution                 │
│  app/api/ai/*      web assistant + copilot  │
│                                             │
│  src/modules/      domain logic (pure)      │
│    booking/ billing/ whatsapp/ ai/ tenancy/ │
│  src/lib/          prisma redis auth stripe │
└──────┬────────┬────────┬────────┬───────────┘
       │        │        │        │
   PostgreSQL Redis  Evolution  OpenAI / Stripe
                       API       (external)
```

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router, standalone output) | One deploy, server components, route handlers for webhooks |
| Styling | Tailwind v4 + shadcn/ui **re-tokenized** | Speed without template look |
| ORM/DB | Prisma + PostgreSQL 16 | Relational rules (conflicts, tenancy) |
| Cache/queue | Redis | WhatsApp message debounce, slot cache, rate limiting |
| Auth | Better Auth (email+password, Prisma adapter) | Fast setup, session management |
| Payments | Stripe (Checkout, Billing Portal, webhooks) | Best DX for subscriptions |
| WhatsApp | Evolution API v2 (self-hosted container) | Per-tenant number via QR, viable multi-tenant WhatsApp |
| LLM | OpenAI `gpt-4o-mini` (env-configurable) | Cheap, fast function calling |
| Tests | Vitest | Critical rules coverage |
| CI | GitHub Actions | lint, typecheck, test, build |
| Deploy | Single VPS, Docker Compose, Caddy (auto-TLS) | Cheap, controls Evolution container locally |

## 3. Multi-tenancy

Shared database, `barbershopId` column on every domain table. Enforcement:

- `src/modules/tenancy` resolves the tenant from the authenticated session (dashboard), from the public slug (booking page), or from the Evolution instance name (WhatsApp webhook).
- Domain modules receive `tenantId` explicitly; repository helpers require it — there is no query path without a tenant filter.
- Public AI tools take the tenant from the resolved context, never from model output.

## 4. Data model (Prisma)

All domain tables carry `barbershopId`. Key entities:

- **Barbershop** — tenant: `name, slug, phone, address, logoUrl, timezone, businessHours (JSON per weekday), cancellationPolicy, subscriptionStatus, trialEndsAt, stripeCustomerId, stripeSubscriptionId, evolutionInstanceId, whatsappStatus`
- **User** — `role OWNER|BARBER`, linked to Barbershop (Better Auth owns credentials/sessions)
- **Professional** — `name, bio, avatarUrl, isActive, userId?`
- **Service** — `name, description, priceCents, durationMin, isActive, sortOrder`
- **ProfessionalService** — N:N
- **AvailabilityRule** — `professionalId, weekday, startTime, endTime`
- **ScheduleBlock** — `professionalId, date, startTime, endTime, reason, source`
- **Customer** — `name, phone (primary identifier), email?, notes`
- **Appointment** — `customerId, professionalId, serviceId, date, startTime, endTime, status, source, notes, cancelledAt`
- **WhatsappConversation** — `customerPhone, state, lastMessageAt` + **WhatsappMessage** — `direction, senderType, content`
- **AiActionLog** — `channel, toolName, input, output, status, requiresConfirmation, confirmedAt`
- **AuditLog** — `userId, action, entity, entityId, payload`
- **WebhookEvent** — `provider, eventId (unique), processedAt` → idempotency for Stripe/Evolution

## 5. Booking engine (`src/modules/booking`)

The heart of the system; fully unit-tested.

- `getAvailableSlots(tenantId, serviceId, professionalId | null, date)` — pure function over loaded data: intersects business hours with the professional's availability rules, subtracts schedule blocks and active appointments, steps by service duration. `professionalId = null` returns the union across eligible professionals.
- `createAppointment(...)` — inside a Prisma transaction: re-validate service/professional active + linked, recompute conflict (`newStart < existingEnd AND newEnd > existingStart` on `PENDING|CONFIRMED`), upsert Customer by phone, insert `CONFIRMED` appointment, write AuditLog. Serializable isolation on the conflict window.

Every channel (public page, WhatsApp bot, web assistant, copilot, admin panel) calls these same functions — the channel only sets `source`.

## 6. AI orchestrator (`src/modules/ai`)

`runAssistant(channel, tenantId, messages, toolContext)` — one loop, channel-specific tool registry and system prompt:

- **Public registry** (WhatsApp + web assistant): `getServices, getSlots, createAppointment, cancelAppointment, getBusinessInfo`. Prompts enforce: short conversational replies, domain-only, ask name + explicit confirmation before booking.
- **Copilot registry** (dashboard): read tools execute immediately (`getAppointmentsByDate, getRevenueSummary, getInactiveCustomers, getNoShows, getTopServices`); sensitive tools (`blockSchedule, unblockSchedule, cancelAppointment`) **do not execute** — they return a structured `pendingAction` which the UI renders as a confirmation card; on confirm, a separate endpoint executes it and stamps `confirmedAt`.
- Every tool call → `AiActionLog`. Tool inputs are validated with Zod; tenant comes from context, never from the model.
- **Insights**: SQL aggregates computed by the backend, LLM narrates the JSON, response cached in Redis for 1h.

## 7. Billing (`src/modules/billing`)

- Signup → `subscriptionStatus = TRIALING`, `trialEndsAt = now + 7 days`, no card.
- Upgrade → Stripe Checkout Session (monthly subscription). Return + webhooks drive state:
  - `checkout.session.completed` → store customer/subscription ids, status `ACTIVE`
  - `invoice.paid` → `ACTIVE`; `invoice.payment_failed` → `PAST_DUE`
  - `customer.subscription.deleted` → `CANCELED`
- Webhooks are idempotent via `WebhookEvent(provider, eventId)` unique insert-first.
- Access gate (middleware + layout guard): valid `TRIALING` or `ACTIVE` required for the dashboard; otherwise a reactivation screen. Public page `/{slug}` returns 404-style "unavailable" for shops without valid subscription.
- Stripe Billing Portal handles card updates and cancellations.

## 8. WhatsApp channel

See [WHATSAPP_WORKFLOW.md](./WHATSAPP_WORKFLOW.md). Summary: one Evolution API instance per barbershop (`evolutionInstanceId`), connected via QR in the dashboard; inbound messages hit `/api/webhooks/evolution`, are debounced 4s per conversation in Redis (merges fragmented messages), run through the public AI registry, and replies go out via Evolution's send-message API. WhatsApp is **a channel, not business logic** — swapping to the official Cloud API later touches only the adapter.

## 9. Error handling & observability

- Domain use cases return typed results (`ok/err`) — no throw-for-control-flow.
- Webhook handlers: verify signature (Stripe) / API key (Evolution), insert `WebhookEvent` first, process, always 200 on duplicates.
- Chatbot failure path: any orchestrator error → friendly fallback message + conversation flagged `TRANSFERRED_TO_HUMAN`.
- Structured logs (pino), request id, `/api/health` endpoint checking DB + Redis.

## 10. Deployment

- **Dev**: `docker-compose.yml` runs postgres + redis + evolution; app runs `next dev`. Stripe via `stripe listen`; Evolution webhook via cloudflared tunnel.
- **Prod**: `docker-compose.prod.yml` adds the app (standalone build) and Caddy (reverse proxy + auto-TLS) on a single VPS. Webhook URLs point at the public domain.
- CI: GitHub Actions — install, lint, typecheck, test, build.

## 11. Key decisions

1. **Monolith over monorepo/NestJS** — the 2-day budget demands one build, one deploy; domain modules keep the boundaries clean.
2. **App-managed trial** (no card at signup) — lower friction; Stripe only enters at conversion.
3. **Evolution API over Cloud API** — per-tenant numbers via QR are feasible today; official API requires per-business Meta verification. Risk (unofficial) documented and accepted; adapter keeps it swappable.
4. **SQL computes, LLM narrates** — insights are deterministic; the model never invents numbers.
5. **AI acts only through whitelisted, tenant-validated, logged tools** — with human confirmation for sensitive actions.
