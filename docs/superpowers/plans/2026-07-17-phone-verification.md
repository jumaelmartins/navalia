# Public Booking Phone Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a 6-digit code, sent via WhatsApp (free, via the shop's own Evolution API connection) or email fallback, to verify a customer actually controls the phone number they entered on the public booking page — before their first booking with a given CPF+phone combination.

**Architecture:** A new `PhoneVerification` model tracks pending/completed code challenges (independent of `Customer`, since the customer record doesn't exist yet at first-booking time). A core module (`src/modules/booking/verification.ts`) owns code generation/hashing/sending/checking. The single `createAppointment` booking engine gets one new pre-transaction gate, scoped to `source === 'PUBLIC_PAGE'` only. `Customer.phoneVerifiedAt` remembers a verified phone so returning customers skip the flow.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma 7 + PostgreSQL, Vitest, Tailwind v4, `nodemailer` (new dependency, SMTP), existing Evolution API client.

## Global Constraints

- Tenant scoping: every new/changed Prisma query must include `barbershopId` (per `CLAUDE.md`).
- Result pattern: domain functions return `{ ok: true, data } | { ok: false, error }`, never throw for control flow.
- No hardcoded colors — use existing CSS custom properties / Tailwind tokens already in use in the touched files.
- Unit tests need no `DATABASE_URL`; integration tests (`describe.skipIf(!process.env.DATABASE_URL)`) require Postgres — run both where noted.
- Follow existing code style exactly (see referenced files) — this is not a rewrite.
- No SMS, no paid verification service — WhatsApp (existing Evolution connection) and email (operator's own SMTP) only.
- Scope is the public booking page only (`source: 'PUBLIC_PAGE'`) — WhatsApp AI, admin manual booking, and AI_WEB are explicitly untouched by this plan.

---

## File Structure

**New files:**
- `src/modules/notifications/email.ts` — `nodemailer`-based SMTP send wrapper, Result-typed.
- `src/modules/notifications/email.test.ts` — unit tests (mocked `nodemailer`).
- `src/modules/booking/verification.ts` — code generation/hashing, `isPhoneVerified`, `hasRecentVerification`, `requestVerificationCode`, `verifyCode`.
- `src/modules/booking/verification.test.ts` — integration tests (real DB, fake WhatsApp/email senders).
- `src/modules/booking/verification-actions.ts` — `'use server'` actions: `checkPhoneVerified`, `requestPhoneVerification`, `confirmPhoneVerification`.
- `src/modules/booking/verification-actions.test.ts` — integration tests (real DB).
- `prisma/migrations/<timestamp>_add_phone_verification/migration.sql` — generated migration.

**Modified files:**
- `prisma/schema.prisma` — `Customer.phoneVerifiedAt`, new `PhoneVerification` model, `Barbershop.phoneVerifications` back-relation.
- `.env.example` — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- `package.json` — adds `nodemailer` + `@types/nodemailer` (dev).
- `src/modules/booking/public-actions.ts` — exports `isShopAccessible` (was module-private) so `verification-actions.ts` can reuse it.
- `src/modules/booking/types.ts` — `BookingError` gains `PHONE_NOT_VERIFIED`.
- `src/modules/booking/create-appointment.ts` — new gate for `PUBLIC_PAGE` source; sets `phoneVerifiedAt` on customer upsert.
- `src/modules/booking/conflict.test.ts` — new tests for the gate.
- `src/app/[slug]/_components/BookingSection.tsx` — verification sub-flow UI in step 4.

---

### Task 1: Schema — `Customer.phoneVerifiedAt` + `PhoneVerification` model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Customer.phoneVerifiedAt: Date | null` on the generated Prisma client; new `PhoneVerification` model with fields `id, barbershopId, cpf, phone, codeHash, channel, attempts, expiresAt, verifiedAt, createdAt`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, add `phoneVerifiedAt` to `Customer` (currently lines 218-233):

```prisma
model Customer {
  id               String  @id @default(cuid())
  barbershopId     String
  barbershop       Barbershop @relation(fields: [barbershopId], references: [id])
  name             String
  phone            String
  cpf              String?
  email            String?
  notes            String?
  privacyConsentAt DateTime?
  phoneVerifiedAt  DateTime?
  appointments     Appointment[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@unique([barbershopId, cpf])
  @@index([barbershopId, phone])
}
```

Add the new `PhoneVerification` model right after `Customer`:

```prisma
model PhoneVerification {
  id           String   @id @default(cuid())
  barbershopId String
  barbershop   Barbershop @relation(fields: [barbershopId], references: [id])
  cpf          String
  phone        String
  codeHash     String
  channel      String   // WHATSAPP | EMAIL
  attempts     Int      @default(0)
  expiresAt    DateTime
  verifiedAt   DateTime?
  createdAt    DateTime @default(now())
  @@index([barbershopId, cpf, phone])
}
```

Add the back-relation on `Barbershop` — find the exact line `  customers     Customer[]` (5 spaces before `Customer[]`, part of the relation-fields block near the end of the model) and add a sibling line right after it:

```prisma
  customers     Customer[]
  phoneVerifications PhoneVerification[]
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_phone_verification`

If this fails because there's no TTY for Prisma's interactive prompt (a
prior task in this codebase hit exactly this — Prisma 7's `migrate dev`
refuses to run fully non-interactively in this environment), don't
diagnose further — skip straight to the manual path below. The exact SQL
was independently generated and verified (via `prisma migrate diff
--from-config-datasource --to-schema <scratch-copy-of-the-edited-schema>
--script`, run against this exact schema change before this plan was
written), so create the migration directory and file yourself:

`prisma/migrations/<YYYYMMDDHHMMSS>_add_phone_verification/migration.sql`
(use the current timestamp in that exact format — e.g. `20260717143000` —
so it sorts after the existing `20260717122058_add_customer_cpf`
migration), with this exact content:

```sql
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhoneVerification" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneVerification_barbershopId_cpf_phone_idx" ON "PhoneVerification"("barbershopId", "cpf", "phone");

-- AddForeignKey
ALTER TABLE "PhoneVerification" ADD CONSTRAINT "PhoneVerification_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Then run:

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
```

Confirm `migrate status` reports the schema is up to date with no drift.
If `migrate dev` actually succeeded in your environment (it may — the TTY
issue was specific to a prior sandboxed run), just confirm its generated
SQL matches the content above (semantically — exact column/constraint
ordering from the tool may differ slightly, that's fine) and skip the
manual file creation.

- [ ] **Step 3: Run the existing suite to confirm no regressions**

Run: `npm run typecheck` and `npm test`
Expected: PASS, no errors — this task only adds a nullable column and a new
table; nothing existing references either yet.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add Customer.phoneVerifiedAt and PhoneVerification model"
```

---

### Task 2: Email module (`nodemailer` SMTP wrapper)

**Files:**
- Create: `src/modules/notifications/email.ts`
- Test: `src/modules/notifications/email.test.ts`
- Modify: `.env.example`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Produces: `sendEmail(to: string, subject: string, text: string): Promise<{ ok: true; data: undefined } | { ok: false; error: string }>`.

- [ ] **Step 1: Install `nodemailer`**

```bash
npm install nodemailer
npm install -D @types/nodemailer
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/notifications/email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMailMock = vi.fn()

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}))

