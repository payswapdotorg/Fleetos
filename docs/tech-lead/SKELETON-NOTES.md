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
