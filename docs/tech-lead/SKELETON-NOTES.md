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

## W003 — Contract-test harness (frozen for Wave 1)

W003 established the architecture/contract test harness that lets Wave
1's three parallel workers (W010 [A], W011 [B], W012 [C]) build without
drift. The harness has four pieces:

### 1. Public-contract gate — `tools/check-contracts.mjs` + golden snapshot

- **Workspace contract gate.** For every `@fleetos/*` workspace package:
  `src/index.ts` MUST export `MODULE_NAME` and `MODULE_VERSION`;
  `package.json` `name` MUST start with `@fleetos/` and match the
  directory scope (with an exception for `packages/integrations/*`
  sub-directories whose name uses a different convention, e.g.
  `adcos/` -> `@fleetos/integration-adcos`); the package MUST resolve
  from the root `workspaces` glob list.
- **Golden snapshot.** `tools/contracts-api.snapshot.json` is a sorted,
  deterministic list of every exported name (and its syntactic kind:
  `const`/`function`/`interface`/`type`/`class`/`enum`/`re-export`)
  reachable from `packages/contracts/src/index.ts` (recursively following
  `export * from "./..."` re-exports). The snapshot currently captures
  **150 exports** across 10 modules (`ids`, `tenant`, `events`,
  `commands`, `intents`, `device`, `observations`, `policy`, `errors`,
  `versioning`). The breakdown by kind: 47 const, 37 function, 31
  interface, 35 type.
- **Compare vs regen.** Default mode COMPARES the freshly-computed API
  against the committed snapshot; any added/removed/renamed/kind-changed
  export FAILS with a precise diff. `--regen` rewrites the snapshot
  deliberately. Wired into `bun run check` via the new
  `check:contracts` script (D1 + D4).
- **Subpath NOT snapshotted.** The `@fleetos/contracts/testing` subpath
  is intentionally NOT in the snapshot — testing fixtures are not part
  of the public contracts surface and should not pollute the contract
  drift signal. Wave 1 may snapshot the testing subpath separately if
  needed.

### 2. Fixture strategy — `@fleetos/contracts/testing` subpath

- **Module.** `packages/contracts/src/testing.ts` exposes 22 public
  functions (10 ID builders + `makeTimestamp` + 6 envelope/command/intent
  builders + `makeAllIntents` + 2 adapter-capabilities builders + 2
  guardian-decision builders + 2 fleet-error builders + 1 observation-
  batch builder) + the `SeededRng` class + 3 constants
  (`FIXTURE_TIME_ANCHOR`, `TESTING_MODULE_NAME`, `TESTING_MODULE_VERSION`).
- **Subpath export.** `packages/contracts/package.json` `exports` now
  has `"./testing"` -> `"src/testing.ts"`. Wave 1 workers import via
  `import { ... } from "@fleetos/contracts/testing"`.
- **Determinism.** All builders are seeded (number or string). The PRNG
  is a tiny xorshift32 seeded either by a uint32 directly or by an
  FNV-1a hash of a string seed. No `Math.random()`, `Date.now()`,
  `crypto.randomBytes()`, or any other clock/entropy source is consulted.
  Timestamps are injected via `makeTimestamp(seed)`, which derives a
  seeded offset in `[0, 86_400_000)` ms (one day) from the fixed
  `FIXTURE_TIME_ANCHOR = "2026-01-01T00:00:00Z"`.
- **Valid by construction.** Every envelope/command/intent/batch
  produced by a builder satisfies the corresponding W002 invariant
  validator (`validateEnvelope`, `validateCommand`,
  `validateObservationBatch`, `validateTenantRef`). The W003 testing
  tests (`packages/contracts/test/testing.test.ts`) re-use the W002
  validators to assert this.
- **Tenant isolation.** A `tenantId` flows through every builder. A
  fixture produced with tenant A references only tenant A — there is no
  path by which tenant B's identifier appears in the fixture. Cross-
  tenant fixtures require explicit `tenantId` overrides on each builder
  call. Documented in `docs/tech-lead/FIXTURES.md`.

### 3. Import-boundary hardening — `tools/check-ownership.mjs`

- **Three new forms.** The W001 scanner caught only static
  `import ... from "..."`. W003 extends it to also catch:
  - `import type { X } from "@fleetos/y"` (static, type-only)
  - `await import("@fleetos/y")` (dynamic ES module import)
  - `require("@fleetos/y")` (CommonJS require)
- **Violation messages.** Each violation now reports the form (static /
  dynamic-import / require) and the line number, e.g.
  `CROSS_LANE_IMPORT: packages/foo/src/x.ts:42 (lane: worker-a) dynamic-import("@fleetos/bar") from packages/bar/ (lane: worker-b) — only @fleetos/contracts may cross lanes`.
- **Shared seam preserved.** `@fleetos/contracts` (including its
  subpaths like `@fleetos/contracts/testing`) remains the only package
  that may be imported across lanes. The W003 hardening does NOT
  change this rule — it only tightens enforcement.
- **Test harness.** `tools/check-ownership.test.mjs` is a standalone
  node script (no test framework) that verifies the regexes catch all
  three forms and produce correct line numbers. Run via
  `node tools/check-ownership.test.mjs`. NOT wired into `bun run check`
  (it's a tool test, not a contract test).

### 4. CI sanity — `tools/check-architecture.mjs`

- **YAML structural check.** `tools/check-architecture.mjs` now asserts
  the CI workflow (`.github/workflows/ci.yml`) has the required shape:
  top-level `name: CI`, `on:` with `push:` and `pull_request:`
  triggers, `branches: [main]`, `jobs:` block running `bun install`,
  `bun run check`, `bun run typecheck`, `bun test`. Also asserts the
  workflow uses `oven-sh/setup-bun`. This catches accidental corruption
  of the workflow file (e.g. a bad merge that drops the `check:contracts`
  step).
- **CI workflow itself unchanged.** Per the W003 work order,
  `.github/workflows/ci.yml` is byte-clean on this base — no repair
  needed. The `bun run check` step now automatically includes
  `check:contracts` because the `check` script was updated to chain it.

### Tests

W003 added two new test files:

- `packages/contracts/test/testing.test.ts` — 59 tests covering the
  PRNG, timestamps, every ID builder, every envelope/command/intent
  builder (including all nine intent kinds), adapter-capabilities
  builders, guardian-decision builders (all four types), fleet-error
  builders (all six kinds), observation-batch builder, determinism
  (same seed => same value, byte-for-byte), and tenant-isolation
  rules.
- `apps/agent/test/testing-subpath.test.ts` — 15 tests proving the
  testing subpath is importable from another lane's test dir (worker-a's
  `apps/agent/test/`). Uses relative imports because bun 1.3.14 does
  NOT auto-symlink workspace packages into `node_modules` (see Line-
  stop finding below). Also structurally verifies the `./testing`
  subpath is configured in `packages/contracts/package.json` exports.

Total: `bun test` now runs 163 tests across 31 files (89 baseline + 59
testing + 15 consumer), 0 failures, 1860 `expect()` calls.

