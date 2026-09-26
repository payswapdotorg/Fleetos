# W001 Skeleton Notes

Established by W001 (Tech-Lead lane) at the base SHA `568708e9314cab8492457475c994cf1c913dbbb4`.
These notes record the package → lane mapping materialized in this commit, deferred
modules, judgment calls, and stop-the-line findings for Tech Lead review.

## Package → Lane Mapping

The following package → lane mapping was materialized from
`spec/worker-ownership.yaml` plus the W001 deliverable list in the work order.
Each package is created with `package.json`, `tsconfig.json`, `src/index.ts`,
`src/index.test.ts`, and a `README.md` citing its frozen responsibility.

### tech-lead

- `@fleetos/contracts` (`packages/contracts/`) — shared seam, Tech-Lead-owned
  during active waves.
- `@fleetos/web` (`apps/web/`) — control-plane web app placeholder (no Next.js
  scaffolding yet). Tech-Lead owns the `apps/web/shell/` sub-tree.

### worker-a (Device Edge)

- `@fleetos/agent` (`apps/agent/`) — device agent runtime; runs OUTSIDE the
  web runtime.
- `@fleetos/device-adapters` (`packages/device-adapters/`) — endpoint adapter
  SDK seams.
- `@fleetos/recovery` (`packages/recovery/`) — last-seen evidence, lock/locate,
  replacement escalation.
- `@fleetos/integration-adcos` (`packages/integrations/adcos/`) — ADCOS
  adapter; assigned to worker-a per W050A.

### worker-b (Intelligence + Control)

- `@fleetos/device-model` (`packages/device-model/`) — Device Twin + observations.
- `@fleetos/health` (`packages/health/`) — signals, baselines, anomalies,
  diagnoses, treatment recommendations.
- `@fleetos/security` (`packages/security/`) — security posture, findings,
  security remediation semantics.
- `@fleetos/policy` (`packages/policy/`) — Contract Guardian home.
- `@fleetos/actions` (`packages/actions/`) — Fleet Actions.
- `@fleetos/learning` (`packages/learning/`) — evaluation cases + capability
  adoption records.
- `@fleetos/integration-arena` (`packages/integrations/arena/`) — Arena adapter;
  assigned to worker-b per W050B.

### worker-c (Workload + Commerce)

- `@fleetos/identity` (`packages/identity/`) — tenant/auth foundations.
- `@fleetos/audit` (`packages/audit/`) — append-only audit.
- `@fleetos/workloads` (`packages/workloads/`) — workload profiles +
  recommendations.
- `@fleetos/vendors` (`packages/vendors/`) — vendor capability/quality/
  fulfillment semantics.
- `@fleetos/procurement` (`packages/procurement/`) — demand aggregation,
  matching, quote, order.
- `@fleetos/software` (`packages/software/`) — catalog, subscriptions,
  entitlements, seat allocation.
- `@fleetos/maintenance` (`packages/maintenance/`) — treatment plans, service
  work orders, warranty.
- `@fleetos/integration-aurum` (`packages/integrations/aurum/`) — Aurum adapter;
  assigned to worker-c per W050C.

## Deferred modules (no ownership path in frozen yaml)

The following modules appear in `spec/MODULE-DEPENDENCY-MAP.md` but have no
ownership path in the frozen `spec/worker-ownership.yaml`. They were NOT
materialized as packages in W001. They are DEFERRED to the W050x / W051 era
and require a Tech-Lead ADR before being added.

- `connectivity` — listed as a layer-5 module with dependency edges to
  devices, workloads, policy, audit. No `packages/connectivity/` directory was
  created. The FleetOS side of connectivity is realized through the
  `@fleetos/integration-adcos` adapter (W050A). Native connectivity
  topology/path execution is owned by ADCOS, not FleetOS (per
  `spec/ARCHITECTURE-LOCK.md` items 7–8). Deferred to W050x/W051 with a
  Tech-Lead ADR.

