/**
 * @fleetos/web-actions — W100B: the ROLE-SHAPED print DISTRIBUTION
 * surface.
 *
 * The W100B product sentence rendered:
 *
 *   "selected people + document -> each person's approved printer
 *    receives the job."
 *
 * The domain plan (`@fleetos/actions` `planPrintDistribution` — W100B)
 * is presented through a STRUCTURAL SEAM (`SurfacePrintDistributionPlan
 * Record`, structurally satisfied by the domain `PrintDistributionPlan`
 * — proven by binding test) and shaped by the active role lens:
 *
 *   - the UNDERLYING distribution entries (per-person jobs, approved
 *     printers, refusal reasons, escalation context) are IDENTICAL for
 *     every lens (proven by test: same records + different lens =>
 *     identical `plan` projection, identical authority echo, identical
 *     affordance availability);
 *   - the LENS changes ONLY the emphasis: the lead copy, the spotlight
 *     user ids (whose copies lead — the employee's own entry; the
 *     service desk's operational queue of refusals; the team manager's
 *     waiting list), and the evidence-first flag;
 *   - every REFUSED entry carries its machine-stable routing reasons
 *     VERBATIM plus the PRINTER-APPROVAL ESCALATION path when capable
 *     but unapproved printers exist ("request printer approval from
 *     your Fleet Administrator" — a request, never a promotion);
 *   - the plan-distribution affordance's availability is
 *     AUTHORITY-derived (identity + Guardian), never role-derived.
 *
 * PURE: no clock, no entropy, no I/O; deterministic and deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  deepFrozen,
  frozen,
  frozenArray,
  isPlainObject,
  isPositiveInteger,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult } from "./internal";
import type { ActionsRoleLensView } from "./role-lens";
import type { ExperienceRole, RestrictedCapabilityView, RoleLensAuthorityEcho } from "./role-lens";
import type {
  SurfacePrintJobStatus,
  SurfacePrinterCapabilities,
  SurfaceTenantScope,
} from "./surface-contracts";
import { ALL_SURFACE_PRINT_JOB_STATUSES } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The structural seam for the W100B distribution plan
// ---------------------------------------------------------------------------

/**
 * One per-person distribution entry (structural seam for the W100B
 * domain `PrintDistributionEntry`). The `job` field is structurally
 * satisfied by the W041 `PrintJobRequest` (the SurfacePrintJobRecord
 * seam), with `payload.targetUserId` naming the person.
 */
