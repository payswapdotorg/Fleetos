/**
 * @fleetos/web-security — the structural surface contracts (W060B D1).
 *
 * The W040-disclosed pattern: this surface lane consumes domain shapes
 * through LOCALLY-DECLARED structural seam types that the real domain
 * records structurally satisfy, WITHOUT importing the domain packages
 * from src/ (src/ imports the shared seam `@fleetos/contracts` only;
 * the real binding is proven by cross-lane tests in `test/`).
 *
 *   - `SecurityFindingRecord` is structurally satisfied by the W031
 *     Security Doctor's `SecurityFinding` (@fleetos/security posture).
 *   - `GuardianDecisionRecord` is structurally satisfied by the frozen
 *     `GuardianDecision` (@fleetos/contracts policy).
 *   - `GuardianEvaluationRecord` is structurally satisfied by the W031
 *     Guardian engine's `GuardianEvaluation` (@fleetos/policy engine).
 *   - `ParkedApprovalItemInput` pairs a W041 parked `ActionPlanTemplate`
 *     (@fleetos/actions fleet-action) with the REQUIRE_APPROVAL
 *     decision that parked it (linked by the binding site).
 *
 * Every seam type carries the frozen contracts field shapes verbatim
 * (branded ids, evidence refs, decision types). Extra fields the domain
 * records carry are tolerated (structural supertypes); the surface
 * NEVER re-derives domain truth — it presents observable fields only.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  DeviceId,
  ObservationId,
  PolicyId,
  SecurityRemediationIntentPayload,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import { SECURITY_REMEDIATION_INTENT_KIND } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The acting tenant scope
// ---------------------------------------------------------------------------

/** The acting tenant scope (first parameter of every surface builder). */
export interface SurfaceTenantScope {
  /** The tenant whose data the surface presents (structural tenant isolation). */
  readonly tenantId: TenantId;
}

// ---------------------------------------------------------------------------
// Security Doctor findings (structural seam for W031's SecurityFinding)
// ---------------------------------------------------------------------------

/** The severity union (the W031 posture model's frozen severities). */
export type SurfaceSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** All severities in the surface's canonical (most severe first) order. */
export const ALL_SURFACE_SEVERITIES: readonly SurfaceSeverity[] = Object.freeze([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
]);

/** The machine-stable severity rank (higher = more severe). */
export const SURFACE_SEVERITY_RANK: Readonly<Record<SurfaceSeverity, number>> = Object.freeze({
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
});

/** The finding classification union (the W031 posture model's frozen classifications). */
export type SurfaceFindingClassification = "compliance" | "configuration" | "exposure" | "threat";

/**
 * An OPAQUE evidence link to the immutable observation that supports a
 * finding. The surface displays the reference only; it never interprets
 * observation payloads.
 */
export interface FindingEvidenceRef {
  /** The source observation id (opaque reference). */
  readonly observationId: ObservationId;
  /** The observation kind (open string; displayed, never matched on). */
  readonly kind: string;
}

/**
 * A DRAFT remediation proposal (structural seam for W031's
 * `SecurityRemediationProposal`). Payload shape ONLY: no intent id, no
 * lifecycle status, no dispatch path — the surface presents it as a
 * PROPOSAL and never as an executable action.
 */
export interface RemediationProposalDraft {
  /** The frozen intent kind this proposal drafts. */
  readonly intentKind: typeof SECURITY_REMEDIATION_INTENT_KIND;
  /** The draft payload (frozen shape from @fleetos/contracts). */
  readonly payload: SecurityRemediationIntentPayload;
}

/**
 * A versioned security-posture finding record (structural seam for
 * W031's `SecurityFinding` — an interpretation, never a fact).
 */
export interface SecurityFindingRecord {
  /** The stable finding identity (digest of tenantId, deviceId, code). */
  readonly findingId: string;
  /** The record identity (digest including the interpretation version). */
  readonly recordId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device the finding concerns. */
  readonly deviceId: DeviceId;
  /** The machine-stable finding code (e.g. "security.device.disk_encryption.off"). */
  readonly code: string;
  /** The human title (displayed; never matched on). */
  readonly title: string;
  /** The severity. */
  readonly severity: SurfaceSeverity;
  /** The classification. */
  readonly classification: SurfaceFindingClassification;
  /** The interpretation version (>= 1). */
  readonly interpretationVersion: number;
  /** The prior record this interpretation supersedes (absent on version 1). */
  readonly supersedes?: string;
  /** ISO 8601 timestamp of the assessment (injected upstream). */
  readonly detectedAt: string;
  /** ISO 8601 timestamp of the source observation. */
  readonly observedAt: string;
  /** Opaque evidence links to the supporting observations (observationId order). */
  readonly evidence: readonly FindingEvidenceRef[];
  /** A DRAFT remediation proposal (CRITICAL/HIGH findings only). */
  readonly remediation?: RemediationProposalDraft;
}

// ---------------------------------------------------------------------------
// Contract Guardian decision (structural seam for the frozen contracts shape)
// ---------------------------------------------------------------------------

/** The frozen Guardian decision types. */
export type SurfaceDecisionType = "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";

/** All decision types (canonical order). */
export const ALL_SURFACE_DECISION_TYPES: readonly SurfaceDecisionType[] = Object.freeze([
  "ALLOW",
  "WARN",
  "REQUIRE_APPROVAL",
  "BLOCK",
]);

/**
 * The blocking precedence rank of each decision type (higher wins —
 * the W031 engine's frozen precedence, mirrored locally and proven
 * equal to the engine's table by the binding test).
 */
export const DECISION_PRECEDENCE_RANK_VIEW: Readonly<Record<SurfaceDecisionType, number>> =
  Object.freeze({ ALLOW: 0, WARN: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 });

