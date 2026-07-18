# Public booking phone verification — Design

Date: 2026-07-17
Status: Approved by user, pending implementation plan

## Problem

The public booking page (`/[slug]`) accepts name, CPF, and phone with no proof
the submitter actually controls that phone number. Anyone can type someone
else's name/CPF/phone and create an appointment impersonating them.

## Scope

This spec covers **only the public booking page** (`BookingSection.tsx`,
`source: 'PUBLIC_PAGE'`). Explicitly out of scope, and why:

- **WhatsApp AI channel** — the customer is already messaging from the real
  phone number (`ctx.customerPhone` comes from the inbound message, not user
  input); the channel itself proves phone ownership. No verification needed.
- **Admin manual booking** — the admin is entering the booking while dealing
  with the customer directly (in person or on a call); adding an OTP step
  here is pure friction with no fraud benefit.
- **AI_WEB widget** — same risk profile as the public page (arbitrary text
  input, no proof of phone ownership), but verifying inside a conversational
  AI tool-calling loop (send code → ask user to type it back → call a
  `verifyCode` tool → only then `createAppointment`) is a materially
  different, more complex flow. Deferred to a follow-up spec.

## Design

### Verify once per phone, not every booking

A customer who has already verified a given CPF+phone combination for a
barbershop does not need to re-verify on subsequent public-page bookings.
`Customer` gains `phoneVerifiedAt: DateTime?`. On each public-page booking:

- If an existing `Customer` row matches `(barbershopId, cpf)` **and**
  `phoneVerifiedAt` is set **and** its stored `phone` equals the submitted
  phone → already trusted, skip verification entirely.
- Otherwise (new customer, or same CPF with a **different** phone) →
  verification is required before the booking can be created. A phone
  change forces re-verification — this is intentional: trust is scoped to
  "this CPF + this phone", not "this CPF forever regardless of phone".

### Delivery channel: WhatsApp first, email fallback — no SMS

SMS requires a paid provider (Twilio/Zenvia/etc., roughly R$0.05–0.15 per
message, plus Brazilian carrier registration overhead) and was ruled out on
cost grounds. Two channels that are already free or already in place:

- **WhatsApp**, via the barbershop's own existing Evolution API connection
  (`evolution.sendText`, already used for owner push notifications in
  `src/modules/notifications/push.ts`). Zero incremental cost — reuses
  infrastructure the shop already runs. Available only when
  `barbershop.evolutionInstanceId` is set and `whatsappStatus === 'CONNECTED'`.
- **Email**, via the barbershop operator's own SMTP account (`nodemailer`,
  a free open-source library — no new paid service). Used when WhatsApp
  isn't connected, or as a general fallback. Requires `customerEmail` to be
  filled — if WhatsApp isn't available and the customer left email blank,
  the server tells them to provide an email before it will send a code.

The server decides the channel at send time (checks `whatsappStatus`) and
tells the client which channel was used, so the UI can say "Enviamos um
código para o seu WhatsApp" or "...para o seu e-mail" — the client never
needs to know the shop's WhatsApp status in advance.

### Code mechanics

