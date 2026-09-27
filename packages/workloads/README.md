# @fleetos/workloads

Workload profiles, capability requirements and recommendation semantics.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/workloads/README.md; spec/MODULE-DEPENDENCY-MAP.md Business semantics layer; spec/ARCHITECTURE.md § Workload Intelligence.

## W022 — Workload profiles + recommendation contracts

Implemented by W022 (branch `work/w022`, base `integration/wave0`). The
package is pure TypeScript with zero runtime dependencies: every function
is deterministic (same inputs => same outputs, byte for byte), every
timestamp is injected by the caller (no clock reads, no entropy), and
every failure is a tagged result carrying the frozen `FleetError`
taxonomy — nothing in the public API throws for domain flows.

Per `spec/ARCHITECTURE.md` § Workload Intelligence: "A Workload Profile
describes what a role/process requires." Per § Decision boundary: the
decision engine may PROPOSE; the deterministic policy layer (W031
Contract Guardian) remains authoritative. **Everything this package
produces is a PROPOSAL** — no function creates, dispatches, or executes
a Fleet Intent.

### Module map

| Module | Deliverable | Contents |
|---|---|---|
| `src/profile.ts` | D1 | The `WorkloadProfile` domain model: role/process identity (`subjectKind`, `name`, `description`), tenant scoping (`TenantScoped` from the frozen contracts), and IMMUTABLE versioned revisions — a profile revision is never rewritten; updates create revision+1 with a deterministic FNV-1a content hash binding the full revision content. Informational observed factors that are not comparable (working hours) live here; evidence links reference the source observations. |
| `src/requirement-vector.ts` | D2 | The `RequirementVector`: ten typed, unit-normalized comparable dimensions (cpu/gpu/memory/storage/network demand, power dependence, mobility, peripherals, security classification, downtime sensitivity). Raw engineering units (GB, Mbps, minutes, USD, counts) normalize through FROZEN anchor tables with piecewise-linear interpolation and clamping (W011's unit-normalization pattern). Pure comparison helpers: `compareVectors` (per-dimension satisfaction `min(1, offered/required)`, mean, worst dimension), `diffRequirementVectors`, `validateRequirementVector`. No ML. |
| `src/constraints.ts` | D2 | The hard gates: `WorkloadConstraints` (application set/versions, environments where lawful, peripherals, security classification ceiling) checked against `CandidateCapabilities` by `checkConstraints` — pure pass/fail with machine-stable failure kinds (missing_application, version_below_minimum, environment_unsupported, missing_peripheral, classification_insufficient) in deterministic check order. `assessFit` combines the vector comparison with the constraint check into the `FitAssessment`; the soft score and the hard gate are NEVER traded off against each other. Dotted-numeric version comparison fails CLOSED on malformed input. |
| `src/observed-factors.ts` | module edge | The observations dependency of `workloads -> devices, observations, audit`, honored with real code: `deriveObservedFactors` maps canonical `device.workload` observations (frozen `@fleetos/contracts` `Observation` shapes) to typed factor samples with forward-compatible skip reasons (unknown_kind / bad_payload / outside_window / field_out_of_range — never errors), and `aggregateObservedFactors` folds them per dimension with a NEAREST-RANK p90 (always an observed sample). |
| `src/store.ts` | D1/D4 | The tenant-scoped `WorkloadProfileStore` (in-memory reference): every operation takes W012's `TenantContext` as its FIRST parameter, storage is partitioned per tenant, and no operation accepts a tenant override — tenant isolation BY CONSTRUCTION. The store also exposes `tenantScopedView`, a raw `TenantScopedStore` projection over the same partitions for W012's reusable `runTenantIsolationSuite` harness. `createWorkloadProfileService` wraps the store with an INJECTED audit sink: every consequential mutation (profile created / revised) emits an append-only audit record. |
| `src/recommendations.ts` | D3 | Versioned `WorkloadRecommendation` contracts: PROPOSALS (never automatic) of kind device-class or procurement, derived deterministically from a profile's requirement vector against INJECTED candidates. Ranking is satisfaction desc, candidateId asc — candidate input order never matters. Each record carries the `FitAssessment` (per-dimension evidence), confidence (`min(0.99, satisfaction x profile vector confidence)`), evidence links, a deterministic rationale, and DRAFT `WorkloadIntentProposal`s — `ProcurementIntent` (candidate declares `procurementRequired`) and `SoftwareSubscriptionIntent` (required application the candidate lists as subscription-required, seatCount 1) — payload shapes ONLY, no intent id, no lifecycle. The append-only per-workload `WorkloadRecommendationLedger` (supersession via NEW records with `supersedes`; dismissal entries; derived ACTIVE view). |
| `src/audit-seam.ts` | D4 | The injected audit sink (W012's pattern): `WorkloadAuditRecord` / `WorkloadAuditSink` structurally satisfied by `@fleetos/audit`'s `createAuditSinkAdapter` — proven by test with the hash-chained in-memory `AuditLog`, no cross-lane wiring. Emission for consequential events only: profile created/revised, recommendation proposed/dismissed. |
| `src/internal.ts` | — | Internal helpers (not exported from the public API): ISO sanity, canonical JSON, FNV-1a digests, freezing, FleetError constructors. The synthetic tenant/correlation sentinels are imported from `@fleetos/identity` (same lane — one canonical definition per lane). |

### Error codes (stable machine codes)

`workloads.profile.invalid_request`, `workloads.profile.domain`
(invariants: `workload_unknown`, `workload_already_exists`,
`workload_id_invalid`), `workloads.vector.invalid_request`,
`workloads.factors.invalid_request`,
`workloads.recommendation.invalid_request`,
`workloads.recommendation.tenant_mismatch` (invariants:
`ledger_scope_mismatch`, `duplicate_recommendation_id`,
`recommendation_unknown`, `already_superseded`, `already_dismissed`).

All errors carry the tenant + correlation ids required by the frozen
`FleetError` taxonomy and translate through the frozen `toApiError`
(ValidationError -> 400, DomainError -> 400; context-free violations
project the synthetic `tnt_system` tenant, the W012 convention).

### Determinism conventions (explicit, versioned)

- Dimension set: ten canonical dimensions, frozen (`REQUIREMENT_DIMENSIONS`).
- Normalization: piecewise-linear over frozen anchor tables, clamped.
- Vector satisfaction: per-dimension `min(1, offered / required)`
  (required 0 -> 1); aggregate is the arithmetic mean; worst dimension
  tie-breaks by canonical order.
- Aggregation: nearest-rank p90, `sorted[ceil(p/100 * n) - 1]`.
- Windows: `(asOf - windowMs, asOf]` — inclusive end, injected anchor.
- Record ids: `<prefix>_<fnv1a32(canonicalJson(identity tuple))>` —
  deterministic, non-cryptographic (the W011/W021 convention).
- Confidence: recommendations `min(0.99, satisfaction x vector
  confidence)`; derived factor samples 1.0 (direct reads) or 0.9
  (anchor-normalized) — the W021 convention.
- Ranking: satisfaction desc, candidateId asc; rejected list by
  candidateId asc.

### Dependencies

- `@fleetos/contracts` (workspace) — frozen shared seam: branded ids
  (incl. `WorkloadId`), `TenantScoped`, `Observation`, intent kinds +
  payload interfaces, FleetError taxonomy, `Versioned`/`assertVersion`.
- `@fleetos/identity` (workspace, same lane) — `TenantContext` + the
  isolation guards for the tenant-scoped store; the synthetic sentinels;
  the reusable isolation harness (`runTenantIsolationSuite`, consumed by
  the test suite through the store's raw KV view).
- `@fleetos/audit` (workspace, same lane) — consumed by the TEST suite
  only, to prove the seam's structural compatibility with W012's sink
  adapter and the hash-chained `AuditLog`; src/ never imports it (the
  seam is the boundary, mirroring W011/W021).

Cross-lane imports go through `@fleetos/contracts` only
(`tools/check-ownership.mjs` enforced). `@fleetos/device-model` (the
devices module) is worker-b's lane and is NEVER imported; the
devices/observations module-map edges are satisfied through the frozen
contracts shapes (`DeviceId`, `Observation`, `ObservationKind`).

### Later waves (documented seams)

- Procurement matching (demand aggregation, quotes) consumes
  `CandidateRejection` evidence — W032's call.
- Software catalog/entitlement alignment consumes the
  `SoftwareSubscriptionIntent` drafts — W032's call.
- Repair/failure OUTCOMES (historical results) feed Arena learning
  experiments (W050B), not requirement vectors.
- Contract Guardian evaluation of proposed intents — W031.
- Workload/commerce UI surfaces — W060C.
