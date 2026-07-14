# Privacy Policy + Consent Notices (Design Spec)

**Status:** approved design — feeds the implementation plan.
**Date:** 2026-07-14

## Overview

A full security + LGPD audit of the codebase (2026-07-13) found the app has
no privacy policy, no consent notice at any of its three personal-data
collection points, and no record of consent ever being captured. This spec
covers the first remediation slice the user chose: a privacy policy page,
plus a consent/disclosure notice at each of the three collection points
(public booking form, public AI chat widget, WhatsApp first contact).

Retention/purge policy, deletion/anonymization, cross-channel data
minimization, and a ToS checkbox on the barbershop-owner signup form are
explicitly out of scope for this slice (see "Out of scope").

**Controller identity** (provisional, no CNPJ yet): Jumael Martins,
individual/MEI in formation, contact `jumaelmartins@gmail.com`. The policy
text notes this will be updated once the CNPJ is formalized.

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

Repo-specific constraint discovered during research: the booking module
(`src/modules/booking/**`) has **no Zod schema** — validation there is
hand-written TypeScript checks, not the Zod pattern used elsewhere (e.g. AI
tools). New fields in this spec follow that existing convention rather than
introducing Zod into the booking module.

## Architecture

### 1. Privacy policy page

New route `src/app/(marketing)/privacidade/page.tsx` — static Server
Component, no data fetching, Portuguese copy. Sections:

1. Quem somos (controlador) — Jumael Martins, MEI em formalização, contato
   `jumaelmartins@gmail.com`.
2. Quais dados coletamos — nome, telefone, e-mail (opcional), histórico de
   agendamento, conteúdo de mensagens (WhatsApp e chat web).
3. Para que usamos — confirmar/gerenciar agendamentos, lembretes,
   atendimento via IA.
4. Com quem compartilhamos — OpenAI (processamento de mensagens da IA),
   Evolution API/WhatsApp (envio de mensagens), Stripe (apenas dados de
   pagamento do dono da barbearia, não do cliente final).
5. Base legal — execução de contrato (dados de agendamento) e consentimento
   (processamento por IA e WhatsApp).
6. Retenção — dado mantido enquanto durar o vínculo com a barbearia; nota
   de transparência explícita de que hoje não há exclusão automática
   (matches the existing product decision documented in `docs/SPEC.md:70`).
7. Direitos do titular — acesso, correção, portabilidade, revogação de
   consentimento, via e-mail de contato.
8. Segurança — isolamento de dados por barbearia (tenant), conexão HTTPS.
9. Alterações desta política — data da última atualização.

Add a `Link href="/privacidade"` to the footer nav
(`src/app/(marketing)/_components/Footer.tsx:16-29`, after the existing
"Criar conta" link, same styling).

### 2. Booking form consent (public booking flow)

**Files touched:**
`src/app/[slug]/_components/BookingSection.tsx` (step 4, ~L557-658),
`src/modules/booking/public-actions.ts` (`createPublicAppointment`,
L172-218), `src/modules/booking/create-appointment.ts` (customer upsert,
L279-289), `prisma/schema.prisma` (`Customer` model, L218-230).

- Add a required checkbox in step 4, below the e-mail field and above the
  submit button (~L643-649): "Li e concordo com a **Política de
  Privacidade**" — the policy words link to `/privacidade` (new tab,
  `target="_blank"`).
- Client-side: extend the existing hand-written validation in `handleSubmit`
  (`BookingSection.tsx:242-249`) with one more check — consent must be
  `true` or the submit is blocked with the same inline-error pattern already
  used for name/phone.
- Thread a `consent: boolean` field through the existing inline types at
  `create-appointment.ts:170` and `public-actions.ts:178` (no Zod schema
  introduced, per the constraint above) down to `createAppointment`.
  Server-side, reject with a new error code (`CONSENT_REQUIRED`) if false —
  don't trust client-side validation alone.
- Schema migration: add `privacyConsentAt DateTime?` to `Customer`
  (`prisma/schema.prisma`, after `notes` at L225).
- In the upsert at `create-appointment.ts:280-289`, set
  `privacyConsentAt: new Date()` **only inside the `create:` block**
  (L282-287). The `update:` block (L288, `{ name: args.customer.name }`)
  stays untouched — a repeat customer's original consent timestamp is never
  overwritten by a later booking.