- 6-digit numeric code, zero-padded (e.g. `"042817"`).
- Stored as a SHA-256 hash (Node's built-in `crypto`, no new dependency) —
  a fast hash is acceptable here because a short expiry + capped attempts
  already make brute force infeasible (1,000,000 possibilities, 5 attempts,
  10-minute window).
- Expires 10 minutes after creation.
- Max 5 verification attempts per code; exceeding it invalidates the code
  and the customer must request a new one.
- Resend cooldown: 60 seconds between code requests for the same
  `(barbershopId, cpf, phone)`, to prevent spamming a phone/inbox.

### Data model

New model, since a customer doesn't exist yet at first-booking time (the
`Customer` row is only created inside `createAppointment`'s transaction) —
verification has to be tracked independently of `Customer` until then:

```prisma
model PhoneVerification {
  id           String    @id @default(cuid())
  barbershopId String
  barbershop   Barbershop @relation(fields: [barbershopId], references: [id])
  cpf          String
  phone        String
  codeHash     String
  channel      String    // WHATSAPP | EMAIL
  attempts     Int       @default(0)
  expiresAt    DateTime
  verifiedAt   DateTime?
  createdAt    DateTime  @default(now())
  @@index([barbershopId, cpf, phone])
}
```

`Customer.phoneVerifiedAt DateTime?` is added as described above.

### Booking-engine enforcement

`createAppointment` gets one more pre-transaction check, applied **only**
when `args.source === 'PUBLIC_PAGE'` (WhatsApp, AI_WEB, and ADMIN sources
are unaffected):

1. Look up `Customer` by `(barbershopId, cpf)`. If found, `phoneVerifiedAt`
   is set, and its `phone` matches the normalized incoming phone → verified,
   continue.
2. Otherwise, look up the most recent `PhoneVerification` row for
   `(barbershopId, cpf, phone)` with `verifiedAt` set and within the last 30
   minutes (generous window — long enough to finish filling out the rest of
   the form after verifying, short enough that a verified-but-abandoned
   session can't be reused hours later for a different booking attempt).
   Found → continue. Not found → return `{ ok: false, error:
   'PHONE_NOT_VERIFIED' }`.
3. On successful booking, the customer upsert also sets
   `phoneVerifiedAt = now()` (bootstrapping the "verified once" trust for
   all future bookings with this CPF+phone).

### UI flow (public booking page, step 4)

1. Customer fills Nome, CPF, Telefone, Email (optional, unless the server
   later says it's required for the email fallback), and the existing
   privacy consent checkbox — unchanged from today.
2. When CPF and phone are both filled, the client asks the server whether
   this combination is already verified. If yes, the UI shows the existing
   "Confirmar agendamento" flow with no extra step, exactly as today.
3. If not yet verified, an "Enviar código" step appears: clicking it calls
   the request-code action, which sends the code and returns which channel
   was used (or an error asking for an email if WhatsApp is unavailable and
   email is blank). The UI reveals a 6-digit code input, "Confirmar código",
   and a rate-limited "Reenviar código" link.
4. Once the code is confirmed, the UI shows a "Telefone verificado ✓"
   indicator and the normal "Confirmar agendamento" button activates.
5. Submission (`createPublicAppointment` → `createAppointment`) proceeds as
   today; the engine's own check (above) is the authoritative gate — the
   client-side flow is UX, not the security boundary.

### New infrastructure

- **`nodemailer`** (+ `@types/nodemailer` dev dependency) — free, open
  source, generic SMTP client. No vendor lock-in, no paid tier.
- New env vars, documented in `.env.example`: `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. The operator fills these with
  their own existing SMTP account's credentials — this project introduces
  no new paid service.
- New module `src/modules/notifications/email.ts`, mirroring the
  Result-typed pattern already established in
  `src/modules/whatsapp/evolution-client.ts`.

### Error handling

New `BookingError` variant: `PHONE_NOT_VERIFIED`, with a pt-BR message
telling the customer to verify their phone before submitting (the public
booking form should never actually hit this from the engine in practice,
since the client-side flow gates the submit button — but the engine check
is the real boundary, so the message still needs to exist and be sensible
if reached directly, e.g. a stale/replayed request).

Code-request and code-verify actions follow the existing `Result`/
`ActionResult` pattern (`{ok:true,...}|{ok:false,error}` — never throw for
control flow), matching every other action in this codebase.

### Out of scope

- WhatsApp AI and AI_WEB widget verification (see Scope section) — future
  spec.
- SMS as a channel — ruled out on cost.
- Any external phone-verification service (Twilio Verify, etc.) — same
  cost reasoning as SMS.
- Rate-limiting by IP address (only by `(barbershopId, cpf, phone)`) — an
  attacker spamming many different fake CPF/phone combinations from one IP
  isn't mitigated here; acceptable for now given the barbershop-scale threat
  model, revisit if abuse is observed.