export interface SurfacePrintDistributionEntryRecord {
  /** The person (the job's targetUserId). */
  readonly userId: string;
  /** The person's job (ROUTED to an approved printer, or REFUSED). */
  readonly job: {
    readonly jobId: string;
    readonly tenantId: SurfaceTenantScope["tenantId"];
    readonly payload: { readonly documentRef: string; readonly targetUserId?: string };
    readonly status: SurfacePrintJobStatus;
    readonly printerId?: string;
    readonly queuePosition?: number;
    readonly createdAt: string;
    readonly evidence: readonly unknown[];
    readonly routingReasons?: readonly string[];
  };
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
 * The distribution plan record (structural seam for the W100B domain
 * `PrintDistributionPlan`). Entries arrive sorted by userId ascending
 * (the domain's machine-stable order).
 */
export interface SurfacePrintDistributionPlanRecord {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The distributed document. */
  readonly documentRef: string;
  /** The required printer features the document demanded. */
  readonly requiredFeatures: SurfacePrinterCapabilities;
  /** The injected planning instant. */
  readonly at: string;
  /** The person count. */
  readonly personCount: number;
  /** The routed entry count. */
  readonly routedCount: number;
  /** The refused entry count. */
  readonly refusedCount: number;
  /** The per-person entries (userId ascending). */
  readonly entries: readonly SurfacePrintDistributionEntryRecord[];
}

// ---------------------------------------------------------------------------
// The lens input + view-models
// ---------------------------------------------------------------------------

/** The role lens the distribution surface is shaped by (the W100B lens view). */
export type PrintDistributionRoleLens = ActionsRoleLensView;

/** The printer-approval escalation path (a request, never a promotion). */
export interface PrinterApprovalEscalationView {
  /** The capable-but-unapproved printer ids (sorted). */
  readonly printerIds: readonly string[];
  /** Who the request goes to (displayed). */
  readonly requestLabel: string;
  /** The machine-stable request action (displayed alongside). */
  readonly action: string;
  /** Machine-asserted: this explanation grants nothing. */
  readonly grantsNothing: false;
}

/** One per-person entry presentation (verbatim facts + escalation when refused). */
export interface PrintDistributionEntryView {
  /** The person. */
  readonly userId: string;
  /** The person's job identity. */
  readonly jobId: string;
  /** The job status (verbatim). */
  readonly status: SurfacePrintJobStatus;
  /** The approved printer that receives the job (null when REFUSED). */
  readonly printerId: string | null;
  /** The queue position (null when absent). */
  readonly queuePosition: number | null;
  /** The machine-stable routing reasons (VERBATIM; empty unless REFUSED). */
  readonly routingReasons: readonly string[];
  /** Whether the entry was REFUSED (derived from the status). */
  readonly refused: boolean;
  /** The evidence artifact count (opaque). */
  readonly evidenceCount: number;
  /** The printer-approval escalation when capable-unapproved printers exist (else null). */
  readonly escalation: PrinterApprovalEscalationView | null;
}

/** The per-role lead (emphasis copy + spotlight + evidence-first). */
export interface PrintDistributionLensLead {
  /** The per-role emphasis paragraph. */
  readonly copy: string;
  /** The person count (derived). */
  readonly personCount: number;
  /** The routed count (derived). */
  readonly routedCount: number;
  /** The refused count (derived). */
  readonly refusedCount: number;
  /** The lens's spotlight user ids (whose copies lead — emphasis only). */
  readonly spotlightUserIds: readonly string[];
  /** Whether the lens leads with the evidence trail. */
  readonly evidenceFirst: boolean;
}

/** The plan-distribution affordance (availability is authority-derived). */
export interface DistributionAffordanceView {
  /** The gated capability this affordance presents. */
  readonly capability: "print.distribution.plan";
  /** Whether the effective authority permits the capability. */
  readonly available: boolean;
  /** The restricted-capability explanation when unavailable (else null). */
  readonly restricted: RestrictedCapabilityView | null;
  /** Machine-asserted: this affordance grants nothing. */
  readonly grantsAnything: false;
}

/** The role-shaped print distribution view (emphasis changes; records never do). */
export interface RoleShapedPrintDistributionView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The active role. */
  readonly activeRole: ExperienceRole;
  /** The active role's label. */
  readonly roleLabel: string;
  /** The one-line lens lead (from the lens view). */
  readonly lensLead: string;
  /** The distributed document (verbatim). */
  readonly documentRef: string;
  /** The role-shaped lead (emphasis copy + derived counts + spotlights). */
  readonly lead: PrintDistributionLensLead;
  /** The per-person entries (verbatim facts + escalations; userId ascending). */
  readonly entries: readonly PrintDistributionEntryView[];
  /** The authority echo — VERBATIM from the lens. */
  readonly authority: RoleLensAuthorityEcho;
  /** The plan-distribution affordance (authority-derived availability). */
  readonly distributionAffordance: DistributionAffordanceView;
  /** Machine-asserted: this view grants nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildRoleShapedPrintDistributionView`. */
export type RoleShapedPrintDistributionResult = SurfaceResult<RoleShapedPrintDistributionView>;

/** The per-role print-distribution lead copy (the emphasis paragraphs). */
export const PRINT_DISTRIBUTION_LEAD_COPY: Readonly<Record<ExperienceRole, string>> =
  Object.freeze({
    "fleet.admin":
      "Fleet-wide distribution: every selected person's job and the approved printer that receives it, with refusal escalation paths.",
    "service.desk":
      "Operational distribution: routing state per person, queue positions, and the refusals still needing an approved printer.",
    "security.compliance":
      "Policy-compliant distribution: only approved printers receive jobs. Refusals carry their machine-stable reasons and the printer-approval escalation path.",
    "asset.manager":
      "Resource view: printer utilization across the distribution and the approvals still outstanding.",
    "team.manager":
      "Team distribution: who received the document, and who is still waiting on an approved printer.",
    "employee":
      "Your print: your copy's approved printer and status, in plain language.",
    "vendor.operator":
      "Scoped view: the distribution relevant to your fulfillment work.",
  });

/** Which user ids the lens spotlights (emphasis only — records never filtered). */
const DISTRIBUTION_SPOTLIGHT: Readonly<
  Record<ExperienceRole, "refused" | "own-entry" | "none">
> = Object.freeze({
  "fleet.admin": "none",
  "service.desk": "refused",
  "security.compliance": "none",
  "asset.manager": "none",
  "team.manager": "refused",
  "employee": "own-entry",
  "vendor.operator": "none",
});

/** Whether the lens leads with the evidence trail. */
export const DISTRIBUTION_EVIDENCE_FIRST: Readonly<Record<ExperienceRole, boolean>> =
  Object.freeze({
    "fleet.admin": false,
    "service.desk": false,
    "security.compliance": true,
    "asset.manager": false,
    "team.manager": false,
    "employee": false,
    "vendor.operator": false,
  });

/** The printer-approval escalation request label. */
export const PRINTER_APPROVAL_ESCALATION_LABEL = "Fleet Administrator" as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEntry(
  candidate: unknown,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  if (typeof candidate["userId"] !== "string" || (candidate["userId"] as string).length === 0) {
    failures.push({ path: `${path}/userId`, reason: "non_empty_string_required" });
  }
  const job = candidate["job"];
  if (!isPlainObject(job)) {
    failures.push({ path: `${path}/job`, reason: "object_required" });
    return;
  }
  if (typeof job["jobId"] !== "string" || (job["jobId"] as string).length === 0) {
    failures.push({ path: `${path}/job/jobId`, reason: "non_empty_string_required" });
  }
  const payload = job["payload"];
  if (
    !isPlainObject(payload) ||
    typeof payload["documentRef"] !== "string" ||
    (payload["documentRef"] as string).length === 0
  ) {
    failures.push({ path: `${path}/job/payload/documentRef`, reason: "non_empty_string_required" });
  }
  const status = job["status"];
  if (
    typeof status !== "string" ||
    !(ALL_SURFACE_PRINT_JOB_STATUSES as readonly string[]).includes(status)
  ) {
    failures.push({ path: `${path}/job/status`, reason: "unknown_status" });
  }
  if (job["printerId"] !== undefined && typeof job["printerId"] !== "string") {
    failures.push({ path: `${path}/job/printerId`, reason: "string_required" });
  }
  if (job["queuePosition"] !== undefined && !isPositiveInteger(job["queuePosition"])) {
    failures.push({ path: `${path}/job/queuePosition`, reason: "positive_integer_required" });
  }
  if (typeof job["createdAt"] !== "string" || (job["createdAt"] as string).length === 0) {
    failures.push({ path: `${path}/job/createdAt`, reason: "non_empty_string_required" });
  }
  if (!Array.isArray(job["evidence"])) {
    failures.push({ path: `${path}/job/evidence`, reason: "array_required" });
  }
  if (job["routingReasons"] !== undefined && !Array.isArray(job["routingReasons"])) {
    failures.push({ path: `${path}/job/routingReasons`, reason: "array_required" });
  }
}

function validatePlan(
  candidate: unknown,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path: "/plan", reason: "object_required" });
    return;
  }
  if (typeof candidate["documentRef"] !== "string" || (candidate["documentRef"] as string).length === 0) {
    failures.push({ path: "/plan/documentRef", reason: "non_empty_string_required" });
  }
  if (typeof candidate["at"] !== "string" || (candidate["at"] as string).length === 0) {
    failures.push({ path: "/plan/at", reason: "non_empty_string_required" });
  }
  if (!Array.isArray(candidate["entries"])) {
    failures.push({ path: "/plan/entries", reason: "array_required" });
    return;
  }
  for (let i = 0; i < candidate.entries.length; i++) {
    validateEntry(candidate.entries[i], `/plan/entries/${i}`, failures);
  }
  // The count discipline: personCount === entries.length; refusedCount === refused entries.
  const entries = candidate.entries as readonly { refused?: unknown }[];
  if (candidate["personCount"] !== entries.length) {
    failures.push({ path: "/plan/personCount", reason: "entry_count_mismatch" });
  }
  const refusedCount = entries.filter((entry) => entry.refused === true).length;
  if (candidate["refusedCount"] !== refusedCount) {
    failures.push({ path: "/plan/refusedCount", reason: "refused_count_mismatch" });
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the role-shaped print distribution view.
 *
 * The per-person entries pass through VERBATIM (job facts, refusal
 * reasons, escalation context — userId ascending, the domain's order);
 * the lens shapes ONLY the lead copy, the spotlight user ids and the
 * evidence-first flag. Every REFUSED entry with capable-but-unapproved
 * printers carries the printer-approval ESCALATION (a request, never a
 * promotion). The plan-distribution affordance's availability is
 * derived from the lens's AUTHORITY echo — never from the role.
 *
 * @param scope the acting tenant scope
 * @param lens the role lens view (from `buildActionsRoleLens`)
 * @param plan the distribution plan record (the W100B domain plan, bound at the binding site)
 * @returns the tagged result: the role-shaped view or a machine-stable error
 */
export function buildRoleShapedPrintDistributionView(
  scope: SurfaceTenantScope,
  lens: PrintDistributionRoleLens,
  plan: SurfacePrintDistributionPlanRecord,
): RoleShapedPrintDistributionResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || typeof scope.tenantId !== "string" || scope.tenantId.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "print distribution surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — the lens + plan discipline.
  const failures: { path: string; reason: string }[] = [];
  if (!isPlainObject(lens) || lens["grantsAnything"] !== false) {
    failures.push({ path: "/lens", reason: "lens_view_invalid" });
  }
  validatePlan(plan, failures);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.distributionInvalid,
        "print distribution surface input is invalid",
        scope.tenantId,
        failures,
      ),
    };
  }
  if (lens.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "print distribution surface refuses a cross-tenant lens",
        scope.tenantId,
        [{ path: "/lens/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  if (plan.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "print distribution surface refuses cross-tenant plan records",
        scope.tenantId,
        [{ path: "/plan/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 2 — the per-person entries (verbatim facts + escalations).
  const entries: PrintDistributionEntryView[] = plan.entries.map((entry) =>
    frozen({
      userId: entry.userId,
      jobId: entry.job.jobId,
      status: entry.job.status,
      printerId: entry.job.printerId ?? null,
      queuePosition: entry.job.queuePosition ?? null,
      routingReasons: frozenArray(entry.job.routingReasons ?? []),
      refused: entry.job.status === "REFUSED",
      evidenceCount: entry.job.evidence.length,
      escalation:
        entry.unapprovedCapablePrinterIds.length > 0
          ? frozen({
              printerIds: frozenArray(entry.unapprovedCapablePrinterIds),
              requestLabel: PRINTER_APPROVAL_ESCALATION_LABEL,
              action: "request printer approval",
              grantsNothing: false,
            } satisfies PrinterApprovalEscalationView)
          : null,
    } satisfies PrintDistributionEntryView),
  );
  // Phase 3 — the role-shaped lead (spotlight derivation; emphasis only).
  const spotlightKind = DISTRIBUTION_SPOTLIGHT[lens.activeRole];
  let spotlightUserIds: string[] = [];
  if (spotlightKind === "refused") {
    spotlightUserIds = entries.filter((entry) => entry.refused).map((entry) => entry.userId);
  } else if (spotlightKind === "own-entry") {
    spotlightUserIds = entries
      .filter((entry) => entry.userId === lens.authority.principalId)
      .map((entry) => entry.userId);
  }
  // Phase 4 — the plan-distribution affordance (authority-derived).
  const distributionCapability = "print.distribution.plan" as const;
  const available = (lens.authority.permissions as readonly string[]).includes(
    distributionCapability,
  );
  const restricted = available
    ? null
    : (lens.restricted.find((r) => r.capability === distributionCapability) ?? null);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        activeRole: lens.activeRole,
        roleLabel: lens.roleLabel,
        lensLead: lens.lensLead,
        documentRef: plan.documentRef,
        lead: frozen({
          copy: PRINT_DISTRIBUTION_LEAD_COPY[lens.activeRole],
          personCount: plan.personCount,
          routedCount: plan.routedCount,
          refusedCount: plan.refusedCount,
          spotlightUserIds: frozenArray(spotlightUserIds),
          evidenceFirst: DISTRIBUTION_EVIDENCE_FIRST[lens.activeRole],
        } satisfies PrintDistributionLensLead),
        entries: frozenArray(entries),
        authority: lens.authority,
        distributionAffordance: frozen({
          capability: distributionCapability,
          available,
          restricted,
          grantsAnything: false,
        } satisfies DistributionAffordanceView),
        grantsAnything: false,
      } satisfies RoleShapedPrintDistributionView),
    ),
  };
}
