# W003 Fixture Strategy

This document describes the deterministic, seeded fixture builders exported by the
`@fleetos/contracts/testing` subpath (introduced in W003). Wave 1 lanes (W010/W011/W012)
consume these builders to construct valid envelopes, commands, intents, decisions, errors,
and capability sets for contract tests without re-rolling ad-hoc fixtures in every
test file.

## What exists

The testing subpath (`packages/contracts/src/testing.ts`) is imported via:

```ts
import {
  makeTenantId,
  makeDeviceId,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAdapterCapabilities,
  makeGuardianDecision,
  makeFleetError,
  // ... and the constants needed to call them
  ALLOW, WARN, REQUIRE_APPROVAL, BLOCK,
  MAINTAIN_DEVICE_INTENT_KIND, // ... the nine intent kinds
} from "@fleetos/contracts/testing";
```

### Builders and what they produce

| Builder | Produces | Coverage |
|---|---|---|
| `makeTenantId(seed)` | `TenantId` matching `tnt_[a-z0-9]{8,64}` | All seeds produce well-formed ids |
| `makeDeviceId(seed)` | `DeviceId` | All seeds |
| `makeEventId` / `makeCorrelationId` / `makeCausationId` / `makeCommandId` / `makeIdempotencyKey` / `makeIntentId` / `makePolicyId` | The corresponding branded IDs | All seeds |
| `makeTimestamp(offsetMs)` | ISO 8601 UTC timestamp | Deterministic — derived from a fixed `FIXTURE_BASE_EPOCH_MS = 2026-01-01T00:00:00.000Z` plus an integer offset. No wall-clock reads. |
| `makeEventEnvelope<P>(options, seed)` | `EventEnvelope<P>` that passes `validateEnvelope()` | Every field has a deterministic default; overrides are merged in. Throws if the merged envelope would fail validation. |
| `makeCommandEnvelope<P>(options, seed)` | `CommandEnvelope<P>` that passes `validateCommand()`, with a non-empty `idempotencyKey` | Same override-and-validate discipline. |
| `makeIntent(kind, options, seed)` | One of the nine `FleetIntent` variants, tagged by `payload.kind` | Each of the nine intent kinds has a default payload (`defaultIntentPayload`). Payload overrides are merged. |
| `makeAdapterCapabilities(supported, unsupported)` | `AdapterCapabilities` flags object | Throws if a capability appears in BOTH `supported` and `unsupported`. |
| `makeGuardianDecision(decision, options, seed)` | Frozen `GuardianDecision` | Each of the four decision types (`ALLOW`, `WARN`, `REQUIRE_APPROVAL`, `BLOCK`) is supported. |
| `makeFleetError(kind, options, seed)` | `FleetError` discriminated-union variant | Each of the six taxonomy classes (`DomainError`, `PolicyError`, `AuthorizationError`, `AdapterError`, `ConflictError`, `ValidationError`) is supported. |

### Helper constants re-exported

The testing subpath re-exports the four decision-type constants (`ALLOW`, `WARN`,
`REQUIRE_APPROVAL`, `BLOCK`) and the nine intent-kind constants
(`MAINTAIN_DEVICE_INTENT_KIND`, `SECURITY_REMEDIATION_INTENT_KIND`,
`CONNECTIVITY_INTENT_KIND`, `PROCUREMENT_INTENT_KIND`,
`SOFTWARE_SUBSCRIPTION_INTENT_KIND`, `REPLACEMENT_INTENT_KIND`,
`RECOVERY_INTENT_KIND`, `PRINT_INTENT_KIND`, `FLEET_ACTION_INTENT_KIND`) so test
callers can write `makeGuardianDecision(BLOCK, ...)` and
`makeIntent(PRINT_INTENT_KIND, ...)` without separately importing from the main
`@fleetos/contracts` entry.

## Seeding rules

The fixture builders are deterministic: the same seed string always produces the
same value. The rules are:

1. **Hash the seed**: every seed string is hashed via FNV-1a 32-bit
   (`hashStringToUint32`). The hash output feeds a Mulberry32 PRNG
   (`mulberry32`). No `Math.random()` anywhere in the module.

2. **Domain-tag the hash**: each builder prefixes its seed with a domain tag
   (`tenant:`, `device:`, `event:`, `command:`, ...) before hashing, so two
   builders using the same seed produce DIFFERENT values. This prevents
   accidental collisions across builder kinds and is also the basis of the
   tenant-isolation rule (see below).

3. **Fixed suffix length**: every generated id has a fixed-length
   lowercase-alphanumeric suffix (12 chars by default). Tenant ids satisfy
   `tnt_[a-z0-9]{8,64}` automatically (length 12 is well within range).

4. **Timestamps are injected, not read**: `makeTimestamp(offsetMs)` returns a
   deterministic ISO 8601 UTC timestamp derived from the fixed
   `FIXTURE_BASE_EPOCH_MS = 2026-01-01T00:00:00.000Z`. The wall clock is NEVER
   read. Two test runs with the same offset produce identical timestamps.

