/**
 * W090B web-learning test helpers — deterministic builders that bind
 * the surface's structural seams to the REAL `@fleetos/learning`
 * packages (W070). Local to the test suite (never exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy, no I/O. Cross-lane/dev-scope imports are TEST-SCOPE
 * ONLY (the W060 pattern: `@fleetos/learning` is a devDependency).
 *
 * The binding proofs live here BY TYPE: REAL `OutcomeObservation`
 * values flow where `OutcomeObservationLike` is expected, REAL
 * `EvaluationCaseSubmissionProposal` values flow where
 * `EvaluationCaseProposalLike` is expected, and REAL
 * `LearningAdoptionRecord` values flow where `AdoptionRecordLike` is
 * expected — TypeScript structural typing is the compile-time proof;
 * the tests are the runtime proof.
 */

import { asCorrelationId, asUserId, makeGuardianDecision } from "@fleetos/contracts";
import type { CorrelationId, GuardianDecision, TenantId, UserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  convertOutcomeToEvaluationCase,
  createInMemoryLearningAdoptionStore,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  recordCapabilityAdoption,
} from "@fleetos/learning";
import type {
  ActionPlanFacet,
  CertifiedCapabilityFacet,
  EvaluationCaseSubmissionProposal,
  LearningAdoptionRecord,
  LearningAdoptionStore,
  OutcomeObservation,
} from "@fleetos/learning";
import type {
  AdoptionRecordLike,
  EvaluationCaseProposalLike,
  LearningSurfaceTenantScope,
  OutcomeObservationLike,
} from "../src/seams";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
/** Later injected instants (transition flows). */
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids (canonical grammar). */
export const TENANT_A: TenantId = makeTenantId("w090b-lrn-a");
export const TENANT_B: TenantId = makeTenantId("w090b-lrn-b");

/** Deterministic principal + correlation ids. */
export const USER_1: UserId = asUserId("usr_w090blrnuser1");
export const USER_2: UserId = asUserId("usr_w090blrnuser2");
export const CORR: CorrelationId = asCorrelationId("cor_w090blrn01");
export const CORR_2: CorrelationId = asCorrelationId("cor_w090blrn02");

/** The acting tenant-A scope (the tenant rides every builder). */
export function scopeA(): LearningSurfaceTenantScope {
  return { tenantId: TENANT_A };
}

/** The REAL W070 learning tenant scope (for the domain calls). */
export function learningScopeA(): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_A, correlationId: CORR };
}

// ---------------------------------------------------------------------------
// REAL outcome observations (the W070 closed loop's intake)
// ---------------------------------------------------------------------------

/** A deterministic TERMINAL action plan (the W041 facet, APPROVED). */
export function terminalPlan(overrides: Partial<ActionPlanFacet> = {}): ActionPlanFacet {
  return {
    planId: "plan_w090b_terminal01",
    tenantId: TENANT_A,
    name: "w090b learning fixture plan",
    version: 2,
    status: "APPROVED",
    capability: "lock",
    selectedTargets: ["dev_w090blearning1" as never],
    targetCount: 1,
    createdAt: T0,
    transitionedAt: T1,
    contentDigest: "w090b-plan-digest-0001",
    // Evidence artifacts: the conversion derives the case's
    // observationRefs from the plan's evidence keys (NON-EMPTY is
    // required — an outcome without observable refs never converts).
    evidence: [
      {
        key: `evidence/w090b-plan-${overrides.planId ?? "terminal01"}`,
        sizeBytes: 256,
        hash: "w090b00000000000000000000000000000000000000000000000000000000",
        hashAlgorithm: "sha256",
      },
    ],
    ...overrides,
  };
}