- `notifications` — listed as a layer-5 module with dependency edges to
  organizations, devices, actions, audit. No `packages/notifications/`
  directory was created. Outbound notifications are realized through the
  `@fleetos/integration-aurum` adapter (W050C). Aurum is a
  communication/intelligence channel; FleetOS remains operational authority
  (per `spec/ARCHITECTURE-LOCK.md` items 9–10). Deferred to W050x/W051 with a
  Tech-Lead ADR.

## Stop-the-line finding: ownership yaml missing two W001 deliverable paths

The W001 deliverable list (D1) explicitly names two packages whose prefix paths
were NOT claimed by any lane in the frozen `spec/worker-ownership.yaml`:

1. `apps/web/` — D1 creates `@fleetos/web` as a placeholder package here, but
   the yaml only claimed leaf sub-paths (`apps/web/shell/` for tech-lead,
   `apps/web/device/` for worker-a, etc.). The parent `apps/web/` prefix was
   unclaimed, so D3 check #2 ("every package directory is claimed by exactly
   one owner lane") would FAIL on `apps/web/`.
2. `packages/integrations/adcos/` — D1 creates `@fleetos/integration-adcos`
   here, but no lane claimed this path. Per
   `spec/WORK-ITEM-DEPENDENCY-GRAPH.md`, the ADCOS adapter is Wave 5 item
   W050A assigned to Worker A.

**Resolution applied in W001** (minimal additive change to the frozen yaml;
the semantics of all EXISTING path claims are unchanged — only two new path
claims were added):

- Added `apps/web/` to tech-lead's paths (parent of the already-claimed
  `apps/web/shell/`).
- Added `packages/integrations/adcos/` to worker-a's paths (consistent with
  the W050A assignment in `spec/WORK-ITEM-DEPENDENCY-GRAPH.md`).

`tools/check-ownership.mjs` uses **longest-prefix matching** when resolving a
package directory to its owning lane. This means the new parent claim on
`apps/web/` does NOT shadow the existing leaf claims on `apps/web/device/`,
`apps/web/recovery/`, `apps/web/security/`, `apps/web/actions/`,
`apps/web/workloads/`, `apps/web/commerce/`, or `apps/web/shell/` — the longer
prefix wins for those sub-paths.

The Tech Lead should validate these two additive path claims and either
confirm them or reassign via a follow-up ADR. If the Tech Lead prefers an
alternative resolution (e.g., not creating `apps/web/` as a package, or
reassigning ADCOS to a different lane), W001 can be re-spun with minimal
rework.

## Other judgment calls

- **`tsconfig.base.json` introduced as single source of compiler truth.** The
  pre-existing root `tsconfig.json` now extends `tsconfig.base.json` so the
  root typecheck entry point is preserved. Each package's `tsconfig.json`
  extends `tsconfig.base.json` via a relative path (`../../tsconfig.base.json`
  for top-level packages, `../../../tsconfig.base.json` for integrations).
- **`@fleetos/*` path mapping is intentionally NOT used.** Per the work order,
  packages import each other by workspace package name only (e.g.,
  `import { x } from "@fleetos/contracts"`). Bun's workspace resolution
  handles the rest. No `paths` entry is needed in `tsconfig.base.json`.
- **Placeholder `src/index.ts` exports only `MODULE_NAME` and `MODULE_VERSION`.**
  Real domain types, event schemas, and contracts arrive with their owning
  work items (W002+). No runtime dependencies were added (devDependencies:
  typescript only, per the hard constraints).
- **`apps/web/shell/` created with a README** noting it is Tech-Lead-owned UI
  shell territory. The other `apps/web/<surface>/` directories (device,
  recovery, security, actions, workloads, commerce) are created as empty
  directories with a single `.gitkeep` — they are leaf surface dirs owned by
  later waves (W060A/B/C).
- **`bun test` runs at the root across all packages.** Every placeholder test
  asserts the `MODULE_NAME` and `MODULE_VERSION` constants exported from
  `src/index.ts`.