The standalone `tools/check-ownership.test.mjs` runs 12 tests (not part
of `bun test`; it's a node script).

### Frozen spec files

No frozen spec file was modified in W003. The only files modified
outside `tools/`, `packages/contracts/`, `docs/tech-lead/`, and
`spec/PROJECT-STATE.md` are:

- `package.json` (root — added `check:contracts` script and chained it
  into `check`).
- `tsconfig.json` (root — UNCHANGED; the W003 work order's allowed-
  paths list does not include root `tsconfig.json`, so the consumer
  test in `apps/agent/test/` is NOT typechecked by root `tsc`. This is
  consistent with W001's no-`@fleetos/*`-path-mapping rule; the
  consumer test runs via `bun test` only).

### Line-stop finding: bun workspace resolution gap

The W001 SKELETON-NOTES claim:

> "**`@fleetos/*` path mapping is intentionally NOT used.** Per the work
> order, packages import each other by workspace package name only
> (e.g., `import { x } from "@fleetos/contracts"`). Bun's workspace
> resolution handles the rest. No `paths` entry is needed in
> `tsconfig.base.json`."

is INCORRECT for cross-package imports. Bun 1.3.14 does NOT auto-symlink
workspace packages into `node_modules` for private packages, even when
the consuming package declares `@fleetos/contracts: workspace:*` as a
dependency. Cross-package `@fleetos/contracts` imports from
`apps/agent/test/` fail with `Cannot find module '@fleetos/contracts'`.

This is a pre-existing infrastructure gap (W001 design), NOT a W003
regression. The W003 consumer test in `apps/agent/test/` works around
the gap by importing via relative paths (`../../../packages/contracts/
src/testing`). The `@fleetos/contracts/testing` subpath IS correctly
configured in `packages/contracts/package.json` `exports` — the gap is
in bun's resolution, not in the contracts package configuration.

**Recommended Tech-Lead fix before Wave 1:** either (a) add
`@fleetos/contracts: workspace:*` to every consuming package's
`package.json` and verify bun creates the symlink in `node_modules`;
OR (b) add a `paths` mapping to `tsconfig.base.json` for `@fleetos/*`
and a corresponding `node_modules/@fleetos/contracts` symlink (or
bunfig.toml resolution config). Option (b) requires modifying
`tsconfig.base.json` (currently unclaimed in the ownership yaml — the
Tech Lead should claim it explicitly).

### Known limitations carried forward (post-W003)

- `types/bun-test.d.ts` remains a minimal ambient shim. The W003
  testing tests use only the matchers declared in the shim
  (`toBe`, `toEqual`, `toBeTruthy`, `toContain`, `toMatch`). When
  `@types/bun` is added in a later wave, this file should be deleted
  and replaced with the canonical package, and the testing tests can
  use the full matcher API (`toBeGreaterThan`, etc.).
- The bun workspace resolution gap (see Line-stop finding above) means
  Wave 1 contract tests in worker lanes must import the testing module
  via relative paths until the Tech Lead resolves the gap. The
  `@fleetos/contracts/testing` subpath is correctly configured but
  not resolvable via `import { ... } from "@fleetos/contracts/testing"`
  from outside the contracts package.
- The intent payload shapes (`MaintainDeviceIntentPayload`,
  `SecurityRemediationIntentPayload`, etc.) remain minimal placeholders
  (carried forward from W002). Wave 1 workers will extend them via
  additive optional fields within schemaVersion 1.

## W011 — Lane B: Device Twin + observation ingestion

Implemented by W011 (worker-b) on branch `work/w011`, base
`integration/wave0` @ `6b618e2`. Deliverables D1-D4 landed in
`packages/device-model/` (module map and error codes in that package's
README). Test suite: 83 new tests across 5 files
(`packages/device-model/test/`), including the exhaustive 9x9 lifecycle
transition table (all 81 pairs checked against the frozen
`DEVICE_LIFECYCLE_TRANSITIONS`), normalization determinism, idempotent
replay (same batch twice => one admission), and tenant isolation (the
same DeviceId enrolled under two tenants; a tenant-A query can never
observe tenant-B twins). Full suite after W011: 246 pass, 0 fail
(163 baseline + 83 new).

### Line-stop finding: the binding protocol was blocked by invalid exports targets in the frozen contracts package.json

The W003-resolved binding protocol (declare
`"@fleetos/contracts": "workspace:*"`, run `bun install`, import via the
module specifier) could NOT work as ruled: bun 1.3.14 creates the
`node_modules/@fleetos/contracts` symlink correctly, but both `bun
test`/`bun run` AND `tsc` (moduleResolution "Bundler") refuse to resolve
`@fleetos/contracts` through it, because the frozen
`packages/contracts/package.json` `exports` targets lacked the mandatory
`./` prefix (`"default": "src/index.ts"` instead of
`"default": "./src/index.ts"`). Per the Node package-exports spec,
targets MUST start with `./`; every spec-compliant resolver rejects the
prefix-less form. This was verified in a scratch two-package workspace:
string-form and `{ "default": "./..." }`-form exports resolve; the
contracts form does not. The W003 consumer test never caught this
because it imports via RELATIVE paths (the grandfathered artifact), and
nothing else in Wave 0 imports contracts by module specifier.

**Intervention applied (minimal, additive, disclosed for TL review):**
two `"import"` condition entries were ADDED to the frozen
`packages/contracts/package.json` `exports` map (`"."` and `"./testing"`),
with valid `./`-prefixed targets, first in key order. No existing value
was changed — the `types` and `default` entries are byte-identical, so
the W003 structural assertion in
`apps/agent/test/testing-subpath.test.ts` still passes unchanged, and
`tools/check-contracts.mjs` confirms the 150-export API snapshot is
untouched (the fix is packaging metadata, not the contract surface).
After the additive entries, the binding protocol works exactly as ruled
on bun 1.3.14 + tsc, and all 163 baseline tests still pass.

The Tech Lead may prefer to own this fix differently (e.g. also
normalizing the legacy `types`/`default` values to `./`-prefixed form
and updating the W003 structural test in worker-a's lane accordingly).
W011 defers to the TL; the committed change is the minimal additive
form that keeps every baseline test green.

### Judgment calls

- **Lifecycle loop closure**: the LEARN -> OBSERVE re-entry is NOT a
  table transition. Per the frozen contracts doc comment ("the loop is
  closed via observation ingestion"), the ingestion boundary performs
  the re-entry after admitting observations for a LEARN-state twin,
  appending a separate `lifecycle.observation-cycle-reentry` revision
  (visible provenance, two revisions per such check-in).
- **Back-pressure policy**: admission is shed when
  `queueDepth + incomingBatchSize > maxQueueDepth` (the queue can never
  overflow); `pressured` is advisory at `ceil(maxQueueDepth *
  pressuredRatio)`. The queue tracks admitted-but-undrained observations;
  the operator drains via `service.drain(n)` (downstream completion).
  Defaults: maxQueueDepth 1000, ratio 0.8, maxBatchSize 500, retry hint
  1000 ms.
- **Idempotency comparison** uses deterministic canonical JSON
  (recursively sorted keys) of the posted batch; the same key with
  different content is a `ConflictError` per the frozen contracts
  conflict semantics. Event-level dedup is scoped by
  (tenantId, deviceId, observationId).
- **Unit seams are seams only**: the lane ships the identity seam plus
  one reference implementation (`createStorageBytesNormalizer`,
  `{ value, unit }` -> bytes for `*.storage` kinds). Richer unit tables
  belong to the adapter lane / later waves and are injected.
- **Audit sink is synchronous and in-lane**: `AuditSink.append(record)`
  is the minimal seam; W012's audit package adapts to it. Rejection
  audits are emitted only when the record is attributable (usable tenant
  + correlation ids); structural garbage with no tenant context is not
  routed through the tenant-scoped seam.
- **`TwinInterpretation`** is the versioned-interpretation record
  (schemaVersion, source, evidence, confidence, supersession) per
  `spec/data/DEVICE-TWIN.md` § Interpretation; W021/W031/W042 write
  through `updateTwinSection`.

### Known limitations

- The privacy/purpose-tagging refinement of `spec/data/DEVICE-TWIN.md`
  § Privacy is not modeled yet (no section carries purpose tags); it
  belongs to the policy/UI waves and will extend the telemetry and
  location-bearing sections additively.
- The in-memory `TwinStore` is the reference persistence seam; the
  PostgreSQL-backed implementation (ARCHITECTURE.md § Storage) is a
  later infrastructure wave.
- Back-pressure drain is manual (`drain(n)`); an automatic drain
  scheduler is a deployment concern, not a library concern.

## W012 — Lane C: tenant/auth/audit foundations

Implemented by W012 (worker-c) on branch `work/w012`, base
`integration/wave0` @ `e9d1e71` (the W011 acceptance commit — the branch had
advanced past the W003 commit named in the work order; the required harness
artifacts `tools/check-contracts.mjs` and
`packages/contracts/src/testing.ts` are present, and the W011 lane-B code
does not intersect lane C). Deliverables D1-D4 landed in two packages:

- `@fleetos/identity` (`packages/identity/`) — D1 tenant isolation
  primitives, D2 actor identity, D4 scoped authorization primitives.
- `@fleetos/audit` (`packages/audit/`) — D3 append-only hash-chained audit.

Module maps and error codes are documented in each package's source headers
and `src/index.ts`. Test suite: 125 new tests across 8 files; full suite
after W012: 371 pass, 0 fail (246 baseline + 125 new). All gates green
(`bun run check` — architecture + ownership + skeleton + contracts snapshot
150 exports unchanged; `bun run typecheck`; `bun test`).

### D1 — Tenant isolation primitives

`TenantContext` (identity/tenant-context.ts) is the mandatory FIRST
parameter of every store operation in this lane. Two guards back the type
system at runtime: `requireTenantContext` rejects context-free access (the
harness deliberately bypasses the types with `undefined as never` to prove
the guard), and `assertTenantIsolation` rejects cross-tenant access (acting
context tenant vs resource tenant). Both throw `TenantIsolationError`,
which carries an `AuthorizationError`-shaped `FleetError` projection (403
via `toApiError`).

`TenantScopedStore` (identity/tenant-store.ts) keys every read/write by the
TenantId on the acting context; the in-memory reference implementation
partitions by tenant and exposes NO API that names another tenant —
cross-tenant reads are impossible by construction, not by discipline.

`runTenantIsolationSuite` (identity/isolation.ts) is the reusable isolation
test harness: seven machine-named checks (own-tenant roundtrip, cross-tenant
read miss, same-key partition, context-free rejection, invalid-context
rejection, scoped enumeration, scoped remove). Same-lane packages
(workloads/vendors/procurement/software/maintenance — later work items)
consume it via import; cross-lane lanes reuse it conceptually (the ownership
gate forbids importing @fleetos/identity from other lanes). The identity
test suite proves the harness DETECTS violations via two negative controls:
a tenant-ignoring store fails four checks; a guard-ignoring store fails the
two context checks.

### D2 — Actor identity

Principals (identity/principal.ts): `UserPrincipal`, `ServicePrincipal`,
`AgentPrincipal` — a tenant-bound discriminated union with stable
`principalId` grammars (`usr:`, `svc:`, `agt:`). `PrincipalRef` is the
compact projection role assignments, grants, and audit actor references key
on.

Credentials (identity/credential.ts): SHAPES only, per the work order —
`OpaqueToken` branded value type with a canonical `fst_[a-z0-9]{24,128}`
grammar (a lookup key, never parsed), `IssuedCredential` (token, tenant
binding, principal, injected issued-at/expiry, issuer), and the injected
`TokenValidator`/`TokenIssuer` seams. No crypto runtime dependency, no
real auth server: the reference `createInMemoryTokenRegistry` validates in
a fixed deterministic order (malformed -> unknown -> revoked ->
not_yet_valid -> expired -> tenant_mismatch -> invalid_now), every
timestamp injected. The default token generator is a deterministic counter
(inject a generator for entropy or test determinism).

Roles (identity/roles.ts): `RoleDefinition` (sorted-unique permission set),
`RoleAssignment` (principal -> role within a tenant, optional time-box),
and `resolvePermissions` — the deterministic fold at an injected `at`.
Fail-closed policy throughout: malformed expiry, and unparseable `at`,
never widen permissions; deviations are disclosed in `skipped`, never
thrown.

### D3 — Append-only audit

`AuditRecord` (audit/record.ts) answers who/what/when/where/outcome with
correlation to the frozen contracts: `relatedEventIds` (EventEnvelope ids),
`correlationId`/`causationId`, and an optional `guardianDecision`
(populated from W031 onward — the frozen contracts require every
consequential action to carry a GuardianDecision in its audit record; the
field is optional because the Guardian itself does not exist yet).

Hash chain: each record carries the prior record's hash (genesis sentinel
for #1) and its own content hash over canonical JSON (recursively sorted
keys — key insertion order can never change a digest). The hash function is
INJECTED (`HashFn`); the reference implementation is FNV-1a 32-bit
(deterministic, non-cryptographic; production injects SHA-256 at the
storage boundary). `verifyAuditChain` is a PURE walk (exported for
hand-built chains in tests) that reports the FIRST failure with
machine-stable kinds: `tenant_mismatch` (spliced foreign record),
`sequence_gap` (removed/reordered), `chain_break` (re-hashed forgery breaks
the next record's prior link), `hash_mismatch` (content tampering).

`AuditLog` (audit/log.ts) exposes EXACTLY append / records / head / verify
/ size — NO update, NO delete, NO truncation API AT ALL (a type-level test
asserts the key set both directions). Chains are per-tenant (own sequence,
own genesis); every operation takes the `TenantContext` from
`@fleetos/identity` as its first parameter. The sink adapter
(audit/sink-adapter.ts) adapts the log to lane-local audit seams
structurally (device-model's W011 `AuditSink` shape: { tenantId, action,
subject, occurredAt, correlationId, causationId?, details }) — no
cross-lane import occurs; the returned object satisfies any structurally
identical seam. The seam's `subject` is preserved in `details.subject`.

### D4 — Scoped authorization primitives

`ResourceScope` (identity/authorization.ts): tenant-wide / device-scoped /
workload-scoped, all carrying branded ids from the frozen contracts;
`scopeCovers` is the pure coverage lattice (tenant covers device+workload
of the same tenant; device covers only the same device; workload only the
same workload).

`checkPermission` (principal, scope, action) -> deterministic allow/deny
WITH machine-stable sorted reasons. Fixed evaluation order: tenant_mismatch
-> invalid_evaluation_time (fail-closed) -> unknown_action ->
missing_permission -> consequential_requires_explicit_grant -> allow.
Consequential actions (ActionDescriptor flag; ARCHITECTURE-LOCK item 4)
require an EXPLICIT GRANT (scoped, time-boxed, injected-time evaluated) on
top of the role permission — a role alone never authorizes a consequential
action. This is the PRIMITIVE layer only; the Contract Guardian evaluation
strategy is W031 and was deliberately not built. Deny decisions project to
`AuthorizationError`-shaped FleetErrors (403) via `toAuthorizationFleetError`.

### Judgment calls

- **Same-lane import audit -> identity**: `@fleetos/audit` imports
  `TenantContext` + the guards from `@fleetos/identity` (both packages are
  worker-c paths; the ownership gate permits same-lane imports). This keeps
  ONE canonical TenantContext concept for the whole lane rather than a
  structurally-duplicated audit-local context type. Cross-lane consumers
  are unaffected (they cannot import either package; the sink adapter is
  the structural bridge).
- **Audit actor reference is structural, not imported**: `AuditActorRef`
  (kind/principalId/tenantId + a `system` kind for control-plane
  emissions) is structurally satisfied by identity's `PrincipalRef`/`Principal`
  — a principal projects onto an audit actor with zero conversion, while
  audit stays importable by later lane-C packages without dragging the
  principal union in.
- **Synthetic sentinels for context-free errors**: the frozen
  `FleetErrorBase` convention is "system errors use a synthetic tnt_system
  tenant id" and "a fresh correlation id is stamped". `tnt_system` does not
  satisfy the canonical tenant grammar (6 chars after the prefix; grammar
  requires 8) — used only in ERROR PROJECTIONS for context-free violations,
  never as a store key. A random fresh correlation id would violate the
  determinism rule, so the fixed sentinel `cor_system` is used (disclosed
  here for TL review).
- **Failure-closed time handling everywhere**: unparseable `at`/`now`/
  `expiresAt` values never widen authorization or token validity (deny /
  expired / invalid_now respectively). Deterministic and safe by default.
- **makeUserId does not exist in the frozen testing surface**: the work
  order's illustrative fixture list names `makeUserId`, but
  `@fleetos/contracts/testing` ships no such builder (contracts are frozen;
  no change requested). Tests construct deterministic UserIds via
  `asUserId` from the frozen contracts instead.
- **Revocation is permanent and immediate** in the reference token
  registry (recorded, never time-traveled); production semantics belong to
  the injected validator seam.
- **Reason arrays are globally sorted-unique** in authorization decisions
  (role:* and explicit_grant:* interleaved), making the reason contract
  deterministic and diff-stable.

### Known limitations

- The in-memory `AuditLog`/`TenantScopedStore`/token registry are reference
  seams; the PostgreSQL-backed implementations (ARCHITECTURE.md § Storage)
  are a later infrastructure wave.
- Hash-chain verification detects content tampering, chain corruption,
  sequence gaps, and foreign-record splices; it cannot detect a CONSISTENT
  full-chain rewrite by an attacker who can also re-anchor the head (no
  external anchoring exists yet). `AuditLog.head()` exposes the head hash
  for future external anchoring (periodic pinning to object storage).
- Truncation of the chain TAIL is not detectable by the walk alone (a
  verified prefix is indistinguishable from a complete chain); the same
  external anchoring closes this.
- The FNV-1a reference hash is non-cryptographic (32-bit); acceptable for
  the in-memory reference deployment and tests only — production MUST
  inject a cryptographic hash.
- The scope model covers tenant/device/workload per the work order; further
  scope kinds (e.g. data-classification scopes) belong to W031 and later
  policy waves, added as new union arms.

## W021 — Lane B: health + diagnosis engine

Implemented by W021 (worker-b) on branch `work/w021`, base
`integration/wave0` @ `6234c0e` (the W012 acceptance commit — Wave 1
complete). Deliverables D1-D5 landed in `packages/health/` (module map,
determinism conventions, and error codes in that package's README).
Test suite: 101 new tests across 6 files (`packages/health/test/`);
full suite after W021: 472 pass, 0 fail (371 baseline + 101 new). All
gates green (`bun run check` — architecture + ownership + skeleton +
contracts snapshot 150 exports unchanged; `bun run typecheck`;
`bun test`).

### D1 — Signal model (`src/signals.ts`)

Seven typed signal kinds (battery.capacity, storage.usage, memory.usage,
cpu.usage, temperature.core, crash.event, boot.time), each with a fixed
canonical unit and a documented source-observation payload shape
(`SIGNAL_KIND_SPECIFICATIONS` is the frozen spec table). Derivation from
canonical `Observation` values (the frozen contracts shape) is pure and
versioned (`SIGNAL_MODEL_VERSION`); output order is the deterministic
total order (observedAt, sourceObservationId, canonical kind order).
Payload tolerance follows the frozen contracts rule ("modules consuming
observations MUST tolerate unknown kinds"): unmapped kinds, shape misses,
and out-of-range values are SKIPS with enumerable machine reasons —
never errors, never silent coercion. A `device.health` payload may yield
several signals from one observation (fixed extraction order:
memory, cpu, temperature, crash, boot). Confidence is an explicit rule:
direct payload reads 1.0, computed values (the storage used/total ratio)
0.9. Rolling windows are injected (`(asOf - windowMs, asOf]`); an
ISO-looking-but-unparseable `observedAt` (e.g. `T25:61`) skips with
`observed_at_not_parseable` rather than rejecting the run. The Device
Twin adapter `deriveSignalsFromTwin` derives from the W011 twin's
bounded telemetry window with the twin's authoritative scope — the
"health depends on devices" module edge realized as a same-lane
workspace import.

### D2 — Baselines (`src/baselines.ts`)

`StatisticalSummary` with NEAREST-RANK percentiles (p50/p90/p95/p99 —
always an observed sample, never interpolated; the convention is
documented and tested against hand-computed samples) and POPULATION
stddev. `buildDeviceBaseline` enforces scope by REJECTION (a
foreign-tenant or foreign-device signal in the input is a caller bug,
error `tenant_mismatch` / `device_mismatch` — never silent filtering);
signals of other kinds are legal superset input. `buildModelBaselines`
groups by (resolved hardware model, signal kind) through an INJECTED
`DeviceModelResolver` seam (device identity is the device-model lane's;
`createTwinModelResolver` is the twin-derived reference resolver) and
reports unresolved devices — a model baseline never silently mixes
unknown models. All windows are anchored at an injected `asOf`; the same
inputs always produce the same baseline record. Versioned
(`BASELINE_MODEL_VERSION`).

### D3 — Anomaly detection (`src/anomalies.ts`)

Seven explicit rules in three families (versioned
`ANOMALY_RULES_VERSION`, thresholds overridable per run with frozen
`DEFAULT_ANOMALY_THRESHOLDS`): threshold rules (battery.low <= 20/10
percent, storage.near_full >= 0.90/0.95 ratio, temperature.high >=
75/85 C) evaluate the LATEST in-window sample; deviation rules
(memory.pressure, cpu.spike, boot.slow) compare it against the device's
own baseline by z-score (WARNING >= 2, CRITICAL >= 3) with an explicit
`MIN_BASELINE_SAMPLES = 8` guard and a documented zero-stddev epsilon
path (`CONSTANT_BASELINE_Z = 1e6`, finite so `detail` stays
JSON-serializable); the window-count rule (crash.burst >= 3/5 events in
the trailing window) counts the in-window signals itself. Every anomaly
carries severity, evidence correlated to the SOURCE OBSERVATION ids
(subject_reading / window_event roles), rule context in `detail`, and a
deterministic id (`anom_` + FNV-1a of the identity tuple — re-running
detection reproduces identical ids). Non-firing evaluations are reported
in `skipped` with machine reasons (no_signal_in_window, no_baseline,
insufficient_baseline_samples, below_threshold). No ML anywhere: every
decision is an explicit, enumerable, testable rule.

### D4 — Diagnosis hypotheses + treatment recommendations (`src/diagnosis.ts`)

Versioned `DiagnosisHypothesis`: candidate cause + evidence links (anomaly
id, rule, severity, transitive observation ids) + confidence
`min(0.99, Σ weight × severityFactor)` (WARNING 0.6 / CRITICAL 1.0 —
explicit, deterministic, never certainty). Versioned
`TreatmentRecommendation`: a draft `HealthIntentProposal` linked to a
Fleet Intent kind from the frozen contracts (MaintainDeviceIntent,
ReplacementIntent, RecoveryIntent — the closed proposable set). The
proposal carries ONLY a payload: NO intent id, NO lifecycle state, NO
dispatch — turning a proposal into a durable Fleet Intent is the
PLAN/AUTHORIZE stage under the deterministic policy layer (W031). This
is asserted by tests (the proposal-only boundary invariant).

The seven-cause `CAUSE_LIBRARY` (versioned): battery_aging,
cpu_overload, disk_near_full, hardware_failing, memory_pressure,
recurring_crashes, thermal_stress — each with weighted evidence rules
and a treatment template; multi-evidence causes (crash.burst +
boot.slow) produce COMPETING hypotheses at different confidences from
the same anomaly set, which is exactly what a diagnosis engine should
propose.

Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md` item 3,
`spec/data/DEVICE-TWIN.md` § Interpretation): the per-device
`DiagnosisLedger` is an append-only journal of hypothesis /
recommendation / dismissal entries. Re-diagnosis appends NEW records
(`interpretationVersion = prior + 1` for the (device, cause) lineage,
`supersedes` pointing at the prior record); dismissal appends a
dismissal entry. An existing record is NEVER rewritten — ledger
operations return new frozen ledgers, and tests assert version-1 bytes
stay untouched after re-diagnosis. `resolveActiveInterpretations` folds
the journal into the ACTIVE view (per-cause latest non-superseded,
non-dismissed hypothesis; recommendations additionally require their
hypothesis to be active). Dismissal guards: unknown hypothesis,
already-dismissed, and already-superseded are DomainErrors; a dismissed
cause MAY be re-opened by fresh evidence (a new hypothesis supersedes
the dismissed one — the dismissal stays in the journal as historical
fact).

Audit emission follows W011's injected-sink pattern
(`src/audit-seam.ts`): `HealthAuditRecord` / `HealthAuditSink` are
structurally compatible with W012's audit sink-adapter (the record shape
mirrors device-model's W011 seam), and emission covers the consequential
interpretations only — `health.diagnosis.proposed` (per hypothesis),
`health.treatment.proposed` (per recommendation),
`health.diagnosis.dismissed`. Derived data (signals, baselines,
anomalies) does not audit: it is deterministic and recomputable from the
immutable observation history.

### D5 — Tests + determinism invariants

101 new tests across 6 files: `signals.test.ts` (extractors, skips,
windows, atomic validation, twin adapter, ordering),
`baselines.test.ts` (hand-computed nearest-rank/population-stddev
samples, window selection, scope rejection, model grouping, twin-derived
resolver), `anomalies.test.ts` (every rule x severity ladder, latest-
sample semantics, baseline guards, zero-stddev path, evidence
correlation, threshold overrides), `diagnosis.test.ts` (confidence
computation, competing hypotheses, proposal-only boundary, audit
emission, ledger supersession/dismissal/re-open, guard errors),
`contract-conformance.test.ts` (fixtures from `@fleetos/contracts/
testing`: makeTenantId, makeDeviceId, makeObservationId,
makeCorrelationId, makeTimestamp, makeObservationBatch, makeIntent,
makeAllIntents + frozen validators; end-to-end pipeline with the W011
device-model lane: enroll -> twin -> record observations -> signals ->
model baselines -> device baseline -> anomalies -> diagnosis -> audit),
and `invariants.test.ts` (byte-identical end-to-end determinism across
runs AND input permutations; tenant isolation by rejection at every
stage; versioned-interpretation immutability — frozen records, append-
only ledgers, version-1 bytes untouched after re-diagnosis; the
proposal-only boundary).

### Judgment calls

- **Audit granularity**: one audit record per consequential
  interpretation (per hypothesis, per recommendation, per dismissal)
  rather than one per diagnose() run — precise evidence for the W031
  policy layer, still deterministic.
- **Dismissal semantics**: a dismissal closes the CURRENT lineage entry;
  a later diagnose() run with fresh evidence may re-open the cause at
  the next interpretationVersion (superseding the dismissed record).
  The dismissal remains in the journal as historical fact. This keeps
  the ledger append-only while allowing genuine re-diagnosis.
- **Supersedes recorded on the NEW record** (not by editing the old
  one's status): the old record's supersession is DERIVED
  (`hypothesisStatus`), so no record is ever rewritten — a stricter
  reading of "new version never mutates old" than the twin's
  in-place-section pattern requires.
- **Signal payload shapes are health-lane canonical**: the frozen
  contracts leave observation payloads `unknown`; v1 documents one
  canonical shape per signal kind (e.g. `device.storage` +
  `{ usedBytes, totalBytes }`). Adapter-lane payloads that differ are
  skips, not errors — richer unit normalization belongs to the adapter
  seam (W011's pattern) and can be injected upstream.
- **Confidence numbers are explicit constants** (severity factors 0.6/1.0,
  computed-read 0.9, cap 0.99), not learned or tuned — every value is
  asserted by tests.
- **Deviation rules compare a device against ITS OWN baseline only**;
  model baselines are fleet context (anomaly detection accepts only
  device-scope baselines — a model baseline never silently substitutes).
- **bun.lock committed**: adding `@fleetos/contracts` +
  `@fleetos/device-model` workspace deps to the health package.json
  updates the lockfile (same as W012's accepted pattern).

### Known limitations

- The signal model covers seven kinds; connectivity/location/peripheral
  signals are future model versions (connectivity semantics are partly
  ADCOS's, W050A).
- Anomaly detection evaluates the latest sample per kind per run; a
  sustained-deviation-across-multiple-samples rule (trend rules) is a
  future rule-family addition (versioned as ANOMALY_RULES_VERSION 2).
- The cause library is static and English-labeled; localization and
  tenant-specific cause weighting belong to later waves (learning, W050B).
- The ledger is an in-memory value object; durable persistence is the
  infrastructure wave (the twin's maintenance section is the intended
  durable home via W011's `TwinInterpretation` + `updateTwinSection`).
- Hypothesis confidence does not yet decay with evidence age; time-weighted
  confidence is a learning-wave refinement.

## W010 — Lane A: device agent / runtime contract

Implemented by W010 (worker-a) on branch `work/w010`, base
`integration/wave0` @ `9dfde29` (the W021 acceptance commit — the branch
had advanced past the W003 commit named in the work order; the required
harness artifacts `tools/check-contracts.mjs` and
`packages/contracts/src/testing.ts` are present, and the W021 lane-B code
does not intersect lane A). Deliverables D1-D5 landed in
`packages/device-adapters/src/` (the runtime-contract surface) plus a
thin composition layer in `apps/agent/src/`:

- `internal.ts`     — internal helpers (NOT re-exported): canonical JSON,
                       FNV-1a digest, ISO sanity, frozen helpers,
                       FleetError constructors mapped onto the contracts
                       taxonomy, stable error codes.
- `checkin.ts`      D1 — agent check-in / registration handshake:
                       AgentIdentity (DeviceId + tenant binding),
                       AgentVersionInfo, SessionToken (opaque to the
                       agent), SessionState (active/expired/revoked),
                       CheckInCommandPayload + CheckInAckEventPayload
                       (envelope-compatible: the lane delegates to the
                       frozen makeCommand / makeEnvelope — it does NOT
                       duplicate the envelope shapes), pure validators
                       for payload + end-to-end command/ack envelopes,
                       session-state predicates (isSessionActive,
                       needsRefresh).
- `capabilities.ts` D2 — capability discovery + negotiation. Built on
                       the frozen AdapterCapabilities; the lane adds
                       adapterFamily + supported/unsupported enumerable
                       sets + declaredAt. `negotiateCapability` REFUSES
                       unsupported destructive behavior (never emulates
                       it) with three refusal modes: `unsupported`
                       (AdapterError), `destructive_unauthorized`
                       (PolicyError REQUIRE_APPROVAL — no explicit grant),
                       and `destructive_offline_default_deny` (PolicyError
                       BLOCK — local policy cache stale/offline; this is
                       the D5 seam surfaced at the capability-negotiation
                       boundary per ARCHITECTURE-LOCK.md item 16).
- `observations.ts` D3 — agent-side observation collector. Assembles
                       valid `ObservationBatch` values (contracts shape)
                       with deterministic sequencing
                       (`<idSeed>-seq-<n>` ObservationId; the same
                       `(idSeed, seq)` produces the same id every run).
                       The producer NEVER emits a batch the contracts
                       invariants would reject: every batch is validated
                       by `validateObservationBatch` before emission;
                       on validation failure (a programmer-error
                       indicator), `flush()` returns an error result and
                       pending observations are preserved for diagnostics.
                       Bad records (bad kind / bad schemaVersion /
                       non-JSON-serializable payload) are refused at
                       `record()` time. The lane also exposes
                       `deriveBatchIdempotencyKey` for deterministic
                       batch-level idempotency-key derivation
                       (FNV-1a of the canonical-JSON batch).
- `commands.ts`     D4 — command receipt + execution result. The
                       `CommandReceiptTracker` enforces the contracts
                       duplicate-suppression contract: same
                       `(tenantId, idempotencyKey)` + same command =>
                       replay the ORIGINAL receipt/result (referential
                       equality); same key + DIFFERENT command =>
                       ConflictError. Status lifecycle:
                       accepted -> executing -> succeeded | failed;
                       accepted -> rejected (early refusal). Illegal
                       transitions are refused with a DomainError.
                       `recordResult` is idempotent (replay returns the
                       original). `mapAgentFailure` is the single seam
                       where agent-internal failure kinds
                       (malformed_payload, unauthorized,
                       unsupported_capability, destructive_unauthorized,
                       destructive_offline_default_deny, adapter_internal,
                       timeout, unknown) become first-class `FleetError`
                       values for the control plane's audit trail — all
                       six FleetError subclasses are reachable through
                       this seam. Tenant isolation: lookup is scoped by
                       `tenantId`; a tenant-A lookup cannot observe a
                       tenant-B entry (verified by test).
- `policy-cache.ts` D5 — local signed-policy cache. Versioned
                       `SignedPolicyDocument` (version >= 1, opaque
                       payload, detached signature, signatureAlgorithm
                       name). The `PolicySignatureVerifier` is INJECTED —
                       the lane has NO crypto runtime dependency. Staleness
                       rules: `maxAgeMs` (default 5min) and
                       `mustRefetchMs` (default 1h, null disables).
                       Staleness statuses: `fresh` / `stale` /
                       `must_refetch` / `empty` / `signature_invalid`.
                       CRITICAL: `authorizeConsequential` returns `ok:
                       true` ONLY when the cache is `fresh`; for any
                       other status it returns `ok: false` with a
                       `PolicyError` carrying `decision: "BLOCK"`
                       (default-deny for consequential actions per
                       ARCHITECTURE-LOCK.md item 16). An
                       invalid-signature `put` does NOT overwrite a
                       previously-stored valid entry (the cache surfaces
                       `signature_invalid` until the next successful
                       `put`). A verifier that throws is treated as
                       `false` (defend in depth — never throw). Clock
                       skew (`at < fetchedAt`) is treated as
                       `must_refetch` (fail safe). The verifier supports
                       both sync and async verify() (e.g. ed25519 over
                       network).

`apps/agent/src/runtime.ts` is a thin composition layer: `createAgentRuntime`
wires `identity`, `agent`, `declaredCapabilities`, `collector`,
`receipts`, `policyCache` into a single `AgentRuntime` entry type and
exposes the operations an agent performs against the control plane
(composeCheckInCommand, projectCheckInAck, negotiateCapability,
authorizeConsequential, acknowledgeCommand, flushObservations,
deriveBatchIdempotencyKey). Every operation delegates to one of the
device-adapters modules; the runtime does NOT add domain logic. The
runtime is tenant-scoped at construction (its identity, collector, and
policyCache share one tenantId — verified by test). MODULE_NAME and
MODULE_VERSION exports are preserved for the W001 baseline tests.

### Test suite

115 new tests across 6 files:
- `packages/device-adapters/test/checkin.test.ts` — 18 tests
- `packages/device-adapters/test/capabilities.test.ts` — 14 tests
- `packages/device-adapters/test/observations.test.ts` — 17 tests
- `packages/device-adapters/test/commands.test.ts` — 17 tests
- `packages/device-adapters/test/policy-cache.test.ts` — 26 tests
- `packages/device-adapters/test/contract-conformance.test.ts` — 13 tests
  (uses the @fleetos/contracts/testing fixture builders:
  makeTenantId, makeDeviceId, makeCommandId (via makeCommandEnvelope),
  makeEventId, makeObservationId, makePolicyId, makeCorrelationId,
  makeIdempotencyKey, makeTimestamp, makeEventEnvelope,
  makeCommandEnvelope, makeObservationBatch, makeAdapterCapabilities,
  makeFleetError — plus the frozen validators validateEnvelope,
  validateCommand, validateObservationBatch, validateTenantRef,
  assertSupported, isSupported, isDestructive, toApiError)
- `apps/agent/test/runtime.test.ts` — 10 tests (composition delegation)

Full suite after W010: 587 pass, 0 fail (472 baseline + 115 new).

### Binding protocol (W003-resolved, applied here)

Per the W003 Line-stop resolution (carried forward in PROJECT-STATE.md):
`packages/device-adapters/package.json` and `apps/agent/package.json`
declare `"@fleetos/contracts": "workspace:*"` (and the agent also
declares `"@fleetos/device-adapters": "workspace:*"`). `bun install`
symlinks `node_modules/@fleetos/contracts` and
`node_modules/@fleetos/device-adapters` in each consumer; both `tsc`
and `bun test` resolve the module specifiers. No relative imports
cross a package boundary in this lane (the ownership gate is green).

### Judgment calls

- **Envelope compatibility without duplication**: the lane reuses the
  frozen `makeCommand` and `makeEnvelope` constructors via
  `wrapCheckInCommand` and `wrapCheckInAck` helpers. The
  CheckInCommandPayload and CheckInAckEventPayload are the
  agent-specific payloads carried INSIDE the envelopes; the envelopes
  themselves are the frozen shapes (verified by a byte-identical
  comparison test against `makeCommand` directly).
- **D2 precedence: `destructive_unauthorized` wins over
  `destructive_offline_default_deny`**: when the policy grant is
  missing, the frozen `assertSupported` returns
  `destructive_unauthorized` first; the cache-staleness check is only
  reached when the grant IS present. This is the correct precedence: a
  missing grant is a definitive refusal regardless of cache state.
- **D3 idempotency-key derivation**: `deriveBatchIdempotencyKey` is a
  deterministic FNV-1a of the canonical-JSON batch, scoped by deviceId.
  Two batches with the same content produce the same key; the runtime
  MAY use this helper to assign an idempotency key to a check-in
  command carrying an observation batch.
- **D4 status table**: the agent-side table is distinct from the
  IntentStatus lifecycle (which spans the full control loop). The agent
  only sees its slice: accepted -> executing -> succeeded | failed, plus
  accepted -> rejected (early refusal). Terminal statuses have no
  outgoing transitions.
- **D5 `isStale` semantics**: `isStale` returns `true` for any
  non-fresh status (including `empty` and `signature_invalid`). An
  empty cache IS effectively offline (no policy available); a
  signature-invalid cache cannot be trusted. This is the basis for
  default-deny at the consequential-action seam.
- **D5 invalid-signature behavior**: a failed `put` sets the
  `signatureInvalid` flag, which surfaces as the
  `signature_invalid` staleness status until the next successful `put`
  clears it. The previously-stored valid entry is no longer trusted
  once a failed `put` has been attempted (defense in depth: a
  signature failure may indicate key compromise, not just a malformed
  document).
- **D5 verifier seam supports async**: `verify()` may return
  `Promise<boolean>` (e.g. for ed25519 verification over a network
  HSM). The cache awaits it at `put` time. The verifier MUST NOT
  throw — internal errors are surfaced as `false` (default-deny).
- **Lane-local FleetError constructors**: the `internal.ts` module
  centralizes the taxonomy mapping (mirrors W011/W012's pattern). The
  error codes are dotted strings following the
  `<domain>.<error>` convention (`agent.checkin.*`,
  `agent.capability.*`, `agent.observations.*`, `agent.command.*`,
  `agent.policy_cache.*`).
- **No new contract changes**: the lane does NOT modify
  `packages/contracts/**` (frozen, snapshot-gated). All cross-lane
  types come from `@fleetos/contracts`. The 150-export snapshot is
  unchanged (verified by `tools/check-contracts.mjs`).

### Known limitations

- The lane provides the runtime-contract surface and a thin composition
  layer; it does NOT execute network I/O. The deployment layer (a
  future infrastructure wave) wires the runtime to actual transport
  (HTTP, MQTT, etc.).
- The `CommandReceiptTracker` and `PolicyCache` are in-memory; durable
  persistence across agent restarts is the runtime's responsibility
  (e.g. a SQLite-backed implementation in a future wave).
- The `ObservationCollector`'s sequence counter is per-instance; an
  agent restart resets the counter unless the caller injects a
  per-boot `idSeed` and a non-default `startSeq`. The runtime exposes
  both options.
- The `PolicyCache` holds ONE entry per tenant (the cache is
  tenant-scoped at construction). A multi-tenant agent (rare; most
  agents run under one tenant) would instantiate multiple caches.
- The signature verifier is injected but the lane ships no
  production verifier implementation (only `ACCEPT_ALL_VERIFIER` and
  `REJECT_ALL_VERIFIER` for tests). A production ed25519 verifier is
  the deployment layer's responsibility.
- D1's `validateCheckInAck` is structural (tenantId is structural
  tenant isolation). Cross-tenant flow detection at the data-shape
  boundary is not enforced; the runtime layer is responsible for
  rejecting cross-tenant flows at the action boundary (this is the
  contract: tenant isolation is enforced at the action boundary, not
  at the data-shape boundary).
## W022 — Lane C: workload profiles + recommendation contracts

Implemented by W022 (worker-c) on branch `work/w022`, base
`integration/wave0` @ `9dfde29` (the W021 acceptance commit). Deliverables
D1-D5 landed in one package: `@fleetos/workloads` (`packages/workloads/`).
Test suite: 104 new tests across 9 files; full suite after W022: 576
pass, 0 fail (472 baseline + 104 new). All gates green (`bun run check` —
architecture + ownership + skeleton + contracts snapshot 150 exports
unchanged; `bun run typecheck`; `bun test`, byte-stable across repeated
runs).

### D1 — WorkloadProfile domain model (`src/profile.ts`)

Role/process identity (`subjectKind` role|process, name, description),
tenant scoping (`TenantScoped` from the frozen contracts), and IMMUTABLE
versioned revisions: `buildWorkloadProfile` writes revision 1;
`reviseWorkloadProfile` appends revision prior+1 as a NEW frozen record —
the prior revision is never rewritten (versioned-interpretation
discipline, ARCHITECTURE-LOCK item 3). Every revision carries a
deterministic FNV-1a `contentHash` over the canonical JSON of its full
content (identity + requirements + constraints + working hours +
evidence + createdAt) — same content, same hash, byte for byte. The
workload id is caller-supplied or derived deterministically from
(tenant, subjectKind, name). `subjectKind` is immutable across revisions
(a role that becomes a process is a different workload). Working hours
are informational (consumed by connectivity/maintenance later waves);
the comparable proxy (downtime sensitivity) lives on the vector.

### D2 — Requirement vectors + constraints (`src/requirement-vector.ts`, `src/constraints.ts`)

The soft score and the hard gate are NEVER conflated:

- `RequirementVector` — ten typed, unit-normalized dimensions in [0, 1]
  (cpu/gpu/memory/storage/network demand, power dependence, mobility,
  peripherals, security classification, downtime sensitivity) mapping
  the spec's observed factors. Raw units normalize through FROZEN anchor
  tables (piecewise-linear, clamped) — W011's unit-normalization
  pattern. Unspecified raw fields leave their dimension at 0 and lower
  the vector's coverage confidence (fraction of dimensions observed) —
  honest, never guessed. `compareVectors` computes per-dimension
  satisfaction `min(1, offered/required)` (required 0 -> 1), the
  arithmetic mean, deficits/satisfied lists, and the worst dimension
  (canonical-order tie-break). `diffRequirementVectors` compares two
  profiles. Pure functions; no ML.
- `WorkloadConstraints` — the checkable, discrete requirements:
  application set/versions (dotted-numeric comparison that fails CLOSED
  on malformed versions), environments where lawful, peripherals, and
  the security classification ceiling (strict `CLASSIFICATION_ORDER`).
  `checkConstraints` returns pass/fail with machine-stable failure kinds
  in fixed check order. `assessFit` combines vector + constraints into
  the `FitAssessment` — a perfect soft score never rescues a failed hard
  gate.

### Observations module-map edge (`src/observed-factors.ts`)

`workloads -> devices, observations, audit` is honored with real code:
`deriveObservedFactors` maps canonical `device.workload` observations
(the FROZEN `@fleetos/contracts` `Observation` shape) to typed factor
samples (direct ratio reads confidence 1.0; anchor-normalized
quantities 0.9 — the W021 convention), with forward-compatible skip
reasons (unknown_kind / bad_payload / outside_window /
field_out_of_range — never errors). `aggregateObservedFactors` folds a
NEAREST-RANK p90 per dimension (always an observed sample). The window
is `(asOf - windowMs, asOf]` — inclusive end, injected anchor.

### D3 — Versioned recommendation contracts (`src/recommendations.ts`)

`WorkloadRecommendation` — a PROPOSAL (never automatic): kind
device-class (advisory standardization) or procurement (the candidate
declares `procurementRequired`), derived deterministically from the
profile's requirement vector against INJECTED candidates. Ranking:
satisfaction desc, candidateId asc — candidate input order never
matters (proven by permutation tests). Records carry the FitAssessment
(per-dimension evidence), confidence `min(0.99, satisfaction x profile
vector confidence)`, evidence links from the profile revision, a
deterministic rationale template, and DRAFT `WorkloadIntentProposal`s:
ProcurementIntent (payload: workloadId + description) and
SoftwareSubscriptionIntent (payload: softwareId + seatCount 1, for
required applications the candidate lists subscriptionRequired) —
payload shapes ONLY from the frozen contracts: no intent id, no
lifecycle, no dispatch (asserted by test: the serialized record contains
neither `intentId` nor `status`). The append-only per-workload
`WorkloadRecommendationLedger`: supersession via NEW records
(`supersedes`), dismissal entries, duplicate/scope guards, and the
derived ACTIVE view (`resolveActiveRecommendations`). Unsatisfiable
candidates are reported as `CandidateRejection` evidence (machine
failure kinds) for later waves (W032 procurement matching).

### D4 — Audit + tenancy (`src/audit-seam.ts`, `src/store.ts`)

- Audit: the injected `WorkloadAuditSink` seam (W012's pattern —
  structurally identical to W011's device-model seam and W021's health
  seam). `@fleetos/audit`'s `createAuditSinkAdapter(log, { source })`
  satisfies `WorkloadAuditSink` with ZERO glue (proven by test: the
  adapter is assigned to the seam type and the records land in the
  tenant-scoped, hash-chained, append-only `AuditLog`; the chain
  verifies). Emission for consequential events only: profile
  created/revised (service boundary), recommendation proposed (engine),
  recommendation dismissed (ledger op). Pure reads never audit; failed
  mutations never audit (the frozen error taxonomy carries its own
  trace).
- Tenancy: the `WorkloadProfileStore` takes W012's `TenantContext` as
  the FIRST parameter of every operation, partitions storage per tenant,
  and exposes NO API that names another tenant — cross-tenant reads are
  impossible by construction. The runtime guards
  (`requireTenantContext`) reject context-free and invalid-tenant access
  even when the type system is bypassed (proven by test with
  `undefined as never`). A foreign workload id is INDISTINGUISHABLE from
  an unknown one (`workload_unknown` for both — no existence side
  channel). W012's reusable `runTenantIsolationSuite` runs against the
  store's raw KV view over the SAME partitions (all seven checks pass),
  complemented by exhaustive rich-operation isolation tests (latest +
  specific-revision reads, listing, sizing, revision appends,
  same-key partitioning, duplicate handling).

### D5 — Tests + docs

Contract conformance via `@fleetos/contracts/testing` fixture builders:
`makeTenantId`, `makeTimestamp`, `makeCorrelationId`, `makeDeviceId`,
`makeObservationBatch`, `makeIntent`, `makeAllIntents`,
`FIXTURE_TIME_ANCHOR` (frozen helpers exercised: `asWorkloadId`,
`validateTenantRef`, `isValidTenantId`, `assertVersion`, `makeVersioned`,
`toApiError`, the intent-kind constants). Determinism: byte-identical
full-pipeline runs (observation -> factors -> vector -> profile ->
store -> service -> recommendation -> ledger -> audit), input-permutation
invariance (observations and candidates), audit-vs-no-audit domain-output
equality. Revision immutability: byte snapshots of stored revisions
survive later revisions; content hashes unique per revision. Tenant
isolation: the W012 harness + exhaustive store checks. Audit emission on
every consequential mutation (counts, actions, traceability fields,
details payloads).

### Judgment calls

- **The devices module-map edge is satisfied via the frozen contracts,
  not @fleetos/device-model**: the work order names identity/audit/
  device-model as depend-via-workspace-import dependencies, but the
  ownership gate (hard constraint: `bun run check` stays green) forbids
  cross-lane imports — device-model is worker-b's lane. The devices and
  observations edges are therefore honored through the frozen
  `@fleetos/contracts` shapes (`DeviceId`, `Observation`,
  `ObservationKind`) and the `device.workload` factor derivation; no
  DeviceTwin import occurs (health could import device-model only
  because it is same-lane with it).
- **@fleetos/audit is a TEST-scope dependency only**: the audit seam is
  structural (W011/W021 pattern); src/ never imports the audit package.
  The package.json dependency exists so bun resolves the import in the
  test that PROVES the structural compatibility with W012's sink
  adapter. Same-lane, so no gate concern either way.
- **The isolation-harness view is a raw storage projection**:
  `tenantScopedView` skips domain validation (the harness requires
  reference-equal read-backs of pre-built profiles, which rebuilding
  would break) but shares the store's REAL per-tenant partitions — the
  harness verifies the actual partitioning, not a copy. `remove` exists
  only on this storage-level view; the domain API has no removal
  (revisions are append-only).
- **Soft score vs hard gate separation**: unspecified raw factors
  normalize to 0 (no observed demand) and lower confidence — they never
  silently become hard requirements; hard guarantees live ONLY in
  `WorkloadConstraints`. Security classification appears on BOTH sides
  by design: the vector dim (soft, comparable) and the optional
  constraint (hard ceiling) — a profile may set either or both.
- **procurementRequired / subscriptionRequired are injected candidate
  flags**, not inferences: the engine never guesses whether a class
  needs purchasing or an app needs a subscription — the catalog declares
  it (deterministic recommendation functions with injected inputs).
- **Synthetic sentinels**: context-free error projections use W012's
  canonical `tnt_system` / `cor_system` (imported from @fleetos/identity
  — one definition per lane); a provided correlation id is always
  preserved over the sentinel.
- **bun.lock committed**: adding the workspace deps to the workloads
  package.json updates the lockfile (the accepted W012/W021 pattern).
- **The repo's minimal `types/bun-test.d.ts` shim** (tech-lead owned)
  supports only a subset of matchers; the test suite sticks to
  `toBe`/`toEqual`/`toContain`/`toHaveLength`/`toThrow` with boolean
  pre-computation for ordering/closeness assertions (the accepted
  packages' convention).

### Known limitations

- The in-memory store/ledger are reference seams; durable persistence
  (PostgreSQL per ARCHITECTURE.md § Storage) is the infrastructure wave.
- The anchor tables are globally frozen defaults; tenant-specific
  normalization anchors would be a versioned model change
  (REQUIREMENT_VECTOR_VERSION 2).
- Aggregation is p90 per dimension; time-weighted or per-role weighting
  belongs to the learning wave (W050B Arena).
- The recommendation engine ranks by satisfaction only; cost/budget
  ranking dimensions belong to procurement matching (W032), which also
  owns demand aggregation and quote flows.
- seatCount is fixed at 1 per proposed SoftwareSubscriptionIntent draft
  (one seat for the workload's principal); fleet-level seat pooling is
  W032's aggregation concern.

## W031 — Lane B: Security Doctor + Contract Guardian

Implemented by W031 (worker-b) on branch `work/w031`, base
`integration/wave0` @ `d47780d` (the W022 acceptance commit).
Deliverables D1-D5 landed in TWO packages (both frozen lane B paths):
`@fleetos/security` (`packages/security/`) and `@fleetos/policy`
(`packages/policy/`). Test suite: 131 new tests across 14 files (81
policy + 50 security); full suite after W031: 822 pass, 0 fail (691
baseline + 131 new). All gates green (`bun run check` — architecture +
ownership + skeleton + contracts snapshot 150 exports unchanged; `bun
run typecheck`; `bun test`, byte-stable across repeated runs).

### D1 — SecurityPosture domain model (`packages/security/src/posture.ts`, `src/findings-ledger.ts`)

Posture derived deterministically from the FROZEN canonical observation
shapes (`Observation` from `@fleetos/contracts`, kind `device.security`,
payload schema version 1): an ORDERED 9-rule library (disk encryption,
screen lock disabled / excessive delay, firewall, endpoint protection
disabled / outdated, OS unsupported, critical updates pending, active
malware) maps recognized payload facts to findings with severity
(CRITICAL/HIGH/MEDIUM/LOW) + classification
(compliance/configuration/exposure/threat). Multiple observations
supporting the same rule merge into ONE finding (evidence sorted by
observation id); `assessSecurityPosture` derives the posture status
(most severe finding wins; LOW alone stays HEALTHY in model v1) plus
per-severity counts, output sorted (severity rank desc, code asc)
regardless of observation input order. Forward compatibility is
machine-stable skips: `kind_not_security`,
`payload_version_unsupported` (schemaVersion !== 1 — never
misinterpreted), `payload_unrecognized` (no recognized key; unknown
EXTRA keys alongside recognized ones are tolerated),
`payload_invalid` (recognized key, wrong value type). Findings are
VERSIONED interpretations with deterministic ids: `findingId` =
digest(tenant, device, code) stable across re-assessments; `recordId`
adds the interpretation version; `supersedes` links the prior record
(stamped from injected history — W021's pattern). The findings LEDGER
is append-only per (tenant, device): version-out-of-sequence appends
rejected, dismissal appends entries (the record stays in history), the
ACTIVE view is derived (latest version per identity minus
latest-entry-dismissed; a re-derived finding re-activates at v+1 —
observable evidence wins). Remediation: DRAFT
`SecurityRemediationIntent` payloads (the intent kind OWNED by
`@fleetos/security` per the frozen contracts) on CRITICAL/HIGH findings
only — payload shapes only; asserted by test that the serialized
proposal carries neither `intentId` nor `status`.

### D2 — Guardian rule model (`packages/policy/src/rule-model.ts`)

Typed rule inputs covering the spec's ten inputs verbatim: principal,
device (incl. a posture summary input), workload, data classification,
contract/obligation, destination, network, printer, time, geography,
action (time and geography as separate facets, jointly documented as
the spec's "time/geography" input). EVERY facet is an observable fact
(roles, platforms, zones, classifications, approved-printer flags,
instants, country codes, action kinds) — there is NO intent input
anywhere in the model (ARCHITECTURE-LOCK item 11). Conditions are a
discriminated union (11 kinds + `allOf` conjunction) over uniform
`StringSetMatcher`s (`in` / `notIn`); absent facet values satisfy
`notIn` (fail-closed: "only these zones may..." fires when unknown) and
fail `in`; the absent data classification matches the `UNCLASSIFIED`
sentinel; obligation requirements (`missingAnyObligations`) fire when
the contract facet is absent. Rules: deterministic ids —
digest(tenantId, name), stable across revisions; version 1 at
definition, +1 per `reviseGuardianRule` (new frozen record, identity
immutable); content digest over (name, condition, effect, enabled).
Rule sets: versioned, compiled with member rules SORTED by ruleId —
byte-identical rule sets from any input order — with duplicate-rule-id
and cross-tenant-member rejection.

### D3 — Guardian evaluation engine (`packages/policy/src/engine.ts`)

`evaluateGuardianRequest(ruleSet, request, { at, correlationId, ... })`
is PURE (injected clock/inputs — no clock reads, no entropy) and
produces the FROZEN `GuardianDecision` shape from `@fleetos/contracts`
BUILT via the frozen `makeGuardianDecision` constructor (decision types
ALLOW/WARN/REQUIRE_APPROVAL/BLOCK reused, never re-declared; asserted by
test that the decision carries exactly the frozen shape's keys and is
byte-identical to a fixture decision built from the same inputs).
Blocking precedence BLOCK > REQUIRE_APPROVAL > WARN > ALLOW is DATA
(`DECISION_PRECEDENCE_RANK`), resolved deterministically — exhaustive
pairwise coverage (all 6 ordered pairs + all-four-together across input
permutations). No rule fired -> ALLOW with empty rules +
`policy.no_rule_matched`. Machine-stable reasons
(`policy.rule.matched` with ruleId/ruleVersion/conditionKind/effect,
`policy.precedence.resolved` with the chosen effect). Observable-
evidence links: the request's `EvidenceRef` artifacts pass through into
the decision untouched (never interpreted). Time conditions evaluate
against the effective instant (request `time.at` ?? injected `at`, both
caller-injected). The full `GuardianEvaluation` carries the decision +
rule-set id/version (the "policy version" of the spec's decision
recording) + matched rules + reasons.

### D4 — Audit + tenancy (`src/audit-seam.ts`, `src/rule-store.ts`, `src/findings-ledger.ts`)

- Audit: the injected `PolicyAuditSink` / `SecurityAuditSink` seams
  (W011/W021/W022's pattern — structurally identical record shape).
  `@fleetos/audit`'s `createAuditSinkAdapter(log, { source })` satisfies
  BOTH seams with ZERO glue (proven by test: the adapter is assigned to
  each seam type; emissions land in the tenant-scoped hash-chained
  AuditLog; the chain verifies; per-tenant chains stay separate).
  Emission for consequential events ONLY: Guardian decisions that are
  BLOCK or REQUIRE_APPROVAL (the types that hold/refuse an action —
  WARN/ALLOW never audit), rule-set version publication (an
  authorization-posture mutation), and every posture-finding mutation
  (recorded / superseded / dismissed). Pure derivations and failed
  mutations never audit (the frozen error taxonomy carries its own
  trace).
- Tenancy: tenant isolation BY CONSTRUCTION in both stores. The acting
  `PolicyTenantScope` / `SecurityTenantScope` (`{ tenantId,
  correlationId? }` — structurally identical to identity's
  TenantContext, declared locally because the ownership gate forbids
  importing `@fleetos/identity` from lane B) is the FIRST parameter of
  every operation; the runtime guards reject context-free, invalid-
  grammar, and cross-tenant access even when the types are bypassed
  (`undefined as never` — proven by test); storage is partitioned per
  tenant (rule sets by tenant; findings by tenant then device) and NO
  operation accepts a tenant override. Foreign rule-set versions and
  finding ids are INDISTINGUISHABLE from unknown ones (no existence
  side channel). Evaluation rejects a request whose tenant differs
  from the rule set's tenant (tagged `tenant_mismatch` error, never a
  wrong-tenant decision) — exhaustive pairing over all four effects.

### D5 — Tests + docs

Contract conformance via `@fleetos/contracts/testing` fixture builders:
`makeGuardianDecision`, `makeAllGuardianDecisions` (all four types,
frozen shape keys, RuleRef shape), `makeObservationBatch` (frozen batch
invariants + forward-compatible skips over fixture payloads),
`makeIntent` (SecurityRemediationIntent determinism + payload-shape
conformance of the drafts), `makeTenantId`, `makeDeviceId`,
`makeObservationId`, `makeTimestamp`, `makePolicyId`,
`FIXTURE_TIME_ANCHOR`, `TESTING_MODULE_NAME`. Byte-identical
determinism across runs and input permutations (rules, observations,
audit on/off — domain output never changes). Blocking-precedence
coverage (exhaustive pairwise). Finding-ledger immutability (v1 bytes
untouched after supersession; frozen records; version discipline).
Tenant isolation (exhaustive, incl. types-bypassed). End-to-end:
observations -> posture -> policy-typed device facet -> Guardian
REQUIRE_APPROVAL (the module-map integration).

### Judgment calls

- **@fleetos/audit is a TEST-scope dependency of both packages** (the
  work order's "depend on them via workspace:* imports only" clause):
  src/ NEVER imports it — the ownership gate scans src/ only and stays
  green — the dependency exists so the tests PROVE the seams are
  structurally satisfied by W012's sink adapter (the W022-disclosed
  pattern; the W012 sink-adapter doc explicitly anticipates lane-B
  seams).
- **The security -> policy module-map edge is real code**:
  `packages/security` depends on `@fleetos/policy` (same lane, gate-
  legal) and derives policy-owned `GuardianDevicePosture` rule inputs
  from its posture model (`deriveGuardianDevicePosture`); the devices/
  observations edges are honored via the frozen contracts shapes only
  (per the work order); the audit edge is the injected sink seam.
- **The policy package imports only `@fleetos/contracts`** (module map:
  policy -> organizations/devices/workloads/audit — all four honored
  through frozen shapes: TenantScoped/TenantId, DeviceId, WorkloadId,
  the injected audit seam).
- **`PolicyTenantScope`/`SecurityTenantScope` are local
  structural twins of identity's TenantContext** ({ tenantId,
  correlationId? }): same-lane consumers can pass identity contexts
  directly (structural typing); the guards validate against the frozen
  `validateTenantRef` grammar. One definition per package, mirroring
  the accepted per-package seam pattern.
- **Explicit ALLOW rules exist** (the spec's "permit a manager-approved
  exception" example) but NEVER override stricter firing rules — the
  precedence is total and deterministic; an explicit ALLOW records a
  permissive exception in the decision's rule refs and loses to any
  WARN/REQUIRE_APPROVAL/BLOCK that also fires.
- **Time windows evaluate in UTC** (hour-of-day + day-of-week from the
  injected instant): timezone-aware local windows need a tz database —
  out of scope for a zero-dependency package; a versioned model change
  if ever needed.
- **The device-posture summary is a rule INPUT, not an inference**:
  security derives counts + status deterministically from findings;
  the Guardian evaluates them; neither layer asserts employee intent.
- **bun.lock committed**: adding the workspace deps updates the
  lockfile (the accepted W012/W021/W022 pattern).
- **Test suites stick to the shim-supported matchers**
  (toBe/toEqual/toContain/toHaveLength with boolean pre-computation —
  the accepted packages' convention).

### Known limitations

- The in-memory rule-set store and findings ledger are reference
  seams; durable persistence (PostgreSQL per ARCHITECTURE.md § Storage)
  is the infrastructure wave.
- The v1 posture recognition vocabulary covers the nine rules' payload
  fields; richer agent payloads skip with `payload_unrecognized` until
  a versioned model change (SECURITY_POSTURE_MODEL_VERSION 2).
- The frozen `GuardianDecision` shape carries no expiry field; the
  spec's "expiry/re-evaluation" is realized as re-evaluation (the
  engine is pure; decisions are point-in-time) + the rule-set version
  recorded in the evaluation result. An expiry field would be a frozen
  contracts change (Line-stop territory if required).
- Approval workflows (holding an action until a human approves a
  REQUIRE_APPROVAL decision) belong to W041 Fleet Actions; the Guardian
  only decides.
- LOW findings do not degrade the posture status in model v1
  (documented; counts still surface them).

## W020 — Lane A: endpoint adapter SDK

Implemented by W020 (worker-a) on branch `work/w020`, base
`integration/wave0` @ `ec59328` (the W031 acceptance commit — past the
Wave 1 acceptances; the required W010 runtime-contract artifacts
`packages/device-adapters/src/{checkin,capabilities,observations,commands,policy-cache}.ts`
and `apps/agent/src/runtime.ts` are present, and the W022/W031 lane-B/C
code does not intersect lane A). Deliverables landed in
`packages/device-adapters/src/` (the SDK surface) plus the composition
extension in `apps/agent/src/`:

- `seams.ts`         D2 — the platform seam TYPES for the three desktop
                       families named in ARCHITECTURE.md § Device
                       adapters. Each platform declares a typed command
                       execution channel (Windows: PowerShell; macOS:
                       shell + MDM `profiles` for enforce/update; Linux:
                       shell + package manager for update), typed
                       observation sources (Windows: WMI + event log;
                       macOS: system_profiler + unified log; Linux:
                       procfs + journald) and a capability probe — every
                       typed surface EXTENDS the normalized boundaries
                       (`execute()`, `poll()`, `probe()`) the
                       platform-agnostic adapter routes through.
                       Platform-specific types stay INSIDE this package
                       (the seam is where platform meets the normalized
                       surface by design; they never enter the frozen
                       core contracts).
- `seams-inmemory.ts` D2 — in-memory deterministic REFERENCE
                       implementations of the three seams (fakes; no real
                       OS integration in this lane). Scripted per-
                       capability outcomes (first match wins;
                       unscripted capabilities succeed deterministically),
                       scripted observation records per source, scripted
                       probe result; every invocation is recorded
                       (`calls()` / `reset()`) so tests can prove the SDK
                       never reaches the seam on refusal. Evidence is
                       content-addressed over the canonical JSON of the
                       platform command (FNV-1a — a test hash, never for
                       security). No clock, no entropy: two fakes built
                       with the same options behave identically
                       (byte-for-byte, verified by test).
- `adapter.ts`      D1/D3 — the normalized `EndpointAdapter` contract:
                       ONE platform-agnostic interface with one METHOD
                       per normalized capability (identify, observe,
                       diagnose, enforce, remediate, lock, locate, wipe,
                       reboot, update, health) plus the generic
                       `invoke()` router. Built on the W010 pieces: the
                       capability record (`declareAgentCapabilities`),
                       the observation producer (the adapter owns an
                       `ObservationCollector`; `observe` polls the seam's
                       sources, records, and flushes a valid batch with
                       mid-observe back-pressure flushes and fail-closed
                       malformed-source handling), and the failure mapper
                       (`mapAgentFailure` — seam failures become
                       first-class FleetErrors). D3 enforcement lives
                       INSIDE every method: W010 `negotiateCapability`
                       (frozen `assertSupported` inside) refuses
                       unsupported capabilities and destructive
                       capabilities without an explicit, cache-fresh
                       grant — and the platform seam is NEVER invoked on
                       refusal (verified by exhaustive tests over all 11
                       capabilities × {declared, undeclared} and all 7
                       destructive × {grant, no-grant, stale-cache}).
                       Cross-tenant invocation is refused with an
                       AuthorizationError at the action boundary.
                       Construction throws on programmer error (platform
                       mismatch between descriptor and seams, empty
                       descriptor fields, non-ISO declaredAt). Also:
                       `probeCapabilities` + `reconcileProbedCapabilities`
                       (probe is DISCOVERY; the declared record stays the
                       routing authority — mismatch surfaced for audit).
- `registry.ts`     D4 — the tenant-scoped `AdapterRegistry`.
                       Registration structurally validates the adapter
                       (descriptor fields, platform ∈ {windows, macos,
                       linux}, capability record, invoke function — all
                       failures collected with field paths) and enforces
                       uniqueness (adapterId unique per tenant; one
                       adapter per (tenant, device) endpoint — both
                       ConflictError). Lookup by adapterId / device /
                       platform, listing in registration order. Tenant
                       isolation is STRUCTURAL: per-tenant nested-map
                       namespaces (no composite keys, so even ids
                       containing separators cannot cross tenants);
                       foreign lookups are indistinguishable from
                       unknown (verified by test, including
                       unregister).
- `dispatch.ts`     D4 — the capability-aware command dispatcher
                       composing the W010 tracker + the registry + the
                       adapter. Pipeline: injected-timestamp sanity ->
                       frozen `validateCommand` (malformed inputs never
                       reach admission; mirrors the tracker's own
                       refusal) -> command-type -> capability mapping
                       (`device.command.<capability>`, the frozen
                       contracts `<module>.<subject>.<verb>` convention;
                       unknown types are born-rejected as unroutable) ->
                       adapter resolution (explicit adapterId, then
                       device, then singleton fallback; zero/ambiguous
                       registrations are refusals) -> PRE-negotiation
                       with the resolved adapter's declared capabilities
                       (born-rejected receipts: the tracker's
                       rejectReason vocabulary "unsupported" /
                       "unauthorized" is used, and the seam is never
                       invoked) -> idempotent admission (W010
                       `acknowledge`: a replay returns the ORIGINAL
                       receipt and result and is NEVER re-executed —
                       idempotency wins over a later capability/grant
                       change, verified by test; a different command
                       under the same key is a ConflictError) ->
                       capability-aware execution through
                       `adapter.invoke` (which re-enforces the same
                       negotiation — defense in depth over the frozen
                       `assertSupported`) -> status lifecycle transitions
                       (accepted -> executing -> succeeded | failed; or
                       born-rejected) -> result envelope with FleetError
                       mapping. A replayed command without a terminal
                       result fails SAFE (incomplete; never re-executed).

`apps/agent/src/runtime.ts` extends the W010 composition: the
`AgentRuntime` now owns an `AdapterRegistry` (construction-time
`options.adapters`, registered with validation — a failure throws) and
exposes `dispatchCommand(command, inputs)` delegating to the dispatcher
wired to the runtime's OWN receipt tracker. Runtime-injected defaults:
target device = the runtime's identity device; policy-cache readiness =
derived from the runtime's own local signed-policy cache at `executedAt`
(fresh + signature-verified => ready; anything else => destructive
default-deny — a fresh `SignedPolicyDocument` put flips it, verified by
test); policy grant = false unless passed (fail-closed). All additions
are optional/backward-compatible: the W010 runtime tests pass unchanged.

### Test suite

154 new tests across 6 files:
- `packages/device-adapters/test/seams.test.ts` — 19 tests (routing to
  platform-typed methods, scripted outcomes, sources/probe, recording,
  determinism)
- `packages/device-adapters/test/adapter.test.ts` — 76 tests
  (construction, the exhaustive refusal matrix — 11 capabilities ×
  declared/undeclared, 7 destructive × grant matrix, 4 non-destructive
  no-grant, unknown capability, tenant mismatch, FleetError mapping,
  observe/collector behavior incl. back-pressure + fail-closed, probe
  helpers, cross-platform parity)
- `packages/device-adapters/test/registry.test.ts` — 13 tests
  (registration, conflicts, structural validation, tenant isolation,
  unregister)
- `packages/device-adapters/test/dispatch.test.ts` — 24 tests (mapping
  round trip, happy path + lifecycle, idempotent replay + refused-replay
  + conflict, born-rejected refusals, resolution fallbacks, malformed
  inputs, execution failures, exhaustive 11-type dispatch)
- `packages/device-adapters/test/adapter-conformance.test.ts` — 11
  tests (contract conformance via @fleetos/contracts/testing fixtures)
- `apps/agent/test/dispatch.test.ts` — 11 tests (runtime composition:
  registry, defaults, derived policy-cache readiness, replay,
  shared-tracker semantics)

Full suite after W020: 976 pass, 0 fail (822 baseline + 154 new).

### Binding protocol

Unchanged from W010: `packages/device-adapters/package.json` declares
`"@fleetos/contracts": "workspace:*"`; `apps/agent/package.json`
declares both `@fleetos/contracts` and `@fleetos/device-adapters`
(same lane). No relative imports cross a package boundary (ownership
gate green).

### Judgment calls

- **Command-type mapping is lane-local**: the frozen contracts
  `CommandType` is an open namespaced-string convention
  (`<module>.<subject>.<verb>`); the frozen testing fixture's default
  `device.command.lock` is the precedent. The SDK defines the
  `device.command.<capability>` table for the eleven normalized
  capabilities in `dispatch.ts` (`CAPABILITY_COMMAND_TYPES`) — a
  lane-local mapping over the frozen convention, NOT a contracts
  change. Unknown types are born-rejected (routable = mapped).
- **Born-rejected vs accepted-then-rejected**: pre-negotiation and
  adapter-resolution refusals happen BEFORE admission, so the receipt is
  born-rejected through the tracker's `rejectReason` vocabulary
  ("unsupported" for unroutable/unmapped/no-adapter/undeclared,
  "unauthorized" for destructive grant failures). Adapter-side
  negotiation refusals that occur AFTER admission (unreachable via the
  dispatcher — same inputs, same frozen logic — but reachable calling
  `adapter.invoke` directly) would transition accepted -> rejected. The
  receipt vocabulary is the W010 tracker's; no new statuses.
- **No-adapter refusals are "unsupported"-flavored**: the tracker's
  rejectReason vocabulary is only
  malformed/unauthorized/unsupported; "no adapter for this device" is
  recorded as receipt reason "unsupported" while the RESULT carries the
  precise AdapterError (`agent.adapter.not_found`). The result is the
  audit-grade record; the receipt reason is coarse by W010 design.
- **Idempotency beats capability state**: a redelivery of an already
  terminal command replays the ORIGINAL result even if the adapter's
  capabilities or the grant state changed in between (the
  duplicate-suppression contract). Verified by test (refused-then-
  regranted wipe still replays the rejection; the seam is never
  invoked).
- **Declared capabilities are authoritative over the probe**: the seam
  probe is discovery (for manifests/check-in/audit). A declared-but-
  not-probed capability still routes (the declaration is the explicit
  support contract per ARCHITECTURE.md); `reconcileProbedCapabilities`
  surfaces the mismatch (`declaredOnly`) for audit. A real platform
  failure then surfaces at execution as a FleetError.
- **Observe is passive**: the observe operation polls the seam's
  observation sources and NEVER executes a platform command (the
  normalized `poll()` boundary). The other ten capabilities route
  through the seam's `execute()`.
- **The macOS/Linux channel routing differentiates the platforms**:
  macOS routes enforce/update through MDM `profiles` (the managed-
  preferences tool) and everything else through shell; Linux routes
  update through the distribution package manager and everything else
  through shell. This makes the typed boundaries genuinely platform-
  specific while the adapter stays platform-agnostic.
- **Seam evidence hashes are FNV-1a (test hash)**: the in-memory
  reference seams derive `EvidenceRef` values with FNV-1a over the
  canonical JSON of the platform command and label the algorithm
  explicitly ("fnv1a32"). A production seam hashes with sha256; the
  contracts `EvidenceRef.hashAlgorithm` field carries the name so this
  stays honest.
- **Runtime policy-cache readiness is derived, not caller-asserted**:
  `AgentRuntime.dispatchCommand` computes `policyCacheReady` from its
  OWN signed-policy cache at `executedAt` unless the caller overrides
  it — a real composition of the W010 cache with the W020 dispatch
  (an empty/stale cache default-denies destructive capabilities even
  WITH a grant; a fresh signed document unlocks them).
- **Registry namespaces are per-tenant nested maps**: no composite
  string keys — tenant ids are opaque branded strings, so composite
  keys could theoretically collide across tenants if ids contained
  separators. Nested maps make the isolation structural.
- **No new contract changes**: the lane does NOT modify
  `packages/contracts/**` (frozen, snapshot-gated). The 150-export
  snapshot is unchanged (verified by `tools/check-contracts.mjs`).

### Known limitations

- No real OS integration: the seam reference implementations are
  in-memory fakes. A production Windows/macOS/Linux integration
  (PowerShell/WMI, profiles/system_profiler, package managers/procfs)
  is a later infrastructure wave; the typed seam interfaces are the
  contract it implements.
- The dispatcher is synchronous: the seam execution surface returns a
  terminal result per invocation. Long-running platform operations
  (update, wipe) need an async/deferred execution model in a later
  wave; the receipt lifecycle already carries the executing status for
  it.
- `AdapterId` is a plain string (registry-local identifier, not a
  cross-lane branded contract id). The registry enforces uniqueness
  per tenant; global uniqueness across tenants is not claimed.
- The capability probe is a point-in-time snapshot; the SDK does not
  re-probe automatically (the runtime may call `probeCapabilities` at
  check-in/manifest time).
- W030 scope (mobile + printer/copier adapter contracts) is NOT
  started; `AdapterPlatform` is deliberately the three desktop
  platforms. Recovery/adcos/web-device paths (lane A's later items)
  are NOT started.
---

## W032 — Lane C: procurement / vendor / software exchange

Work item W032 (lane C, worker-c) implements the FleetOS procurement /
vendor / software exchange per `spec/ARCHITECTURE.md` § Procurement/
service exchange and `spec/procurement/PROCUREMENT-EXCHANGE.md`. Three
packages: `@fleetos/vendors` (D1), `@fleetos/procurement` (D2/D3),
`@fleetos/software` (D4). Audit + tenancy (D5) span all three.

### D1 — Vendor model (`packages/vendors/src/vendor.ts`)

The Vendor domain model: vendor identity (tenant-scoped — the tenant
approves vendors), capability declarations (typed `VendorCapability`
with open-union `VendorCapabilityKind` for forward compatibility —
unknown kinds are NOT errors), inventory signals
(`VendorInventorySignal` with `InventoryAvailability` ratio in [0, 1]
+ `DaysDuration` lead time), and quality/SLA/warranty terms
(`VendorTerms` carrying `QualityScore`, `SlaCoverage`, `DaysDuration`
warranty — all typed comparable values). Versioned vendor records
(append-only revisions: `buildVendor` writes revision 1; `reviseVendor`
appends revision+1 with a fresh deterministic content hash; the prior
revision is never rewritten — `spec/ARCHITECTURE-LOCK.md` item 3
discipline).

### D2 — Demand + matching (`packages/procurement/src/demand.ts`, `matching.ts`, `demand-store.ts`)

`ProcurementDemand` consumes W022's WorkloadRecommendation DRAFT
`ProcurementIntentPayload` (the frozen shape from `@fleetos/contracts`):
the demand carries the workload linkage (`workloadId` from the payload,
optional), the requirement description (`description` from the payload,
required), the demand quantity, the customer deadline, the delivery
area, the budget cap (USD), and the SLA / warranty / quality /
availability floors. The W022 `CandidateRejection` evidence is
carried as `DemandRejectionEvidence` (machine-stable, advisory input
— the matcher down-ranks vendors whose matched capability appears in
the evidence, never silently dropped).

`matchDemand` is a PURE FUNCTION: given a demand + a list of vendor
records (INJECTED inputs), produces a deterministic ranked list of
`VendorMatch` records with machine-stable match reasons. Hard gates
(fail-closed): region (vendor regions include the delivery area),
capability (vendor declares at least one capability matching the
demand's allowed substitutions, or any capability when the demand is
unscoped), quantity (vendor availability ratio > 0), deadline (vendor
lead time <= demand deadline days from `at`), availability floor, SLA
floor, warranty floor, quality floor. Rank score (only satisfiable
candidates get a positive score): baseline 0.5 + 0.2 * quality headroom
+ 0.15 * SLA headroom + 0.1 * normalized warranty bonus + 0.05 *
availability headroom - 0.2 * substitution down-rank - 0.3 *
rejected_by_evidence down-rank. Clamped to [0, 1]; unsatisfiable
candidates get 0. Ranking is by rankScore desc, vendorId asc — input
order invariant. The matcher emits one
`procurement.match.found` audit record per satisfiable match (the
matching trail).

### D3 — Quotes + acceptance + aggregation (`packages/procurement/src/quotes.ts`)

Versioned Quote contracts (append-only ledger with supersession —
versioned-interpretation discipline per `spec/ARCHITECTURE-LOCK.md`
item 3). `issueQuote` produces revision 1 in ISSUED status;
`supersedeQuote` produces revision+1 with `supersedes` pointing at
the prior. The `QuoteLedger` is append-only: `appendQuote`,
`acceptQuote`, and supersession entries are all NEW entries (the
prior is never rewritten). Quote acceptance is PROPOSAL-GATED (never
automatic): `acceptQuote` is the explicit acceptance step; the
acceptance is a one-way ISSUED -> ACCEPTED transition recorded as a
new ledger entry (the quote's own `status` field stays "ISSUED" —
the acceptance entry is the machine-stable record of the
PROPOSAL-GATED transition). Cannot accept an unknown / already-
accepted / rejected quote (tagged DomainErrors). `resolveActiveQuote`
returns the latest non-superseded revision of a (demandId, vendorId)
lineage.

Compatible-order aggregation: `aggregateAcceptedQuotes` groups
accepted (demand, quote) pairs by (vendorId, deliveryArea, deadline)
— the spec's "compatible orders may be aggregated before a customer
deadline". Each `AggregatedOrder` traces to its member demands
(`memberDemandIds` sorted by demandId — deterministic). Individual
customer contracts remain auditable: every aggregated order's audit
record carries the member demand ids.

### D4 — Software subscriptions (`packages/software/src/subscription.ts`, `store.ts`)

`SoftwareSubscription` consumes W022's WorkloadRecommendation DRAFT
`SoftwareSubscriptionIntentPayload` (the frozen shape from
`@fleetos/contracts`): the subscription carries the software id
(`softwareId` from the payload), the seat count (`seatCount` from the
payload), the term in days (default 365), the workload linkage
(optional), and the tenant scope. `allocateSubscription` is the pure
builder; `reviseSubscription` appends revision+1 with `supersedes`
pointing at the prior. The `SubscriptionStore` is tenant-scoped,
in-memory reference; the `SubscriptionService` wraps it with an
injected audit sink (`software.subscription.allocated` /
`software.subscription.revised`).

### D5 — Audit + tenancy + tests + docs

Audit: consequential mutations (vendor created/revised, demand
created, quote issued/accepted/superseded, aggregation formed,
subscription allocated/revised, match found) emit append-only audit
records through an INJECTED sink (W012's pattern — structurally
satisfied by `@fleetos/audit`'s `createAuditSinkAdapter`; proven by
test, no cross-lane wiring in `src/`). Tenant isolation by
construction: a tenant-A context can never read tenant-B
vendors/quotes/demands/subscriptions — every store operation takes
the acting `TenantContext` as its FIRST parameter; the runtime guard
`requireTenantContext` rejects context-free and invalid-tenant access
even when a caller bypasses the types. The W012 reusable isolation
harness (`runTenantIsolationSuite`) runs green over each store's raw
KV view; exhaustive rich-operation isolation checks (foreign ids
indistinguishable from unknown, duplicate detection scoped to the
acting tenant, revision history append-only).

Contract conformance via `@fleetos/contracts/testing` fixture builders
(`makeTenantId`, `makeTimestamp`, `makeCorrelationId`, `makeIntent`,
`makeAllIntents`, `FIXTURE_TIME_ANCHOR`); frozen contracts helpers
exercised (`asVendorId`, `asWorkloadId`, `validateTenantRef`,
`isValidTenantId`, `assertVersion`, `makeVersioned`,
`PROCUREMENT_INTENT_KIND`, `SOFTWARE_SUBSCRIPTION_INTENT_KIND`,
`toApiError`, `TenantScoped`). Byte-identical end-to-end determinism
across runs and input permutations (vendor input order, audit on/off
— domain output never changes). End-to-end: W022 recommendation →
demand → matching → quote → acceptance → aggregation (the W022 → W032
bridge).

129 new tests (40 vendors + 46 procurement + 43 software). Full suite
951 pass 0 fail (822 baseline + 129 new). All gates green on the
branch — snapshot 150 contracts exports unchanged.

### Judgment calls

- **The demand store and the subscription store maintain TWO separate
  per-tenant partition maps** (one for the rich store, keyed by the
  deterministic `demandId` / `subscriptionId`; one for the raw KV
  view, keyed by the harness's caller-supplied key). The
  demandId/subscriptionId is computed deterministically (a
  `dmd_<hash>` / `sub_<hash>` string), so it cannot equal the W012
  isolation harness's fixed "k1"/"k2" keys. Sharing partitions would
  break the harness's reference-equality check. The W022 workloads
  store shares partitions because the workloadId is caller-supplied
  (the test passes the harness's key as the workloadId); for demands
  and subscriptions, the natural primary key is computed, so the
  views must be separate. Documented in the store files.
- **The matching quantity gate uses a soft rule (availability ratio > 0)**:
  the matcher treats vendor inventory availability as "fraction of
  full availability" and the demand's quantity as "number of units";
  the gate fails when availability <= 0 (the vendor can fulfill
  nothing). The actual allocation (how many units a vendor can
  fulfill at a given availability ratio) is the QUOTE step's
  responsibility — the matcher only determines whether the vendor is
  a candidate. A stricter rule (e.g. availability >= demand.quantity
  / MAX_DEMAND_QUANTITY_PER_VENDOR) would require a vendor-capacity
  model that does not exist in the spec; the soft rule is documented
  in `matching.ts`.
- **The quote's `status` field stays "ISSUED" after acceptance**:
  the quote is immutable; the acceptance is a separate ledger entry
  (the machine-stable record of the PROPOSAL-GATED transition).
  `quoteStatus(ledger, quoteId)` resolves ACTIVE / SUPERSEDED /
  ISSUED / ACCEPTED / REJECTED by walking the ledger, not by reading
  the quote's own `status` field. The `acceptQuote` check for
  already-accepted looks for an existing acceptance entry in the
  ledger.
- **The aggregation's `totalQuantity` is derived from the quotes'**
  `totalPriceUsd / unitPriceUsd` (the demand's quantity preserved
  across revisions). This is a documented computation; the spec's
  "individual customer contracts remain auditable" is satisfied by
  the `memberDemandIds` field carrying every aggregated order's
  member demand ids.
- **The demand + subscription consume W022 DRAFT payloads only** (no
  intent id, no lifecycle) — the spec's "FleetOS is the demand-side
  orchestrator" boundary. Creating, authorizing, or executing a
  Fleet Intent belongs to the intent owners and the deterministic
  policy layer (W031's Contract Guardian boundary) — never to this
  engine.
- **`@fleetos/audit` is a TEST-scope dependency of all three packages**
  (the work order's "depend on them via workspace:* imports only"
  clause): src/ NEVER imports it — the ownership gate scans src/ only
  and stays green — the dependency exists so the tests PROVE the seams
  are structurally satisfied by W012's sink adapter (the W022-disclosed
  pattern).
- **`@fleetos/vendors` is a same-lane runtime dependency of
  `@fleetos/procurement`** (the matcher consumes the `Vendor` type).
  `@fleetos/workloads` is declared as a runtime dependency of both
  `@fleetos/procurement` and `@fleetos/software` for the test-suite
  bridge (a real W022 WorkloadRecommendation run produces the draft
  payloads + rejection evidence that these packages consume); src/
  never imports it. The ownership gate scans src/ only — green.
- **`@fleetos/identity`'s TenantContext is the same-lane import** for
  all three packages (W012's pattern). Local structural twins are
  NOT introduced (the work order's workspace-binding protocol rules
  permit same-lane imports; the workloads package established the
  pattern).
- **bun.lock committed**: adding the workspace deps updates the
  lockfile (the accepted W012/W021/W022/W031 pattern).
- **Test suites stick to the shim-supported matchers**
  (toBe/toEqual/toContain/toHaveLength with boolean pre-computation —
  the accepted packages' convention; `toBeGreaterThan` is NOT in the
  shim, replaced with `(<value> > 0)` pre-computed to a boolean).

### Known limitations

- The in-memory vendor / demand / subscription stores and the quote
  ledger are reference seams; durable persistence (PostgreSQL per
  ARCHITECTURE.md § Storage) is the infrastructure wave.
- The matching engine v1 covers the spec's ten dimensions
  (workload, quantity, deadline, location, substitutions, budget,
  warranty, SLA, vendor quality, inventory); budget is matched at
  the QUOTE step (D3) — the matcher carries the budget cap as
  advisory input only. A richer vendor-capacity model (e.g.
  per-capacity allocation) would be a versioned model change
  (MATCH_MODEL_VERSION 2).
- The aggregation's deadline-window grouping uses the demand's
  `deadline` (per spec — compatible orders share the same customer
  deadline). A "deadline window" (e.g. demands due within the same
  week, not the same instant) would be a versioned model change
  (AGGREGATION_MODEL_VERSION 2).
- The vendor quality score is an INJECTED typed value (the spec's
  "vendor outcomes" derivation rule belongs to a later learning
  wave — W06x Arena). The matcher consumes the score as-is.
- Approval workflows (holding a quote acceptance until a human
  approves) belong to W041 Fleet Actions; this package only records
  the acceptance.
- The procurement -> maintenance module-map edge is honored via the
  frozen contracts shapes only (the maintenance package is worker-c
  but W042 — not started; the work order forbids the import).

## W041 — Lane B: Fleet Actions + Print orchestration

Implemented by W041 (worker-b) on branch `work/w041`, base
`integration/wave0` @ `db3c2fe` (the W032 acceptance commit — past the
Wave 2 acceptances; the required W031 Contract Guardian artifacts
`packages/policy/src/{rule-model,engine,rule-store,audit-seam}.ts` are
present, and the W030/W032 lane-A/C code does not intersect lane B).
Deliverables D1-D5 landed in ONE package: `@fleetos/actions`
(`packages/actions/`). Test suite: 79 new tests across 6 files; full
suite after W041: 1184 pass, 0 fail (1105 baseline + 79 new). All gates
green (`bun run check` — architecture + ownership + skeleton +
contracts snapshot 150 exports unchanged; `bun run typecheck`; `bun
test`, byte-stable across repeated runs).

### D1 — FleetAction domain model (`src/device-descriptor.ts`, `src/fleet-action.ts`)

The minimal device descriptor carries the FROZEN contracts shapes only
(tenantId, deviceId, lifecycleState, adapterCapabilities, platform,
ownership) — the actions -> devices module-map edge is honored via the
frozen contracts shapes only (the work order's "depend on them via
workspace:* imports only" clause). The local `DeviceRegistryView`
interface is structurally compatible with `@fleetos/device-model`'s
`TwinStore` (W011, same lane B) at the binding site — the consumer
projects a TwinStore onto this view at the call site without a
src-import of `@fleetos/device-model`. The view is INJECTED (never
constructed inside the actions package): a test injects an in-memory
view with deterministic descriptors; production injects a real registry
adapter. `list(tenantId)` returns descriptors sorted by deviceId for
deterministic iteration (byte-stable target resolution).

Typed device-group selectors (PURE values, no I/O): a discriminated
union of 10 kinds — `all` (the universal selector), `byId` (explicit
device id list — closed set; resolved as the intersection with the
registry — foreign ids are filtered out, never raising an existence
side channel), `byPlatform`, `byOwnership`, `byLifecycleState` (frozen
contracts), `byCapability` (devices whose declared adapter capabilities
explicitly support the named capability — uses the frozen `isSupported`
helper directly, never re-declared), `byPostureSummary` (queries a
forward-compatible extension field on the descriptor; the frozen
descriptor does not include `postureSummary` — the binding site may
attach it via a structural supertype; fail-closed when posture is
unknown), and set algebra `intersect` / `union` / `subtract` over
sub-selectors. Selectors compose; resolution is deterministic — the
same selector + the same registry produce the same device set,
byte-for-byte, every run. Resolved target sets are sorted by deviceId
for stable ordering.

Action plan templates: versioned, immutable PROPOSAL — `planId` =
digest(tenantId, name) stable across revisions; `version` >= 1;
`selector` (the device-group selector the targets were resolved from);
`capability` (the intended capability invocation per target — must be
one of the frozen `AdapterCapabilities` keys; destructive capabilities
carry an explicit grant requirement at the policy-gate boundary);
`selectedTargets` (the resolved device set, frozen at creation time —
the plan captures the device set the proposal was based on; re-
resolution after registry changes is a new revision with a new content
digest — versioned-interpretation discipline); `targetCount` (mirrors
`selectedTargets.length` — also surfaced in the frozen
`FleetActionIntentPayload`); `status: PROPOSAL` at creation (always —
until the Guardian evaluates); `createdAt` (injected timestamp);
`evidence` (observable artifacts, never interpreted); `contentDigest`
(canonical digest of selector + capability + selectedTargets + status).

The plan transition table: PROPOSAL -> ADVANCED | PARKED | REJECTED
(via the Guardian decision); PARKED -> APPROVED | REJECTED (via the
human-approval step); ADVANCED / APPROVED / REJECTED are terminal from
the policy-gate perspective (execution belongs to later waves — W060B
/ device-adapters, not this package).

### D2 — Policy-gated execution flow (`src/policy-gate.ts`)

`submitActionPlan(plan, { ruleSet, request, at, correlationId })`
delegates to `@fleetos/policy`'s `evaluateGuardianRequest` (same lane
B; the W031 Guardian is the AUTHORITATIVE policy layer — the actions
package is the bridge that translates a Guardian decision into a plan
transition + an audit emission). The decision-to-status mapping is the
frozen Guardian's semantics: ALLOW -> ADVANCED; WARN -> ADVANCED (non-
blocking per the frozen `isBlockingDecision` helper — warnings are
recorded but do not hold the action; the audit carries the warning
context); REQUIRE_APPROVAL -> PARKED (held for human approval); BLOCK
-> REJECTED (refused with the Guardian's machine-stable reasons). The
proposal-gated boundary is enforced: submitting a plan that is not in
PROPOSAL status is rejected with a tagged DomainError
(`status_not_proposal`). NEVER auto-execute.

The parked-plan approval step (`approveParkedPlan(plan, "approve" |
"reject", { at, correlationId, approverId })`) lives HERE — the W031-
deferred-to-W041 note in the SKELETON-NOTES: "Approval workflows
(holding an action until a human approves a REQUIRE_APPROVAL decision)
belong to W041 Fleet Actions; the Guardian only decides." The
transition is PARKED -> APPROVED (the human-approval step) or PARKED
-> REJECTED (the human-rejection step); the audit carries the
approving principal's id.

Tenant isolation by rejection: the plan's tenant MUST match the rule
set's tenant AND the request's tenant — a tenant-A plan can never be
evaluated against tenant-B rules (rejected with a tagged
`tenant_mismatch` error, never a wrong-tenant decision). The Guardian
engine itself rejects request/rule-set tenant mismatches; the actions
lane is fail-closed at the action boundary.

Audit: consequential transitions (ADVANCED / PARKED / REJECTED) emit
`action.plan.submitted` to the injected sink; approvals emit
`action.plan.approved`. Pure reads and failed submissions never audit.

### D3 — Print orchestration (`src/print-orchestration.ts`)

Print job requests as versioned records built on top of the FROZEN
`PrintIntentPayload` (documentRef + targetUserId — embedded verbatim,
never modified). The job's `requiredFeatures` is the printer-capability
subset the document demands (color, duplex, staple, ...). The router
filters the supporting printers: the tenant MUST match (foreign-tenant
printers are filtered out — no side channel) AND the printer's declared
capabilities MUST satisfy the required features via the local
`supportsPrintFeatures` helper (a non-emulation gate — unsupported
features are REFUSED, never emulated via a different printer that lacks
them; if no printer supports the required features, the routing returns
a tagged `routing_refused` error with the unsupported feature names as
machine-stable reasons). Among the supporting printers, the router
selects the one with the LOWEST score (the consumer's injected scoring
function maps `PrinterPreferences` — cost / latency / proximity as
typed comparable inputs — to a number; ties broken by printerId
ascending — input-order invariant). Default: identity rank — the
first supporting printer in the registry's deterministic order.

Queue-state contracts per printer with observable evidence links: the
per-printer queue state is DERIVED from the latest QUEUED revisions
across all jobs at the printer (no mutable queue state). The
`enqueuePrintJob(job, { at, priorState })` transition produces a NEW
frozen queue state with the job appended (FIFO) and the depth
incremented; the job's `queuePosition` is updated to its actual
position; the job's status transitions ROUTED -> QUEUED. The
`PrinterQueueState` carries the queued job ids in queue order, the
observable evidence links (the queued jobs' correlation ids), and the
injected update timestamp.

### D4 — Audit + tenancy (`src/audit-seam.ts`, `src/action-store.ts`, `src/print-store.ts`)

- Audit: the injected `ActionAuditSink` seam (W011/W021/W022/W031's
  pattern — structurally identical record shape: `{ tenantId, action,
  subject, occurredAt, correlationId, causationId?, details }`).
  `@fleetos/audit`'s `createAuditSinkAdapter(log, { source })`
  satisfies the seam with ZERO glue (proven by test: the adapter is
  assigned to the seam type; emissions land in the tenant-scoped hash-
  chained AuditLog; the chain verifies; per-tenant chains stay
  separate). Emission for consequential events ONLY: plan creation
  (the FIRST revision appended to a plan's revision chain — the
  persistence boundary is the audit trigger, not the version number;
  supports the case where the caller transitioned the plan before
  persisting it), plan submission (ADVANCED / PARKED / REJECTED), plan
  approval (the W031-deferred human-approval step), print job routing
  (ROUTED + REFUSED both audit — REFUSED carries the unsupported
  feature names as machine-stable reasons), and print job queueing
  (QUEUED). The print STORE does NOT emit on append (the routing
  module is the emission owner — the store's audit sink is plumbed
  for future store-level emissions). Pure reads and failed mutations
  never audit (the frozen error taxonomy carries its own trace).
- Tenancy: tenant isolation BY CONSTRUCTION in both stores. The
  acting `ActionTenantScope` (`{ tenantId, correlationId? }` —
  structurally identical to identity's TenantContext + policy's
  PolicyTenantScope; declared locally because the ownership gate
  forbids importing `@fleetos/identity` from lane B) is the FIRST
  parameter of every operation; the runtime guards reject context-
  free, invalid-grammar, and cross-tenant access even when the types
  are bypassed (`undefined as never` — proven by test); storage is
  partitioned per tenant (`Map<tenantId, Map<planId/jobId,
  revisions[]>>`) and NO operation accepts a tenant override. Foreign
  plan/job ids are INDISTINGUISHABLE from unknown ones (no existence
  side channel) — verified by test (tenant-A's `getLatestPlan(tenantB,
  planIdA)` returns `undefined`, indistinguishable from a missing
  plan). Cross-tenant injection (a tenant-A scope naming a tenant-B
  plan) is rejected with a tagged `tenant_mismatch` DomainError.

### D5 — Tests + docs

Contract conformance via `@fleetos/contracts/testing` fixture builders:
`makeIntent` with `PRINT_INTENT_KIND` and `FLEET_ACTION_INTENT_KIND`
(verifying the frozen payload shapes are consumed verbatim — the
PrintIntentPayload's `documentRef` + `targetUserId` and the
FleetActionIntentPayload's `actionPlanRef` + `targetCount`), `makeAllIntents`
(both kinds produced from a single seed), `makeTenantId`,
`makeDeviceId`, `makePolicyId`, `makeCorrelationId`, `makeTimestamp`,
`FIXTURE_TIME_ANCHOR`, `TESTING_MODULE_NAME`/`VERSION`. Byte-identical
determinism across runs and input permutations (selectors, descriptor
insertion order, plan creation, print routing, store listPlanIds /
listJobIds sorting — audit on/off never changes the domain output).
Guardian-gate coverage (ALLOW / WARN -> ADVANCED, REQUIRE_APPROVAL ->
PARKED -> APPROVED / REJECTED, BLOCK -> REJECTED with matched rule
ids, NEVER auto-execute enforcement, tenant mismatch rejection).
Routing refusal for unsupported capabilities (color / staple /
multi-feature — never emulated; the router selects the ONLY
supporting printer even when a non-supporting printer has a lower
score). Tenant isolation (exhaustive — partitions, cross-tenant
rejection, foreign-id indistinguishability, types-bypassed access
rejection, queue-state per-tenant separation). End-to-end structural
compatibility with @fleetos/audit's sink adapter (the adapter
satisfies ActionAuditSink with ZERO glue; emissions land in the
tenant-scoped hash-chained AuditLog; the chain verifies; per-tenant
chains stay separate; the action store routes its planCreated
emissions through the adapter sink).

### Judgment calls

- **@fleetos/audit is a TEST-scope dependency of the package** (the
  work order's "depend on them via workspace:* imports only" clause):
  src/ NEVER imports it — the ownership gate scans src/ only and stays
  green — the dependency exists so the tests PROVE the seam is
  structurally satisfied by W012's sink adapter (the W022/W031-
  disclosed pattern).
- **The actions -> devices module-map edge is honored via the frozen
  contracts shapes only**: the local `DeviceRegistryView` interface is
  structurally compatible with `@fleetos/device-model`'s `TwinStore`
  (W011, same lane B) at the binding site — the consumer projects a
  TwinStore onto this view at the call site. No src-import of
  `@fleetos/device-model` (per the work order's "module-map edges to
  devices resolve via the frozen contracts shapes" clause).
- **The actions -> policy module-map edge is real code**:
  `packages/actions` depends on `@fleetos/policy` (same lane, gate-
  legal) and calls `evaluateGuardianRequest` directly — the W031
  Guardian is the AUTHORITATIVE policy layer; the actions package is
  the bridge that translates a Guardian decision into a plan
  transition + an audit emission.
- **`ActionTenantScope` is a local structural twin of identity's
  `TenantContext` + policy's `PolicyTenantScope`** ({ tenantId,
  correlationId? }): same-lane consumers can pass identity contexts
  directly (structural typing); the guards validate against the
  frozen `validateTenantRef` grammar. One definition per package,
  mirroring the accepted per-package seam pattern.
- **WARN advances with the warning context** (non-blocking per the
  frozen `isBlockingDecision` helper): the spec's ALLOW/WARN/
  REQUIRE_APPROVAL/BLOCK decision types map to ADVANCED / ADVANCED /
  PARKED / REJECTED. WARN surfaces the warning to the operator (via
  the audit's `decision` field) without holding the plan — the
  frozen helper confirms WARN is non-blocking.
- **The parked-plan approval step lives HERE** per the W031 SKELETON-
  NOTES line: "Approval workflows (holding an action until a human
  approves a REQUIRE_APPROVAL decision) belong to W041 Fleet Actions;
  the Guardian only decides." The transition is PARKED -> APPROVED /
  REJECTED; the audit carries the approving principal's id.
- **The action store audits only the FIRST revision appended**: the
  persistence boundary is the audit trigger, not the version number.
  Supports the case where the caller transitioned the plan before
  persisting it (the test that drove this design: route a print job
  through ROUTED -> QUEUED before persisting — the QUEUED revision is
  the first one stored, and the persistence is the audit trigger).
- **The print store does NOT emit on append**: the routing module is
  the emission owner (routed / queued). The store's audit sink is
  plumbed for future store-level emissions (e.g. a queue reorder) —
  the constructor signature does not need to change.
- **The byPostureSummary selector queries a forward-compatible
  extension field on the descriptor**: the actions package's frozen
  `DeviceDescriptor` does not include `postureSummary` — the binding
  site may attach it via a structural supertype. Fail-closed when
  posture is unknown (the selector returns the empty set rather than
  over-selecting).
- **The version discipline accepts any version as the first revision**:
  the caller may have transitioned the plan / job before persisting it;
  the first revision's version may be > 1. Subsequent revisions MUST
  be exactly prior + 1 (no gaps, no out-of-sequence). This is a
  deliberate deviation from the W031 rule-store's per-version-slot
  model (the actions store is a revision chain per plan id, not a
  version slot).
- **bun.lock committed**: adding the workspace deps updates the
  lockfile (the accepted W012/W021/W022/W031 pattern).
- **Test suites stick to the shim-supported matchers**
  (toBe/toEqual/toContain/toHaveLength with boolean pre-computation —
  the accepted packages' convention).

### Known limitations

- The in-memory ActionStore and PrintStore are reference seams;
  durable persistence (PostgreSQL per ARCHITECTURE.md § Storage) is
  the infrastructure wave.
- The print router's scoring function is INJECTED — the actions
  package never interprets the preference values' semantics (only
  the comparable ordering matters). The default (identity rank —
  first supporting printer in the registry's deterministic order) is
  the "no preference expressed" fallback, mirroring the W031 fail-
  closed posture.
- The print router does NOT model print-job content (the documentRef
  is opaque); it models the printer-capability subset the document
  demands (the `requiredFeatures`). A richer document-profile model
  (e.g. page count, paper size, color-profile requirements) would be
  a versioned model change (PRINT_MODEL_VERSION 2).
- The action plan's `capability` is one of the frozen
  `AdapterCapabilities` keys; multi-capability plans (e.g. "lock +
  locate + wipe" in one plan) would be a versioned model change
  (PLAN_MODEL_VERSION 2). The v1 model carries ONE capability per
  plan; the consumer composes multiple plans for multi-capability
  workflows.
- Execution belongs to later waves (W060B / device-adapters, not
  this package). The actions package stops at the proposal-gated
  boundary — APPROVED is terminal from the policy-gate perspective;
  the execution handoff is downstream.

---

## W030 — Lane A: mobile + printer/copier adapter contracts

Implemented by W030 (worker-a) on branch `work/w030`, base
`integration/wave0` @ `f88bfbc` (the W041 acceptance commit — past the
Wave 3 acceptances; the required W020 endpoint-adapter-SDK artifacts
`packages/device-adapters/src/{adapter,seams,seams-inmemory,registry,dispatch}.ts`
are present, and the W031/W032/W041 lane-B/C code does not intersect
lane A). Deliverables D1-D5 landed entirely in
`packages/device-adapters/**` (the frozen lane; no real MDM/SNMP
integration — both are CONTRACT boundaries: pure typed shapes +
injected seams). `packages/contracts/**` untouched (150-export snapshot
unchanged, verified by the gate).

### D1 — Mobile adapter family contracts

- `src/families.ts` — the family identifiers (`ios` / `ipados` /
  `android` / `printer-copier`), the mobile family descriptors
  (iOS/iPadOS = Apple MDM protocol; Android = Android Enterprise), and
  the EXPLICIT TYPED capability profiles: the mobile envelope carries
  the typical MDM set (lock/locate/wipe/update/observe/identify/health)
  PLUS diagnose (device-info/bugreport queries) and enforce
  (passcode/restrictions/managed apps) — `remediate`/`reboot` are
  OUTSIDE the envelope this wave (disclosed below). Profiles are built
  by `buildFamilyCapabilityProfile` (frozen flag set + derived
  supported/unsupported enumerables over the frozen canonical
  `ALL_ADAPTER_CAPABILITIES` — the W010 `declareAgentCapabilities`
  discipline), so the profile and its enumerables cannot desynchronize.
- `src/mobile-commands.ts` — the MDM-shaped command payload contracts:
  managed-app commands (install/remove + managed configuration),
  OS-update policies (target version, deferral, notify),
  LOST-MODE with REQUIRED message + phone on enable (the work order's
  named shape), device lock (optional 4-8 digit PIN), wipe
  (scope full vs ENTERPRISE — work profile / org erase, the BYOD-safe
  default), locate requests (accuracy + max age; `locate` is
  destructive per the frozen `DESTRUCTIVE_CAPABILITIES`), and mobile
  enforcement (passcode policy with bounded length / restrictions
  profile). Every payload has a parse-don't-validate parser
  (`unknown` -> narrowed typed payload, tagged failure with field
  path); the contracts are CLOSED-WORLD (unknown fields fail the
  parse — no silent field dropping, no payload smuggling across
  kinds). `MOBILE_CAPABILITY_PAYLOAD_KINDS` is the lane-local
  capability -> accepted-payload-kinds map (enforce -> managed-app |
  mobile-enforce; update -> os-update-policy; lock -> lost-mode |
  device-lock; locate -> locate-request; wipe -> wipe) and
  `parseMobileCommandPayload` is the deterministic unified parser
  (canonical kind order, first match wins, machine-stable failure
  reasons).
- `src/mobile-observations.ts` — the mobile observation source
  contracts: battery (`mobile.battery`), OS version
  (`mobile.os-version`, incl. Android security-patch level),
  compliance state (`mobile.compliance`, machine-stable violation
  codes), and GEOLOCATION-AS-EVIDENCE (`mobile.location-evidence`) —
  a captured fix with provenance (fix source, accuracy, capturedAt,
  capturedWhileLostMode collection context). Privacy boundary
  respected by construction: observable evidence only, NEVER inferred
  intent (no movement/dwell/behavioral fields). Kinds follow the
  frozen contracts' documented `<family>.<subject>` convention
  ("mobile" is the family group — disclosed below). Each payload has
  a parser + a record builder (kind + schemaVersion 1) that flows
  through the W010 collector and the frozen
  `validateObservationBatch` (proven by test).
- `src/seams-mobile.ts` — the mobile family seam TYPES: the Apple MDM
  command channel for iOS/iPadOS (typed `AppleMdmCommand` union —
  DeviceInformation, Install/RemoveApplication, InstallProfile,
  ScheduleOSUpdate, Enable/DisableLostMode, DeviceLock, EraseDevice,
  Location), the Android Enterprise channel (typed
  `AndroidEnterpriseCommand` union — device-info, managed-app
  install/remove/hide, apply-policy, set-update-policy, lock-screen
  WITH the lost-mode presentation carried through it, wipe device vs
  work-profile, request-location), and the SHARED mobile observation
  source set (the four mobile observables are protocol-independent;
  each extends the normalized `execute()` / `poll()` / `probe()`
  boundaries from `seams.ts`).

### D2 — Printer/copier adapter family contracts

- `families.ts` (printer section) — the printer/copier family profile
  is observe/health/diagnose-centric with LIMITED enforce:
  identify/observe/diagnose/health/enforce is the base envelope;
  `lock` / `locate` / `wipe` are FORBIDDEN (an explicit frozen list —
  refused at adapter CONSTRUCTION and at every runtime invocation,
  never emulated); `reboot` / `update` are VENDOR-MODEL-OPTIONAL — a
  vendor model descriptor declares which it backs, and the factory
  refuses an optional capability the model does not declare.
  `createPrinterVendorModelDescriptor` validates vendor/model ids,
  connector boundaries (`snmp` and/or `vendor-api`), and enforces that
  optional capabilities require the `vendor-api` boundary (an
  SNMP-only model cannot back them — that would be emulated
  behavior). `printerCopierFamilyEnvelopeFor(vendorModel)` is the pure
  per-model envelope (base + optional).
- `src/printer-commands.ts` — the SNMP + vendor boundary command
  payload contracts: SNMP get (dotted-OID query — an ad-hoc query is a
  DIAGNOSTIC; observe stays passive per W020), SNMP set (typed OID
  assignments with string/integer/gauge/counter values — the
  limited-enforce write boundary), and the vendor command payloads
  (cancel-job, clear-queue, apply-config, reboot, firmware-update).
  Vendor actions are CAPABILITY-SCOPED (`VENDOR_ACTIONS_FOR_CAPABILITY`):
  enforce accepts cancel-job/clear-queue/apply-config, reboot accepts
  only reboot, update accepts only firmware-update — a vendor action
  cannot be smuggled into the wrong capability (verified by test).
  All parsers are closed-world and fail-closed.
- `src/printer-observations.ts` — the consumable/usage observation
  contracts: consumables (`printer.consumable` — toner/ink/drum/
  waste-toner/maintenance-kit with color and remaining percent + page
  estimate), page counts (`printer.page-counts` — total/mono/color/
  duplex/scanned counters), error states (`printer.error-state` —
  device status + machine-stable error entries with severity).
- `src/seams-printer.ts` — the printer/copier seam TYPES: one command
  channel extending the normalized `execute()` boundary with the SNMP
  read/write entry points and the vendor API entry point (there is
  deliberately NO lock/locate/wipe surface), and the observation
  source set extending `poll()` with the three typed evidence
  readers.

### D3 — Family conformance seams

- `src/seams-inmemory-mobile.ts` / `src/seams-inmemory-printer.ts` +
  the shared machinery in `src/inmemory-shared.ts` (mirrors the W020
  fakes' discipline without touching the accepted W020 module): the
  in-memory reference seams for ios / ipados / android /
  printer-copier with deterministic INJECTED scripting (per-capability
  command outcomes, per-source observation records, capability
  probe), invocation recording (`calls()` / `reset()`), and
  content-addressed evidence (FNV-1a over the canonical JSON of the
  TYPED family command — a test hash, never for security). No clock
  reads, no entropy, no network: timestamps are injected by the
  caller at the adapter boundary; two fakes built with the same
  options behave identically, byte-for-byte (verified by test).
- The payload contracts are enforced AT the seam: the normalized
  `execute()` parses the opaque payload with the unified family
  parsers and maps it to the typed platform command; a malformed
  payload (or a capability/payload mismatch) FAILS CLOSED — a failed
  platform command with an `adapter_internal` failure, never an
  emulated success, and the typed channel is never invoked.
- `src/family-adapters.ts` — the family adapter factories:
  `createMobileFamilyAdapter` (platform must be ios/ipados/android,
  seam must match, capabilities must be a SUBSET of the mobile
  envelope — a BYOD profile without wipe is a first-class subset) and
  `createPrinterCopierFamilyAdapter` (platform printer-copier,
  capabilities subset of base + the VENDOR MODEL's optionals;
  forbidden capabilities REFUSED AT CONSTRUCTION with the explicit
  never-emulated message). Both delegate to the W020
  `createEndpointAdapter` unchanged — capability negotiation (frozen
  `assertSupported` semantics via W010 `negotiateCapability`) lives
  INSIDE every method, tenant isolation at the action boundary, and
  refusals NEVER reach the seam. Plus the family conformance
  predicates (`familyConformanceFor`, `familyEnvelopeForPlatform`,
  `isCapabilityInFamilyEnvelope`, `forbiddenCapabilitiesForPlatform`).

### D4 — Registry integration

Family adapters are ordinary W020 `EndpointAdapter`s: they register
through `createAdapterRegistry` UNCHANGED (the registry's structural
validation consumes the extended `ADAPTER_PLATFORMS` — ios/ipados/
android/printer-copier register, conflict detection and the
one-adapter-per-endpoint rule hold) and dispatch through
`createAdapterCommandDispatcher` UNCHANGED (command type ->
capability -> adapter resolution by device descriptor via
`registry.forDevice`, pre-negotiation born-rejected receipts for
family profile gaps — e.g. a wipe command against a printer is
born-rejected with `agent.capability.unsupported` even WITH a grant —
idempotent replay mirroring the ORIGINAL result, mixed-family fleets
resolve per device). Zero changes to `registry.ts` / `dispatch.ts`:
the composition is proven by tests, not by new code paths.

### W020 surface changes (minimal, additive)

- `seams.ts` — `AdapterPlatform` and `ADAPTER_PLATFORMS` extended with
  the four family ids (the W020 file itself said the families "arrive
  with W030"); `PlatformSeams` union extended with the four family
  seams (TYPE-ONLY imports — no runtime coupling); module docs
  updated. The three desktop seams are unchanged.
- `adapter.ts` — the construction error message now derives from
  `ADAPTER_PLATFORMS` instead of the hardcoded "windows/macos/linux"
  string.
- Two W020 baseline tests updated (intent preserved): the registry
  "unknown platform" test used `"ios"` as its invalid-platform example
  — now `"sunos"` (ios is valid post-W030); the seams platform
  predicate test asserted exactly three platforms — now asserts the
  seven W030 platforms plus still-invalid examples.

### Test suite

128 new tests across 8 files (full suite after W030: 1312 pass, 0
fail — 1184 baseline + 128 new; repeated runs byte-stable):
- `test/families.test.ts` — 25 (family ids, profiles, descriptors,
  vendor models, envelope validators incl. forbidden/vendor-not-
  backing/outside reasons, conformance predicates)
- `test/mobile-contracts.test.ts` — 22 (every payload parser's
  valid/invalid matrix, the capability map, the unified parser's kind
  resolution + mismatch failures, observation payload validators,
  record builders through the W010 collector + frozen
  `validateObservationBatch`)
- `test/printer-contracts.test.ts` — 13 (SNMP get/set, vendor command
  discrimination + capability scoping, forbidden capabilities accept
  nothing, observation validators, records through the frozen batch
  validator)
- `test/seams-mobile.test.ts` — 19 (Apple/Android typed routing per
  payload kind, malformed fail-closed, scripted outcomes + evidence,
  the four observation sources in fixed order, probe, reset, byte-
  identical determinism)
- `test/seams-printer.test.ts` — 15 (SNMP/vendor routing, default
  device OIDs for identify/health, forbidden capabilities fail closed
  at the seam, vendor-action smuggling refused, sources, probe,
  determinism)
- `test/family-adapters.test.ts` — 15 (construction gates incl. the
  printer FORBIDDEN construction refusal, the exhaustive
  11-capability x declared/undeclared ios matrix, the printer
  exhaustive matrix over every grant state (lock/locate/wipe refused
  even with grant + fresh cache), the Android destructive grant
  matrix, iPadOS non-destructive, cross-tenant refusal, malformed
  payload fails AFTER negotiation, observe over family sources, BYOD
  subset)
- `test/family-registry.test.ts` — 9 (registration through the W020
  registry, conflicts, structural tenant isolation, dispatch by
  device descriptor for mobile lock / printer enforce, printer wipe
  born-rejected, mobile wipe without grant PolicyError-rejected,
  idempotent replay never re-executes, mixed-family fleets +
  cross-tenant dispatch refusal)
- `test/family-contract-conformance.test.ts` — 10 (contract
  conformance via @fleetos/contracts/testing fixture builders:
  makeAdapterCapabilities / makeAdapterCapabilitiesSeeded / 
  makeCommandEnvelope / makeObservationBatch / makeTenantId /
  makeDeviceId / makeCorrelationId / makeTimestamp /
  makeIdempotencyKey / FIXTURE_TIME_ANCHOR; frozen helpers
  assertSupported / isSupported / isDestructive / validateCommand /
  validateObservationBatch / validateTenantRef / toApiError; the
  frozen toApiError maps the family refusal to 502 AdapterError —
  same taxonomy as the fixture errors; byte-identical determinism
  across family adapter + seam + payload construction)

### Binding protocol

Unchanged from W020: `packages/device-adapters/package.json` declares
`"@fleetos/contracts": "workspace:*"`; no relative imports cross a
package boundary (ownership gate green).

### Judgment calls

- **The mobile envelope includes diagnose + enforce beyond the work
  order's "typically" seven**: the named seven (lock/locate/wipe/
  update/observe/identify/health) are all in; diagnose (device-info /
  bugreport queries) and enforce (passcode/restrictions/managed apps)
  are first-class MDM surfaces the work order's D1 payload contracts
  depend on (managed-app commands and passcode policies ARE enforce
  payloads), so declaring them supported is the honest profile.
  `remediate` and `reboot` stay OUTSIDE the envelope (no first-class
  normalized MDM remediate/reboot command this wave; they arrive with
  vendor-specific extensions if ever needed).
- **A family id IS the adapter platform literal** (ios/ipados/
  android/printer-copier): the W020 `EndpointAdapterDescriptor.platform`
  is the only platform discriminator in the SDK, so family-conformant
  adapters extend the platform union rather than parallel-track a
  second discriminator. This is the additive W030 extension of the
  W020 union the W020 notes anticipated ("families arrive with
  W030"). The desktop members are unchanged; existing consumers are
  unaffected (union growth is backward compatible).
- **iOS and iPadOS are separate family ids** (ARCHITECTURE.md's
  "iOS/iPadOS management" names one family; the work order names
  "iOS/iPadOS + Android Enterprise"): they share the Apple MDM
  channel type and the same capability profile but are distinct
  family descriptors/platforms — iPadOS devices are a distinct
  device class with distinct fleet semantics (shared-iPad adjacent),
  and the registry/dispatch platform filtering works per family.
- **Printer `reboot`/`update` are vendor-model-optional, never
  family-wide**: the work order names the printer profile "observe/
  health/diagnose-centric with limited enforce" — the base envelope
  is exactly that; enterprise MFP vendor APIs genuinely back remote
  restart + firmware update, so those two capabilities are declared
  per VENDOR MODEL (and require the vendor-api connector boundary —
  an SNMP-only model cannot declare them, which would be emulation).
  Every other capability outside the base is outside the envelope.
- **Observation kinds are family-group-prefixed** ("mobile.battery",
  "printer.consumable", ...) following the frozen contracts'
  documented `<family>.<subject>` convention (its own examples are
  "windows.process.list", "macos.disk.health"): "mobile" is the
  family group shared by ios/ipados/android (the payload schemas are
  protocol-independent), "printer" the printer/copier family. The
  canonical `device.*` kinds stay available to other families; the
  open union tolerates both.
- **Closed-world payload validation**: family payload parsers reject
  unknown fields (no silent field dropping). This is what makes the
  capability->payload-kind map's mismatch failures REAL — with
  lenient parsing, an all-optional payload (device-lock) would
  vacuously accept any object. Disclosed as the fail-closed reading
  of "shapes only" + "fail-closed" discipline.
- **Malformed family payloads fail at the SEAM, after negotiation**:
  the W020 adapter treats payloads as opaque (by design — the SDK
  stays platform-agnostic), so the family payload contracts are
  enforced by the seam's normalized `execute()` (which the in-memory
  reference seams implement via the unified parsers). A malformed
  payload therefore produces a `failed` AdapterError outcome — not a
  pre-negotiation rejection. Unsupported/destructive-unauthorized
  refusals remain pre-negotiation rejections that never reach the
  seam.
- **The in-memory family seams duplicate ~60 lines of W020 fake
  machinery in `inmemory-shared.ts`** rather than refactoring the
  accepted `seams-inmemory.ts` — zero churn to the W020 module, and
  the family fakes get the same discipline (scripting, recording,
  content-addressed evidence) with family-specific routing.
- **`identify`/`health` on printer-copier accept an optional snmp-get
  payload, defaulting to the standard device OIDs** (sysDescr/sysName)
  when absent; `diagnose` requires its query (an ad-hoc diagnostic
  without a query is not a thing). Mobile identify/diagnose/health map
  to DeviceInformation / device-info with no payload contract.
- **Two W020 baseline tests updated** (registry unknown-platform
  example ios->sunos; seams platform predicate extended to the seven
  platforms): the tests' INTENT is preserved (unknown platforms are
  still refused; the predicate still accepts exactly the SDK's
  platforms) — the hardcoded pre-W030 platform list was the only
  thing that changed.
- **No new contract changes**: `packages/contracts/**` untouched
  (150-export snapshot unchanged, gate-verified).

### Known limitations

- No real MDM/SNMP integration: the family seams' reference
  implementations are in-memory fakes. A production Apple MDM /
  Android Enterprise / SNMP / vendor-API connector is a later
  infrastructure wave; the typed seam interfaces are the contract it
  implements. No real network/device I/O anywhere in this wave.
- `remediate`/`reboot` remain outside the MOBILE envelope this wave
  (disclosed above); a vendor-specific extension would be a new
  envelope revision, not a silent widening.
- The generic network/IoT adapter boundary (ARCHITECTURE.md's fourth
  initial family) is NOT started — it arrives with a later wave per
  the W020 note.
- The dispatcher is synchronous (the W020 limitation, inherited);
  long-running MDM operations (wipe, OS update) need the deferred
  execution model in a later wave — the receipt lifecycle already
  carries `executing` for it.
- BYOD/work-profile scoping nuances (per-enrollment capability
  variation) are represented as adapter-level capability SUBSETS (a
  first-class pattern, proven by test) — full enrollment-type-aware
  scoping is W071 (privacy/security/tenant hardening).
- W040 (recovery), W050A (ADCOS adapter) and UI surfaces are NOT
  started (later waves).

## W040 — Lane A: Recovery + Find My Device

Work order: W040 (`packages/recovery/**` only; branch `work/w040` off
`integration/wave0`). Base: the W030 acceptance commit (1312 baseline
tests green before any change). All four module deliverables (D1-D5)
implemented; 1413 tests green on the branch (1312 baseline + 101 new);
`bun run check` / `typecheck` green; the ownership gate stays green with
ZERO cross-lane src imports.

### D1 — Last-seen evidence + Find My Device (`src/last-seen.ts`)

- Deterministic last-seen ledger per device derived from canonical
  observation batches (the FROZEN contracts
  `Observation`/`ObservationBatch` shapes — the `recovery -> devices`
  edge honored via the frozen shapes only; `@fleetos/device-model` is
  worker-b's lane and is never imported). Every record carries source
  evidence refs (the observation ids at the max observed instant,
  sorted), an injected `recordedAt`, and a derived staleness
  classification against INJECTED thresholds (no clock reads).
- Records are append-only + versioned (revision prior+1; never
  rewritten); ids/digests are FNV-1a over canonical JSON; the CURRENT
  view (`resolveLastSeen`) is DERIVED (max observedAt, tie -> max
  version), so out-of-order arrivals append without ever regressing
  the view.
- **Staleness semantics (judgment call, documented in-module):** a
  two-sided band test against injected
  `{freshWithinMs, staleAfterMs}` — fresh within the fresh band, stale
  beyond the stale band, `unknown` for the indeterminate band between,
  for NO evidence, and for future-dated evidence (clock skew; never a
  clamp). `unknown` is a machine-stable refusal to guess.
- Find-My-Device view: the latest location-bearing evidence (kind
  `device.location`, the canonical frozen kind) across ALL revisions,
  ordered (observedAt, record version); the payload passes through
  VERBATIM and opaque (the W030 geolocation-as-evidence privacy
  boundary — recovery never interprets a location payload). Absent
  location evidence is machine-stable `no_location_evidence` — never a
  guess. The view re-derives staleness at view time against the view's
  own injected instant.

### D2 — Recovery cases + state machine (`src/recovery-case.ts`)

- Cases open per device from typed observable triggers: lost/stolen
  reports (operator evidence — never an inferred intent) and posture
  escalations via the `recovery -> security` edge (a STRUCTURAL
  trigger input: the posture status union + the security package's
  finding record-id refs; the binding site injects
  `@fleetos/security`'s real `assessSecurityPosture` output — proven
  by test; the cross-lane src import is forbidden by the ownership
  gate).
- Typed state machine:
  `OPENED -> SECURING -> SECURED / ESCALATED -> REPLACEMENT_PROPOSED /
  CLOSED`, with `CLOSED` terminal and machine-stable closure reasons
  (`device_recovered` / `replacement_proposed` / `operator_cancelled`
  / `evidence_stale`) enforced exactly on CLOSE. Documented
  departures: a case may close from any live state, and a SECURED
  device may still ESCALATE (damaged hardware).
- Versioned PROPOSAL-gated transitions: every transition appends
  revision prior+1 with a deterministic content digest; illegal
  transitions are refused with machine-stable DomainErrors (never
  silent, never a rewrite). The case records the evidence basis: the
  D1 last-seen record id + the posture finding refs.

### D3 — Destructive recovery gate (`src/policy-seam.ts`,
`src/destructive-request.ts`, `src/destructive-gate.ts`)

- **The Guardian routing seam (disclosed judgment call):** the work
  order routes every destructive request through
  `evaluateGuardianRequest` from `@fleetos/policy` — but policy is
  worker-b's lane and the ownership gate forbids cross-lane src
  imports (only `@fleetos/contracts` may cross lanes). The routing is
  therefore honored through a STRUCTURAL seam exactly like the
  audit-sink pattern the work order itself mandates: `GuardianEvaluateFn<R>`
  (generic over the rule-set type; the seam's request/options are
  structural subtypes of the engine's params; the engine's return is a
  subtype of the seam's outcome). TypeScript accepts
  `evaluateGuardianRequest` at the binding site; the test suite
  injects the REAL engine + REAL compiled rule sets and proves every
  decision path (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK) runs through
  it. The recovery lane NEVER re-implements Guardian logic.
- The frozen `RecoveryIntentPayload` (`deviceId?` +
  `action: lock/locate/wipe/reboot`) is consumed VERBATIM as the
  durable intent record's payload (never re-declared; the action union
  is derived from the frozen shape).
- Request lifecycle (typed, machine-stable):
  `REQUESTED -> ADVANCED | PARKED | REJECTED`;
  `ADVANCED/APPROVED -> EXECUTED | FAILED`; `PARKED -> APPROVED |
  REJECTED`. ALLOW advances AND dispatches; WARN advances with the
  warning context (non-blocking per the frozen `isBlockingDecision`;
  the reasons + matched rules ride the revision + audit);
  REQUIRE_APPROVAL parks (the parked -> approved/rejected transitions
  are ledger entries; approval dispatches — the human approval IS the
  explicit §16 grant); BLOCK rejects carrying the Guardian's
  machine-stable reasons (matched rule ids + reason codes verbatim).
  NEVER auto-execute.
- **Capability awareness (fail-fast, disclosed judgment call):** the
  gate refuses BEFORE any seam call when the adapter fronts a foreign
  tenant (`adapter_tenant_mismatch`), a different device
  (`adapter_device_mismatch`), the case is not active
  (`case_not_active`), or the action's capability is not in the
  adapter's DECLARED record (`capability_unsupported` — never
  emulated). The capability check fires BEFORE the Guardian (a
  proposal that can never execute never consumes a policy evaluation);
  the adapter's own W020 negotiation re-asserts grant +
  fresh-policy-cache at dispatch (defense in depth — a
  `policyCacheReady: false` dispatch is RECORDED as FAILED with the
  adapter's PolicyError, never retried/emulated; proven by test with
  the seam's call log proving zero platform invocations).
- Execution dispatch goes through the REAL W020 `EndpointAdapter`
  interface imported from `@fleetos/device-adapters` (same lane — the
  ONLY same-lane import besides contracts), with `policyGrant: true`
  justified by the Guardian advance / human approval. Every granted
  action carries the full §16 evidence trail: the frozen
  `GuardianDecision`, the matched rule refs, the observation evidence
  `EvidenceRef`s (a `evidenceRefsFromObservations` helper builds
  content-addressed refs with the W020 key convention), and the
  adapter's execution evidence — all on the record AND in the audit.

### D4 — Replacement escalation (`src/replacement.ts`)

- Consumes W021 health's versioned diagnosis evidence (a STRUCTURAL
  twin of the health package's replacement-arm proposal: hypothesis
  id, recommendation id, cause id, confidence, the DRAFT
  `ReplacementIntentPayload` — the frozen shape, verbatim — and the
  observation ids behind the anomalies) + W032 vendor warranty terms
  (a STRUCTURAL twin of `VendorTerms`' comparable values; the binding
  site injects `@fleetos/vendors`' real built terms — proven by test).
- Warranty-aware: `in_warranty` / `out_of_warranty` against the
  vendor's typed warranty days measured from an injected
  warranty-start instant (the boundary day itself is in warranty;
  future-dated coverage classifies out — machine-stable, never a
  clamp), or `no_warranty_terms` when no terms were supplied.
- PROPOSALS only: append-only ledger with supersession discipline (the
  new revision cites the prior via `supersedes`; the prior revision is
  never rewritten). NOTHING here creates a demand, matches a vendor,
  or orders anything — procurement is `@fleetos/procurement`'s wave,
  invoked by a human decision this package does not make (proven by
  the record's serialized shape carrying no procurement surface).

### D5 — Audit + tenancy + tests + docs

- Audit emission through the injected `RecoveryAuditSink` (the
  W011/W021/W022/W031/W041 pattern — structurally identical record
  shape). Emission policy (one coherent rule across the package): the
  DOMAIN boundary functions own ALL emissions
  (`recordLastSeenObservations` -> `recovery.lastseen.recorded`;
  `openRecoveryCase`/`transitionRecoveryCase` ->
  `recovery.case.opened`/`transitioned`; the destructive gate ->
  requested/parked/approved/rejected/executed/failed/refused;
  `escalateReplacement`/`supersedeReplacementEscalation` ->
  escalated/superseded); the in-memory stores audit NOTHING. Proven by
  test into the REAL hash-chained AuditLog via `@fleetos/audit`'s sink
  adapter — the chain verifies, per-tenant chains stay separate.
- Tenant isolation by construction: TenantContext-first
  (`RecoveryTenantScope`, the structural twin of identity's
  TenantContext) on every operation of every store; partitioned
  per-tenant storage; the runtime guard rejects context-free,
  invalid-grammar, and cross-tenant access WITH THE TYPES BYPASSED
  (`undefined as never` — proven by test); foreign ids are
  indistinguishable from unknown ones (no existence side channel).
- Tests: 101 new (contract conformance via
  `@fleetos/contracts/testing` fixture builders; D1 last-seen + Find
  My Device incl. byte-identical determinism + permutations; D2 cases
  incl. the real security edge; D3 Guardian-gate coverage with the
  REAL engine — all four decision paths + parked-approval transitions
  + dispatch through a REAL adapter over the in-memory Windows seam
  with call-log proofs; capability refusal with seam-never-invoked
  proofs; D4 warranty-aware escalation with the real health + vendor
  packages; audit into the real hash-chained log; exhaustive tenant
  isolation; determinism). Total 1413 green, 0 failed.

### Line-stop findings

- None. The frozen `ReplacementIntentPayload` + `RecoveryIntentPayload`
  shapes in `@fleetos/contracts` were consumed verbatim with no
  contract change required; the `@fleetos/contracts` snapshot gate
  passes unchanged (150 exports).

### Known limitations

- No durable persistence: the stores/ledgers are the in-memory
  reference implementations (the W011/W021/W022/W031/W041 pattern);
  the durable storage wave binds the same interfaces.
- The Guardian evaluation seam is synchronous and the rule set is
  injected per call site; a richer long-running approval workflow
  (expiry, escalation timers, notification fan-out via Aurum) is a
  later wave (W050C/W061).
- Find My Device surfaces only the LAST location-bearing observation
  verbatim (payload opaque); any location-payload semantics (accuracy
  filtering, fix-source ranking) belong to the owning adapter family
  contracts (W030) or a later UI wave — never guessed here.
- The recovery case state machine parks destructive requests but does
  not model multi-actor approval chains (single approver id recorded);
  richer approval routing is the actions/identity wave's evolution.
- apps/web/recovery is NOT started (a later work item, per the work
  order).
