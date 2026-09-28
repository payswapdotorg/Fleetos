/**
 * @fleetos/web-recovery — the STRUCTURAL seams over the recovery +
 * fleet-action domains.
 *
 * The W040-disclosed pattern: domain surfaces are injected at binding
 * sites as STRUCTURAL shapes, never imported as cross-lane modules.
 * The ownership gate (`tools/check-ownership.mjs`) allows
 * `@fleetos/contracts` as the only cross-lane src/ import; the
 * recovery domain lives in `@fleetos/recovery` (same lane, but the
 * work order binds this UI lane to contracts-only src/ imports) and
 * the fleet-action domain in `@fleetos/actions` (worker-b). This
 * package therefore declares the structural subset of those domain
 * surfaces its view-models consume, and the BINDING SITE (the W061
 * shell in production; the test suite in this wave) injects the real
 * packages — proven by test:
 *
 *   - `@fleetos/recovery`'s REAL `FindMyDeviceView` satisfies
 *     `FindMyViewLike` structurally; the REAL `LastSeenRecord` (ledger
 *     revisions) satisfies `LastSeenRevisionLike`; the REAL
 *     `RecoveryCaseRecord` satisfies `RecoveryCaseLike`; the REAL
 *     `DestructiveRequestRecord` satisfies `DestructiveRequestLike`
 *     (the Guardian decision is typed by the FROZEN contracts shape).
 *   - `@fleetos/actions`'s REAL `ActionPlanTemplate` satisfies
 *     `ActionPlanLike` (the recursive `DeviceGroupSelector` satisfies
 *     `SelectorLike`).
 *   - The frozen `GuardianDecision` / `GuardianDecisionType` /
 *     `EvidenceRef` types come from `@fleetos/contracts` verbatim —
 *     the cross-lane seam.
 *
 * Status unions (case statuses, plan statuses, request statuses,
 * staleness classifications) are consumed as `string`: the surface is
 * provider-neutral — it displays what the domain asserted, verbatim,
 * and never re-derives domain truth. The state MACHINE tables are
 * injected at the binding site (`StatusMachineTable`), so the display
 * can never drift from the domain's frozen transition tables.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type {
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  GuardianDecisionType,
  TenantId,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Find My Device (W040 D1) — structural twins
// ---------------------------------------------------------------------------

/**
 * The machine-stable Find-My-Device location states — the structural
 * twin of the recovery domain's `no_location_evidence` / `located`
 * union (mirrored as literal types so the surface can never invent a
 * third state).
 */
export type FindMyLocationStatus = "no_location_evidence" | "located";

/** The current last-seen summary — structural twin of the domain view's. */
export interface LastSeenSummaryLike {
  readonly recordId: string;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly staleness: string;
  readonly evidence: readonly string[];
}

/**
 * The derived last-known-location state — structural twin of the
 * domain's `FindMyDeviceLocation` (the payload stays the DOMAIN's
 * business: the surface never carries — and therefore never
 * interprets — location payload bytes; the observation evidence ref
 * is the anchor).
 */
export type FindMyLocationLike =
  | { readonly status: "no_location_evidence" }
  | {
      readonly status: "located";
      readonly observationId: string;
      readonly observedAt: string;
      readonly kind: string;
      readonly staleness: string;
      readonly fromRecordId: string;
    };

/** The Find-My-Device view of one device — structural twin. */
export interface FindMyViewLike {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly lastSeen: LastSeenSummaryLike | undefined;
  readonly location: FindMyLocationLike;
}

/** One append-only last-seen ledger revision — structural twin. */
export interface LastSeenRevisionLike {
  readonly recordId: string;
  readonly version: number;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly staleness: string;
  readonly evidence: readonly string[];
  /** Does this revision carry location-bearing evidence? */
  readonly hasLocationEvidence: boolean;
}