- **`tools/verify-skeleton.mjs` asserts every package directory contains
  `package.json` + `tsconfig.json` + `src/index.ts` + `src/index.test.ts`**
  and that the package.json declares a `@fleetos/*` name at version `0.1.0`
  with `private: true`. It is wired into `bun run check` alongside
  `check:architecture` and `check:ownership`.
- **CI workflow** (`.github/workflows/ci.yml`) runs `bun install`,
  `bun run check`, `bun run typecheck`, `bun test` on push/PR to main. It is
  minimal and green-by-construction at this commit.
- **`spec/PROJECT-STATE.md` updated** to STATUS `W001 IMPLEMENTED (pending TL
  acceptance)`, implementation wave 0 complete pending acceptance, next Tech
  Lead actions: W002.

## W002 — contracts now real (frozen for Wave 1)

W002 filled the `@fleetos/contracts` package with the real FleetOS shared
contract surface. The placeholder exports from W001 (`MODULE_NAME`,
`MODULE_VERSION`) are preserved in `src/index.ts` for backward compatibility
with the 21 baseline tests, but the package now exports the full public API:

- `src/ids.ts` — 14 branded IDs (TenantId, DeviceId, ObservationId, EventId,
  IntentId, ActionId, CommandId, UserId, VendorId, WorkloadId, PolicyId,
  AuditRecordId, CorrelationId, CausationId, IdempotencyKey) + `brand<T,B>()`
  helper + `isBranded()` type guard + `asXxx()` constructors. Branded IDs are
  template-literal types with NO runtime cost — a `TenantId` is structurally
  a string at runtime but nominally distinct from a `DeviceId` at the type
  level. This is the structural basis for tenant isolation: every envelope,
  command, intent, and audit record carries a branded `TenantId`, and the
  compiler rejects cross-tenant assignment at the type level.
- `src/tenant.ts` — `TenantScoped` base shape, `TenantRef` validation helper
  (`validateTenantRef()`), `isValidTenantId()` predicate. Tenant isolation is
  structural: every envelope below is tenant-scoped.
- `src/events.ts` — `EventEnvelope<P>` with tenant scope, correlation/
  causation ids, schema version; `makeEnvelope()` pure constructor stamps
  correlation/causation rules (root command => fresh correlation; events
  caused by commands inherit correlation + use command id as causation;
  events caused by events inherit correlation + use source event id as
  causation); `validateEnvelope()` invariant validator; `serializeEnvelope()`
  deterministic serializer.
- `src/commands.ts` — `CommandEnvelope<P>` with idempotency key
  (duplicate-suppression contract: same key => same logical effect once);
  `makeCommand()` constructor; `validateCommand()` invariant validator.
- `src/intents.ts` — the nine durable Fleet Intents (verbatim from
  `spec/ARCHITECTURE.md` § Intent model) as a discriminated union on the
  `kind` field; `IntentEnvelope<P>`; `IntentStatus` lifecycle
  (REQUESTED -> AUTHORIZED -> DISPATCHED -> EXECUTING -> VERIFIED -> COMPLETED
  plus terminal REJECTED | FAILED | CANCELLED); `INTENT_TRANSITIONS` table;
  `canTransition()` predicate.
- `src/device.ts` — `DeviceLifecycleState` (verbatim from
  `spec/ARCHITECTURE.md` § Device lifecycle: ENROLL -> OBSERVE -> ASSESS ->
  DIAGNOSE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> LEARN);
  `DEVICE_LIFECYCLE_TRANSITIONS` strict-linear-progression table;
  `AdapterCapabilities` flags type (the eleven capabilities from
  `spec/ARCHITECTURE.md` § Device adapters); `DESTRUCTIVE_CAPABILITIES`
  (enforce, remediate, lock, locate, wipe, reboot, update);
  `assertSupported()` capability gate — unsupported destructive behavior
  may NEVER be emulated (per `spec/ARCHITECTURE-LOCK.md` item 16).
