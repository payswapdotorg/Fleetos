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
