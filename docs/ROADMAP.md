# Navalia — Roadmap

Planned features, in rough priority order. Architecture notes describe how each
fits the existing design (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

## v1.1 — Auth & booking policies

### Google sign-in
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

## Later
- Official WhatsApp Cloud API adapter (transport swap only — pipeline/tools
  unchanged)
- Appointment reminders (WhatsApp templates)
- Human-takeover inbox in the dashboard
- E-mail notifications; CSV exports; multi-plan tiers; PWA
