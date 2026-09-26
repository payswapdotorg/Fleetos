# W003 — Fixture Strategy

Established by W003 (Tech-Lead lane) on the `work/w003` branch, base
SHA `0a75124` (integration/wave0). This document is the authoritative
fixture strategy for Wave 1 contract tests.

## What exists

The `@fleetos/contracts/testing` subpath (exposed via the
`"./testing"` entry in `packages/contracts/package.json` `exports`)
provides deterministic, seeded fixture builders for every cross-lane
contract:

| Builder | Returns | Source |
|---|---|---|
| `makeTenantId(seed)` | `TenantId` (canonical grammar `tnt_<base32>`) | `ids.ts` |
| `makeDeviceId(seed)` | `DeviceId` | `ids.ts` |
| `makeEventId(seed)` | `EventId` | `ids.ts` |
| `makeCommandId(seed)` | `CommandId` | `ids.ts` |
| `makeIntentId(seed)` | `IntentId` | `ids.ts` |
| `makeCorrelationId(seed)` | `CorrelationId` | `ids.ts` |
| `makeCausationId(seed)` | `CausationId` | `ids.ts` |
| `makeIdempotencyKey(seed)` | `IdempotencyKey` (16-char base32 suffix) | `ids.ts` |
| `makeObservationId(seed)` | `ObservationId` | `ids.ts` |
| `makePolicyId(seed)` | `PolicyId` | `ids.ts` |
| `makeTimestamp(seed)` | ISO 8601 string (anchor + seed-derived offset) | testing.ts |
| `makeEventEnvelope(opts)` | `EventEnvelope<P>` (valid by construction) | `events.ts` |
| `makeCommandEnvelope(opts)` | `CommandEnvelope<P>` with idempotency key | `commands.ts` |
| `makeIntent(opts)` | `FleetIntent` (any of the nine kinds) | `intents.ts` |
| `makeAllIntents(seed)` | all nine `FleetIntent` envelopes | `intents.ts` |
| `makeAdapterCapabilities(opts)` | `AdapterCapabilities` (explicit supported/unsupported) | `device.ts` |
| `makeAdapterCapabilitiesSeeded(seed)` | `AdapterCapabilities` (deterministic subset) | `device.ts` |
| `makeGuardianDecision(opts)` | `GuardianDecision` (any of the four types) | `policy.ts` |
| `makeAllGuardianDecisions(seed)` | all four `GuardianDecision` objects | `policy.ts` |
| `makeFleetError(opts)` | `FleetError` (any of the six kinds) | `errors.ts` |
| `makeAllFleetErrors(seed)` | all six `FleetError` objects | `errors.ts` |
| `makeObservationBatch(opts)` | `ObservationBatch` (valid by construction) | `observations.ts` |
| `SeededRng` (class) | xorshift32 PRNG, `next()`/`float()`/`int(n)`/`pick(arr)`/`base32(n)` | testing.ts |
| `rng(seed)` | `SeededRng` (from number or string) | testing.ts |

Plus the constants `FIXTURE_TIME_ANCHOR`, `TESTING_MODULE_NAME`,
`TESTING_MODULE_VERSION`.

Total: **22 public functions + 1 PRNG class + 3 constants**.

## How Wave 1 lanes consume it

Every Wave 1 worker (W010 [A], W011 [B], W012 [C]) writes contract tests
against the contracts surface. The standard import is:

```ts
import {
  makeTenantId,
  makeDeviceId,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAllIntents,
  makeAdapterCapabilities,
  makeGuardianDecision,
  makeFleetError,
  makeObservationBatch,
  SeededRng,
  rng,
  FIXTURE_TIME_ANCHOR,
} from "@fleetos/contracts/testing";
```

