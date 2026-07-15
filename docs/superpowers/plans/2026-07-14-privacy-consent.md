# Privacy Policy + Consent Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/privacidade` policy page and a disclosure/consent notice at each of the three data-collection points found in the 2026-07-13 security/LGPD audit — the public booking form, the public AI chat widget, and the first WhatsApp message in a new conversation.

**Architecture:** One new static marketing route; one Prisma migration adding two nullable timestamp columns (`Customer.privacyConsentAt`, `WhatsappConversation.privacyNoticeSentAt`); a hard consent gate inside `createAppointment` scoped to `source === 'PUBLIC_PAGE'` only (so no other caller — WhatsApp, AI_WEB, COPILOT, ADMIN — is affected); a non-blocking disclosure banner in the chat widget; a one-time disclosure line prepended to the first AI/fallback reply in a new WhatsApp conversation.

**Tech Stack:** Next.js 16 App Router (Server Components), Prisma 7 + PostgreSQL, Vitest.

## Global Constraints

Inherited from `CLAUDE.md` and the approved spec (`docs/superpowers/specs/2026-07-14-privacy-consent-design.md`):

- **Tenant scoping:** every query takes an explicit `barbershopId` — not touched by this plan (no new tenant-scoped query is added; `Customer`/`WhatsappConversation` rows are already scoped by their existing `barbershopId`).
- **Result pattern:** domain use cases return `{ ok: true, data: T } | { ok: false, error: string }`.
- **Design tokens:** no hardcoded colors — use `src/app/globals.css` CSS custom properties (`text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, etc.).
- **Stack:** Next.js 16, Prisma 7, Vitest. UI copy pt-BR; code/docs English.
- **Testing:** unit/integration tests use `describe.skipIf(!process.env.DATABASE_URL)` for anything touching Postgres; `import 'dotenv/config'` must be the FIRST import in any new/edited test file that needs `DATABASE_URL`.
- **Booking module has no Zod schema** — validation there is hand-written TypeScript checks; new fields follow that convention, not Zod.
- **Scope:** consent is only enforced for `source === 'PUBLIC_PAGE'` bookings. WhatsApp/AI_WEB/COPILOT/ADMIN booking creation is untouched by Task 3.
- Prerequisite for any task touching Postgres: `docker compose up -d` must be running (`DATABASE_URL` in `.env` points to `127.0.0.1:5432`).

---

### Task 1: Privacy policy page + footer link

**Files:**
- Create: `src/app/(marketing)/privacidade/page.tsx`
- Modify: `src/app/(marketing)/_components/Footer.tsx:16-29`

**Interfaces:**
- Produces: the `/privacidade` route, linked to by Task 3 (booking form checkbox), Task 4 (chat widget banner), and Task 5 (WhatsApp disclosure text).

- [ ] **Step 1: Create the policy page**

```tsx
// src/app/(marketing)/privacidade/page.tsx
export const metadata = {
  title: 'Política de Privacidade',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold text-foreground">
        Política de Privacidade
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 14 de julho de 2026
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-lg font-semibold">1. Quem somos</h2>
          <p className="mt-2 text-muted-foreground">
            Esta plataforma é operada por Jumael Martins (pessoa física, MEI em
            processo de formalização), controlador dos dados pessoais tratados
            aqui. Dúvidas ou solicitações sobre seus dados podem ser enviadas
            para{' '}
            <a className="underline" href="mailto:jumaelmartins@gmail.com">
              jumaelmartins@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. Quais dados coletamos</h2>
          <p className="mt-2 text-muted-foreground">
            Nome, telefone e, opcionalmente, e-mail informados ao agendar um
            horário; histórico de agendamentos; e o conteúdo das mensagens
            trocadas com o assistente de atendimento, seja pelo WhatsApp ou
            pelo chat do site.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Para que usamos seus dados</h2>
          <p className="mt-2 text-muted-foreground">
            Para confirmar e gerenciar seus agendamentos, enviar lembretes e
            permitir que o assistente de atendimento (inteligência
            artificial) responda suas mensagens.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Com quem compartilhamos</h2>
          <p className="mt-2 text-muted-foreground">
            Compartilhamos dados estritamente necessários com prestadores de
            serviço que viabilizam o atendimento: a OpenAI, para processar
            mensagens do assistente de IA; a Evolution API, para envio e
            recebimento de mensagens de WhatsApp; e a Stripe, apenas para o
            pagamento da assinatura do dono do estabelecimento — não dados de
            clientes finais.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Base legal</h2>
          <p className="mt-2 text-muted-foreground">
            Tratamos dados de agendamento com base na execução do contrato de
            prestação de serviço entre você e o estabelecimento. O
            processamento das mensagens pelo assistente de inteligência
            artificial e o envio via WhatsApp têm base no seu consentimento,
            que pode ser revogado a qualquer momento pelo contato acima.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            6. Por quanto tempo guardamos seus dados
          </h2>
          <p className="mt-2 text-muted-foreground">
            Seus dados são mantidos enquanto durar seu vínculo com o
            estabelecimento. Hoje ainda não temos um processo automatizado de
            exclusão ou anonimização — estamos avaliando essa melhoria.
            Solicitações de exclusão podem ser feitas pelo contato acima e
            serão avaliadas manualmente.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Seus direitos</h2>
          <p className="mt-2 text-muted-foreground">
            Você pode solicitar, a qualquer momento e pelo contato acima:
            acesso aos seus dados, correção de dados incorretos, portabilidade
            e revogação do seu consentimento.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Segurança</h2>
          <p className="mt-2 text-muted-foreground">
            Os dados de cada estabelecimento são isolados dos demais e todo o
            tráfego com a plataforma é feito por conexão criptografada
            (HTTPS).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Alterações desta política</h2>
          <p className="mt-2 text-muted-foreground">
            Podemos atualizar esta política conforme a plataforma evolui. A
            data no topo desta página sempre reflete a versão mais recente.
          </p>
        </section>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Add the footer link**

In `src/app/(marketing)/_components/Footer.tsx`, replace lines 16-29:

```tsx
          <nav aria-label="Links do rodapé" className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Criar conta
            </Link>
          </nav>
```

with:

```tsx
          <nav aria-label="Links do rodapé" className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Criar conta
            </Link>
            <Link
              href="/privacidade"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacidade
            </Link>
          </nav>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0, no new errors.

Run: `npm run dev`, open `http://127.0.0.1:3000/privacidade` (use `127.0.0.1`, not `localhost` — Windows `::1` resolution quirk documented in this repo). Confirm the page renders and the homepage footer shows a working "Privacidade" link.

- [ ] **Step 4: Commit**

```bash
git add src/app/(marketing)/privacidade/page.tsx src/app/(marketing)/_components/Footer.tsx
git commit -m "feat(privacy): add privacy policy page and footer link"
```

---

### Task 2: Schema migration — consent/notice timestamp fields

**Files:**
- Modify: `prisma/schema.prisma` (`Customer` model L218-230, `WhatsappConversation` model L255-267)
- Create: new migration under `prisma/migrations/` (generated by the command below)

**Interfaces:**
- Produces: `Customer.privacyConsentAt DateTime?` (consumed by Task 3), `WhatsappConversation.privacyNoticeSentAt DateTime?` (consumed by Task 5).

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, replace the `Customer` model (lines 218-230):

```prisma
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
```

with:

```prisma
model Customer {
  id               String  @id @default(cuid())
  barbershopId     String
  barbershop       Barbershop @relation(fields: [barbershopId], references: [id])
  name             String
  phone            String
  email            String?
  notes            String?
  privacyConsentAt DateTime?
  appointments     Appointment[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@unique([barbershopId, phone])
}
```

Replace the `WhatsappConversation` model (lines 255-267):

```prisma
model WhatsappConversation {
  id            String @id @default(cuid())
  barbershopId  String
  customerPhone String
  state                  ConversationState @default(OPEN)
  pendingActionId        String?
  pendingActionExpiresAt DateTime?
  lastMessageAt DateTime @default(now())
  messages      WhatsappMessage[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([barbershopId, customerPhone])
}
```

with:

```prisma
model WhatsappConversation {
  id            String @id @default(cuid())
  barbershopId  String
  customerPhone String
  state                  ConversationState @default(OPEN)
  pendingActionId        String?
  pendingActionExpiresAt DateTime?
  privacyNoticeSentAt    DateTime?
  lastMessageAt DateTime @default(now())
  messages      WhatsappMessage[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([barbershopId, customerPhone])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_privacy_consent_fields`
Expected: prompts nothing (non-destructive additive migration), prints "Your database is now in sync with your schema" and regenerates the Prisma client. Confirm a new folder appears under `prisma/migrations/` containing `add_privacy_consent_fields` in its name, with a `migration.sql` that adds the two columns.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(privacy): add consent/notice timestamp fields to schema"
```

---

### Task 3: Booking form consent (public booking flow)

**Files:**
- Modify: `src/modules/booking/types.ts` (full file, 38 lines)
- Modify: `src/modules/booking/create-appointment.ts:164-179` (signature), `:180-186` (pre-transaction checks), `:279-289` (customer upsert)
- Modify: `src/modules/booking/public-actions.ts:172-179` (signature), `:180-217` (body)
- Modify: `src/app/[slug]/_components/BookingSection.tsx` (state ~L117-120, `handleSubmit` ~L233-281, step-4 form ~L605-656)
- Test: `src/modules/booking/conflict.test.ts` (append after the existing test at L273-280)

**Interfaces:**
- Consumes: Task 1's `/privacidade` route (link href); Task 2's `Customer.privacyConsentAt` field.
- Produces: `createAppointment(args: { ...; consent?: boolean })` — `consent` is optional, only enforced when `args.source === 'PUBLIC_PAGE'`. `createPublicAppointment(args: { ...; consent: boolean })` — `consent` is required for this wrapper.

- [ ] **Step 1: Add `CONSENT_REQUIRED` to the error union**

In `src/modules/booking/types.ts`, replace the full file content with:

```ts
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

export type AppointmentSource =
  | 'PUBLIC_PAGE'
  | 'WHATSAPP'
  | 'ADMIN'
  | 'AI_WEB'
  | 'COPILOT'

export type BookingError =
  | 'SLOT_TAKEN'
  | 'INVALID_SERVICE'
  | 'INVALID_PROFESSIONAL'
  | 'OUTSIDE_AVAILABILITY'
  | 'INVALID_PHONE'
  | 'NOT_FOUND'
  | 'CONSENT_REQUIRED'

/** Single source of truth for pt-BR booking error messages. */
export const BOOKING_ERROR_PT_BR: Record<BookingError, string> = {
  SLOT_TAKEN: 'Esse horário acabou de ser reservado. Escolha outro.',
  INVALID_SERVICE: 'Serviço não encontrado.',
  INVALID_PROFESSIONAL: 'Profissional não encontrado.',
  OUTSIDE_AVAILABILITY: 'Horário fora da disponibilidade.',
  INVALID_PHONE: 'Telefone inválido.',
  NOT_FOUND: 'Agendamento não encontrado.',
  CONSENT_REQUIRED: 'Você precisa concordar com a Política de Privacidade para continuar.',
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingError }
```

- [ ] **Step 2: Write the failing tests**

In `src/modules/booking/conflict.test.ts`, find the `base` helper (around L86-90):

```ts
  const base = (startTime: string) => ({
    tenantId: barbershopId,
    serviceId,
    professionalId,
    date: TEST_DATE,
    startTime,
    customer,
    source: 'ADMIN' as const,
  })
```

Replace it with (adds a `consent: true` default so every existing test in this file keeps compiling and passing — `source: 'ADMIN'` means the new consent gate never fires for them):

```ts
  const base = (startTime: string) => ({
    tenantId: barbershopId,
    serviceId,
    professionalId,
    date: TEST_DATE,
    startTime,
    customer,
    source: 'ADMIN' as const,
    consent: true,
  })
```

Then append these three tests immediately after the existing `(j) phone "123" → INVALID_PHONE` test (L273-280), before the closing `})` of the `describe` block:

```ts
  it('(k) PUBLIC_PAGE source without consent → CONSENT_REQUIRED', async () => {
    const result = await createAppointment({
      ...base('15:15'),
      source: 'PUBLIC_PAGE',
      consent: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CONSENT_REQUIRED')
  })

  it('(l) ADMIN source without consent still succeeds (gate only applies to PUBLIC_PAGE)', async () => {
    const result = await createAppointment({
      tenantId: barbershopId,
      serviceId,
      professionalId,
      date: TEST_DATE,
      startTime: '15:30',
      customer,
      source: 'ADMIN',
    })
    expect(result.ok).toBe(true)
  })

  it('(m) PUBLIC_PAGE booking with consent sets privacyConsentAt; a repeat booking does not overwrite it', async () => {
    const uniquePhone = '11955550001'

    const first = await createAppointment({
      ...base('15:45'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Consent Tester', phone: uniquePhone },
    })
    expect(first.ok).toBe(true)

    const afterFirst = await prisma.customer.findUnique({
      where: { barbershopId_phone: { barbershopId, phone: uniquePhone } },
    })
    expect(afterFirst?.privacyConsentAt).not.toBeNull()
    const consentAt = afterFirst!.privacyConsentAt!.getTime()

    const second = await createAppointment({
      ...base('16:00'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Consent Tester', phone: uniquePhone },
    })
    expect(second.ok).toBe(true)

    const afterSecond = await prisma.customer.findUnique({
      where: { barbershopId_phone: { barbershopId, phone: uniquePhone } },
    })
    expect(afterSecond?.privacyConsentAt?.getTime()).toBe(consentAt)
  })
```

Note: `'15:15'`, `'15:30'`, `'15:45'`, `'16:00'` are assumed free on `TEST_DATE`. If any collides with an earlier test in the file (`SLOT_TAKEN` instead of the expected error), pick a different unused time — check the file's existing tests (a)-(j) for times already in use first.

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test -- src/modules/booking/conflict.test.ts`
Expected: FAIL — TypeScript error (`consent` does not exist on the args type) or, once that's stubbed, tests (k)/(m) fail because `CONSENT_REQUIRED`/`privacyConsentAt` don't exist yet.

- [ ] **Step 4: Implement the consent gate + timestamp in `create-appointment.ts`**

Find the function signature (L164-179):

```ts
export async function createAppointment(args: {
  tenantId: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
  source: AppointmentSource
}): Promise<
  Result<{
    appointmentId: string
    endTime: string
    professionalName: string
    serviceName: string
  }>
> {
```

Replace with:

```ts
export async function createAppointment(args: {
  tenantId: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
  source: AppointmentSource
  consent?: boolean
}): Promise<
  Result<{
    appointmentId: string
    endTime: string
    professionalName: string
    serviceName: string
  }>
> {
```

Find the pre-transaction checks (L180-186):

```ts
  // Validate canonical date before entering the transaction (C1)
  if (!isCanonicalDate(args.date)) return { ok: false, error: 'OUTSIDE_AVAILABILITY' }

  // Fix 3: Validate phone before entering the transaction
  const phone = normalizePhone(args.customer.phone)
  if (phone === null) return { ok: false, error: 'INVALID_PHONE' }

  const runTx = async () =>
```

Replace with:

```ts
  // Validate canonical date before entering the transaction (C1)
  if (!isCanonicalDate(args.date)) return { ok: false, error: 'OUTSIDE_AVAILABILITY' }

  // Public bookings must record consent before anything else happens.
  if (args.source === 'PUBLIC_PAGE' && !args.consent) {
    return { ok: false, error: 'CONSENT_REQUIRED' }
  }

  // Fix 3: Validate phone before entering the transaction
  const phone = normalizePhone(args.customer.phone)
  if (phone === null) return { ok: false, error: 'INVALID_PHONE' }

  const runTx = async () =>
```

Find the customer upsert (L279-289):

```ts
        // --- 5. Upsert customer (barbershopId + normalised phone) ---
        const customer = await tx.customer.upsert({
          where: { barbershopId_phone: { barbershopId: args.tenantId, phone } },
          create: {
            barbershopId: args.tenantId,
            name: args.customer.name,
            phone,
            email: args.customer.email,
          },
          update: { name: args.customer.name },
        })
```

Replace with:

```ts
        // --- 5. Upsert customer (barbershopId + normalised phone) ---
        const customer = await tx.customer.upsert({
          where: { barbershopId_phone: { barbershopId: args.tenantId, phone } },
          create: {
            barbershopId: args.tenantId,
            name: args.customer.name,
            phone,
            email: args.customer.email,
            privacyConsentAt: args.consent ? new Date() : undefined,
          },
          update: { name: args.customer.name },
        })
```

- [ ] **Step 5: Thread `consent` through `public-actions.ts`**

Find the function signature (L172-179):

```ts
export async function createPublicAppointment(args: {
  slug: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
}): Promise<AppointmentResult> {
```

Replace with:

```ts
export async function createPublicAppointment(args: {
  slug: string
  serviceId: string
  professionalId: string
  date: string
  startTime: string
  customer: { name: string; phone: string; email?: string }
  consent: boolean
}): Promise<AppointmentResult> {
```

Find the call to `createAppointment` inside the body (L180-217):

```ts
    const result = await createAppointment({
      tenantId: shop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
      startTime: args.startTime,
      customer: args.customer,
      source: 'PUBLIC_PAGE',
    })
```

Replace with:

```ts
    const result = await createAppointment({
      tenantId: shop.id,
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      date: args.date,
      startTime: args.startTime,
      customer: args.customer,
      source: 'PUBLIC_PAGE',
      consent: args.consent,
    })
```

(No other change needed in this file — `BOOKING_ERROR_PT_BR[result.error]` already maps `CONSENT_REQUIRED` to its pt-BR message from Step 1.)

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test -- src/modules/booking/conflict.test.ts`
Expected: PASS, all tests including (k), (l), (m).

- [ ] **Step 7: Add the checkbox to the booking form UI**

In `src/app/[slug]/_components/BookingSection.tsx`, find the state declarations (around L117-120):

```tsx
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
```

Replace with:

```tsx
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
```

Find the validation checks in `handleSubmit` (L242-249):

```tsx
    if (!customerName.trim()) {
      setFormError('Informe seu nome.')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Informe seu telefone.')
      return
    }
```

Replace with:

```tsx
    if (!customerName.trim()) {
      setFormError('Informe seu nome.')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Informe seu telefone.')
      return
    }
    if (!consentAccepted) {
      setFormError('Você precisa concordar com a Política de Privacidade para continuar.')
      return
    }
```

Find the `createPublicAppointment` call (L251-263):

```tsx
      const result = await createPublicAppointment({
        slug: shop.slug,
        serviceId,
        professionalId: resolvedProfessionalId,
        date: selectedDate,
        startTime: selectedSlot,
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          email: customerEmail.trim() || undefined,
        },
      })
```

Replace with:

```tsx
      const result = await createPublicAppointment({
        slug: shop.slug,
        serviceId,
        professionalId: resolvedProfessionalId,
        date: selectedDate,
        startTime: selectedSlot,
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          email: customerEmail.trim() || undefined,
        },
        consent: consentAccepted,
      })
```

Find the email field through the `formError` paragraph (L631-647):

```tsx
            <div className="space-y-1.5">
              <Label htmlFor="booking-email">
                E-mail <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Input
                id="booking-email"
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                disabled={isPending}
              />
            </div>

            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
```

Replace with (adds the checkbox between the e-mail field and the error slot):

```tsx
            <div className="space-y-1.5">
              <Label htmlFor="booking-email">
                E-mail <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Input
                id="booking-email"
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                disabled={isPending}
              />
            </div>

            <div className="flex items-start gap-2">
              <input
                id="booking-consent"
                type="checkbox"
                checked={consentAccepted}
                onChange={e => setConsentAccepted(e.target.checked)}
                disabled={isPending}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <Label
                htmlFor="booking-consent"
                className="text-xs font-normal text-muted-foreground"
              >
                Li e concordo com a{' '}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Política de Privacidade
                </a>
                .
              </Label>
            </div>

            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

Run: `npm run dev`, open a barbershop's public booking page (`http://127.0.0.1:3000/<slug>`), walk through booking to step 4, confirm: submitting without checking the box shows the error message and does not book; checking the box and submitting succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/modules/booking/types.ts src/modules/booking/create-appointment.ts src/modules/booking/public-actions.ts src/modules/booking/conflict.test.ts src/app/\[slug\]/_components/BookingSection.tsx
git commit -m "feat(booking): require privacy consent on public booking form"
```

---

### Task 4: AI chat widget disclosure

**Files:**
- Modify: `src/app/[slug]/_components/ChatWidget.tsx:145-168`

**Interfaces:**
- Consumes: Task 1's `/privacidade` route (link href).

- [ ] **Step 1: Add the disclosure banner**

Find the header block through the start of the messages list (L145-168):

```tsx
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary"
                  aria-hidden="true"
                >
                  <MessageCircle className="size-4 text-primary-foreground" />
                </div>
                <span className="font-medium text-foreground text-sm truncate">
                  Assistente {shopName}
                </span>
              </div>

              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar assistente"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* Messages list */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
              role="log"
              aria-live="polite"
            >
```

Replace with (inserts a persistent disclosure strip between the header and the message list):

```tsx
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary"
                  aria-hidden="true"
                >
                  <MessageCircle className="size-4 text-primary-foreground" />
                </div>
                <span className="font-medium text-foreground text-sm truncate">
                  Assistente {shopName}
                </span>
              </div>

              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar assistente"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* Privacy notice */}
            <div className="px-4 py-1.5 border-b border-border shrink-0">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Atendimento com IA — mensagens podem ser processadas por serviços de terceiros.{' '}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Política de Privacidade
                </a>
              </p>
            </div>

            {/* Messages list */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
              role="log"
              aria-live="polite"
            >
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

Run: `npm run dev`, open a public booking page, open the chat widget, confirm the disclosure line is visible above the message list and its link opens `/privacidade` in a new tab.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[slug\]/_components/ChatWidget.tsx
git commit -m "feat(chat): add AI processing disclosure to public chat widget"
```

---

### Task 5: WhatsApp first-contact disclosure

**Files:**
- Modify: `src/modules/whatsapp/pipeline.ts` (helper insertion after L225, `flushToAI` L514-644, `sendFallback` L231-248)
- Test: `src/modules/whatsapp/pipeline.test.ts` (append new `describe` block)

**Interfaces:**
- Consumes: Task 1's `/privacidade` route (URL in the disclosure text); Task 2's `WhatsappConversation.privacyNoticeSentAt` field.

- [ ] **Step 1: Write the failing tests**

In `src/modules/whatsapp/pipeline.test.ts`, append this new `describe` block (place it after the existing `describe('handleInboundMessage: [HUMANO] marker handling', ...)` block, i.e. after line 374):

```ts
describe('handleInboundMessage: first-contact privacy notice', () => {
  it('prepends the privacy notice to the AI reply on a brand-new conversation', async () => {
    mockFindUniqueConv.mockResolvedValue({ state: 'OPEN', privacyNoticeSentAt: null })
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: 'Seus horários disponíveis são às 10h e 14h.' },
    })

    await handleInboundMessage(BASE_ARGS)

    const [, , sentText] = mockSendText.mock.calls[0] as [string, string, string]
    expect(sentText).toContain('Política de privacidade')
    expect(sentText).toContain('/privacidade')
    expect(sentText).toContain('Seus horários disponíveis são às 10h e 14h.')

    expect(mockUpdateConv).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ privacyNoticeSentAt: expect.any(Date) }),
      }),
    )
  })

  it('does NOT prepend the privacy notice when it was already sent', async () => {
    mockFindUniqueConv.mockResolvedValue({
      state: 'OPEN',
      privacyNoticeSentAt: new Date('2026-07-01'),
    })
    mockRunAssistant.mockResolvedValue({
      ok: true,
      data: { reply: 'Seus horários disponíveis são às 10h e 14h.' },
    })

    await handleInboundMessage(BASE_ARGS)

    const [, , sentText] = mockSendText.mock.calls[0] as [string, string, string]
    expect(sentText).not.toContain('Política de privacidade')
    expect(sentText).toBe('Seus horários disponíveis são às 10h e 14h.')

    const updateCalls = mockUpdateConv.mock.calls as Array<
      Array<{ data?: { privacyNoticeSentAt?: unknown } }>
    >
    const noticeUpdate = updateCalls.find(([callArgs]) => callArgs?.data?.privacyNoticeSentAt !== undefined)
    expect(noticeUpdate).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- src/modules/whatsapp/pipeline.test.ts`
Expected: FAIL — both new tests fail because the notice is never prepended and `privacyNoticeSentAt` is never set.

- [ ] **Step 3: Add the `buildPrivacyNotice` helper**

In `src/modules/whatsapp/pipeline.ts`, immediately after the `persistMessage` function (ends at line 225), insert:

```ts

/** One-time LGPD disclosure prepended to the first reply in a new conversation. */
function buildPrivacyNotice(shopName: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return (
    `Olá! Esse é o atendimento automático da ${shopName}, feito com inteligência artificial. ` +
    `Suas mensagens podem ser processadas por serviços de terceiros. ` +
    `Política de privacidade: ${baseUrl}/privacidade`
  )
}
```

- [ ] **Step 4: Update `sendFallback` to accept and apply `isFirstContact`**

Find the full function (L231-248):

```ts
async function sendFallback(
  shop: ShopRecord,
  instanceName: string,
  fromPhone: string,
  conversation: ConvRecord,
): Promise<void> {
  // Persist SYSTEM message first (so at least the audit trail exists even if send fails)
  await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', FALLBACK_REPLY)

  const sendResult = await evolution.sendText(instanceName, fromPhone, FALLBACK_REPLY)
  if (!sendResult.ok) {
    console.error('[pipeline] sendText fallback failed', sendResult.error)
  }

  await prisma.whatsappConversation
    .update({ where: { id: conversation.id }, data: { state: 'TRANSFERRED_TO_HUMAN' } })
    .catch(err => console.error('[pipeline] state→TRANSFERRED error', err))
}
```

Replace with:

```ts
async function sendFallback(
  shop: ShopRecord,
  instanceName: string,
  fromPhone: string,
  conversation: ConvRecord,
  isFirstContact: boolean,
): Promise<void> {
  const text = isFirstContact
    ? buildPrivacyNotice(shop.name) + '\n\n' + FALLBACK_REPLY
    : FALLBACK_REPLY

  // Persist SYSTEM message first (so at least the audit trail exists even if send fails)
  await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', text)

  const sendResult = await evolution.sendText(instanceName, fromPhone, text)
  if (!sendResult.ok) {
    console.error('[pipeline] sendText fallback failed', sendResult.error)
  }

  await prisma.whatsappConversation
    .update({
      where: { id: conversation.id },
      data: {
        state: 'TRANSFERRED_TO_HUMAN',
        ...(isFirstContact && sendResult.ok ? { privacyNoticeSentAt: new Date() } : {}),
      },
    })
    .catch(err => console.error('[pipeline] state→TRANSFERRED error', err))
}
```

- [ ] **Step 5: Update `flushToAI`**

Find the start of the function through the state guard (L526-533):

```ts
  // I8: Re-read conversation state — the debounce window (4 s) is wide enough
  // for a human agent to transfer the conversation. If state has changed to
  // TRANSFERRED_TO_HUMAN (or CLOSED), skip the AI call entirely.
  const freshConv = await prisma.whatsappConversation
    .findUnique({ where: { id: conversation.id }, select: { state: true } })
    .catch(() => null)
  if (!freshConv || freshConv.state !== 'OPEN') return
```

Replace with:

```ts
  // I8: Re-read conversation state — the debounce window (4 s) is wide enough
  // for a human agent to transfer the conversation. If state has changed to
  // TRANSFERRED_TO_HUMAN (or CLOSED), skip the AI call entirely.
  const freshConv = await prisma.whatsappConversation
    .findUnique({
      where: { id: conversation.id },
      select: { state: true, privacyNoticeSentAt: true },
    })
    .catch(() => null)
  if (!freshConv || freshConv.state !== 'OPEN') return

  // First contact on this conversation — prepend a one-time privacy/IA disclosure.
  const isFirstContact = freshConv.privacyNoticeSentAt === null
```

Find the "OpenAI not configured" branch (L573-576):

```ts
  if (!isOpenAIConfigured()) {
    await sendFallback(shop, instanceName, fromPhone, conversation)
    return
  }
```

Replace with:

```ts
  if (!isOpenAIConfigured()) {
    await sendFallback(shop, instanceName, fromPhone, conversation, isFirstContact)
    return
  }
```

Find the "runAssistant error" branch (L610-614):

```ts
  if (!result.ok) {
    console.error('[pipeline] runAssistant error', result.error)
    await sendFallback(shop, instanceName, fromPhone, conversation)
    return
  }
```

Replace with:

```ts
  if (!result.ok) {
    console.error('[pipeline] runAssistant error', result.error)
    await sendFallback(shop, instanceName, fromPhone, conversation, isFirstContact)
    return
  }
```

Find the reply composition through the end of the function (L616-644):

```ts
  let reply = result.data.reply
  let isHumanHandoff = false

  // Detect [HUMANO] marker — strip ALL occurrences and append handoff notice
  if (reply.includes(HUMAN_MARKER)) {
    reply = reply.replace(/\[HUMANO\]/g, '').trim()
    reply = reply + HUMAN_HANDOFF_SUFFIX
    isHumanHandoff = true
  }

  // Send via Evolution FIRST — persist only after knowing the delivery outcome.
  const sendResult = await evolution.sendText(instanceName, fromPhone, reply)
  if (sendResult.ok) {
    await persistMessage(shop, conversation, 'OUTBOUND', 'AI', reply)
  } else {
    console.error('[pipeline] sendText failed', sendResult.error)
    await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', '[FALHA NO ENVIO] ' + reply)
  }

  // Transition state when human handoff is requested
  if (isHumanHandoff) {
    await prisma.whatsappConversation
      .update({
        where: { id: conversation.id },
        data: { state: 'TRANSFERRED_TO_HUMAN' },
      })
      .catch(err => console.error('[pipeline] state→TRANSFERRED error', err))
  }
}
```

Replace with:

```ts
  let reply = result.data.reply
  let isHumanHandoff = false

  // Detect [HUMANO] marker — strip ALL occurrences and append handoff notice
  if (reply.includes(HUMAN_MARKER)) {
    reply = reply.replace(/\[HUMANO\]/g, '').trim()
    reply = reply + HUMAN_HANDOFF_SUFFIX
    isHumanHandoff = true
  }

  if (isFirstContact) {
    reply = buildPrivacyNotice(shop.name) + '\n\n' + reply
  }

  // Send via Evolution FIRST — persist only after knowing the delivery outcome.
  const sendResult = await evolution.sendText(instanceName, fromPhone, reply)
  if (sendResult.ok) {
    await persistMessage(shop, conversation, 'OUTBOUND', 'AI', reply)
  } else {
    console.error('[pipeline] sendText failed', sendResult.error)
    await persistMessage(shop, conversation, 'OUTBOUND', 'SYSTEM', '[FALHA NO ENVIO] ' + reply)
  }

  // Transition state when human handoff is requested; mark the privacy notice
  // as sent once delivery succeeds, so it's shown exactly once per conversation.
  const conversationUpdate: { state?: 'TRANSFERRED_TO_HUMAN'; privacyNoticeSentAt?: Date } = {}
  if (isHumanHandoff) conversationUpdate.state = 'TRANSFERRED_TO_HUMAN'
  if (isFirstContact && sendResult.ok) conversationUpdate.privacyNoticeSentAt = new Date()
  if (Object.keys(conversationUpdate).length > 0) {
    await prisma.whatsappConversation
      .update({ where: { id: conversation.id }, data: conversationUpdate })
      .catch(err => console.error('[pipeline] conversation update error', err))
  }
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test -- src/modules/whatsapp/pipeline.test.ts`
Expected: PASS, including both new tests and all pre-existing ones (the `[HUMANO]` test and others use the default `beforeEach` mock `{ state: 'OPEN' }`, which now needs `privacyNoticeSentAt` too — see Step 7).

- [ ] **Step 7: Fix the shared default mock so existing tests keep passing**

In `src/modules/whatsapp/pipeline.test.ts`, find the `beforeEach` default (around L160-170 region, look for this exact line among the `beforeEach` setup):

```ts
  mockFindUniqueConv.mockResolvedValue({ state: 'OPEN' })
```

Replace with:

```ts
  mockFindUniqueConv.mockResolvedValue({ state: 'OPEN', privacyNoticeSentAt: new Date('2020-01-01') })
```

(A non-null default date means pre-existing tests — which don't care about the privacy notice — exercise the "already sent" branch and their `sendText` assertions on exact/`[HUMANO]` reply text stay correct. Only the two new tests in Step 1 override this per-test to test both branches.)

Run: `npm test -- src/modules/whatsapp/pipeline.test.ts` again.
Expected: PASS, full file green.

- [ ] **Step 8: Full-suite check**

Run: `npm test`
Expected: PASS, no regressions elsewhere.

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/whatsapp/pipeline.ts src/modules/whatsapp/pipeline.test.ts
git commit -m "feat(whatsapp): send one-time privacy disclosure on first contact"
```
