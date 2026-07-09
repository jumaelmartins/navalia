# Navalia — Roadmap

Planned features, in rough priority order. Architecture notes describe how each
fits the existing design (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

## v1.1 — Auth & booking policies

### Google sign-in  ✅ shipped (2026-07-08)
Better Auth ships a Google OAuth provider — add `socialProviders.google` to
`src/lib/auth.ts` + button on login/signup. Small.

### Owner-configurable booking payment policy
Owner decides whether an appointment is confirmed immediately or only after
payment of a configurable share of the service price (100% / 50% / custom %).

- The `AppointmentStatus.PENDING` state already exists and is already honored
  by the conflict checker — it becomes "awaiting payment".
- New Barbershop fields: `bookingPaymentPolicy (NONE | FULL | PARTIAL)`,
  `bookingPaymentPercent`, plus payment-method config.
- Customer-facing charge (Pix / card) is a NEW money flow, separate from the
  SaaS subscription: requires Stripe Connect (or Mercado Pago/Asaas split) so
  funds go to the barbershop, not the platform.
- Booking flows (public page + WhatsApp bot) branch after slot validation:
  policy NONE → CONFIRMED (today's behavior); else → PENDING + payment link;
  webhook confirms → CONFIRMED; unpaid TTL → auto-cancel (frees the slot).

### Owner-configurable cancellation policy
- Fields: `cancellationWindowHours` (e.g. 24h), `cancellationFeePercent`
  (0 = free cancel always).
- `cancelAppointment` (all channels) checks the window; inside the window,
  either blocks with a message or applies the fee (requires payment flow
  above for actual charging).

### Late-arrival surcharge
- Fields: `lateToleranceMin`, `lateFeePercent`.
- Applied when staff marks the appointment COMPLETED with a recorded delay —
  informational at first (shown in the register), enforced once customer
  payments exist.

## v1.2 — Agent capabilities & owner operations

### Voice-message understanding (speech-to-text)
The WhatsApp pipeline already routes non-text messages to a single branch
(`pipeline.ts` — currently replies `NON_TEXT_REPLY`). Add audio handling there:

- Detect `audioMessage` (WhatsApp sends Opus in an Ogg container).
- Fetch the bytes via Evolution `POST /chat/getBase64FromMediaMessage/{instance}`
  (or the base64 already carried in the upsert payload).
- Transcribe with OpenAI (`gpt-4o-mini-transcribe` or `whisper-1`; both accept
  ogg/opus directly), then feed the transcript into the existing text flow as
  if the customer had typed it.
- Guards: cap audio duration/size (cost + abuse), keep within the debounce
  latency budget, fall back to `NON_TEXT_REPLY` on transcription failure, log
  to `AiActionLog`. Image/sticker keep the current non-text reply.
- Cost order of magnitude: ~US$0.006/min. No architecture change.

### New-appointment notifications for the owner
Two layers:

- **Dashboard (source of truth):** new `Notification` model
  (`barbershopId`, `type`, `appointmentId`, `readAt`), created inside
  `createAppointment` for *every* source (public page, WhatsApp bot, admin).
  Unread badge + list + mark-read. Polling is enough at first; SSE later.
- **WhatsApp push (opt-in convenience):** `sendText` to the owner's configured
  number via the existing Evolution instance.

Reuses the owner-phone config introduced by the admin flow below — build
together.

### Owner operations over WhatsApp (admin channel)
Let the owner run platform actions by asking the AI over WhatsApp. Fits the
orchestrator cleanly: the copilot is already "internal tools + human
confirmation" — this is a new *channel* reusing that registry.

**Identity model — decided: pre-registered number, NOT password-in-chat.**

- Passwords typed into WhatsApp persist in cleartext across WhatsApp servers,
  Evolution logs, the message DB, and the device chat history — permanently
  exposing the owner credential. Rejected: it would be the weakest link in an
  app whose security model is "credentials never travel an untrusted channel."
- Instead the owner registers their personal number in the (already
  authenticated) web dashboard. That number is the **server-verified identity
  anchor** — same pattern the AI layer already uses (identity from server ctx,
  never from model output). The sender JID comes from Evolution/WhatsApp, not
  from message content, so it can't be forged by typing.

**Layered defenses:**
- Admin number(s) registrable only by an authenticated owner.
- Sensitive actions keep the existing confirmation path (`pendingAction` +
  atomic claim); over WhatsApp the confirmation becomes a "confirmar" reply
  gated on a pending-action id stored on the conversation.
- Optional step-up PIN shown in the web dashboard for the first admin session
  or per high-impact action (mitigates SIM-swap risk on the owner's number).
- Per-number rate limit; full `AiActionLog`.

**Architecture:**
- New `Channel` value `ADMIN_WHATSAPP` (`src/modules/ai/types.ts`).
- Pipeline branches at tenant/phone resolution: inbound phone ∈
  `barbershop.adminPhones` → `runAssistant` with the copilot registry + OWNER
  role + an admin system prompt; otherwise today's public flow.
- New Barbershop field `adminPhones String[]` (or a table for multi-owner).
- Real new work: text-based sensitive-action confirmation over WhatsApp (store
  the pending id on the conversation, resolve it with the same atomic claim as
  the web confirm route). Role gating (BARBER gets no sensitive tools) already
  exists.

## Later
- Official WhatsApp Cloud API adapter (transport swap only — pipeline/tools
  unchanged)
- Appointment reminders (WhatsApp templates)
- Human-takeover inbox in the dashboard
- E-mail notifications; CSV exports; multi-plan tiers; PWA