5. **Default payloads carry the right `kind`**: `makeIntent(kind, ...)` always
   sets `payload.kind` to the first argument. If the caller's `options.payload`
   override includes a different `kind`, the override wins (last-write-wins on
   the spread) — callers should not override `payload.kind` unless they are
   explicitly testing an invariant about kind mismatch.

6. **Validation by construction**: `makeEventEnvelope` and `makeCommandEnvelope`
   invoke `validateEnvelope` / `validateCommand` after construction. If the
   merged overrides would produce an invalid envelope, the builder THROWS with
   a descriptive error including the failure reason and the seed. This is a
   programming error in the caller, not a runtime condition — it surfaces at
   test time, before the test body runs.

7. **No I/O**: no filesystem reads, no network reads, no process-env reads.
   Every fixture is pure.

## Tenant isolation

Tenant isolation is a structural invariant of every FleetOS contract (per
`spec/ARCHITECTURE-LOCK.md` item 17). The fixture builders enforce it by
construction:

- Each builder that produces a tenant-scoped contract (`makeEventEnvelope`,
  `makeCommandEnvelope`, `makeIntent`, `makeGuardianDecision`, `makeFleetError`)
  derives its `tenantId` from a domain-tagged seed: e.g.
  `makeTenantId("event:" + seed)`. The seed prefix (`"event:"`, `"command:"`,
  `"intent:"`, `"guardian:"`, `"error:"`) ensures two builders using the same
  `seed` produce DIFFERENT tenant ids — they cannot accidentally collide.

- The cross-builder tenant-isolation test in
  `packages/contracts/test/testing.test.ts` verifies that for any given seed
  string, no two of `{makeEventEnvelope, makeCommandEnvelope, makeIntent,
  makeGuardianDecision, makeFleetError}` produce the same tenant id. This
  prevents a fixture in one test from accidentally sharing a tenant with a
  fixture in another test.

- Fixtures NEVER leak across tenant boundaries: a fixture constructed with
  `seed="alpha"` cannot observe a fixture constructed with `seed="beta"`
  through the tenant id alone. Any cross-tenant test (e.g. a tenant-isolation
  rejection test) MUST explicitly construct two fixtures with different seeds
  and assert that the second cannot read the first.

## How Wave 1 lanes consume the fixtures

Wave 1 lanes (W010/W011/W012) write contract tests for their owning modules.
The fixture builders are imported from `@fleetos/contracts/testing`:

```ts
import { test, expect } from "bun:test";
import {
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  MAINTAIN_DEVICE_INTENT_KIND,
} from "@fleetos/contracts/testing";

test("device-model ingests a maintenance intent and produces an event", () => {
  const intent = makeIntent(MAINTAIN_DEVICE_INTENT_KIND, {}, "device-model-1");
  // ... call the device-model ingest API with `intent` ...
  // ... assert the produced event matches the intent's tenant ...
});
```

The cross-lane ownership gate (`tools/check-ownership.mjs`) treats
`@fleetos/contracts` and its subpaths (`@fleetos/contracts/testing`) as the
shared seam — any lane may import from either. This is the only cross-lane
import that is allowed; all other cross-lane imports are violations
(see `docs/tech-lead/merge-gates.md` and the W001 ownership notes).

### Consumer proof

The cross-package consumer proof lives at
`apps/agent/src/testing-subpath.test.ts` (worker-a lane). It imports the
testing subpath and exercises every builder. The proof demonstrates that the
subpath resolves cleanly from another lane's test directory and that the
fixture builders are callable from there.

The proof is intentionally READ-ONLY: it does not modify any worker-a-owned
source file or contract. The `apps/agent` package declares
`@fleetos/contracts: "workspace:*` in its `package.json` `dependencies` so
Bun's workspace resolution links the package correctly. (This is the same
pattern Wave 1 lanes will use.)

## Adding a new fixture builder

If a future wave needs a new fixture builder (e.g. `makeObservationBatch` for
device-agent tests), the discipline is:

1. Add the builder to `packages/contracts/src/testing.ts`.
2. Add a determinism test + an invariants test to
   `packages/contracts/test/testing.test.ts`. The invariants test should
   reuse the W002 invariant validators (`validateObservationBatch`,
   `validateEnvelope`, etc.) to assert the fixture is valid.
3. The new builder does NOT need to be added to the snapshot
   (`tools/contracts-api.snapshot.json`) — that snapshot tracks ONLY the
   runtime public API of `@fleetos/contracts` (the `index.ts` re-exports).
   The testing subpath is NOT part of the runtime public API and is
   intentionally NOT snapshotted.
4. If the new builder introduces a new tenant-scoped contract, add a
   cross-builder tenant-isolation test to the existing
   `tenant isolation: no two fixture builders produce the same tenant id for
   the same seed` test in `testing.test.ts`.

## Out-of-scope

The fixture builders do NOT:

- Generate realistic device payloads (the default payloads are intentionally
  minimal — `description: "fixture ..."` etc.). Workers refine the payload
  shapes in their owning work items; the fixtures only need to satisfy the
  cross-cutting invariants.
- Persist anything. Every fixture is an in-memory value.
- Substitute for integration tests. Workers should add integration tests
  against real persistence/network boundaries in their owning lanes; the
  fixtures are for unit and contract tests only.