/**
 * An OPAQUE evidence artifact reference (the frozen `EvidenceRef`
 * contract shape — content-addressable key + hash; never interpreted).
 */
export interface GuardianEvidenceRefView {
  /** The object-storage key (content-addressable; opaque). */
  readonly key: string;
  /** The size of the artifact in bytes. */
  readonly sizeBytes: number;
  /** The cryptographic hash of the artifact (e.g. sha256 hex). */
  readonly hash: string;
  /** The hash algorithm used (e.g. "sha256"). */
  readonly hashAlgorithm: string;
}

/** A reference to a Guardian rule that fired (the frozen RuleRef shape). */
export interface GuardianRuleRefView {
  /** The rule identifier. */
  readonly ruleId: PolicyId;
  /** The rule version at evaluation time. */
  readonly ruleVersion: number;
}

/**
 * A frozen Guardian decision record (structural seam for the frozen
 * `GuardianDecision` contract). Observable fields only — the decision
 * type, the rules that fired, the evidence refs, the instant.
 */
export interface GuardianDecisionRecord {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: SurfaceDecisionType;
  /** The rules that fired (may be empty when no rule matched). */
  readonly rules: readonly GuardianRuleRefView[];
  /** Opaque evidence artifacts supporting the decision (may be empty). */
  readonly evidence: readonly GuardianEvidenceRefView[];
  /** ISO 8601 timestamp of when the decision was made (injected upstream). */
  readonly decidedAt: string;
  /** Schema version of this decision record. */
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// Guardian engine evaluation (structural seam for W031's GuardianEvaluation)
// ---------------------------------------------------------------------------

/**
 * A machine-stable evaluation reason (structural seam for the W031
 * engine's `GuardianReason`). All fields enumerated — no free text,
 * no intent assertion (ARCHITECTURE-LOCK item 11).
 */
export interface GuardianReasonView {
  /** The stable machine code (e.g. "policy.rule.matched"). */
  readonly code: string;
  /** The rule that produced this reason, when applicable. */
  readonly ruleId?: PolicyId;
  /** The rule version at evaluation time, when applicable. */
  readonly ruleVersion?: number;
  /** The condition kind that matched, when applicable. */
  readonly conditionKind?: string;
  /** The effect the matched rule contributes, when applicable. */
  readonly effect?: SurfaceDecisionType;
  /** The chosen effect when the reason records a precedence resolution. */
  readonly chosen?: SurfaceDecisionType;
}

/**
 * A matched rule projection (structural seam for a W031 `GuardianRule`
 * as surfaced by the engine's `matchedRules`). Observable fields only:
 * identity, version, the effect it contributes.
 */
export interface GuardianMatchedRuleView {
  /** The rule identity. */
  readonly ruleId: PolicyId;
  /** The rule name (human; displayed, never matched on). */
  readonly name: string;
  /** The rule version at evaluation time (>= 1). */
  readonly version: number;
  /** The effect the rule contributes. */
  readonly effect: SurfaceDecisionType;
}

/**
 * A full Guardian evaluation (structural seam for the W031 engine's
 * `GuardianEvaluation`): the frozen decision plus the engine-side
 * context (rule set identity, matched rules, machine-stable reasons).
 */
export interface GuardianEvaluationRecord {
  /** The FROZEN Guardian decision (contracts shape). */
  readonly decision: GuardianDecisionRecord;
  /** The rule set that was evaluated. */
  readonly ruleSetId: string;
  /** The rule set's version (the "policy version" of the decision). */
  readonly ruleSetVersion: number;
  /** The rules that fired, in the engine's ruleId order. */
  readonly matchedRules: readonly GuardianMatchedRuleView[];
  /** Machine-stable reasons, in the engine's emitted order. */
  readonly reasons: readonly GuardianReasonView[];
}

// ---------------------------------------------------------------------------
// Parked approvals (structural seam for the W041 parked plan + decision pair)
// ---------------------------------------------------------------------------

/** The action-plan status union (the W041 policy-gate statuses). */
export type SurfacePlanStatus = "PROPOSAL" | "ADVANCED" | "PARKED" | "APPROVED" | "REJECTED";

/**
 * A Fleet Action plan record (structural seam for the W041
 * `ActionPlanTemplate`). The full status union is accepted; the
 * approvals-queue builder REFUSES any record that is not PARKED
 * (fail-closed — a wrong-status input is a bug, never silently
 * filtered).
 */
export interface ParkedPlanRecord {
  /** The deterministic plan identity. */
  readonly planId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The stable human name. */
  readonly name: string;
  /** The plan version (>= 1). */
  readonly version: number;
  /** The plan status (the full W041 union; the queue validates PARKED). */
  readonly status: SurfacePlanStatus;
  /** The intended capability invocation per target (open string). */
  readonly capability: string;
  /** The target count. */
  readonly targetCount: number;
  /** ISO 8601 creation timestamp (injected upstream). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (the parked-at instant, when PARKED). */
  readonly transitionedAt?: string;
  /** The principal who requested the action, when known. */
  readonly requestedBy?: UserId;
}

/**
 * One parked-approval queue item: a W041 parked plan LINKED to the
 * Guardian evaluation whose REQUIRE_APPROVAL decision parked it (the
 * binding site links the pair — e.g. the submit pipeline's evaluation
 * result and the transitioned plan).
 */
export interface ParkedApprovalItemInput {
  /** The parked plan (status MUST be PARKED). */
  readonly plan: ParkedPlanRecord;
  /** The evaluation whose decision MUST be REQUIRE_APPROVAL (presented as decision context). */
  readonly evaluation: GuardianEvaluationRecord;
}

export { SECURITY_REMEDIATION_INTENT_KIND };
