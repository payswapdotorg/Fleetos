/**
 * @fleetos/web-actions — the structural surface contracts (W060B).
 *
 * The W040-disclosed pattern: this surface lane consumes domain shapes
 * through LOCALLY-DECLARED structural seam types that the real W041
 * domain records structurally satisfy, WITHOUT importing the domain
 * package from src/ (src/ imports the shared seam `@fleetos/contracts`
 * only; the real binding is proven by cross-lane tests in `test/`).
 *
 *   - `SurfaceActionPlanRecord` is structurally satisfied by the W041
 *     `ActionPlanTemplate` (@fleetos/actions fleet-action).
 *   - `SurfaceDeviceGroupSelector` is structurally satisfied by the
 *     W041 `DeviceGroupSelector` discriminated union.
 *   - `SurfacePrintJobRecord` is structurally satisfied by the W041
 *     `PrintJobRequest` (@fleetos/actions print-orchestration).
 *   - `SurfacePrinterRecord` is structurally satisfied by the W041
 *     `PrinterDescriptor` (the extra `preferences` field is tolerated).
 *   - `GuardianDecisionRecord` is structurally satisfied by the frozen
 *     `GuardianDecision` (@fleetos/contracts policy).
 *
 * The frozen decision-type and blocking tables mirror the frozen
 * contracts/policy tables locally; the binding test proves they are
 * EQUAL (no re-declaration drift).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  PrintIntentPayload,
  PolicyId,
  TenantId,
  UserId,
} from "../../../../packages/contracts/src/index";

// ---------------------------------------------------------------------------
// The acting tenant scope
// ---------------------------------------------------------------------------

/** The acting tenant scope (first parameter of every surface builder). */
export interface SurfaceTenantScope {
  /** The tenant whose data the surface presents (structural tenant isolation). */
  readonly tenantId: TenantId;
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

/** A rule reference that fired (the frozen RuleRef shape). */
export interface GuardianRuleRefView {
  /** The rule identifier. */
  readonly ruleId: PolicyId;
  /** The rule version at evaluation time. */
  readonly ruleVersion: number;
}

/**
 * A frozen Guardian decision record (structural seam for the frozen
 * `GuardianDecision` contract). Observable fields only.
 */
export interface GuardianDecisionRecord {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: SurfaceDecisionType;
  /** The rules that fired (may be empty when no rule matched). */
  readonly rules: readonly GuardianRuleRefView[];
  /** Opaque evidence artifacts supporting the decision (may be empty). */
  readonly evidence: readonly EvidenceRef[];
  /** ISO 8601 timestamp of when the decision was made (injected upstream). */
  readonly decidedAt: string;
  /** Schema version of this decision record. */
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// Fleet Action plans (structural seam for the W041 ActionPlanTemplate)
// ---------------------------------------------------------------------------

/** The W041 action-plan status union (the policy-gate statuses). */
export type SurfacePlanStatus = "PROPOSAL" | "ADVANCED" | "PARKED" | "APPROVED" | "REJECTED";

/** All plan statuses (canonical order). */
export const ALL_SURFACE_PLAN_STATUSES: readonly SurfacePlanStatus[] = Object.freeze([
  "PROPOSAL",
  "ADVANCED",
  "PARKED",
  "APPROVED",
  "REJECTED",
]);

/**
 * A typed device-group selector (structural seam for the W041
 * `DeviceGroupSelector` discriminated union — a PURE value the target
 * resolver evaluates against an injected registry view).
 */
export type SurfaceDeviceGroupSelector =
  | { readonly kind: "all" }
  | { readonly kind: "byId"; readonly deviceIds: readonly DeviceId[] }
  | { readonly kind: "byPlatform"; readonly platform: string }
  | { readonly kind: "byOwnership"; readonly ownership: string }
  | { readonly kind: "byLifecycleState"; readonly state: string }
  | { readonly kind: "byCapability"; readonly capability: string }
  | { readonly kind: "byPostureSummary"; readonly summary: string }
  | { readonly kind: "intersect"; readonly selectors: readonly SurfaceDeviceGroupSelector[] }
  | { readonly kind: "union"; readonly selectors: readonly SurfaceDeviceGroupSelector[] }
  | {
      readonly kind: "subtract";
      readonly base: SurfaceDeviceGroupSelector;
      readonly minus: SurfaceDeviceGroupSelector;
    };

/** All selector kinds (for validation + iteration). */
export const ALL_SURFACE_SELECTOR_KINDS: readonly SurfaceDeviceGroupSelector["kind"][] =
  Object.freeze([
    "all",
    "byId",
    "byPlatform",
    "byOwnership",
    "byLifecycleState",
    "byCapability",
    "byPostureSummary",
    "intersect",
    "union",
    "subtract",
  ]);

/**
 * A versioned, immutable Fleet Action plan record (structural seam for
 * the W041 `ActionPlanTemplate`). A plan is a PROPOSAL until the
 * Contract Guardian evaluates it; transitions are policy-gated (see
 * `action-plans-view.ts`).
 */
export interface SurfaceActionPlanRecord {
  /** The deterministic plan identity. */
  readonly planId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The stable human name. */
  readonly name: string;
  /** Human description (never matched on). */
  readonly description?: string;
  /** The plan version (>= 1; increments on every revision). */
  readonly version: number;
  /** The device-group selector the targets were resolved from. */
  readonly selector: SurfaceDeviceGroupSelector;
  /** The intended capability invocation per target (open string). */
  readonly capability: string;
  /** The resolved target device set (sorted by deviceId; frozen). */
  readonly selectedTargets: readonly DeviceId[];
  /** The target count (mirrors selectedTargets.length). */
  readonly targetCount: number;
  /** The plan status (transitions via the policy gate). */
  readonly status: SurfacePlanStatus;
  /** ISO 8601 creation timestamp (injected upstream). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (absent on PROPOSAL). */
  readonly transitionedAt?: string;
  /** The principal who requested the action, when known. */
  readonly requestedBy?: UserId;
  /** Opaque evidence artifacts supporting the plan (never interpreted). */
  readonly evidence: readonly EvidenceRef[];
  /** Canonical digest of the plan's CONTENT (opaque pass-through). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// Print orchestration (structural seams for the W041 print records)
// ---------------------------------------------------------------------------

/** The W041 print job status union. */
export type SurfacePrintJobStatus = "ROUTED" | "QUEUED" | "REFUSED" | "COMPLETED";

/** All print job statuses (canonical order). */
export const ALL_SURFACE_PRINT_JOB_STATUSES: readonly SurfacePrintJobStatus[] = Object.freeze([
  "ROUTED",
  "QUEUED",
  "REFUSED",
  "COMPLETED",
]);

/**
 * The declared printer feature capabilities (structural seam for the
 * W041 `PrinterCapabilities`): explicit support only — an undefined or
 * false flag is UNSUPPORTED and is REFUSED, never emulated.
 */
export interface SurfacePrinterCapabilities {
  readonly color?: boolean;
  readonly duplex?: boolean;
  readonly staple?: boolean;
  readonly punch?: boolean;
  readonly scan?: boolean;
  readonly fax?: boolean;
  readonly largeFormat?: boolean;
  readonly photo?: boolean;
  readonly cardstock?: boolean;
}

/** The full list of capability names (mirrors the W041 table; proven equal by test). */
export const ALL_SURFACE_PRINTER_CAPABILITIES: readonly (keyof SurfacePrinterCapabilities)[] =
  Object.freeze([
    "color",
    "duplex",
    "staple",
    "punch",
    "scan",
    "fax",
    "largeFormat",
    "photo",
    "cardstock",
  ]);

/**
 * A versioned, immutable print job record (structural seam for the W041
 * `PrintJobRequest`). The frozen `PrintIntentPayload` (documentRef +
 * targetUserId) passes through verbatim.
 */
export interface SurfacePrintJobRecord {
  /** The deterministic job identity. */
  readonly jobId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The schema version of this job record. */
  readonly version: number;
  /** The FROZEN PrintIntentPayload (documentRef + targetUserId — verbatim). */
  readonly payload: PrintIntentPayload;
  /** The required printer features (capability subset the document demands). */
  readonly requiredFeatures: SurfacePrinterCapabilities;
  /** The resolved printer (when ROUTED / QUEUED / COMPLETED; absent when REFUSED). */
  readonly printerId?: string;
  /** The queue position assigned by the router (when ROUTED / QUEUED). */
  readonly queuePosition?: number;
  /** The job status. */
  readonly status: SurfacePrintJobStatus;
  /** ISO 8601 creation timestamp (injected upstream). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp. */
  readonly transitionedAt?: string;
  /** Opaque evidence artifacts supporting the job (never interpreted). */
  readonly evidence: readonly EvidenceRef[];
  /** The correlation id of the originating request. */
  readonly correlationId: CorrelationId;
  /** Machine-stable routing reasons (the unsupported features list; present when REFUSED). */
  readonly routingReasons?: readonly string[];
  /** Canonical digest of the job's CONTENT (opaque pass-through). */
  readonly contentDigest: string;
}

/**
 * A typed printer record (structural seam for the W041
 * `PrinterDescriptor` — the `preferences` bag is tolerated and unused
 * by the surface; capability-aware, tenant-scoped, observable).
 */
export interface SurfacePrinterRecord {
  /** The printer identifier (open string; the consumer assigns it). */
  readonly printerId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The printer's declared capabilities (explicit support only). */
  readonly capabilities: SurfacePrinterCapabilities;
  /** Whether the printer is on the tenant's approved list (observable). */
  readonly approved?: boolean;
  /** The printer's geographic location (open string). */
  readonly location?: string;
}