- `src/observations.ts` — `Observation`, `ObservationBatch` (check-in
  contract from device agents); `ObservationKind` open string union;
  `validateObservationBatch()` invariant validator.
- `src/policy.ts` — `GuardianDecisionType` (ALLOW | WARN | REQUIRE_APPROVAL
  | BLOCK verbatim from `spec/ARCHITECTURE.md` § Contract Guardian);
  `GuardianDecision` result shape with rule refs and evidence refs;
  `makeGuardianDecision()` constructor; `isBlockingDecision()` predicate.
- `src/errors.ts` — `FleetError` discriminated union (DomainError,
  PolicyError, AuthorizationError, AdapterError, ConflictError,
  ValidationError) with stable machine `code`, human `message`, tenant +
  correlation ids; `ApiError` wire shape for HTTP surfaces; `toApiError()`
  translator with HTTP-status mapping (400/403/409/422/502).
- `src/versioning.ts` — `Versioned<T>` wrapper; `assertVersion()` guard
  (consumer must explicitly list every version it understands; unknown
  versions are rejected, not silently misinterpreted); `makeVersioned()`
  constructor; `MIN_SCHEMA_VERSION = 1`.

### Tests

Tests live in `packages/contracts/test/*.test.ts` (not `src/`):

- `ids.test.ts` — branded id roundtrips, type-guard behavior, zero-cost
  runtime identity.
- `events.test.ts` — envelope invariants (tenant-scoped, correlation
  present, version >= 1, ISO timestamps), correlation/causation rules for
  command-cause and event-cause, deterministic serialization, frozen-record
  invariants.
- `intents.test.ts` — legal happy-path transitions, illegal skip-state
  transitions, REQUESTED -> REJECTED, pre-VERIFIED -> CANCELLED, post-
  DISPATCH -> FAILED, terminal states have no outgoing transitions, the
  nine intent kinds.
- `device.test.ts` — lifecycle order (nine states), linear progression
  invariant, LEARN terminal, capability assertion (supported/unsupported/
  destructive-authorized/destructive-unauthorized — with explicit test that
  unsupported destructive capability returns `unsupported` first, NOT
  `destructive_unauthorized`).
- `policy.test.ts` — Guardian decision types, blocking predicates,
  frozen-record invariants.
- `errors.test.ts` — error taxonomy shape for all six subclasses,
  `toApiError()` HTTP status mapping for all six kinds.
- `versioning.test.ts` — version guard (below-one, unknown-to-consumer,
  known-version happy path, consumer-must-list-explicitly).

### Test results

`bun test` runs 89 tests across 28 files (21 baseline placeholder tests +
68 new contracts tests), 0 failures, 224 `expect()` calls.

### Cross-lane import verification

The ownership gate (`tools/check-ownership.mjs`) was sanity-checked against
two temporary files:

1. A file in `packages/recovery/` (worker-a) importing from
   `@fleetos/health` (worker-b) — correctly FAILED with
   `CROSS_LANE_IMPORT: ... only @fleetos/contracts may cross lanes`.
2. A file in `packages/recovery/` (worker-a) importing from
   `@fleetos/contracts` (tech-lead, the shared seam) — correctly PASSED.

Both temp files were removed after verification.

### Frozen spec files

No frozen spec file was modified in W002. The two confirmed ownership path
claims from W001 (`apps/web/` -> tech-lead, `packages/integrations/adcos/`
-> worker-a, per ADR-0001) are unchanged. The only files modified outside
`packages/contracts/` are:

- `docs/tech-lead/SKELETON-NOTES.md` (this section).
- `spec/PROJECT-STATE.md` (status update to W002 done).
- `tsconfig.json` (root — added `packages/*/test/**/*.ts` to the include
  list so root typecheck covers test files).
- `packages/contracts/tsconfig.json` (added `test/**/*.ts` to include list
  for the package-level typecheck).
- `types/bun-test.d.ts` (relaxed `toBe(expected: T)` to `toBe(expected:
  unknown)` to match Jest/Vitest semantics — branded-id equality tests
  otherwise fail to compile).