### 3. AI chat widget disclosure (public web chat)

**File:** `src/app/[slug]/_components/ChatWidget.tsx`.

Add a small, persistent, non-blocking disclosure line: "Atendimento com IA —
mensagens podem ser processadas por serviços de terceiros. **Política de
Privacidade**" (link to `/privacidade`, new tab). Placed in the empty-state
area (L174-191, near the existing "Tire suas dúvidas..." copy) so it's the
first thing a visitor sees before typing, and stays visible in the input
region afterward if there's room — exact placement is an implementation
detail, but it must be visible before the first message is sent, not just
buried in a settings/about screen. No schema change, no blocking gate —
matches the approach chosen (real consent only where blocking makes sense;
this is a transparency notice, not a gate).

### 4. WhatsApp first-contact disclosure

**File:** `src/modules/whatsapp/pipeline.ts`.

The conversation upsert at L371-385 doesn't currently distinguish
create-vs-update. Add an explicit `isNewConversation` check immediately
after the upsert:

```ts
const isNewConversation = conversation.createdAt.getTime() === conversation.updatedAt.getTime()
```

(Same instant only on insert — `updatedAt` bumps on every subsequent update
per the `@updatedAt` directive on `WhatsappConversation`.)

Thread `isNewConversation` down to `flushToAI()` (where the `sendText` call
at L627 fires). When true, prepend a one-time disclosure to the `reply`
string before it's sent — not a separate message requiring an extra Evolution
API round-trip, one send:

> "Olá! Esse é o atendimento automático da {shop.name}, feito com
> inteligência artificial. Suas mensagens podem ser processadas por serviços
> de terceiros. Política de privacidade: {NEXT_PUBLIC_APP_URL}/privacidade"
>
> (blank line, then the normal AI reply)

Also apply to the fallback path (`sendFallback()`, L240) so a new
conversation still gets the disclosure even if OpenAI is unreachable/not
configured on the very first message.

Build the absolute URL following the existing `appUrl()` /
`webhookUrl()` pattern (`src/modules/whatsapp/instance-actions.ts:19-25`,
`src/modules/billing/actions.ts:19-23`):
`` `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/privacidade` ``.

Not applied to the admin-flow conversation (`handleAdminInbound`, L657-661)
— that's the barbershop owner/staff's own WhatsApp number, not an end
customer's, so it's out of scope for this consent slice.

## Testing

- Unit: `createAppointment`/`createPublicAppointment` rejects when
  `consent` is false/missing (`CONSENT_REQUIRED`), following the existing
  `INVALID_PHONE` test pattern in the booking module's test file.
- Integration (`describe.skipIf(!process.env.DATABASE_URL)`): a first-time
  customer booking sets `privacyConsentAt`; a repeat booking from the same
  phone does not change an already-set `privacyConsentAt`.
- Unit: `pipeline.ts` — mock the Evolution client and assert the disclosure
  text is prepended only when `isNewConversation` is true, and absent on a
  second inbound message in the same conversation.
- No automated test for the static `/privacidade` page content — visually
  verified in dev, consistent with how other static marketing pages are
  handled in this repo (no existing test coverage for `(marketing)/page.tsx`
  either).

## Out of scope

- Retention/purge policy and any automatic deletion job for
  `WhatsappMessage`/`AiActionLog`.
- Deletion/anonymization mechanism for customer data (blocked today by the
  explicit "never hard-delete" decision in `docs/SPEC.md:70` — needs its own
  product decision, not a code-only fix).
- Data-minimization changes (e.g. the `AI_WEB` channel currently round-trips
  the customer's phone number through the OpenAI tool-call arguments, unlike
  the WhatsApp channel which keeps it server-side).
- ToS/privacy checkbox on the barbershop-owner signup form
  (`src/app/(auth)/signup/page.tsx`) — owners aren't one of the three
  collection points the audit flagged; can be a follow-up.
- Cookie-consent banner for the marketing site (no non-essential cookies
  currently in use, so not applicable yet).
- The separately-flagged HIGH finding (no email verification on password
  signup) and the prompt-injection hardening on `customerName` — tracked
  separately, not part of this slice.
