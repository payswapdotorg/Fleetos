# @fleetos/world-context

**Lane C (worker-c) implementation of the workload/project context projection +
the Learning/Arena evaluation bridge (W155 — Wave 14 lane 3 of 4, renumbered
from the planned W152 per the operator's renumbering directive).**

This package is the binding layer between the W154 world-model engine and the
W070 learning loop:

- **D1 — `context-projection.ts`**: the workload/project context projection.
  A pure function family that builds a `WorldModelContext`-shaped record
  (structurally compatible with the W154 frozen `WorldModelContext`) from the
  REAL workload assignment state (from `@fleetos/workloads`) + procurement
  stage summaries (from `@fleetos/procurement`) via structural seams. Honest
  states: empty surface → minimal context; SUPERSEDED/DISMISSED assignments
  + CLOSED procurement cases EXCLUDED; cross-tenant REFUSED.

- **D2 — `predictive-evaluation-bridge.ts`**: the Learning/Arena bridge.
  `convertPredictionToEvaluationProposal` converts a W154
  prediction/counterfactual into a Guardian-gated evaluation-case SUBMISSION
  PROPOSAL (structurally compatible with the W070
  `EvaluationCaseProposalFacet`). The PROPOSAL-GATED law (ALLOW/WARN →
  PROPOSED, REQUIRE_APPROVAL → PARKED, BLOCK → REJECTED); the bridge NEVER
  submits (no submit path exists — machine-tested). Counterfactual-derived
  proposals carry the hypothetical marker THROUGH the conversion on THREE
  surfaces.

- **D3 — `outcome-binding.ts`**: the loop CLOSES. `bindPredictiveOutcome`
  joins an OBSERVED LATER STATE (the actual device health/cadence at the
  horizon's end — INJECTED by the caller) to the PREDICTED estimate (by
  prediction id + the provenance chain), producing an
  outcome-observation-shaped record (structurally compatible with the W070
  `OutcomeObservation`). Honest refusals: horizon-mismatch REFUSES;
  missing-provenance REFUSES; cross-tenant REFUSES.

- **D4 — `audit-seam.ts` + tenant guard**: the house pattern. The package's
  own `WorldContextAuditSink` interface; projection runs, bridge
  conversions, refusals, and outcome bindings are handed to the injected
  sink as append-only records. `checkWorldContextTenantScope` pure guard.

## The frozen public surface (consumed by W156)

- **Types**: `WorldModelContextLike` (the W154 WorldModelContext structural
  twin), `WorldModelPredictionLike` / `WorldModelCounterfactualLike` /
  `WorldModelPredictionRecordLike` (the W154 prediction/counterfactual union),
  `EvaluationCaseProposalFacetLike` / `EvaluationCaseDispositionLike` /
  `EvaluationLabelFacetLike` / `EvaluationOutcomeFacetLike` /
  `RedactionRecordFacetLike` / `RedactionStateFacetLike` (the W070 evaluation-
  conversion facets), `PredictiveEvaluationProposalLike` (the W155 bridge's
  proposal shape), `OutcomeGroundTruthLike` /
  `PredictiveOutcomeBindingLike` (the W155 outcome binding), plus
  `WorkloadAssignmentFacet` (the W022 workloads structural seam) +
  `ProcurementStageFacet` (the procurement structural seam).
- **Functions**: `buildWorldModelContext` (D1),
  `convertPredictionToEvaluationProposal` + `decisionToDisposition` (D2),
  `bindPredictiveOutcome` (D3), `checkWorldContextTenantScope` (D4).
- **Constants**: the frozen schema/algorithm versions
  (`CONTEXT_PROJECTION_SCHEMA_VERSION` / `PROJECTION_VERSION` /
  `BRIDGE_SCHEMA_VERSION` / `BRIDGE_VERSION` / `BINDING_SCHEMA_VERSION` /
  `BINDING_VERSION`); the W154 frozen contract mirror
  (`WORLD_MODEL_CONTEXT_SCHEMA_VERSION = 1`); the closed vocabularies
  (`ALL_CONTEXT_OBSERVATION_KINDS`, `ALL_PROPOSAL_DISPOSITIONS`,
  `ALL_REDACTION_STATE_FACETS`, `WORLD_CONTEXT_AUDIT_ACTIONS`); the bridge
  constants (`BRIDGE_SOURCE_SURFACE`, `BRIDGE_PENDING_OUTCOME_LABEL`,
  `PREDICTIVE_PROBLEM_CLASS_PREFIX`, `PREDICTIVE_OUTCOME_SOURCE_SURFACE`,
  `BRIDGE_PUBLIC_FUNCTIONS` — asserts NO `submit` function).

## Architecture

Per ADR-0002 § "Hard invariants" + the W155 work order (the lane's
constitution):

1. The context projection is DERIVED, tenant-scoped, provenance-carrying —
   NEVER business truth; the authoritative state stays in the owning packages
   (workloads/procurement).
2. Every context item carries its own provenance refs to the SOURCE records
   (workload ids, procurement case ids) — the same discipline as the W153
   feature provenance.
3. The bridge NEVER auto-submits anything to Arena — the W070 PROPOSAL-gated
   law (GuardianDecision gates ALLOW/WARN → PROPOSED, REQUIRE_APPROVAL →
   PARKED, BLOCK → REJECTED).
4. Predictions remain ADVISORY until adoption — no predictive output
   authorizes/executes/mutates business truth.
5. Tenant isolation + BYOD/privacy before anything enters the bridge:
   cross-tenant context/proposal/binding REFUSED.
6. Determinism: the same source records + the same projection version =>
   byte-identical context + byte-identical evaluation proposals.
7. Zero runtime dependencies; strict TS; no `any` in public signatures;
   every timestamp injected by the caller; no clock reads, no entropy.
8. Consume @fleetos/world-model + @fleetos/learning + the domain packages
   through STRUCTURAL SEAMS in src/ (the W040/W154 pattern — the ownership
   gate forbids cross-lane src/ imports beyond @fleetos/contracts); bind the
   REAL packages at the test binding sites, machine-enforced by the
   contract-conformance test.

## Decision boundary

The deterministic policy layer (the W031 Contract Guardian) remains the sole
authority for evaluation-case submission — the gate consumes the FROZEN
`GuardianDecision` and NOTHING here auto-submits. Adoption is PROPOSAL-gated
through the W070 fail-closed certification boundary — the W155 lane produces
the proposal SHAPE; the W070 arena adapter owns the submission ledger.

## Module map

```
src/
├── index.ts                       # Public API
├── internal.ts                    # Internal helpers (canonical JSON, SHA-256,
│                                  # FNV-1a, frozen, normalizeRefs/Evidence,
│                                  # checkWorldContextTenantScope, ERROR_CODES)
├── audit-seam.ts                  # D4 — the audit sink interface
├── seam.ts                        # The W040/W154 structural-seam pattern
│                                  # (LOCAL interfaces for the W154
│                                  # WorldModelContext + WorldModelPrediction/
│                                  # Counterfactual; the W070 evaluation-conversion
│                                  # facets; the W022 workloads + procurement
│                                  # surfaces)
├── context-projection.ts          # D1 — buildWorldModelContext
├── predictive-evaluation-bridge.ts  # D2 — convertPredictionToEvaluationProposal
└── outcome-binding.ts             # D3 — bindPredictiveOutcome

test/
├── helpers.ts                     # Fixtures (synthetic + REAL W154 prediction
│                                  # builders; workload + procurement facets;
│                                  # GuardianDecision factory; observed-outcome
│                                  # builder; the W091 demo-fleet pattern)
├── determinism.test.ts            # Golden contexts + golden proposals + golden
│                                  # bindings (byte-identical outputs)
├── honesty.test.ts                # Empty-surface minimal context;
│                                  # non-ok prediction REFUSED; missing-provenance
│                                  # REFUSAL; cross-tenant REFUSED everywhere
├── proposal-gate.test.ts          # The proposal-gate law (ALLOW/WARN/RA/BLOCK);
│                                  # the bridge NEVER submits (no submit path —
│                                  # machine-tested)
├── counterfactual-visibility.test.ts  # The hypothetical marker survives
│                                  # conversion (THREE surfaces)
├── outcome-binding.test.ts        # The observed-vs-predicted join; horizon-mismatch
│                                  # REFUSES; provenance chain verified
├── contract-conformance.test.ts   # The src-discipline + frozen-surface checks
│                                  # (machine-enforced)
└── binding.test.ts                # The integration binding proof (REAL
                                  # @fleetos/audit sink adapter + REAL W154 engine
                                  # + REAL W070 outcome-observation shape)
```