The subpath resolves via `packages/contracts/package.json` `exports` —
Bun's workspace resolution handles the rest. No `paths` entry is needed
in `tsconfig.base.json` (consistent with W001's no-path-mapping rule).

### Use cases by lane

- **Worker A (Device Edge — W010):** `@fleetos/agent`,
  `@fleetos/device-adapters`, `@fleetos/recovery`,
  `@fleetos/integration-adcos`. Contract tests for device check-in,
  capability assertion, recovery intent lifecycle. Use
  `makeObservationBatch`, `makeAdapterCapabilities`,
  `makeAdapterCapabilitiesSeeded`, `makeCommandEnvelope` (with
  idempotency key), `makeIntent({ kind: "RecoveryIntent" })`,
  `makeFleetError({ kind: "AdapterError" })`.

- **Worker B (Intelligence + Control — W011):** `@fleetos/device-model`,
  `@fleetos/health`, `@fleetos/security`, `@fleetos/policy`,
  `@fleetos/actions`, `@fleetos/learning`, `@fleetos/integration-arena`.
  Contract tests for device lifecycle transitions, Contract Guardian
  decisions, Fleet Actions. Use `makeEventEnvelope`,
  `makeGuardianDecision` (each of the four types),
  `makeIntent({ kind: "MaintainDeviceIntent" })`,
  `makeIntent({ kind: "SecurityRemediationIntent" })`,
  `makeFleetError({ kind: "PolicyError" })`,
  `makeAdapterCapabilities({ supported: ["wipe"], unsupported: ["locate"] })`.

- **Worker C (Workload + Commerce — W012):** `@fleetos/identity`,
  `@fleetos/audit`, `@fleetos/workloads`, `@fleetos/vendors`,
  `@fleetos/procurement`, `@fleetos/software`, `@fleetos/maintenance`,
  `@fleetos/integration-aurum`. Contract tests for tenant enrollment,
  audit append, procurement intent, software subscription, maintenance
  plans. Use `makeTenantId`, `makeIntent({ kind: "ProcurementIntent" })`,
  `makeIntent({ kind: "SoftwareSubscriptionIntent" })`,
  `makeIntent({ kind: "ReplacementIntent" })`,
  `makeEventEnvelope` (audit records),
  `makeFleetError({ kind: "ConflictError" })`.

### Re-using the W002 invariant tests

The W002 invariant tests live in `packages/contracts/test/*.test.ts` and
assert that `validateEnvelope`, `validateCommand`,
`validateObservationBatch`, etc. accept valid inputs and reject
malformed ones. The W003 fixture builders produce envelopes/commands/
intents that PASS those validators by construction. Wave 1 contract tests
should reuse this invariant by importing the validators directly:

```ts
import { validateEnvelope } from "@fleetos/contracts";
import { makeEventEnvelope } from "@fleetos/contracts/testing";

test("my module's event handler accepts a valid envelope", () => {
  const env = makeEventEnvelope({ seed: "my-test", payload: { ... } });
  expect(validateEnvelope(env).ok).toBe(true);
  // ... my module's logic ...
});
```

This means any drift in the fixture builders (e.g. accidentally producing
an envelope with an empty `tenantId`) is caught by the W002 invariant
tests *before* Wave 1 tests rely on the broken fixture.

## Seeding rules

### Determinism contract

**Same seed → same values, byte-for-byte, every run.**

The PRNG is a tiny xorshift32 seeded either by a uint32 (number) or by
a string hashed with FNV-1a (`SeededRng.from(s)`). No `Math.random()`,
`Date.now()`, `crypto.randomBytes()`, `process.hrtime`, or any other
clock/entropy source is consulted anywhere in the testing subpath.

Timestamps are *injected* via `makeTimestamp(seed)`, which derives a
seeded offset in `[0, 86_400_000)` ms (one day) from the
`FIXTURE_TIME_ANCHOR = "2026-01-01T00:00:00Z"`. The anchor is fixed and
synthetic — it is never compared against real-world time.

### Seed conventions

- **Use string seeds for readability.** `makeEventEnvelope({ seed:
  "tenant-enrollment-flow" })` is far more debuggable than
  `makeEventEnvelope({ seed: 42 })`. The FNV-1a hash is well-distributed
  for ASCII strings of any length.
- **Derive sub-seeds by suffixing.** When producing multiple fixtures in
  the same test, use sub-seeds like `"${base}-event-1"`,
  `"${base}-event-2"`, `"${base}-command"`. The `makeAllIntents(seed)`
  helper does this internally (`"${seed}-${kind}"`).
- **Do NOT reuse the same seed across unrelated fixtures.** Two
  `makeEventEnvelope({ seed: "x" })` calls produce the same envelope —
  fine if you want determinism, confusing if you wanted two distinct
  envelopes. Use distinct seeds (`"x-1"`, `"x-2"`) for distinct
  fixtures.
- **Tests should be reproducible from the seed alone.** If a test fails,
  the seed in the failure message should let a developer regenerate
  the exact fixture locally.

### The no-clock rule

The fixture builders never read the system clock. This is enforced by
design (no `Date.now()` calls in `src/testing.ts`) and verified by the
`makeTimestamp` test in `packages/contracts/test/testing.test.ts`.

## Tenant isolation: fixtures never leak across tenant boundaries

Tenant isolation is structural in FleetOS
(`spec/ARCHITECTURE-LOCK.md` item 17). The fixture builders enforce the
same rule:

1. **A `tenantId` flows through every builder.** Every envelope,
   command, intent, decision, and error carries a `tenantId` field. The
   builder accepts an optional `tenantId` override; if not supplied, it
   derives one from the seed via `makeTenantId(seed)`.

2. **A fixture produced with tenant A references only tenant A.** The
   builder does not silently mix tenants. If you call
   `makeEventEnvelope({ tenantId: A, seed: "x" })`, every branded ID
   inside the envelope (subject, correlation, causation) is derived
   from `"x"` — but the `tenantId` field is `A`. There is no path by
   which tenant B's identifier appears in the envelope.

3. **Cross-tenant fixtures require explicit construction.** To produce
   two fixtures with different tenants, you must call the builder
   twice with different `tenantId` overrides:

   ```ts
   const tenantA = makeTenantId("tenant-a");
   const tenantB = makeTenantId("tenant-b");
   const envA = makeEventEnvelope({ tenantId: tenantA, seed: "a" });
   const envB = makeEventEnvelope({ tenantId: tenantB, seed: "b" });
   expect(envA.tenantId).not.toBe(envB.tenantId);
   ```

4. **The seeded ID generators do not collide across tenants.** Two
   fixtures with the same seed but different `tenantId` overrides will
   have different tenant fields but *may* have the same event/command/
   intent IDs (because the IDs are derived from the seed, not the
   tenant). This is fine — IDs are scoped by tenant. To guarantee
   distinct IDs across tenants, use distinct seeds.

5. **Wave 1 contract tests must assert tenant isolation explicitly.**
   A test that exercises a cross-tenant code path (e.g. an audit query
   that joins two tenants) must use `makeTenantId("a")` and
   `makeTenantId("b")` and assert that the query returns only the
   requested tenant's records. The fixture builders make this easy;
   the test author must still write the assertion.

## What the fixtures are NOT

- **Fixtures are not fuzz tests.** They produce valid samples; they do
  not explore the input space. For property-based testing, layer a
  fuzz harness on top (e.g. iterate seeds 0..1000 and assert invariants
  on each generated envelope).
- **Fixtures are not production data.** The seeded IDs are synthetic
  (`tnt_<base32>`, `dev_<base32>`, etc.). They will never collide with
  real production identifiers because the production ID format is
  reserved.
- **Fixtures are not a substitute for the W002 validators.** The
  builders produce valid envelopes by construction, but the validators
  are still the source of truth for "is this envelope valid?". Tests
  that need to verify a boundary rejection (e.g. "my module rejects an
  envelope with an empty `tenantId`") must construct the broken
  envelope directly, not via a fixture builder.

## Versioning

The testing subpath is versioned with the `@fleetos/contracts` package.
Adding a new builder is an additive change within `schemaVersion 1`
(per the W002 versioning discipline). Breaking changes to a builder's
signature require a new `schemaVersion` AND a Tech-Lead ADR
(`spec/worker-ownership.yaml` rule:
`shared_contract_changes_require_tech_lead`).

The `TESTING_MODULE_NAME` and `TESTING_MODULE_VERSION` constants are
exported so consumer tests can assert the subpath imports correctly
(see `apps/agent/src/testing-subpath.test.ts`).

## Reference

- `packages/contracts/src/testing.ts` — the implementation.
- `packages/contracts/test/testing.test.ts` — validity + determinism
  tests for every builder.
- `apps/agent/src/testing-subpath.test.ts` — proof that the subpath
  imports cleanly from another lane's test directory (read-only use of
  worker-a's test dir, allowed for this proof per W003 D5).
- `spec/ARCHITECTURE-LOCK.md` item 17 — tenant isolation rule.
- `spec/worker-ownership.yaml` — `shared_contract_changes_require_tech_lead`.
- `docs/tech-lead/SKELETON-NOTES.md` — Wave 0 history (W001, W002, W003).