import { sendEmail } from './email'

describe('sendEmail', () => {
  beforeEach(() => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user@example.com')
    vi.stubEnv('SMTP_PASSWORD', 'secret')
    vi.stubEnv('SMTP_FROM', 'Navalia <no-reply@example.com>')
    sendMailMock.mockReset()
  })

  it('sends mail with the given to/subject/text and returns ok', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' })

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(true)
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'Navalia <no-reply@example.com>',
      to: 'cliente@example.com',
      subject: 'Assunto',
      text: 'Corpo',
    })
  })

  it('returns ok:false when sendMail throws', async () => {
    sendMailMock.mockRejectedValue(new Error('Connection refused'))

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Connection refused')
  })

  it('returns ok:false when SMTP_HOST is not set', async () => {
    vi.stubEnv('SMTP_HOST', '')

    const result = await sendEmail('cliente@example.com', 'Assunto', 'Corpo')

    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- email.test.ts`
Expected: FAIL with "Cannot find module './email'"

- [ ] **Step 4: Implement the module**

Create `src/modules/notifications/email.ts`:

```ts
import 'server-only'
import { createTransport } from 'nodemailer'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function requireEnv(name: string): string | null {
  const value = process.env[name]
  return value && value.length > 0 ? value : null
}

/** Sends a plain-text email via the operator's own SMTP account. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<Result<void>> {
  const host = requireEnv('SMTP_HOST')
  const port = requireEnv('SMTP_PORT')
  const user = requireEnv('SMTP_USER')
  const pass = requireEnv('SMTP_PASSWORD')
  const from = requireEnv('SMTP_FROM')

  if (!host || !port || !user || !pass || !from) {
    return { ok: false, error: 'Configuração de e-mail (SMTP) ausente.' }
  }

  try {
    const transporter = createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    })
    await transporter.sendMail({ from, to, subject, text })
    return { ok: true, data: undefined }
  } catch (err) {
    return {
      ok: false,
      error: `Erro ao enviar e-mail: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- email.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Document the new env vars**

Append to `.env.example` (after the `EVOLUTION_WEBHOOK_URL` line):

```
# SMTP for email fallback (phone-verification codes when WhatsApp isn't
# connected). Use your own existing SMTP account — no new paid service.
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASSWORD=change-me
SMTP_FROM=Navalia <no-reply@example.com>
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/notifications/email.ts src/modules/notifications/email.test.ts .env.example package.json package-lock.json
git commit -m "feat(notifications): add nodemailer-based SMTP email sender"
```

---

### Task 3: Core verification module

**Files:**
- Create: `src/modules/booking/verification.ts`
- Test: `src/modules/booking/verification.test.ts`

**Interfaces:**
- Consumes: `evolution.sendText` from `@/modules/whatsapp/evolution-client` (Result-typed), `sendEmail` from `@/modules/notifications/email` (Task 2), `prisma` from `@/lib/prisma`, the `PhoneVerification`/`Customer.phoneVerifiedAt` fields (Task 1).
- Produces:
  - `isPhoneVerified(barbershopId: string, cpf: string, phone: string): Promise<boolean>`
  - `hasRecentVerification(barbershopId: string, cpf: string, phone: string): Promise<boolean>`
  - `requestVerificationCode(args: { barbershopId: string; cpf: string; phone: string; email?: string }): Promise<Result<{ channel: 'WHATSAPP' | 'EMAIL' }>>`
  - `verifyCode(args: { barbershopId: string; cpf: string; phone: string; code: string }): Promise<Result<{ verified: true }>>`
  - `Result<T> = { ok: true; data: T } | { ok: false; error: VerificationError }`
  - `VerificationError = 'ALREADY_VERIFIED' | 'RESEND_TOO_SOON' | 'EMAIL_REQUIRED' | 'SEND_FAILED' | 'NOT_FOUND' | 'CODE_EXPIRED' | 'CODE_INVALID' | 'TOO_MANY_ATTEMPTS'`
  - All four exported functions take an optional `deps` last argument (`{ prisma?, sendWhatsApp?, sendEmail? }`) defaulting to the real implementations — mirrors the existing pattern in `src/modules/notifications/push.ts`.

- [ ] **Step 1: Write the failing integration tests**

Create `src/modules/booking/verification.test.ts`:

```ts
import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  isPhoneVerified,
  hasRecentVerification,
  requestVerificationCode,
  verifyCode,
} from './verification'

let barbershopId: string
let connectedShopId: string
const CPF_A = '11144477735'
const PHONE_A = '5571999990001'

describe.skipIf(!process.env.DATABASE_URL)('verification (integration)', () => {
  beforeAll(async () => {
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Verification Shop',
        slug: `test-verify-${Date.now()}`,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        whatsappStatus: 'DISCONNECTED',
      },
    })
    barbershopId = shop.id

    const connectedShop = await prisma.barbershop.create({
      data: {
        name: 'Test Connected Shop',
        slug: `test-verify-connected-${Date.now()}`,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        evolutionInstanceId: `test-instance-${Date.now()}`,
        whatsappStatus: 'CONNECTED',
      },
    })
    connectedShopId = connectedShop.id
  })

  afterAll(async () => {
    await prisma.phoneVerification.deleteMany({ where: { barbershopId: { in: [barbershopId, connectedShopId] } } })
    await prisma.customer.deleteMany({ where: { barbershopId: { in: [barbershopId, connectedShopId] } } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
    await prisma.barbershop.delete({ where: { id: connectedShopId } })
  })

  it('(a) isPhoneVerified is false when no customer exists', async () => {
    expect(await isPhoneVerified(barbershopId, CPF_A, PHONE_A)).toBe(false)
  })

  it('(b) requestVerificationCode without email on a disconnected shop → EMAIL_REQUIRED', async () => {
    const result = await requestVerificationCode({ barbershopId, cpf: CPF_A, phone: PHONE_A })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('EMAIL_REQUIRED')
  })

  it('(c) requestVerificationCode with email on a disconnected shop sends via EMAIL', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const result = await requestVerificationCode(
      { barbershopId, cpf: CPF_A, phone: PHONE_A, email: 'cliente@example.com' },
      { sendEmail },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.channel).toBe('EMAIL')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [to, , text] = sendEmail.mock.calls[0]
    expect(to).toBe('cliente@example.com')
    expect(text).toMatch(/\d{6}/)
  })

  it('(d) resend cooldown blocks a second request within 60s', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true })
    const result = await requestVerificationCode(
      { barbershopId, cpf: CPF_A, phone: PHONE_A, email: 'cliente@example.com' },
      { sendEmail },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('RESEND_TOO_SOON')
  })

  it('(e) requestVerificationCode on a connected shop sends via WHATSAPP, ignoring email', async () => {
    const sendWhatsApp = vi.fn().mockResolvedValue({ ok: true })
    const sendEmail = vi.fn()
    const result = await requestVerificationCode(
      { barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A },
      { sendWhatsApp, sendEmail },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.channel).toBe('WHATSAPP')
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('(f) verifyCode with the wrong code increments attempts and fails', async () => {
    const result = await verifyCode({ barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A, code: '000000' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('CODE_INVALID')

    const row = await prisma.phoneVerification.findFirst({
      where: { barbershopId: connectedShopId, cpf: CPF_A, phone: PHONE_A },
      orderBy: { createdAt: 'desc' },
    })
    expect(row?.attempts).toBe(1)
  })

  it('(g) verifyCode with the right code succeeds, and hasRecentVerification becomes true', async () => {
    const sendWhatsApp = vi.fn().mockResolvedValue({ ok: true })
    // Capture the code via a spy on the WhatsApp text
    let sentCode = ''
    sendWhatsApp.mockImplementation(async (_instance: string, _to: string, text: string) => {
      sentCode = text.match(/\d{6}/)?.[0] ?? ''
      return { ok: true }
    })

    const uniquePhone = '5571999990099'
    await requestVerificationCode(
      { barbershopId: connectedShopId, cpf: '52998224725', phone: uniquePhone },
      { sendWhatsApp },
    )
    expect(sentCode).toMatch(/^\d{6}$/)

    const result = await verifyCode({
      barbershopId: connectedShopId,
      cpf: '52998224725',
      phone: uniquePhone,
      code: sentCode,
    })
    expect(result.ok).toBe(true)

    expect(await hasRecentVerification(connectedShopId, '52998224725', uniquePhone)).toBe(true)
  })

  it('(h) a customer with phoneVerifiedAt set for this exact phone is already verified', async () => {
    const customer = await prisma.customer.create({
      data: {
        barbershopId,
        name: 'Verified Customer',
        cpf: '39053344705',
        phone: '5571999990088',
        phoneVerifiedAt: new Date(),
      },
    })
    expect(await isPhoneVerified(barbershopId, customer.cpf!, customer.phone)).toBe(true)
  })

  it('(i) a verified customer with a DIFFERENT phone is not verified for the new phone', async () => {
    const customer = await prisma.customer.findFirst({ where: { barbershopId, cpf: '39053344705' } })
    expect(await isPhoneVerified(barbershopId, customer!.cpf!, '5571999990077')).toBe(false)
  })

  it('(j) verifyCode with no pending code → NOT_FOUND', async () => {
    const result = await verifyCode({ barbershopId, cpf: '99999999999', phone: '5571999990066', code: '123456' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- verification.test.ts`
Expected: FAIL with "Cannot find module './verification'"

- [ ] **Step 3: Implement the module**

Create `src/modules/booking/verification.ts`:

```ts
import 'server-only'
import { createHash, randomInt } from 'crypto'
import { prisma as realPrisma } from '@/lib/prisma'
import { evolution } from '@/modules/whatsapp/evolution-client'
import { sendEmail as realSendEmail } from '@/modules/notifications/email'

const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const RECENT_VERIFICATION_WINDOW_MS = 30 * 60 * 1000
const MAX_ATTEMPTS = 5

export type VerificationError =
  | 'ALREADY_VERIFIED'
  | 'RESEND_TOO_SOON'
  | 'EMAIL_REQUIRED'
  | 'SEND_FAILED'
  | 'NOT_FOUND'
  | 'CODE_EXPIRED'
  | 'CODE_INVALID'
  | 'TOO_MANY_ATTEMPTS'

export type Result<T> = { ok: true; data: T } | { ok: false; error: VerificationError }

type Deps = {
  prisma?: typeof realPrisma
  sendWhatsApp?: (instance: string, to: string, text: string) => Promise<{ ok: boolean }>
  sendEmail?: (to: string, subject: string, text: string) => Promise<{ ok: boolean }>
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** True when this exact (barbershopId, cpf, phone) combination is already trusted. */
export async function isPhoneVerified(
  barbershopId: string,
  cpf: string,
  phone: string,
  deps: Deps = {},
): Promise<boolean> {
  const db = deps.prisma ?? realPrisma
  const customer = await db.customer.findUnique({
    where: { barbershopId_cpf: { barbershopId, cpf } },
    select: { phone: true, phoneVerifiedAt: true },
  })
  return !!customer && customer.phone === phone && customer.phoneVerifiedAt !== null
}

/** True when a fresh (last 30 min), completed PhoneVerification exists for this combination. */
export async function hasRecentVerification(
  barbershopId: string,
  cpf: string,
  phone: string,
  deps: Deps = {},
): Promise<boolean> {
  const db = deps.prisma ?? realPrisma
  const verification = await db.phoneVerification.findFirst({
    where: {
      barbershopId,
      cpf,
      phone,
      verifiedAt: { gte: new Date(Date.now() - RECENT_VERIFICATION_WINDOW_MS) },
    },
  })
  return !!verification
}

/**
 * Sends a 6-digit code via WhatsApp (if the shop's Evolution instance is
 * connected) or email (fallback — requires `args.email`).
 */
export async function requestVerificationCode(
  args: { barbershopId: string; cpf: string; phone: string; email?: string },
  deps: Deps = {},
): Promise<Result<{ channel: 'WHATSAPP' | 'EMAIL' }>> {
  const db = deps.prisma ?? realPrisma
  const sendWhatsApp =
    deps.sendWhatsApp ??
    ((instance: string, to: string, text: string) => evolution.sendText(instance, to, text))
  const sendEmail = deps.sendEmail ?? realSendEmail

  if (await isPhoneVerified(args.barbershopId, args.cpf, args.phone, { prisma: db })) {
    return { ok: false, error: 'ALREADY_VERIFIED' }
  }

  const recent = await db.phoneVerification.findFirst({
    where: { barbershopId: args.barbershopId, cpf: args.cpf, phone: args.phone },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, error: 'RESEND_TOO_SOON' }
  }

  const shop = await db.barbershop.findUnique({
    where: { id: args.barbershopId },
    select: { name: true, evolutionInstanceId: true, whatsappStatus: true },
  })
  if (!shop) return { ok: false, error: 'NOT_FOUND' }

  const useWhatsApp = !!shop.evolutionInstanceId && shop.whatsappStatus === 'CONNECTED'
  if (!useWhatsApp && !args.email) {
    return { ok: false, error: 'EMAIL_REQUIRED' }
  }

  const code = generateCode()
  const text = `Seu código de verificação para ${shop.name}: ${code}\nVálido por 10 minutos.`

  const sendResult = useWhatsApp
    ? await sendWhatsApp(shop.evolutionInstanceId!, args.phone, text)
    : await sendEmail(args.email!, `Código de verificação — ${shop.name}`, text)

  if (!sendResult.ok) return { ok: false, error: 'SEND_FAILED' }

  await db.phoneVerification.create({
    data: {
      barbershopId: args.barbershopId,
      cpf: args.cpf,
      phone: args.phone,
      codeHash: hashCode(code),
      channel: useWhatsApp ? 'WHATSAPP' : 'EMAIL',
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  })

  return { ok: true, data: { channel: useWhatsApp ? 'WHATSAPP' : 'EMAIL' } }
}

/** Verifies the most recent pending code for this (barbershopId, cpf, phone). */
export async function verifyCode(
  args: { barbershopId: string; cpf: string; phone: string; code: string },
  deps: Deps = {},
): Promise<Result<{ verified: true }>> {
  const db = deps.prisma ?? realPrisma

  const verification = await db.phoneVerification.findFirst({
    where: { barbershopId: args.barbershopId, cpf: args.cpf, phone: args.phone, verifiedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!verification) return { ok: false, error: 'NOT_FOUND' }
  if (verification.expiresAt < new Date()) return { ok: false, error: 'CODE_EXPIRED' }
  if (verification.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'TOO_MANY_ATTEMPTS' }

  if (hashCode(args.code) !== verification.codeHash) {
    await db.phoneVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, error: 'CODE_INVALID' }
  }

  await db.phoneVerification.update({
    where: { id: verification.id },
    data: { verifiedAt: new Date() },
  })
  return { ok: true, data: { verified: true } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- verification.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Run typecheck and full suite**

Run: `npm run typecheck` and `npm test`
Expected: PASS, no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/modules/booking/verification.ts src/modules/booking/verification.test.ts
git commit -m "feat(booking): add core phone-verification module (WhatsApp/email OTP)"
```

---

### Task 4: Server actions

**Files:**
- Create: `src/modules/booking/verification-actions.ts`
- Test: `src/modules/booking/verification-actions.test.ts`
- Modify: `src/modules/booking/public-actions.ts` (export `isShopAccessible`)

**Interfaces:**
- Consumes: `isPhoneVerified`, `requestVerificationCode`, `verifyCode` from `./verification` (Task 3); `normalizeCpf` from `@/modules/tenancy/cpf`.
- Produces:
  - `checkPhoneVerified(args: { slug: string; cpf: string; phone: string }): Promise<{ verified: boolean }>`
  - `requestPhoneVerification(args: { slug: string; cpf: string; phone: string; email?: string }): Promise<{ ok: true; channel: 'WHATSAPP' | 'EMAIL' } | { ok: false; error: string; needsEmail?: boolean }>`
  - `confirmPhoneVerification(args: { slug: string; cpf: string; phone: string; code: string }): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Export `isShopAccessible` from `public-actions.ts`**

In `src/modules/booking/public-actions.ts`, change the function declaration
(currently `function isShopAccessible(...)`, around line 12) to:

```ts
export function isShopAccessible(shop: {
  onboardingCompleted: boolean
  subscriptionStatus: Parameters<typeof hasAccess>[0]['subscriptionStatus']
  trialEndsAt: Date
}): boolean {
  if (!shop.onboardingCompleted) return false
  return hasAccess(shop)
}
```

(Only the added `export` keyword changes — the body is unchanged.)

- [ ] **Step 2: Write the failing integration tests**

Create `src/modules/booking/verification-actions.test.ts`:

```ts
import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { checkPhoneVerified, requestPhoneVerification, confirmPhoneVerification } from './verification-actions'

let barbershopId: string
let slug: string

describe.skipIf(!process.env.DATABASE_URL)('verification-actions (integration)', () => {
  beforeAll(async () => {
    slug = `test-verify-actions-${Date.now()}`
    const shop = await prisma.barbershop.create({
      data: {
        name: 'Test Verify Actions Shop',
        slug,
        businessHours: {},
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onboardingCompleted: true,
        whatsappStatus: 'DISCONNECTED',
      },
    })
    barbershopId = shop.id
  })

  afterAll(async () => {
    await prisma.phoneVerification.deleteMany({ where: { barbershopId } })
    await prisma.customer.deleteMany({ where: { barbershopId } })
    await prisma.barbershop.delete({ where: { id: barbershopId } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('(a) checkPhoneVerified is false for an unknown CPF', async () => {
    const result = await checkPhoneVerified({ slug, cpf: '11144477735', phone: '5571999991001' })
    expect(result.verified).toBe(false)
  })

  it('(b) checkPhoneVerified returns false for an unknown slug (no page-not-found leak)', async () => {
    const result = await checkPhoneVerified({ slug: 'does-not-exist', cpf: '11144477735', phone: '5571999991001' })
    expect(result.verified).toBe(false)
  })

  it('(c) requestPhoneVerification without email on a disconnected shop asks for one', async () => {
    const result = await requestPhoneVerification({ slug, cpf: '52998224725', phone: '5571999991002' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.needsEmail).toBe(true)
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('(d) requestPhoneVerification with email fails gracefully when SMTP is unconfigured', async () => {
    // Force SMTP_* unset regardless of the developer's local .env — this
    // test asserts requestPhoneVerification surfaces a friendly error
    // instead of throwing when the real sendEmail() call fails closed, and
    // must not depend on whether real SMTP credentials happen to be
    // configured on the machine running the suite.
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_PORT', '')
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASSWORD', '')
    vi.stubEnv('SMTP_FROM', '')

    const result = await requestPhoneVerification({
      slug,
      cpf: '52998224725',
      phone: '5571999991002',
      email: 'cliente@example.com',
    })
    expect(result.ok).toBe(false)
  })

  it('(e) confirmPhoneVerification with no pending code returns a friendly error', async () => {
    const result = await confirmPhoneVerification({
      slug,
      cpf: '39053344705',
      phone: '5571999991003',
      code: '123456',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- verification-actions.test.ts`
Expected: FAIL with "Cannot find module './verification-actions'"

- [ ] **Step 4: Implement the actions**

Create `src/modules/booking/verification-actions.ts`:

```ts
'use server'

import { prisma } from '@/lib/prisma'
import { isShopAccessible } from './public-actions'
import { normalizeCpf } from '@/modules/tenancy/cpf'
import {
  isPhoneVerified,
  requestVerificationCode,
  verifyCode,
  type VerificationError,
} from './verification'

const REQUEST_ERROR_PT_BR: Record<VerificationError, string> = {
  ALREADY_VERIFIED: 'Telefone já verificado.',
  RESEND_TOO_SOON: 'Aguarde um minuto antes de pedir um novo código.',
  EMAIL_REQUIRED: 'WhatsApp indisponível no momento — informe seu e-mail para receber o código.',
  SEND_FAILED: 'Não foi possível enviar o código agora. Tente novamente.',
  NOT_FOUND: 'Página indisponível.',
  CODE_EXPIRED: 'Código expirado. Solicite um novo.',
  CODE_INVALID: 'Código incorreto.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas. Solicite um novo código.',
}

async function resolveAccessibleShopId(slug: string): Promise<string | null> {
  const shop = await prisma.barbershop.findUnique({
    where: { slug },
    select: { id: true, onboardingCompleted: true, subscriptionStatus: true, trialEndsAt: true },
  })
  if (!shop || !isShopAccessible(shop)) return null
  return shop.id
}

export async function checkPhoneVerified(args: {
  slug: string
  cpf: string
  phone: string
}): Promise<{ verified: boolean }> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { verified: false }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { verified: false }

  const verified = await isPhoneVerified(barbershopId, cpf, args.phone.trim())
  return { verified }
}

export async function requestPhoneVerification(args: {
  slug: string
  cpf: string
  phone: string
  email?: string
}): Promise<
  | { ok: true; channel: 'WHATSAPP' | 'EMAIL' }
  | { ok: false; error: string; needsEmail?: boolean }
> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { ok: false, error: 'Página indisponível.' }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { ok: false, error: 'CPF inválido.' }

  const result = await requestVerificationCode({
    barbershopId,
    cpf,
    phone: args.phone.trim(),
    email: args.email?.trim() || undefined,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: REQUEST_ERROR_PT_BR[result.error],
      needsEmail: result.error === 'EMAIL_REQUIRED',
    }
  }

  return { ok: true, channel: result.data.channel }
}

export async function confirmPhoneVerification(args: {
  slug: string
  cpf: string
  phone: string
  code: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const barbershopId = await resolveAccessibleShopId(args.slug)
  if (!barbershopId) return { ok: false, error: 'Página indisponível.' }

  const cpf = normalizeCpf(args.cpf)
  if (!cpf) return { ok: false, error: 'CPF inválido.' }

  const result = await verifyCode({
    barbershopId,
    cpf,
    phone: args.phone.trim(),
    code: args.code.trim(),
  })

  if (!result.ok) return { ok: false, error: REQUEST_ERROR_PT_BR[result.error] }
  return { ok: true }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- verification-actions.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run typecheck and full suite**

Run: `npm run typecheck` and `npm test`
Expected: PASS, no errors, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/modules/booking/verification-actions.ts src/modules/booking/verification-actions.test.ts src/modules/booking/public-actions.ts
git commit -m "feat(booking): add server actions for phone verification (check/request/confirm)"
```

---

### Task 5: Booking engine gate

**Files:**
- Modify: `src/modules/booking/types.ts`
- Modify: `src/modules/booking/create-appointment.ts`
- Modify: `src/modules/booking/conflict.test.ts`

**Interfaces:**
- Consumes: `isPhoneVerified`, `hasRecentVerification` from `./verification` (Task 3).
- Produces: `createAppointment` can now also return `{ ok: false, error: 'PHONE_NOT_VERIFIED' }` when `source === 'PUBLIC_PAGE'` and the phone isn't trusted; on success, `Customer.phoneVerifiedAt` is set/refreshed for `PUBLIC_PAGE` bookings.

- [ ] **Step 1: Extend the error union and pt-BR message**

In `src/modules/booking/types.ts`, add `PHONE_NOT_VERIFIED` to `BookingError` and `BOOKING_ERROR_PT_BR`:

```ts
export type BookingError =
  | 'SLOT_TAKEN'
  | 'INVALID_SERVICE'
  | 'INVALID_PROFESSIONAL'
  | 'OUTSIDE_AVAILABILITY'
  | 'INVALID_PHONE'
  | 'INVALID_CPF'
  | 'CPF_MIGRATION_REQUIRED'
  | 'PHONE_NOT_VERIFIED'
  | 'NOT_FOUND'
  | 'CONSENT_REQUIRED'

/** Single source of truth for pt-BR booking error messages. */
export const BOOKING_ERROR_PT_BR: Record<BookingError, string> = {
  SLOT_TAKEN: 'Esse horário acabou de ser reservado. Escolha outro.',
  INVALID_SERVICE: 'Serviço não encontrado.',
  INVALID_PROFESSIONAL: 'Profissional não encontrado.',
  OUTSIDE_AVAILABILITY: 'Horário fora da disponibilidade.',
  INVALID_PHONE: 'Telefone inválido.',
  INVALID_CPF: 'CPF inválido.',
  CPF_MIGRATION_REQUIRED: 'Agendamentos temporariamente indisponíveis. Entre em contato com a barbearia.',
  PHONE_NOT_VERIFIED: 'Verifique seu telefone antes de confirmar o agendamento.',
  NOT_FOUND: 'Agendamento não encontrado.',
  CONSENT_REQUIRED: 'Você precisa concordar com a Política de Privacidade para continuar.',
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingError }
```

- [ ] **Step 2: Write the failing integration tests**

In `src/modules/booking/conflict.test.ts`, add the import (with the other
local imports near the top):

```ts
import { isPhoneVerified } from './verification'
```

Append these tests at the end of the `describe` block, before the closing `})`:

```ts
  it('(q) PUBLIC_PAGE booking with an unverified new phone → PHONE_NOT_VERIFIED', async () => {
    const result = await createAppointment({
      ...base('18:30'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Unverified', cpf: '20000000027', phone: '11955550003' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PHONE_NOT_VERIFIED')
  })

  it('(r) PUBLIC_PAGE booking with a recently-verified phone succeeds and sets phoneVerifiedAt', async () => {
    const cpf = '20000791997'
    const phone = '11955550004'
    await prisma.phoneVerification.create({
      data: {
        barbershopId,
        cpf,
        phone,
        codeHash: 'irrelevant-for-this-test',
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      },
    })

    const result = await createAppointment({
      ...base('18:45'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Recently Verified', cpf, phone },
    })
    expect(result.ok).toBe(true)

    const customer = await prisma.customer.findUnique({
      where: { barbershopId_cpf: { barbershopId, cpf } },
    })
    expect(customer?.phoneVerifiedAt).not.toBeNull()
  })

  it('(s) a returning customer whose phone is already trusted skips the gate on a second booking', async () => {
    const cpf = '20001583824'
    const phone = '11955550005'
    await prisma.phoneVerification.create({
      data: {
        barbershopId,
        cpf,
        phone,
        codeHash: 'irrelevant-for-this-test',
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      },
    })
    const first = await createAppointment({
      ...base('19:00'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Returning Customer', cpf, phone },
    })
    expect(first.ok).toBe(true)
    expect(await isPhoneVerified(barbershopId, cpf, phone)).toBe(true)

    // No new PhoneVerification row exists for this booking — proves the gate
    // is satisfied via Customer.phoneVerifiedAt, not a fresh code.
    const second = await createAppointment({
      ...base('19:15'),
      source: 'PUBLIC_PAGE',
      consent: true,
      customer: { name: 'Returning Customer', cpf, phone },
    })
    expect(second.ok).toBe(true)
  })

  it('(t) ADMIN source is unaffected by the phone-verification gate', async () => {
    const result = await createAppointment({
      ...base('19:30'),
      source: 'ADMIN',
      customer: { name: 'Admin Walk-in', cpf: '20002375761', phone: '11955550006' },
    })
    expect(result.ok).toBe(true)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- conflict.test.ts`
Expected: FAIL — tests (q), (r), (s) fail because the gate doesn't exist yet
(bookings that should be blocked succeed instead); import of
`./verification` also doesn't resolve to a `PHONE_NOT_VERIFIED`-aware
engine yet.

- [ ] **Step 4: Implement the gate in the booking engine**

In `src/modules/booking/create-appointment.ts`, add the import (near the
other local imports):

```ts
import { isPhoneVerified, hasRecentVerification } from './verification'
```

Insert the gate right after the existing CPF validation line
(`if (cpf === null || !isValidCpf(cpf)) return { ok: false, error: 'INVALID_CPF' }`)
and before `const runTx = async () => ...`:

```ts
  let verifiedPhoneTimestamp: Date | undefined
  if (args.source === 'PUBLIC_PAGE') {
    const trusted = await isPhoneVerified(args.tenantId, cpf, phone)
    if (!trusted) {
      const recentlyVerified = await hasRecentVerification(args.tenantId, cpf, phone)
      if (!recentlyVerified) return { ok: false, error: 'PHONE_NOT_VERIFIED' }
      verifiedPhoneTimestamp = new Date()
    }
  }
```

Update the customer upsert (step 5 inside the transaction) to set
`phoneVerifiedAt` on create, and refresh it on update only when this
booking just proved a new verification:

```ts
        // --- 5. Upsert customer (barbershopId + normalised CPF) ---
        const customer = await tx.customer.upsert({
          where: { barbershopId_cpf: { barbershopId: args.tenantId, cpf } },
          create: {
            barbershopId: args.tenantId,
            name: args.customer.name,
            cpf,
            phone,
            email: args.customer.email,
            privacyConsentAt: args.consent ? new Date() : undefined,
            phoneVerifiedAt: args.source === 'PUBLIC_PAGE' ? (verifiedPhoneTimestamp ?? new Date()) : undefined,
          },
          update: {
            name: args.customer.name,
            phone,
            ...(verifiedPhoneTimestamp ? { phoneVerifiedAt: verifiedPhoneTimestamp } : {}),
          },
        })
```

(Reasoning: a brand-new `Customer` row created via `PUBLIC_PAGE` can only
reach this line by having passed the gate above — either already trusted
[impossible for a genuinely new row] or freshly verified — so
`verifiedPhoneTimestamp ?? new Date()` is always defined in practice for
the create branch; the `?? new Date()` is a harmless belt-and-suspenders
fallback. On `update`, omitting the field when `verifiedPhoneTimestamp` is
unset preserves whatever `phoneVerifiedAt` the customer already had —
correct both for "already trusted, nothing changed" and for any non-
`PUBLIC_PAGE` source, which never touches this field.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- conflict.test.ts`
Expected: PASS on all tests (a)–(t).

- [ ] **Step 6: Run typecheck and full suite**

Run: `npm run typecheck` and `npm test`
Expected: PASS, no errors, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/modules/booking/types.ts src/modules/booking/create-appointment.ts src/modules/booking/conflict.test.ts
git commit -m "feat(booking): gate PUBLIC_PAGE bookings on phone verification"
```

---

### Task 6: Public booking page — verification UI

**Files:**
- Modify: `src/app/[slug]/_components/BookingSection.tsx`

**Interfaces:**
- Consumes: `checkPhoneVerified`, `requestPhoneVerification`, `confirmPhoneVerification` from `@/modules/booking/verification-actions` (Task 4).

- [ ] **Step 1: Add imports and state**

Add the import (with the other `@/modules/booking/*` imports near the top):

```tsx
import {
  checkPhoneVerified,
  requestPhoneVerification,
  confirmPhoneVerification,
} from '@/modules/booking/verification-actions'
```

Add `useEffect` to the existing React import (currently
`import { useState, useTransition, useCallback } from 'react'`):

```tsx
import { useState, useTransition, useCallback, useEffect } from 'react'
```

Add new state, right after the existing customer-form state block
(`const [isPending, startTransition] = useTransition()`):

```tsx
  // Phone verification
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null)
  const [checkingVerification, setCheckingVerification] = useState(false)
  const [verificationSent, setVerificationSent] = useState<{ channel: 'WHATSAPP' | 'EMAIL' } | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [sendingCode, startSendCodeTransition] = useTransition()
  const [confirmingCode, startConfirmCodeTransition] = useTransition()
  const [canResend, setCanResend] = useState(true)
```

- [ ] **Step 2: Add the auto-check effect and handlers**

Add this right after the `whatsAppHref` block (after the closing `: null`
of that `const whatsAppHref = ...` statement), before `// ── Fetch slots ──`:

```tsx
  // ── Phone verification: auto-check once CPF + phone are both filled ────

  useEffect(() => {
    const normalized = normalizeCpf(customerCpf)
    if (!normalized || !isValidCpf(normalized) || !customerPhone.trim()) {
      setPhoneVerified(null)
      setVerificationSent(null)
      return
    }

    let cancelled = false
    setCheckingVerification(true)
    setVerificationSent(null)
    setVerificationError(null)

    checkPhoneVerified({ slug: shop.slug, cpf: normalized, phone: customerPhone.trim() }).then(res => {
      if (!cancelled) {
        setPhoneVerified(res.verified)
        setCheckingVerification(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [customerCpf, customerPhone, shop.slug])

  function handleSendCode() {
    const normalized = normalizeCpf(customerCpf)
    if (!normalized) return
    setVerificationError(null)
    startSendCodeTransition(async () => {
      const res = await requestPhoneVerification({
        slug: shop.slug,
        cpf: normalized,
        phone: customerPhone.trim(),
        email: customerEmail.trim() || undefined,
      })
      if (!res.ok) {
        setVerificationError(res.error)
        return
      }
      setVerificationSent({ channel: res.channel })
      setCanResend(false)
      setTimeout(() => setCanResend(true), 60_000)
    })
  }

  function handleConfirmCode() {
    const normalized = normalizeCpf(customerCpf)
    if (!normalized) return
    setVerificationError(null)
    startConfirmCodeTransition(async () => {
      const res = await confirmPhoneVerification({
        slug: shop.slug,
        cpf: normalized,
        phone: customerPhone.trim(),
        code: verificationCode.trim(),
      })
      if (!res.ok) {
        setVerificationError(res.error)
        return
      }
      setPhoneVerified(true)
      setVerificationSent(null)
    })
  }
```

- [ ] **Step 3: Guard submission**

In `handleSubmit`, add a check right after the existing CPF-validity check
and before the `consentAccepted` check:

```tsx
    if (phoneVerified !== true) {
      setFormError('Verifique seu telefone antes de confirmar o agendamento.')
      return
    }
```

- [ ] **Step 4: Add the verification UI block**

In the step-4 JSX, insert this block right after the "E-mail" field's
closing `</div>` and before the consent checkbox's `<div className="flex items-start gap-2">`:

```tsx
            {customerCpf.trim() && customerPhone.trim() && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                {checkingVerification && (
                  <p className="text-xs text-muted-foreground">Verificando telefone…</p>
                )}

                {!checkingVerification && phoneVerified === true && (
                  <p className="text-xs font-medium text-[var(--status-confirmed-fg)]">
                    ✓ Telefone verificado
                  </p>
                )}

                {!checkingVerification && phoneVerified === false && !verificationSent && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Por segurança, confirme que este telefone é seu.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleSendCode}
                      disabled={sendingCode}
                    >
                      {sendingCode ? 'Enviando…' : 'Enviar código de verificação'}
                    </Button>
                  </div>
                )}

                {!checkingVerification && phoneVerified === false && verificationSent && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Enviamos um código para o seu{' '}
                      {verificationSent.channel === 'WHATSAPP' ? 'WhatsApp' : 'e-mail'}.
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value)}
                        placeholder="000000"
                        maxLength={6}
                        disabled={confirmingCode}
                        className="w-28"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleConfirmCode}
                        disabled={confirmingCode || verificationCode.trim().length !== 6}
                      >
                        {confirmingCode ? 'Confirmando…' : 'Confirmar código'}
                      </Button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={!canResend || sendingCode}
                      className="text-xs text-muted-foreground underline disabled:opacity-50 disabled:no-underline"
                    >
                      Reenviar código
                    </button>
                  </div>
                )}

                {verificationError && (
                  <p className="text-xs text-destructive">{verificationError}</p>
                )}
              </div>
            )}

```

- [ ] **Step 5: Disable the submit button until verified**

Find the submit `<Button type="submit" ...>` at the end of the form and
change its `disabled` prop from `disabled={isPending}` to:

```tsx
              disabled={isPending || phoneVerified === false}
```

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open a barbershop's public booking page, walk through to
step 4. With a barbershop that has no WhatsApp connected (the seeded demo
shop, unless you've connected WhatsApp locally):
- Fill Nome, CPF (a fresh one not already in the seed data), Telefone. Leave
  Email blank, click "Enviar código de verificação" — confirm it asks for
  an email (`needsEmail` message).
- Fill Email, click again — since no `SMTP_*` env vars are set locally by
  default, confirm this fails with a friendly error (not a crash) — this
  is expected without real SMTP configured; note it in your report rather
  than treating it as a blocker for this manual check.
- With `SMTP_*` configured (if you have a test SMTP account), confirm a
  real code arrives and typing it in unlocks "Confirmar agendamento".
- Re-run the flow with the SAME CPF+phone a second time (new browser tab or
  after finishing a booking) — confirm the verification block doesn't
  appear at all (`phoneVerified` resolves to `true` immediately).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add "src/app/[slug]/_components/BookingSection.tsx"
git commit -m "feat(booking): add phone verification UI to the public booking form"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: PASS, including all tests added in Tasks 2, 3, 4, 5.

- [ ] **Step 2: Run integration tests against a real database**

Run (with `DATABASE_URL` set): `npm test`
Expected: PASS, including `verification.test.ts`, `verification-actions.test.ts`,
and the new `conflict.test.ts` cases (q)-(t).

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS, no errors. Warnings should only be pre-existing ones already
present before this plan (see the prior branch's final review for the known
baseline) — if lint introduces a new warning in a file this plan touched,
fix it before considering the task done.

- [ ] **Step 4: Manual end-to-end pass**

Run `npm run dev` and walk through: a brand-new CPF+phone on the public
booking page requires verification before the "Confirmar agendamento"
button activates; a second booking with the same CPF+phone skips
verification entirely; a booking via the admin dashboard or the WhatsApp
AI flow (if reachable locally) is completely unaffected by any of this.