### Known limitations carried forward

- `types/bun-test.d.ts` remains a minimal ambient shim. When `@types/bun`
  is added in a later wave (W003 or a Tech-Lead ADR), this file should be
  deleted and replaced with the canonical package.
- The cross-lane import-boundary check covers static `import ... from "..."`
  statements only. Dynamic `import("...")` expressions are not checked.
- The intent payload shapes (`MaintainDeviceIntentPayload`,
  `SecurityRemediationIntentPayload`, etc.) are intentionally minimal
  placeholders — they will be refined by the owning work items (W040
  Recovery, W031 Security Doctor, W042 Maintenance, W032 Procurement,
  W041 Fleet Actions, W050A ADCOS) when those work items are authorized.
  Workers will extend the payloads via additive optional fields (no
  breaking change) within schemaVersion 1.

## W003 — contract-test harness (frozen for Wave 1)

W003 introduces the contract-test harness that lets Wave 1's three parallel
workers build without drift. The deliverables are:

### D1 — Public-contract gate: `tools/check-contracts.mjs`

A new gate with two responsibilities:

1. **Workspace + module-marker gate** — for every `@fleetos/*` workspace
   package: `src/index.ts` exports `MODULE_NAME` and `MODULE_VERSION`;
   `package.json#name` matches the directory scope (derived from the
   directory name with `@fleetos/` prepended; `packages/integrations/<x>`
   maps to `@fleetos/integration-<x>` per the W001 convention); workspaces
   resolve from the root `package.json` (each package directory must be
   covered by one of the root `workspaces` globs).
2. **Golden snapshot of `@fleetos/contracts` public API** — the gate walks
   `export * from "./..."` chains starting from
   `packages/contracts/src/index.ts`, parsing every named export and
   classifying it by kind (`const` / `let` / `var` / `function` / `type` /
   `interface` / `class` / `re-export`). The resulting sorted map is
   compared to `tools/contracts-api.snapshot.json` (150 entries). Default
   mode COMPARES — any added, removed, renamed, or kind-changed export
   fails with a precise diff. `--regen` rewrites the snapshot deliberately
   (used by the Tech Lead when a contract change is authorized by an ADR).

The gate is wired into `bun run check` via the root `check:contracts` script,
which runs in CI as part of the existing `bun run check` step
(`.github/workflows/ci.yml` is unchanged — it already runs `bun run check`,
and the new gate runs automatically within that step).

The snapshot is committed at
`tools/contracts-api.snapshot.json`. It captures 150 exports from the
`@fleetos/contracts` runtime public API. The testing subpath
(`packages/contracts/src/testing.ts`) is intentionally NOT in the snapshot
— it is a test-only API, not a runtime API.

### D2 — Fixture strategy: `@fleetos/contracts/testing`

A new testing subpath exported by `@fleetos/contracts`:

```json
{
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./testing": { "types": "./src/testing.ts", "default": "./src/testing.ts" }
  }
}
```

The subpath exports deterministic, seeded fixture builders:

- `makeTenantId`, `makeDeviceId`, `makeEventId`, `makeCorrelationId`,
  `makeCausationId`, `makeCommandId`, `makeIdempotencyKey`, `makeIntentId`,
  `makePolicyId` — branded ID builders.
- `makeTimestamp(offsetMs)` — deterministic ISO 8601 timestamps derived from
  a fixed `FIXTURE_BASE_EPOCH_MS = 2026-01-01T00:00:00.000Z`. No wall-clock
  reads.
- `makeEventEnvelope(options, seed)` — `EventEnvelope<P>` valid by
  construction; throws if overrides would produce an invalid envelope.
- `makeCommandEnvelope(options, seed)` — `CommandEnvelope<P>` with a
  non-empty idempotency key, valid by construction.
- `makeIntent(kind, options, seed)` — one of the nine `FleetIntent`
  variants, tagged by `payload.kind`. Each kind has a default payload.
