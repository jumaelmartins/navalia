# Dashboard cards, revenue split, CPF identifier — Design

Date: 2026-07-16
Status: Approved by user, pending implementation plan

## Problem

Three issues reported against the current dashboard/booking flow:

1. KPI cards on `/dashboard` overflow their container when the value is a
   long currency string (e.g. "R$ 1.234,56").
2. "Receita hoje" / "Receita semana" count `CONFIRMED` appointments, so a
   booking counts as revenue the moment it's created — before the service
   is ever delivered.
3. `Customer` is keyed by phone (`@@unique([barbershopId, phone])`). In
   Brazil it's common for a family to share one phone/WhatsApp number, so
   three different people booking from the same number are merged into a
   single customer record. CPF (Brazilian tax ID) is the correct unique
   identifier per person.

## A. KPI card overflow

**Root cause**: `KpiCard` (`src/app/(dashboard)/dashboard/page.tsx`) renders
the value in a `text-4xl` span with no `truncate`/`min-w-0`, inside a grid
that goes up to `xl:grid-cols-6` — six narrow cards, and a formatted BRL
value ("R$ 1.234,56") doesn't fit.

**Fix**:
- Wrap the value in a `min-w-0` container.
- Value span: `text-2xl sm:text-3xl font-semibold text-primary truncate block`.
- Add `title={value}` on the value span so the full number is available on
  hover when truncated.
- This is revisited in section B, since the KPI grid grows to 8 cards.

## B. Revenue: "prevista" vs "realizada"

Decision: keep both signals as separate cards rather than replacing one
with the other.

- Rename existing cards: "Receita hoje" → **"Receita prevista hoje"**,
  "Receita semana" → **"Receita prevista semana"**. Logic unchanged
  (`CONFIRMED` + `COMPLETED`).
- Add two new cards: **"Receita realizada hoje"** / **"Receita realizada
  semana"** — sum of `priceCents` for `COMPLETED` appointments only.
- `getDashboardKpis` (`src/modules/insights/queries.ts`) gains
  `todayRevenueRealizedCents` and `weekRevenueRealizedCents`, computed from
  the `todayAppts`/`weekAppts` arrays already fetched — no new query.
- `DashboardKpis` type gets the two new fields.
- KPI grid on `/dashboard` grows from 6 to 8 cards. Change grid to
  `grid-cols-2 sm:grid-cols-4` (2 rows of 4) so cards stay wide enough that
  the section A fix isn't fighting a too-narrow column on large screens.

## C. CPF as the customer identifier

### Schema (`prisma/schema.prisma`)

```prisma
model Customer {
  ...
  phone            String   // no longer unique; contact info only
  cpf              String?  // 11 digits, no punctuation; unique per tenant
  ...
  @@unique([barbershopId, cpf])
  @@index([barbershopId, phone])
}
```

`cpf` is nullable at the DB level to hold pre-existing rows created before
this change (see Migration gate below). Every customer created or updated
through the app from this point on is required to have a valid CPF — the
column is only nullable to represent historical data, not an accepted
ongoing state.

### CPF validation module — `src/modules/tenancy/cpf.ts`

Pure functions, unit-tested, no Prisma/framework dependency:

- `normalizeCpf(raw: string): string | null` — strips non-digits; returns
  the 11-digit string or `null` if the result isn't 11 digits.
- `isValidCpf(cpf: string): boolean` — takes an already-normalized 11-digit
  string. Rejects the 11 known repeated-digit sequences (`00000000000`,
  `11111111111`, … `99999999999`). Otherwise applies the standard CPF
  checksum: two verification digits computed from weighted sums (weights
  10..2 for the first check digit, 11..2 for the second) mod 11.
- `formatCpf(cpf: string): string` — `"000.000.000-00"` display format,
  mirroring `formatPhone` in `ClientesClient.tsx`.

### Booking engine (`src/modules/booking/create-appointment.ts`)

- `createAppointment`'s `customer` arg becomes
  `{ name: string; cpf: string; phone: string; email?: string }`.
- Before the transaction: normalize + validate CPF the same way phone is
  validated today (`normalizeCpf` + `isValidCpf`); return
  `{ ok: false, error: 'INVALID_CPF' }` on failure.
- **Migration gate**, checked first, before CPF validation, inside
  `createAppointment` (so every channel — public page, WhatsApp AI, AI_WEB
  widget, admin — goes through one enforcement point): query
  `prisma.customer.count({ where: { barbershopId: tenantId, cpf: null } })`.
  If `> 0`, return `{ ok: false, error: 'CPF_MIGRATION_REQUIRED' }`
  immediately.
