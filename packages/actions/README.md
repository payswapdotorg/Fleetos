# @fleetos/actions

Fleet Actions + Print orchestration — the FleetOS Fleet Action domain model
(group selection, action plan templates as PROPOSAL status only, target
resolution), policy-gated execution flow (a plan submits to the W031
Contract Guardian evaluation via `@fleetos/policy`; ALLOW advances,
REQUIRE_APPROVAL parks for approval, BLOCK rejects with the Guardian's
machine-stable reasons; NEVER auto-execute), print orchestration (printer
routing on top of the frozen `PrintIntentPayload`; print job requests as
versioned records, printer selection from typed printer descriptors,
capability-aware routing that refuses unsupported job features — never
emulates, deterministic routing rules with injectable cost / latency /
proximity preferences, queue-state contracts per printer with observable
evidence links), and audit + tenancy (consequential mutations emit audit
records through an injected sink structurally satisfied by `@fleetos/audit`'s
sink adapter; tenant isolation by construction — tenant-A context can never
read/act on tenant-B plans or jobs).

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

`spec/ARCHITECTURE.md` § Intent model + § Decision boundary + § Contract
Guardian + § Device adapters; `spec/ARCHITECTURE-LOCK.md` items 3
(versioned-interpretation discipline), 4 (consequential actions have
authorization, idempotency, audit and verification), 11 (no inferred
employee intent), 16 (destructive actions require an explicit policy grant
and evidence trail), 17 (tenant isolation by construction).

## Module map

| File                       | D     | Responsibility                                                      |
| -------------------------- | ----- | ------------------------------------------------------------------- |
| `src/device-descriptor.ts` | D1    | Minimal device descriptor + `DeviceRegistryView` (the actions -> devices module-map edge honored via the frozen contracts shapes only — the consumer binds a TwinStore at the call site). |
| `src/fleet-action.ts`      | D1    | The FleetAction domain model — typed device-group selectors, action plan templates (PROPOSAL status only), pure target resolution, plan transition table. |
| `src/policy-gate.ts`       | D2    | Policy-gated execution — submits a plan to the W031 Guardian evaluation; ALLOW/WARN advance, REQUIRE_APPROVAL parks, BLOCK rejects. The parked-plan approval step (the W031-deferred human-approval transition) lives here. |
| `src/print-orchestration.ts` | D3  | Print job routing on top of the frozen `PrintIntentPayload`; capability-aware printer selection that refuses unsupported features (never emulates); queue-state contracts per printer. |
| `src/action-store.ts`      | D4    | Tenant-scoped, append-only-per-version `ActionStore` (plan revisions are append-only per plan id). |
| `src/print-store.ts`       | D4    | Tenant-scoped, append-only-per-version `PrintStore` (job revisions are append-only per job id; the per-printer queue state is derived). |
| `src/audit-seam.ts`        | D4    | The injected audit sink interface (W011/W021/W022/W031's pattern; structurally satisfied by `@fleetos/audit`'s sink adapter — proven by test). |
| `src/internal.ts`          | —    | Internal helpers (timestamp sanity, canonical JSON, content digests, immutability helpers, tenant-scope guard, FleetError constructors). |

## Workspace dependencies

- `@fleetos/contracts` (`workspace:*`) — the frozen shared seam
  (`PrintIntentPayload`, `FleetActionIntentPayload`, branded IDs,
  `AdapterCapabilities`, `EvidenceRef`, `TenantScoped`, `validateTenantRef`,
  `isSupported`/`isDestructive`/`DESTRUCTIVE_CAPABILITIES`, `FleetError`
  taxonomy). The package NEVER modifies the frozen shapes; it consumes them
  as-is.
- `@fleetos/policy` (`workspace:*`) — same lane B; the W031 Contract
  Guardian engine (`evaluateGuardianRequest`, `compileGuardianRuleSet`,
  `defineGuardianRule`). The Guardian is the AUTHORITATIVE policy layer;
  the actions package is the bridge that translates a Guardian decision
  into a plan transition + an audit emission.
- `@fleetos/audit` (`workspace:*`) — TEST-scope dependency only
  (src/ NEVER imports it — the ownership gate scans src/ only); the
  dependency exists so the tests PROVE the seams are structurally
  satisfied by W012's sink adapter (the W022/W031-disclosed pattern).

The `actions -> devices` module-map edge is honored via the frozen
contracts shapes only (the work order's "depend on them via workspace:*
imports only" clause): the local `DeviceRegistryView` interface is
structurally compatible with `@fleetos/device-model`'s `TwinStore` (W011,
same lane B) at the binding site; the consumer projects a TwinStore onto
this view at the call site without a src-import of `@fleetos/device-model`.

## Determinism + tenancy

PURE: every input (selector, registry, plan, rule set, request, decision
instant, correlation id, scoring function) is injected — the actions
package reads no clock and no entropy. Target resolution is sorted by
deviceId for byte-stable plan ids + content digests. Plan revisions are
append-only per plan id (versioned-interpretation discipline — the prior
is never rewritten). Tenant isolation is BY CONSTRUCTION: every store
operation takes the acting `ActionTenantScope` as its FIRST parameter;
storage is partitioned per tenant; foreign ids are indistinguishable from
unknown ones (no existence side channel); types-bypassed access is
rejected at runtime by the tenant-scope guard.

## W041 state

Implemented by W041 (worker-b) on branch `work/w041`, base
`integration/wave0`. Deliverables D1-D5 landed in this package. Test
suite: 79 new tests across 6 files (contract conformance, determinism,
guardian-gate, routing-refusal, tenant-isolation, audit). All gates green
(architecture + ownership + skeleton + contracts snapshot 150 exports
unchanged; typecheck; bun test). The package never modifies the frozen
contracts (`PrintIntentPayload` + `FleetActionIntentPayload` shapes are
already frozen in `@fleetos/contracts`).