- `makeAdapterCapabilities(supported, unsupported)` — explicit supported and
  unsupported capability sets; throws if a capability appears in BOTH.
- `makeGuardianDecision(decision, options, seed)` — frozen
  `GuardianDecision` for each of the four decision types.
- `makeFleetError(kind, options, seed)` — `FleetError` for each of the six
  taxonomy classes.

Determinism rules:
- FNV-1a 32-bit hash of a domain-tagged seed string → Mulberry32 PRNG →
  fixed-length lowercase-alphanumeric id suffixes.
- No `Math.random()` anywhere. No network reads. No filesystem reads.
  No wall-clock reads (`makeTimestamp` uses a fixed base epoch).
- Domain-tagged seeds: each builder prefixes its seed with a domain tag
  (`"tenant:"`, `"event:"`, `"command:"`, etc.) before hashing, so two
  builders using the same seed produce DIFFERENT values — this is the
  structural basis for tenant isolation.

The four decision-type constants (`ALLOW`, `WARN`, `REQUIRE_APPROVAL`,
`BLOCK`) and the nine intent-kind constants are re-exported from the testing
subpath so callers can write `makeGuardianDecision(BLOCK, ...)` and
`makeIntent(PRINT_INTENT_KIND, ...)` without separately importing from the
main `@fleetos/contracts` entry.

Full strategy documented in `docs/tech-lead/FIXTURES.md`.

### D3 — Import-boundary hardening: `tools/check-ownership.mjs`

The W001 scanner caught only static `import ... from "..."` statements. W003
extends it to also catch:

- **dynamic imports**: `import("...")` and `await import("...")`. The regex
  matches anywhere in the source (not line-anchored).
- **CommonJS require**: `require("...")` (single or double quotes). Does NOT
  match `require.resolve(...)` (different function).
- **`import type`**: the existing static-import regex already matches
  `import type X from "..."`, but the report now tags these as `"import-type"`
  (rather than `"static-import"`) so callers can see the form.

The scanner was refactored: the spec-extraction logic now lives in an
exported `extractImportSpecifiers(text)` function so it can be unit-tested
in isolation (see `tools/check-ownership.test.mjs`). The line-based yaml
parser for `spec/worker-ownership.yaml` is unchanged (per the W003
constraint to keep it as-is).

Tests in `tools/check-ownership.test.mjs` cover:
- Each form is recognized and tagged correctly.
- Mixed forms in the same file are all captured.
- Comments (block + line) are stripped before matching.
- Line numbers are 1-indexed and approximate.
- `import.meta.url` is NOT matched (no parens after `import`).
- `require.resolve(...)` is NOT matched (different function).

A live-fire test was performed during W003: a temporary file with one
violation of each form (static-import, import-type, dynamic-import, require)
was placed in `packages/recovery/` (worker-a) and the scanner correctly
reported all four cross-lane violations. The temp file was removed after
verification.

### D4 — CI wiring

The CI workflow (`.github/workflows/ci.yml`) was already correct at the
W002 base — it runs `bun install`, `bun run check`, `bun run typecheck`,
`bun test` on push/PR to `main`. The new `check:contracts` gate runs
automatically as part of `bun run check` (since the root `check` script now
includes it). The YAML parses cleanly (verified with Python's `yaml.safe_load`
and a custom indentation-parity check). No changes were needed to the YAML
itself — only to the root `package.json` `scripts.check` entry.

### D5 — Tests + docs

- **Fixture tests** (`packages/contracts/test/testing.test.ts`, 43 tests):
  determinism (same seed => same value across all builders), tenant-id
  grammar (`tnt_[a-z0-9]{8,64}`), valid-by-construction (every fixture passes
  the W002 invariant validators: `validateEnvelope`, `validateCommand`,
  `validateTenantRef`, `validateObservationBatch`), throws-on-invalid-override,
  cross-builder tenant isolation (no two builders using the same seed produce
  the same tenant id), exhaustive coverage of each of the nine intent kinds,
  each of the four guardian decision types, each of the six error taxonomy
  classes, each of the eleven adapter capabilities.
