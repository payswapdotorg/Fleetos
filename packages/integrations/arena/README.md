# @fleetos/integration-arena

Arena integration adapter. Submits evaluation cases and consumes certified capability metadata through the Arena contract. Arena owns capability learning/certification; FleetOS owns operational adoption (`spec/ARCHITECTURE-LOCK.md` item 9). FleetOS never treats an uncertified model output as action permission (`spec/integration/ARENA.md`).

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/integration/ARENA.md; spec/ARCHITECTURE-LOCK.md item 9; spec/work-items/WORK-ITEM-CATALOG.md W050B.

## W050B state (implemented)

The arena package implements all five D1-D5 deliverables. All modules are pure (zero runtime dependencies, strict TS, no clock reads — every timestamp is injected by the caller).

### D1 — Evaluation-case submission (`src/evaluation-case.ts`)

- Typed, provider-neutral evaluation cases carrying: problem class, normalized observation refs (content-addressable, opaque to the control plane), context, action history refs, outcome (ground-truth label + value + observedAt + evidence refs), evaluation labels (key/value ground-truth annotations), tenant policy refs, and redaction/de-identification state (a typed machine-stable record: `raw` / `deidentified` / `redacted` + applied policies).
- Submission is PROPOSAL-gated through the W031 Contract Guardian decision model (the structural seam typed against the frozen `GuardianDecision`): ALLOW/WARN → SUBMITTED; REQUIRE_APPROVAL → PARKED (held for human review; never auto-submitted); BLOCK → REJECTED (refused with the Guardian's machine-stable reasons). The submission's `evaluator` option is REQUIRED — there is no auto-submit path.
- Deterministic case ids: FNV-1a over canonical JSON of (tenantId, problemClass, observationRefs, context, actionHistoryRefs, outcome, labels, tenantPolicyRefs, redaction). Identical inputs produce byte-identical case ids and content digests across runs and input permutations (proven by test).
- Append-only submission ledger: a prior revision is NEVER rewritten; a re-submission of identical inputs is idempotent (the existing record is returned — never a duplicate).

### D2 — Certified capability adoption (`src/capability-adoption.ts`)

- Typed adoption records from Arena's certified capability metadata: capability ID/version (verbatim), Arena certification reference (verbatim — the audit evidence that the certification existed at adoption time), FleetOS compatibility statement (verbatim: `compatible` / `compatible_with_warnings` / `incompatible`), evaluation-suite revision (verbatim), rollout policy, cohort, rollback version.
- Versioned append-only records with supersession discipline: a new revision is a NEW record citing the prior via `supersedes`; the prior revision is never rewritten. The adoption identity (`adoptionId`) is the deterministic digest of (tenantId, capabilityId) — different capability versions are different revisions on the same adoptionId lineage.
- Adoption is an EXPLICIT PROPOSAL-gated transition (never automatic): the caller supplies a `CapabilityAdoptionProposal` carrying the proposal id, the approver id (the human who approved), the approved-at instant, the cohort, the rollback version, and (on a supersession) the prior recordId.
- The D3 fail-closed certification gate runs FIRST (before any store mutation); a refusal produces a `CapabilityAdoptionResult` with `ok: false` carrying the machine-stable refusal reasons, the store is untouched, and the refusal is audited.

### D3 — The certification boundary (`src/certification-boundary.ts`)

- The ARENA.md invariant: "FleetOS never treats an uncertified model output as action permission." This module is the FAIL-CLOSED gate that enforces it.
- A capability is the unit Arena learns/certifies. The certified-capability metadata carries: `capabilityId`, `capabilityVersion`, `certificationRef` (canonical `acr_` prefix + 16+ base32 chars), `evaluationSuiteRevision`, `fleetOSCompatibilityStatement`, optional `certificationHash` (defense-in-depth content-hash check), optional `warnings` (when `compatible_with_warnings`), optional `capabilityClass`.
- The gate refuses adoption when: the metadata is null/absent (`missing_metadata`); required fields are absent (`missing_capability_id` / `missing_capability_version` / `missing_certification_ref`); the certification reference is malformed (`malformed_certification_ref`); the caller-supplied hash check fails (`certification_hash_mismatch`); the compatibility statement is `incompatible` or unknown (`incompatible_capability` — fail-closed: never adopt a capability whose compatibility the control plane does not understand).
- Fail-closed: ANY refusal reason produces a `Refusal` carrying machine-stable reason codes; no partial adoption, no "best-effort" path. Multiple refusal reasons are accumulated and exposed at once (never silently).
- The ARENA.md invariant is asserted BY TEST (`packages/integrations/arena/test/certification-boundary.test.ts`): the package exposes NO function that converts raw model output into an adoption record without first producing a `CertifiedCapability` through this gate; adoption records carry the `certificationRef` verbatim. The `RawModelOutput` type is exported for documentation only — the package REFUSES to ingest it directly. `projectCertificationRefFromRawModelOutput` is the ONLY structural bridge from raw model output to a certification reference (and it returns `null` for typical model output, which carries no certification reference).

### D4 — Audit + tenancy (`src/audit-seam.ts`, `src/internal.ts`)

- Audit emission through the injected `ArenaAuditSink` (the W011/W021/W022/W031/W032/W040/W041 pattern — structurally identical record shape). Emission policy: the DOMAIN boundary functions own ALL emissions (`submitEvaluationCase` → `arena.case.submitted/parked/rejected`; `adoptCapability` → `arena.capability.adopted/superseded/refused`); the in-memory stores audit NOTHING. Proven by test into the REAL hash-chained AuditLog via `@fleetos/audit`'s sink adapter — the chain verifies, per-tenant chains stay separate.
- Tenant isolation by construction: `ArenaTenantScope` (the structural twin of identity's `TenantContext`) on every operation of every store; partitioned per-tenant storage; the runtime guard rejects context-free, invalid-grammar, and cross-tenant access WITH THE TYPES BYPASSED (`undefined as never` — proven by test); foreign ids are indistinguishable from unknown ones (no existence side channel).

### D5 — Tests + docs

- Tests: 112 new (contract conformance via `@fleetos/contracts/testing` fixture builders; byte-identical end-to-end determinism across runs and input permutations; the fail-closed certification boundary coverage incl. the ARENA.md invariant assertion; Guardian-gate coverage with the REAL engine — all four decision paths (ALLOW/WARN/REQUIRE_APPROVAL/BLOCK) + the human-approval PROPOSAL gate for adoption + supersession discipline; audit into the REAL hash-chained log; exhaustive tenant isolation incl. foreign-id indistinguishability). Total 1635 green, 0 failed (1523 baseline + 112 new).
- All gates green on the branch — snapshot 150 contracts exports unchanged.

## Cross-lane discipline

Cross-lane domain types come from `@fleetos/contracts` only. The structural seams (audit sink, Guardian evaluator, tenant scope) declared LOCALLY in this package are structurally satisfied by the real packages at the binding site (proven by test):
- `ArenaAuditSink` ← `@fleetos/audit`'s `createAuditSinkAdapter` (lane C; proven by test).
- `GuardianEvaluateFn<R>` ← `@fleetos/policy`'s `evaluateGuardianRequest` (lane B; same lane but declared LOCALLY per the integration-package discipline — provider-neutral).
- `ArenaTenantScope` ← `@fleetos/identity`'s `TenantContext` (lane C; structural twin).

No `any` in public signatures. No runtime dependencies (TypeScript dev-dep only).

## Line-stop findings

None. The frozen `@fleetos/contracts` surface was consumed verbatim with no contract change required; the `@fleetos/contracts` snapshot gate passes unchanged (150 exports).

## Known limitations

- No durable persistence: the stores/ledgers are the in-memory reference implementations (the W011/W021/W022/W031/W032/W040/W041 pattern); the durable storage wave binds the same interfaces.
- The Guardian evaluation seam is synchronous and the rule set is injected per call site; a richer long-running approval workflow (expiry, escalation timers, notification fan-out via Aurum) is a later wave (W050C/W061).
- The rollout policy is fixed at `{ kind: "full" }` for v1; a later wave may let the `CapabilityAdoptionProposal` carry the rollout policy explicitly (canary / ring / full).
- The certification-boundary's hash check is opt-in (the caller supplies the expected hash); a later wave may wire it to a content-addressable store that automatically re-asserts the hash.
- apps/web/arena is NOT started (a later work item, per the work order).