/** Build a REAL outcome observation from a terminal plan (W070 D1). */
export function realObservation(
  overrides: Partial<ActionPlanFacet> = {},
  observedAt: string = T2,
): OutcomeObservation {
  const built = observeActionPlanOutcome(learningScopeA(), { plan: terminalPlan(overrides) }, {
    observedAt,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(`observeActionPlanOutcome failed: ${built.error.message}`);
  return built.observation;
}

// ---------------------------------------------------------------------------
// REAL Guardian-gated evaluation-case proposals (W070 D2)
// ---------------------------------------------------------------------------

/**
 * Build a REAL gated evaluation-case submission proposal from a REAL
 * outcome observation. The redaction state is REQUIRED (the conversion
 * never fabricates one); the Guardian decision is the FROZEN contracts
 * shape built with `makeGuardianDecision`.
 */
export function realGatedProposal(
  observation: OutcomeObservation,
  decisionType: "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK",
  decidedAt = T2,
): EvaluationCaseSubmissionProposal {
  const converted = convertOutcomeToEvaluationCase(learningScopeA(), observation, {
    tenantPolicyRefs: ["pol_w090b_learning_tenant_policy_1"],
    redaction: { state: "deidentified", appliedPolicies: ["pol_w090b_redaction_policy_1"] },
  });
  if (!converted.ok) throw new Error(`convertOutcomeToEvaluationCase failed: ${converted.error.message}`);

  const decision: GuardianDecision = makeGuardianDecision({
    tenantId: observation.tenantId,
    decision: decisionType,
    rules: [{ ruleId: "pol_w090b_learning_rule_1" as never, ruleVersion: 1 }],
    evidence: [],
    decidedAt,
    schemaVersion: 1,
  });

  const gated = gateEvaluationCaseProposal(learningScopeA(), converted.draft, decision);
  if (!gated.ok) throw new Error(`gateEvaluationCaseProposal failed: ${gated.error.message}`);
  return gated.proposal;
}

// ---------------------------------------------------------------------------
// REAL adoption ledger records (W070 D3 — supersession visible)
// ---------------------------------------------------------------------------

/** Deterministic certified-capability metadata (the Arena facet). */
export function certifiedMetadata(
  capabilityVersion: string,
  certificationRef: string,
): CertifiedCapabilityFacet {
  return {
    tenantId: TENANT_A,
    capabilityId: "cap_w090b_batteryhealth",
    capabilityVersion,
    certificationRef,
    evaluationSuiteRevision: "suite_w090b_rev2",
    fleetOSCompatibilityStatement: "compatible",
    warnings: [],
    capabilityClass: "device.health.treatment",
  };
}

/** The human-approved adoption proposal (the EXPLICIT grant). */
export function adoptionProposal(
  overrides: Partial<{
    proposalId: string;
    approverId: UserId;
    approvedAt: string;
    supersedes: string;
  }> = {},
): {
  proposalId: string;
  approverId: UserId;
  approvedAt: string;
  cohort: string;
  rollbackVersion: string;
  supersedes?: string;
} {
  return {
    proposalId: "prp_w090b_adoption_0001",
    approverId: USER_1,
    approvedAt: T2,
    cohort: "fleet-wide",
    rollbackVersion: "1.0.0",
    ...overrides,
  };
}

/** A seeded REAL adoption ledger: v1 adopted, then v2 SUPERSEDING v1. */
export function seededAdoptionLedger(): {
  store: LearningAdoptionStore;
  records: readonly LearningAdoptionRecord[];
} {
  const store = createInMemoryLearningAdoptionStore();

  const first = recordCapabilityAdoption(
    learningScopeA(),
    store,
    certifiedMetadata("1.0.0", "acr_w090bcertification0001"),
    adoptionProposal({ proposalId: "prp_w090b_adoption_0001", approvedAt: T2 }),
    { at: T2, correlationId: CORR },
  );
  if (!first.ok) throw new Error(`first adoption failed: ${first.error.message}`);

  const second = recordCapabilityAdoption(
    learningScopeA(),
    store,
    certifiedMetadata("1.1.0", "acr_w090bcertification0002"),
    adoptionProposal({
      proposalId: "prp_w090b_adoption_0002",
      approverId: USER_2,
      approvedAt: T3,
      supersedes: first.record.recordId,
    }),
    { at: T3, correlationId: CORR_2, rolloutPolicy: { kind: "canary", percentage: 25 } },
  );
  if (!second.ok) throw new Error(`second adoption failed: ${second.error.message}`);

  const records: LearningAdoptionRecord[] = [first.record, second.record];
  return { store, records };
}

// ---------------------------------------------------------------------------
// Structural-binding assertions (compile-time proofs, runtime-checked)
// ---------------------------------------------------------------------------

/** REAL observations satisfy the surface seam (runtime identity proof). */
export function realObservationsBind(
  observations: readonly OutcomeObservation[],
): readonly OutcomeObservationLike[] {
  // The return-type annotation IS the structural proof; the identity
  // return is the runtime proof that no adapter/mapping intervenes.
  return observations;
}

/** REAL gated proposals satisfy the surface seam. */
export function realProposalsBind(
  proposals: readonly EvaluationCaseSubmissionProposal[],
): readonly EvaluationCaseProposalLike[] {
  return proposals;
}

/** REAL adoption revisions satisfy the surface seam. */
export function realAdoptionsBind(
  records: readonly LearningAdoptionRecord[],
): readonly AdoptionRecordLike[] {
  return records;
}