- **Cross-package consumer proof** (`apps/agent/src/testing-subpath.test.ts`,
  2 tests): imports `@fleetos/contracts/testing` from the worker-a lane,
  exercises every builder, asserts determinism from the consumer's
  perspective. Read-only use of another lane's test directory (per the W003
  D5 allowance). The `apps/agent` package declares
  `@fleetos/contracts: "workspace:*"` in its `dependencies` so Bun's
  workspace resolution links the package correctly.
- **Ownership scanner tests** (`tools/check-ownership.test.mjs`, 12 tests):
  unit tests for `extractImportSpecifiers` covering each form (static,
  import-type, dynamic, require), mixed forms, comment stripping, line
  numbers, and negative cases (`import.meta.url`, `require.resolve`).
- **Docs**: `docs/tech-lead/FIXTURES.md` (the fixture strategy), this
  `SKELETON-NOTES.md` section, and `spec/PROJECT-STATE.md` updated to
  mark W003 done and Wave 1 unblocked.
- **`types/bun-test.d.ts`** extended with `toBeGreaterThan`,
  `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual` matchers
  needed by the new tests for numeric invariants (`schemaVersion`,
  `version`, `seatCount`, etc.). The shim remains minimal; the
  known-limitation note about replacing it with `@types/bun` is preserved.

### Test results

`bun test` runs 146 tests across 31 files (89 W002 baseline + 43 fixture
tests + 2 cross-package consumer tests + 12 ownership scanner tests), 0
failures, 515 `expect()` calls.

`bun run check` runs architecture + ownership + contracts + skeleton checks,
all green.

`bun run typecheck` passes.

### Files modified outside `packages/contracts/` and `tools/`

Per the W003 ownership scope:

- `apps/agent/package.json` — added `@fleetos/contracts: "workspace:*` to
  `dependencies` so the cross-package consumer proof can resolve the
  subpath. This is a minimal additive change; it does not modify any
  worker-a source file.
- `apps/agent/src/testing-subpath.test.ts` — new file. Read-only consumer
  proof of the testing subpath.
- `docs/tech-lead/FIXTURES.md` — new file. The fixture strategy.
- `docs/tech-lead/SKELETON-NOTES.md` — this section.
- `spec/PROJECT-STATE.md` — status update to W003 done, Wave 1 unblocked.
- `package.json` (root) — added `check:contracts` script and wired it into
  the `check` composite script.
- `types/bun-test.d.ts` — extended with four numeric comparison matchers.

No frozen spec file was modified. The `spec/worker-ownership.yaml` is
unchanged (the W001 additive path claims for `apps/web/` and
`packages/integrations/adcos/` per ADR-0001 remain in effect).

### Known limitations carried forward (updated)

- `types/bun-test.d.ts` remains a minimal ambient shim. It now covers
  `test`, `expect`, `describe`, `mock`, `beforeEach`/`afterEach`/etc., plus
  the `toBeGreaterThan` / `toBeGreaterThanOrEqual` / `toBeLessThan` /
  `toBeLessThanOrEqual` matchers needed by the W003 tests. When `@types/bun`
  is added in a later wave, this file should be deleted and replaced with
  the canonical package.
- The intent payload shapes (`MaintainDeviceIntentPayload`,
  `SecurityRemediationIntentPayload`, etc.) are still minimal placeholders
  — Wave 1 lanes (W010/W011/W012) refine them via additive optional fields.
- The fixture builders do NOT generate realistic device payloads (the
  default payloads are intentionally minimal — `description: "fixture ..."`
  etc.). Workers refine the payload shapes in their owning work items; the
  fixtures only need to satisfy the cross-cutting invariants.
- The cross-lane import-boundary check now covers static, import-type,
  dynamic, and require forms. Other forms (e.g. Webpack-specific
  `require.ensure`, dynamic property access like `require("pkg-" + name)`)
  are still not checked — they're rare in FleetOS source.
