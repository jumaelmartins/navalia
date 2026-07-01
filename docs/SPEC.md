# Navalia — Product Specification

> **Navalia** (from Portuguese *navalha* — straight razor — + *IA* — AI) is a multi-tenant SaaS for barber shops: public online booking, a real WhatsApp booking chatbot, an internal AI copilot, business insights, and subscription billing with a 7-day free trial.

This document is the source of truth for product scope. Technical details live in [ARCHITECTURE.md](./ARCHITECTURE.md); the WhatsApp channel is detailed in [WHATSAPP_WORKFLOW.md](./WHATSAPP_WORKFLOW.md).

## 1. Problem

Small and mid-size barber shops manage their schedule over WhatsApp, paper, or generic tools. This causes double bookings, slow manual replies, no per-professional schedule view, lost customer history, and zero visibility into revenue and occupancy. Navalia centralizes these flows and automates customer service where it already happens: WhatsApp.

## 2. Users

| Role | Capabilities |
|---|---|
| **Owner** | Configures the barbershop, manages professionals/services/availability, sees revenue and insights, uses the full internal copilot, manages the subscription |
| **Barber** | Sees own schedule, blocks/releases time slots, sees the day's customers, limited copilot |
| **End customer** | Books via public page, via WhatsApp chatbot, or via web AI assistant — no account required (phone number identifies the customer) |

## 3. Scope (v1 — built in the initial 2-day sprint)

### Core
- Email/password auth; signup creates the barbershop (tenant) and the OWNER user
- Multi-tenancy: shared database, `barbershopId` on every domain table, tenant-scoped data access enforced at the repository layer
- Onboarding wizard: barbershop info → business hours → first service → first professional → public link
- Services CRUD (price in cents, duration, active flag, ordering)
- Professionals CRUD + N:N link to services
- Per-professional weekly availability rules + schedule blocks (lunch, day off, etc.)
- Booking engine: available-slot computation and conflict-safe transactional appointment creation
- Public booking page at `/{slug}`: services, professionals, step-by-step booking flow, contextual WhatsApp deep link, share-confirmation-on-WhatsApp
- Admin dashboard: KPIs, day/week schedule views with per-professional filter, appointment actions (complete, cancel, no-show, reschedule), customer list with history

### Billing (real)
- 7-day free trial, app-managed, **no card required at signup**
- Single monthly plan (price configurable; placeholder R$ 99/month)
- Stripe Checkout for subscription start, Stripe Billing Portal for card changes/cancellation
- Webhook-driven subscription lifecycle (idempotent); expired trial or failed payment locks the dashboard behind a reactivation screen and unpublishes the public page (data preserved)

### WhatsApp channel (real)
- Each barbershop connects **its own WhatsApp number** by scanning a QR code in the admin panel (Evolution API instance per tenant)
- AI chatbot books real appointments over WhatsApp: checks real availability, asks for the customer's name, and **never creates an appointment without explicit confirmation**
- Fallback to human: on AI failure or on request, the bot flags the conversation for the shop to take over

### AI surfaces (single orchestrator, three channels)
- **WhatsApp chatbot** — public tools: `getServices`, `getSlots`, `createAppointment`, `cancelAppointment`, `getBusinessInfo`
- **Web assistant** — same public tools, embedded as a chat widget on the public booking page
- **Internal copilot** — dashboard chat for owners/barbers: schedule queries, revenue summaries, inactive customers, no-shows, top services; sensitive actions (block/release schedule, cancel appointments) return a pending action that the user must confirm in the UI before execution
- **Insights** — backend computes aggregates with SQL; the LLM only narrates them; cached 1h
- Every AI tool execution is recorded in an AI action log; sensitive actions record confirmation timestamps

### Platform
- Marketing landing page (hero, features, pricing, trial CTA)
- Audit log for critical actions
- Demo seed data
- Tests on critical rules (slots, conflicts, subscription transitions, WhatsApp link generation, AI tool guards)
- Docker Compose for dev and prod; CI (lint, typecheck, test, build); single-VPS deploy with automatic TLS

## 4. Out of scope (roadmap)

Native mobile app, marketplace, Google Calendar sync, email/SMS notifications, multi-plan tiers, per-professional pricing, official WhatsApp Cloud API (architecture keeps the channel swappable), fiscal/financial modules, loyalty programs.

## 5. Critical business rules

### Booking
1. An appointment's interval is `[startTime, startTime + service.durationMin)`.
2. **Conflict rule**: a new appointment conflicts when `newStart < existingEnd AND newEnd > existingStart` for the same professional and date, considering only `PENDING`/`CONFIRMED` appointments.
3. Slots are computed from: barbershop business hours ∩ professional availability rules − schedule blocks − existing active appointments, stepped by service duration.
4. "Any professional" = union of all eligible professionals' slots.
5. Appointments require an active service, an active professional, and that professional must perform that service.
6. Creation re-validates conflicts inside a database transaction.
7. Customers are created/reused by phone number; customers with history are never hard-deleted.
8. Cancellation preserves history (`cancelledAt`, status `CANCELLED`).

### Appointment lifecycle
`PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW` — source tracked as `PUBLIC_PAGE | WHATSAPP | ADMIN | AI_WEB | COPILOT`.

### Subscription lifecycle
`TRIALING (7d) → ACTIVE → PAST_DUE → CANCELED`. Access gate: `TRIALING` (not expired) or `ACTIVE`. Anything else → reactivation screen, public page unpublished, data preserved.

### AI safety
- The AI never touches the database directly — only whitelisted tools, each of which validates tenant and permissions.
- No appointment creation without explicit customer confirmation; the bot asks for name + confirms date/time/service before calling `createAppointment`.
- Sensitive copilot actions require explicit UI confirmation before execution.
- All tool calls are logged. The system prompt restricts scope to the barbershop domain; off-topic requests are politely redirected.

## 6. Acceptance criteria

1. An owner can sign up, complete onboarding, and get a public booking link.
2. A customer can book through the public page; the appointment appears in the dashboard schedule.
3. Double booking is impossible (verified by tests and by concurrent attempts).
4. The owner can connect a real WhatsApp number by scanning a QR code.
5. A customer can book a real appointment through WhatsApp chat, with explicit confirmation.
6. The trial starts at signup without a card and the dashboard shows the countdown.
7. Checkout (Stripe test mode) activates the subscription via webhook; canceling reverts access.
8. The copilot blocks a schedule interval only after UI confirmation, and the action is logged.
9. Insights show real aggregates narrated by the LLM.
10. `npm test` passes; CI is green; the stack boots with `docker compose up` and deploys to a VPS.

## 7. UI language & branding

Product UI is **pt-BR**. Repository docs and README are in English. The brand name "Navalia" is referenced through a single branding token/config so it can be changed cheaply.