/** The injected staleness bands (the view's band policy). */
export interface FindMyBands {
  readonly freshWithinMs: number;
  readonly staleAfterMs: number;
}

/**
 * The tenant-partitioned Find-My-Device source — the last-seen
 * evidence ledger surfaced READ-ONLY. INJECTED at the binding site
 * (the REAL `findMyDevice` + the REAL ledger in this wave's tests;
 * live stores in the W061 shell).
 *
 * `view` re-derives staleness against the VIEW's injected instant +
 * bands (the domain's own re-derivation discipline); `revisions`
 * returns the device's full append-only ledger, version order.
 */
export interface FindMyDeviceSource {
  view(
    tenantId: TenantId,
    deviceId: DeviceId,
    at: string,
    bands: FindMyBands,
  ): FindMyViewLike;
  revisions(tenantId: TenantId, deviceId: DeviceId): readonly LastSeenRevisionLike[];
}

// ---------------------------------------------------------------------------
// Recovery cases (W040 D2) — structural twins + the injected machine
// ---------------------------------------------------------------------------

/** The observable trigger that opened a case — structural twin. */
export interface RecoveryTriggerLike {
  readonly kind: string;
  readonly reportedAt?: string;
  readonly reportedBy?: string;
  readonly note?: string;
  readonly postureStatus?: string;
  readonly findingRefs?: readonly string[];
  readonly assessedAt?: string;
}

/** The case evidence basis — structural twin. */
export interface RecoveryCaseEvidenceLike {
  readonly lastSeenRecordId?: string;
  readonly lastSeenObservedAt?: string;
  readonly postureFindingRefs: readonly string[];
}

/** A versioned recovery-case revision — structural twin. */
export interface RecoveryCaseLike {
  readonly caseId: string;
  readonly recordId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly version: number;
  readonly status: string;
  readonly trigger: RecoveryTriggerLike;
  readonly evidence: RecoveryCaseEvidenceLike;
  readonly openedAt: string;
  readonly transitionedAt?: string;
  readonly closureReason?: string;
  readonly closedAt?: string;
  readonly contentDigest: string;
}

/**
 * The injected status-machine table: the domain's frozen transition
 * table + terminal + (for cases) the ACTIVE statuses that alone accept
 * destructive requests. Injected at the binding site so the surface
 * can never drift from the domain tables.
 */
export interface StatusMachineTable {
  /** The domain's frozen transition table (from-status -> legal next). */
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  /** The terminal statuses (no outgoing transitions). */
  readonly terminal: readonly string[];
  /** The active statuses (the destructive-gate precondition), when the domain defines them. */
  readonly active?: readonly string[];
  /** The parked statuses (held for human approval), when the domain defines them. */
  readonly parked?: readonly string[];
}

/**
 * The tenant-partitioned recovery-case source. INJECTED at the binding
 * site (the REAL `RecoveryCaseStore` in this wave's tests).
 */
export interface RecoveryCaseSource {
  /** The LATEST revision of every case in the tenant, deterministic order. */
  list(tenantId: TenantId): readonly RecoveryCaseLike[];
  /** Every revision of one case, version order (the append-only history). */
  history(tenantId: TenantId, caseId: string): readonly RecoveryCaseLike[];
  /** The LATEST revision of one case, or undefined (own partition only). */
  latest(tenantId: TenantId, caseId: string): RecoveryCaseLike | undefined;
}

// ---------------------------------------------------------------------------
// Fleet actions (W041) — structural twins
// ---------------------------------------------------------------------------

/**
 * A typed device-group selector — the structural twin of the actions
 * domain's recursive `DeviceGroupSelector` (every consumed kind + the
 * composed algebra, structurally compatible with the real union).
 */
