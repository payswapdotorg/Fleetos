/**
 * @fleetos/web-actions — W142: the runtime state structural seams.
 *
 * The W141-disclosed pattern: domain surfaces are injected at binding
 * sites as STRUCTURAL shapes, never imported as cross-lane modules.
 * The ownership gate allows `@fleetos/contracts` as the only cross-lane
 * src/ import; the Fleet Action plan + print records live in
 * `@fleetos/actions` (worker-b — the SAME package, but bound as an
 * external source so this UI package stays free of cross-lane src/
 * imports), the policy engine in `@fleetos/policy` (worker-b), and the
 * audit log in `@fleetos/audit` (worker-b).
 *
 * The W142 runtime state contract for the actions lane — the sources a
 * fleet-action surface composes from:
 *
 *   - the tenant's action plans (the W041 `ActionPlanTemplate` ledger);
 *   - the plan revision chain (the versioned history per plan id);
 *   - the resolved target set (the W041 `resolveActionTargets` output);
 *   - the parked approval items (the W041 parked plan + parking
 *     decision pair);
 *   - the verification record (when execution completed and was
 *     verified).
 *
 * PLUS the print-distribution runtime state (the W100B distribution
 * plan + per-person entries):
 *
 *   - the distribution plan (the W100B `PrintDistributionPlan`);
 *   - the per-person distribution entries (each person's job +
 *     approved printer + refusal reasons).
 *
 * Open unions (plan statuses, decision types, selector kinds) are the
 * frozen contracts vocabulary verbatim — never re-derived. Evidence
 * refs are OPAQUE content-addressable keys — never interpreted.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type { CorrelationId, TenantId, UserId } from "@fleetos/contracts";
import type { SurfaceTenantScope } from "./surface-contracts";
import type {
  SurfaceActionPlanRecord,
  SurfaceDeviceGroupSelector,
  SurfacePlanStatus,
  SurfacePrintJobRecord,
  SurfacePrinterCapabilities,
  SurfacePrinterRecord,
} from "./surface-contracts";
import type { GuardianDecisionRecord } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The audit sink seam (structurally the @fleetos/audit AuditSink shape)
// ---------------------------------------------------------------------------

/**
 * The append-only audit record the actions lane emits. Structurally
 * identical to `@fleetos/audit`'s `AuditSinkRecord` — the REAL sink
 * adapter accepts this shape at the binding site without a cross-lane
 * import.
 */