- Step 5 (customer upsert) switches from
  `where: { barbershopId_phone: {...} }` to
  `where: { barbershopId_cpf: {...} }`; `create` includes `cpf`; `update`
  sets `name` and `phone` (phone can change per booking, cpf cannot).
- `Result` error union gains `'INVALID_CPF'` and `'CPF_MIGRATION_REQUIRED'`.

### Call sites that construct the `customer` arg

All four need a CPF input/collection step:

1. **Public booking page** — `src/app/[slug]/_components/BookingSection.tsx`
   step 4 form. Add a required CPF field (with input mask
   `000.000.000-00` and inline validation message) alongside name/phone.
   `src/modules/booking/public-actions.ts` (`createPublicAppointment`)
   passes `cpf` through; on `CPF_MIGRATION_REQUIRED` the customer-facing
   message is generic — **"Agendamentos temporariamente indisponíveis.
   Entre em contato com a barbearia."** — it must not expose internal gate
   details to end users who have no way to act on it.

2. **Admin manual booking** —
   `src/app/(dashboard)/dashboard/agenda/_components/AgendaClient.tsx`
   (~line 449-553, the new-appointment form) and
   `src/modules/booking/admin-actions.ts` (`createAppointmentAdmin`). Add a
   required CPF field next to the phone field. On
   `CPF_MIGRATION_REQUIRED`, the error message points the admin to
   `/dashboard/clientes` to finish the backfill.

3. **WhatsApp AI tool** — `src/modules/ai/tools/public-tools.ts`,
   `createAppointment` tool (~line 227-347). Today, `WHATSAPP` channel
   resolves `phone` straight from `ctx.customerPhone` (never asked in
   chat) while `AI_WEB` requires a `customerPhone` arg. CPF has no
   equivalent server-side source for either channel, so **both** channels
   now require a `customerCpf` arg — the model must ask for it in
   conversation before calling the tool with `confirmed: true`. Add
   `customerCpf` to the tool's JSON schema (`required`) and to the Zod
   schema, normalize/validate the same way as the engine (return a
   Portuguese error the model can relay and retry on). Update the tool
   `description` and the relevant prompt section in
   `src/modules/ai/prompts.ts` so the assistant knows to ask "Qual seu CPF
   (com todos os dígitos)?" as part of gathering booking details, and
   handles `CPF_MIGRATION_REQUIRED` by telling the customer scheduling is
   temporarily unavailable and to contact the shop directly (same
   customer-facing framing as the public page — the model cannot fix an
   admin-side backlog).

4. **Copilot / dashboard AI assistant** —
   `src/modules/ai/tools/copilot-tools.ts` only reads customer data
   (upcoming appointments, inactive-customer lists); it has no
   appointment-creation tool. No change needed here.

### Migration UI — `/dashboard/clientes`

- `ClientesPage` (`src/app/(dashboard)/dashboard/clientes/page.tsx`) selects
  `cpf` on the `Customer` query and passes it through `CustomerRow`.
- `ClientesClient.tsx`: rows missing `cpf` show a `"CPF pendente"` badge
  (reuse the pending-style badge already used for `isInactive`) and an
  inline-editable CPF cell (input + save, mirroring the notes-save pattern
  in `CustomerSheet`) instead of a static phone-only display. Validate with
  `isValidCpf` client + server side before save.
- New server action alongside `saveCustomerNotes` in
  `src/app/(dashboard)/dashboard/clientes/actions.ts`:
  `saveCustomerCpf(customerId: string, cpf: string): Promise<ActionResult<{cpf: string}>>`
  — normalizes, validates, checks tenant-scoped uniqueness (surfaces a
  clear "CPF já cadastrado para outro cliente" error on collision), then
  updates.
- Page header gains a banner when any customer is missing CPF: **"N
  clientes sem CPF — preencha para liberar novos agendamentos."** with the
  pending count, shown above the table.

### Out of scope

- No bulk-import/CSV tool for filling CPFs — the admin fills them one at a
  time through the new inline editor. Acceptable for expected data volumes
  (a barbershop's customer list); can be revisited if it proves painful.
- No CPF verification against an external registry (e.g. Receita Federal
  API) — checksum validation only, matching how phone validation works
  today (format check, not carrier verification).