export type SelectorLike =
  | { readonly kind: "all" }
  | { readonly kind: "byId"; readonly deviceIds: readonly DeviceId[] }
  | { readonly kind: "byPlatform"; readonly platform: string }
  | { readonly kind: "byOwnership"; readonly ownership: string }
  | { readonly kind: "byLifecycleState"; readonly state: string }
  | { readonly kind: "byCapability"; readonly capability: string }
  | { readonly kind: "byPostureSummary"; readonly summary: string }
  | { readonly kind: "intersect" | "union"; readonly selectors: readonly SelectorLike[] }
  | { readonly kind: "subtract"; readonly base: SelectorLike; readonly minus: SelectorLike };

/** A versioned action plan — structural twin of the actions domain's. */
export interface ActionPlanLike {
  readonly planId: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly selector: SelectorLike;
  readonly capability: string;
  readonly selectedTargets: readonly DeviceId[];
  readonly targetCount: number;
  readonly status: string;
  readonly createdAt: string;
  readonly transitionedAt?: string;
  readonly requestedBy?: string;
  readonly evidence: readonly EvidenceRef[];
  readonly contentDigest: string;
}

/**
 * The tenant-partitioned action-plan source. INJECTED at the binding
 * site (the REAL `ActionStore` in this wave's tests).
 */
export interface ActionPlanSource {
  /** The LATEST revision of every plan in the tenant, deterministic order. */
  list(tenantId: TenantId): readonly ActionPlanLike[];
  /** The LATEST revision of one plan, or undefined (own partition only). */
  latest(tenantId: TenantId, planId: string): ActionPlanLike | undefined;
}

// ---------------------------------------------------------------------------
// Destructive recovery requests (W040 D3) — structural twins
// ---------------------------------------------------------------------------

/** A matched Guardian rule ref — structural twin of the domain's. */
export interface MatchedRuleRefLike {
  readonly ruleId: string;
  readonly version: number;
}

/** A machine-stable evaluation reason — structural twin of the domain's. */
export interface EvaluationReasonLike {
  readonly code: string;
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  readonly conditionKind?: string;
  readonly effect?: GuardianDecisionType;
  readonly chosen?: GuardianDecisionType;
}

/** The execution dispatch outcome — structural twin of the domain's. */
export interface ExecutionRecordLike {
  readonly attemptedAt: string;
  readonly outcome: "executed" | "failed";
  readonly adapterEvidence: readonly EvidenceRef[];
}

/**
 * A versioned destructive-request revision — structural twin of the
 * domain's `DestructiveRequestRecord` (the intent payload is consumed
 * as its action kind; the Guardian decision is the FROZEN contracts
 * shape, verbatim).
 */
export interface DestructiveRequestLike {
  readonly requestId: string;
  readonly recordId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly caseId: string;
  readonly version: number;
  readonly action: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly requestedBy?: string;
  readonly caseEvidence: RecoveryCaseEvidenceLike;
  readonly evidence: readonly EvidenceRef[];
  /** The FROZEN Guardian decision (contracts shape, verbatim). */
  readonly decision?: GuardianDecision;
  readonly matchedRules?: readonly MatchedRuleRefLike[];
  readonly reasons?: readonly EvaluationReasonLike[];
  readonly refusalReason?: string;
  readonly decidedAt?: string;
  readonly approvedBy?: string;
  readonly approvalDecidedAt?: string;
  readonly execution?: ExecutionRecordLike;
  readonly contentDigest: string;
}

/**
 * The tenant-partitioned destructive-request source. INJECTED at the
 * binding site (the REAL `DestructiveRequestStore` in this wave's
 * tests).
 */
export interface DestructiveRequestSource {
  /** The LATEST revision of every request in the tenant, deterministic order. */
  list(tenantId: TenantId): readonly DestructiveRequestLike[];
  /** Every revision of one request, version order (the append-only history). */
  history(tenantId: TenantId, requestId: string): readonly DestructiveRequestLike[];
  /** The LATEST revision of one request, or undefined (own partition only). */
  latest(tenantId: TenantId, requestId: string): DestructiveRequestLike | undefined;
}