export interface ActionsDecisionAuditRecord {
  readonly tenantId: TenantId;
  readonly action: string;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The append-only audit sink. Implementations MUST NOT drop records.
 * INJECTED at the binding site (the REAL `@fleetos/audit` log through
 * its sink adapter; the collecting sink in tests).
 */
export interface ActionsDecisionAuditSink {
  append(record: ActionsDecisionAuditRecord): void;
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_ACTIONS_AUDIT_SINK: ActionsDecisionAuditSink = Object.freeze({
  append: (_record: ActionsDecisionAuditRecord): void => undefined,
});

// ---------------------------------------------------------------------------
// The plan source (the W041 ActionPlanTemplate ledger)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned plan source. INJECTED at the binding site —
 * the REAL `@fleetos/actions` `createActionPlan` ledger satisfies this
 * structurally.
 *
 * Contract:
 *   - `list` returns ONLY the acting tenant's plans, deterministically
 *     ordered (sorted by createdAt asc, then planId asc — the
 *     surface's frozen order);
 *   - `get` returns `undefined` for foreign/unknown plans — no
 *     existence side channel across tenants.
 */
export interface ActionPlanSource {
  list(tenantId: TenantId): readonly SurfaceActionPlanRecord[];
  get(tenantId: TenantId, planId: string): SurfaceActionPlanRecord | undefined;
}

// ---------------------------------------------------------------------------
// The plan revision source (the versioned history per plan id)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned plan revision source — the versioned history
 * chain for one plan id. INJECTED at the binding site; the REAL W041
 * ledger's revisions satisfy this structurally.
 */
export interface ActionPlanRevisionSource {
  /** The revision chain for one plan id (version order; the latest leads). */
  revisions(tenantId: TenantId, planId: string): readonly SurfaceActionPlanRecord[];
}

// ---------------------------------------------------------------------------
// The target resolver seam (the W041 resolveActionTargets output)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned target resolver. INJECTED at the binding site;
 * the REAL `@fleetos/actions` `resolveActionTargets` over the device
 * registry view satisfies this structurally. PURE: targets are a pure
 * projection of (selector, registry view, tenant).
 */
export interface TargetResolverSource {
  /** Resolve the target device set for the selector (sorted, frozen). */
  resolve(
    tenantId: TenantId,
    selector: SurfaceDeviceGroupSelector,
  ): readonly { readonly deviceId: string }[];
}

// ---------------------------------------------------------------------------
// The linked Guardian decision seam (the decision context for a plan)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned Guardian decision source — the decision that
 * produced the plan's current status (when the plan was submitted).
 * INJECTED at the binding site; the REAL `@fleetos/policy` Guardian
 * engine's evaluation records satisfy this structurally.
 */
export interface PlanDecisionSource {
  /** The Guardian decision that produced the plan's current status, when linked. */
  decisionFor(
    tenantId: TenantId,
    planId: string,
  ): GuardianDecisionRecord | undefined;
}

// ---------------------------------------------------------------------------
// The verification seam (the W041 verification record per plan)
// ---------------------------------------------------------------------------

/**
 * The verification record — the REAL runtime state of a verified fleet
 * action outcome. The structural projection the binding site derives
 * from the REAL action boundary's verification step.
 */
export interface FleetActionVerificationRecord {
  readonly planId: string;
  readonly tenantId: TenantId;
  readonly verifiedAt: string;
  readonly summary: string;
  readonly evidenceCount: number;
  /** The per-target outcome (one row per target in the plan's resolved set). */
  readonly perTarget: readonly {
    readonly deviceId: string;
    readonly outcome: string;
    readonly evidenceCount: number;
  }[];
}

/**
 * The tenant-partitioned verification source. INJECTED at the binding
 * site; the REAL action-boundary verification records satisfy this
 * structurally.
 */
export interface FleetActionVerificationSource {
  /** The verification record for one plan (when verification completed). */
  verificationFor(
    tenantId: TenantId,
    planId: string,
  ): FleetActionVerificationRecord | undefined;
}

// ---------------------------------------------------------------------------
// The print-distribution runtime state seam
// ---------------------------------------------------------------------------

/**
 * One per-person distribution entry (the W100B domain shape, projected
 * structurally — the actions package already exposes this in
 * `print-distribution-view.ts`; this is the runtime seam variant the
 * feed composes from).
 */
export interface PrintDistributionEntryRecord {
  /** The person (the job's targetUserId). */
  readonly userId: string;
  /** The person's job (ROUTED to an approved printer, or REFUSED). */
  readonly job: SurfacePrintJobRecord;
  /** Whether the entry was REFUSED (mirrors job.status). */
  readonly refused: boolean;
  /** The count of tenant-matching APPROVED printers in the person's pool. */
  readonly approvedPrinterCount: number;
  /** Capable-but-unapproved printer count (escalation context, observable). */
  readonly unapprovedCapablePrinterCount: number;
  /** Capable-but-unapproved printer ids (sorted; escalation affordances). */
  readonly unapprovedCapablePrinterIds: readonly string[];
}

/**
 * The distribution plan record (the W100B domain shape, projected
 * structurally).
 */
export interface PrintDistributionPlanRecord {
  readonly tenantId: TenantId;
  readonly documentRef: string;
  readonly entries: readonly PrintDistributionEntryRecord[];
  readonly summary: {
    readonly total: number;
    readonly routed: number;
    readonly refused: number;
  };
}

/**
 * The tenant-partitioned print-distribution source. INJECTED at the
 * binding site; the REAL `@fleetos/actions` `planPrintDistribution`
 * output satisfies this structurally.
 */
export interface PrintDistributionSource {
  /** The distribution plan for one document (when distributed). */
  distributionFor(
    tenantId: TenantId,
    documentRef: string,
  ): PrintDistributionPlanRecord | undefined;
}

// ---------------------------------------------------------------------------
// Re-exports for the seam consumers
// ---------------------------------------------------------------------------

export type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
  SurfaceDeviceGroupSelector,
  SurfacePlanStatus,
  SurfacePrintJobRecord,
  SurfacePrinterCapabilities,
  SurfacePrinterRecord,
  SurfaceTenantScope,
} from "./surface-contracts";

// ---------------------------------------------------------------------------
// The acting principal (for the actions RBAC path, when needed)
// ---------------------------------------------------------------------------

/** The acting principal (mirrors the security lane's AuthorityRecord). */
export interface ActionsPrincipal {
  readonly tenantId: TenantId;
  readonly principalId: UserId;
  /** The permission names the active role assignments grant (open vocabulary). */
  readonly permissions: readonly string[];
}
