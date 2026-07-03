# Task C2 Report — emit APPOINTMENT_CREATED notification in-tx

## TDD RED → GREEN Evidence

### RED
Test file written (`create-appointment.notification.test.ts`) and run with `DATABASE_URL` set.
First attempt failed at data setup (`service.findFirstOrThrow` returned no record) because the DB
has 5 barbershops and the first in heap order ("Barbearia do Carlos") has zero services.

**Adaptation (noted):** Brief assumes a single-shop DB; actual DB has 5 shops. The `findFirstOrThrow`
for barbershop was updated with `where: { services: { some: { professionals: { some: {} } } } }`
to guarantee a valid shop-service-professional combination. All other test assertions are
identical to the brief.

After adaptation, RED confirmed:
```
AssertionError: expected +0 to be 1
  ❯ ...notification.test.ts:31 expect(after).toBe(before + 1)
```
- `res.ok` was `true` (appointment created), count didn't increase (notification not written).

### GREEN
Added `tx.notification.create(...)` inside the Serializable transaction in `create-appointment.ts`
(step 8, after AuditLog). Test passed: `Tests 1 passed (1)`.

---

## Exact Insertion Point

File: `src/modules/booking/create-appointment.ts`

- Transaction client variable: `tx` (confirmed from source)
- Appointment variable: `appointment` (confirmed from source, line 292)
- Inserted after `tx.auditLog.create(...)` block (step 7, lines 307-321), before `return { ok: true, ... }`:

```typescript
// --- 8. Owner notification (atomic with booking) ---
await tx.notification.create({
  data: {
    barbershopId: args.tenantId,
    type: 'APPOINTMENT_CREATED',
    appointmentId: appointment.id,
  },
})
```

---

## Collateral Fixes Required

### 1. `conflict.test.ts` — afterAll teardown FK violation
`createAppointment` now writes a `Notification` row (FK to `Barbershop`). The conflict test's
`afterAll` cleanup was trying to `prisma.barbershop.delete(...)` while Notification rows for
that barbershop still existed, triggering `Notification_barbershopId_fkey` constraint failure.

**Fix:** Added `await prisma.notification.deleteMany({ where: { barbershopId } })` to the
`afterAll` teardown, immediately after `auditLog.deleteMany` and before `appointment.deleteMany`.

### 2. `booking-shared.ts` — isRetryableError missing DriverAdapterError case
When the booking tests run concurrently (multiple Vitest workers), the Serializable transaction
for the notification test and the conflict tests produced serialization failures surfaced as
`DriverAdapterError: TransactionWriteConflict` from `@prisma/adapter-pg` — not wrapped as
`PrismaClientKnownRequestError(P2034)` as expected. The existing `isRetryableError` only handles
`PrismaClientKnownRequestError`, so the retry didn't fire.

**Fix:** Extended `isRetryableError` to also return `true` when `err.name === 'DriverAdapterError'`
and `err.message === 'TransactionWriteConflict'`. This is the adapter-level serialization failure
path alongside the engine-level P2034 path.

### 3. `create-appointment.ts` — Prisma transaction timeout
The `$transaction` default timeout (5000ms Prisma default) was being hit under test load.
The transaction now does 11 DB operations (added notification write). Increased to `timeout: 15000`.

---

## Test Results

### Notification test (isolated)
```
Tests  1 passed (1)
Duration  ~3.6s (transform + import + test)
```

### Full booking suite
```
Test Files  3 passed (3)
Tests  23 passed (23)
Duration  22.27s
```

### Typecheck
```
npm run typecheck → exit 0 (no errors)
```

---

## Concerns

1. **DriverAdapterError retry:** The `DriverAdapterError: TransactionWriteConflict` not being
   surfaced as P2034 suggests a potential version incompatibility between `@prisma/adapter-pg`
   and the Prisma client runtime. This may affect the production retry path too (not just tests).
   Recommend confirming this with the team or pinning Prisma versions.

2. **Test timeout:** The notification integration test requires a 15s timeout (`it(..., 15_000`)`)
   because the Serializable transaction + PgAdapter round-trips are slow under contention. This
   is fine for integration tests but implies the booking engine's p99 latency may be higher than
   the original 5s Prisma default assumed.

3. **Test isolation:** The `create-appointment.notification.test.ts` has a cleanup in the `if (res.ok)` 
   block. If the test fails after appointment creation but before cleanup (e.g., on the `expect(after).toBe(before + 1)` assertion), the appointment (and notification) will be left in the DB.
   This is consistent with the brief's approach. The far-future date `2099-01-05` minimises
   real-world impact.

4. **DB state assumption:** Test uses `findFirstOrThrow` with filter — works correctly with current
   seeded data. Any shop matching the filter must have professionals with availability rules for
   2099-01-05 (Monday, weekday=1). All demo shops with professional-service links do have
   Monday availability rules.

---

## Fix — match write-conflict on cause.kind not message

### What changed

`src/modules/booking/booking-shared.ts` — the `isRetryableError` function's `DriverAdapterError`
branch was matching on `err.message === 'TransactionWriteConflict'`. This was fragile: the
message was only set to `'TransactionWriteConflict'` because the SQLSTATE-40001 payload
`{ kind: 'TransactionWriteConflict' }` has no `message` field, so the `DriverAdapterError`
constructor falls back to `payload.kind` as the message string. If a future adapter version adds
a `message` field to that payload, the match silently breaks.

**Fix:** Added `import { isDriverAdapterError } from '@prisma/driver-adapter-utils'` and changed
the branch to:

```typescript
if (isDriverAdapterError(err) && err.cause.kind === 'TransactionWriteConflict') {
  return true
}
```

`isDriverAdapterError` (line 51 in `node_modules/@prisma/driver-adapter-utils/dist/index.js`) is
an exported type guard that checks `error["name"] === "DriverAdapterError" && typeof error["cause"] === "object"`.
`err.cause` stores the raw payload (line 48: `this.cause = payload`), so `err.cause.kind` is the
stable discriminant regardless of whether the payload has a `message` field.

### Adapter source lines verified

- `node_modules/@prisma/driver-adapter-utils/dist/index.js` lines 43–52:
  - `DriverAdapterError` constructor: `super(typeof payload["message"] === "string" ? payload["message"] : payload.kind)` — message is the fallback
  - `this.cause = payload` — payload stored on cause
  - `isDriverAdapterError` exported as a type guard
- `node_modules/@prisma/adapter-pg/dist/index.js` line 513–515:
  - `case "40001": { kind: "TransactionWriteConflict" }` — no `message` field in payload

### Test command and result

```
set -a && source <(grep -E '^DATABASE_URL=' .env) && set +a
npx vitest run booking
```

```
 Test Files  3 passed (3)
      Tests  23 passed (23)
   Start at  15:31:27
   Duration  3.39s
```

`npm run typecheck` — exit 0, no errors.
