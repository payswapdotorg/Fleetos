/**
 * @fleetos/web-workloads — the ROLE-AWARE workload projection (W100C).
 *
 * The W100C lens surface: role-aware projections of the
 * workload-planning view for the four C-lane roles named by the work
 * order — asset.manager, team.manager, employee and vendor.operator.
 *
 * THE MATRIX RULES (spec/ui/ROLE-EXPERIENCE-MATRIX.yaml, encoded):
 *   - `experience_profiles_do_not_grant_permissions` — a lens view
 *     carries ZERO permission data. There is no permission field, no
 *     effective-permission list, no grant: the view type is structurally
 *     permission-free (asserted by test). Effective permissions come
 *     from identity + Contract Guardian, injected separately by the
 *     shell.
 *   - `active_role_is_scoped_to_current_tenant` — the lens view carries
 *     the acting tenant; a lens request whose tenant disagrees with the
 *     listing's tenant is refused (`tenant_mismatch`).
 *   - `unavailable_capabilities_show_reason_and_escalation_path` — when
 *     a lens de-emphasizes or hides a section the role does not use,
 *     the projection carries a machine-stable CAPABILITY NOTICE with a
 *     reason and an escalation path — never a silent omission.
 *
 * What a lens changes (PRESENTATION ONLY — ROLEFUL-UX-ARCHITECTURE §
 * "Creative freedom"): section ordering/emphasis, the lead copy (the
 * role's primary question), row-emphasis ordering hints, and capability
 * notices. What a lens NEVER changes: the underlying rows' domain
 * values, their identities, or any status semantics.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";
import type { WorkloadProfileListView, WorkloadProfileRowView } from "./listing";

// ---------------------------------------------------------------------------
// The lens vocabulary (frozen — derived from ROLE-EXPERIENCE-MATRIX.yaml)
// ---------------------------------------------------------------------------

/** The W100C lens ids (the C-lane roles the work item names). */
export const WORKLOAD_ROLE_LENS_IDS = frozenArray([
  "asset.manager",
  "team.manager",
  "employee",
  "vendor.operator",
] as const);

/** One lens id. */
export type WorkloadRoleLensId = (typeof WORKLOAD_ROLE_LENS_IDS)[number];

/** The emphasis levels a section can carry under a lens. */
export type LensEmphasis = "highest" | "high" | "medium" | "low" | "minimal";

/** One workload-surface section the lens orders. */
export type WorkloadSectionId =
  | "listing"
  | "recommendations"
  | "capacity-linkage"
  | "journey"
  | "commerce-links";

/** The immutable lens descriptor (machine-stable). */
export interface WorkloadRoleLens {
  readonly lensId: WorkloadRoleLensId;
  /** The operator-facing label (ROLE-EXPERIENCE-MATRIX `label`). */
  readonly label: string;
  /** The home lens (ROLE-EXPERIENCE-MATRIX `home_lens`). */
  readonly homeLens: "resources" | "team" | "personal" | "exchange";
  /** The role's primary question (ROLEFUL-UX-ARCHITECTURE table). */
  readonly primaryQuestion: string;
  /** Section emphasis under this lens (machine-stable ordering input). */
  readonly sectionEmphasis: Readonly<Record<WorkloadSectionId, LensEmphasis>>;
  /**
   * Row-ordering hints for the LISTING under this lens (deterministic
   * tie-breaks keep the view machine-stable):
   *   - "demand" — rows whose revisions/links signal active resource
   *     planning first (asset.manager);
   *   - "team" — rows for team-owned subject kinds first (team.manager);
   *   - "mine" — the row list stays id-ordered (the shell injects the
   *     principal's own workloads; employee);
   *   - "id" — plain id order (vendor.operator: minimal surface).
   */
  readonly listingOrder: "demand" | "team" | "mine" | "id";
}

const SECTION_EMPHASIS_BY_LENS: Readonly<
  Record<WorkloadRoleLensId, Readonly<Record<WorkloadSectionId, LensEmphasis>>>
> = frozen({
  // Asset & Procurement Manager: Workloads HIGH, Commerce HIGHEST,
  // Maintenance in primary areas (matrix `primary_areas`).
  "asset.manager": frozen({
    listing: "highest",
    recommendations: "high",
    "capacity-linkage": "high",
    journey: "high",
    "commerce-links": "highest",
  }),
  // Team Manager: Workloads HIGH, actions/team emphasis.
  "team.manager": frozen({
    listing: "high",
    recommendations: "medium",
    "capacity-linkage": "high",
    journey: "medium",
    "commerce-links": "medium",
  }),
  // Employee: My-work emphasis (matrix: Workloads "My-work").
  employee: frozen({
    listing: "medium",
    recommendations: "low",
    "capacity-linkage": "medium",
    journey: "low",
    "commerce-links": "minimal",
  }),
  // Vendor Operator: Workloads LOW (matrix) — minimal surface.
  "vendor.operator": frozen({
    listing: "low",
    recommendations: "minimal",
    "capacity-linkage": "minimal",
    journey: "minimal",
    "commerce-links": "medium",
  }),
});

/** The frozen lens descriptors (the W100C vocabulary). */
export const WORKLOAD_ROLE_LENSES: Readonly<Record<WorkloadRoleLensId, WorkloadRoleLens>> =
  frozen({
    "asset.manager": frozen({
      lensId: "asset.manager",
      label: "Asset & Procurement Manager",
      homeLens: "resources",
      primaryQuestion: "What should we buy, maintain, replace or subscribe to?",
      sectionEmphasis: SECTION_EMPHASIS_BY_LENS["asset.manager"],
      listingOrder: "demand",
    }),
    "team.manager": frozen({
      lensId: "team.manager",
      label: "Team Manager",
      homeLens: "team",
      primaryQuestion: "How is my team affected and which requests/approvals need me?",
      sectionEmphasis: SECTION_EMPHASIS_BY_LENS["team.manager"],
      listingOrder: "team",
    }),
    employee: frozen({
      lensId: "employee",
      label: "Employee / Device Owner",
      homeLens: "personal",
      primaryQuestion: "Is my device healthy, what should I do, and how do I request help?",
      sectionEmphasis: SECTION_EMPHASIS_BY_LENS.employee,
      listingOrder: "mine",
    }),
    "vendor.operator": frozen({
      lensId: "vendor.operator",
      label: "Vendor / Service Operator",
      homeLens: "exchange",
      primaryQuestion: "Which quotes, work orders and fulfillment steps require my response?",
      sectionEmphasis: SECTION_EMPHASIS_BY_LENS["vendor.operator"],
      listingOrder: "id",
    }),
  });

// ---------------------------------------------------------------------------
// The lens view (PRESENTATION ONLY — structurally permission-free)
// ---------------------------------------------------------------------------

/** One capability notice: a de-emphasized section with WHY + escalation. */
export interface LensCapabilityNotice {
  /** The machine-stable notice kind. */
  readonly kind: "section_deemphasized";
  /** The section the notice is about. */
  readonly section: WorkloadSectionId;
  /** The machine-stable reason code. */
  readonly reason: string;
  /** The human-facing explanation (rendered verbatim). */
  readonly message: string;
  /** The escalation path (rendered verbatim — the matrix rule). */
  readonly escalationPath: string;
}

/** The role-aware workload listing projection. */
export interface WorkloadRoleLensView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly lensId: WorkloadRoleLensId;
  /** The lens descriptor's display copy (label + primary question). */
  readonly label: string;
  readonly primaryQuestion: string;
  /** The sections in the lens's emphasis order (machine-stable). */
  readonly sections: readonly WorkloadSectionId[];
  /** The listing rows in the lens's ordering (IDENTICAL domain values). */
  readonly rows: readonly WorkloadProfileRowView[];
  /** Capability notices (unavailable/de-emphasized sections). */
  readonly notices: readonly LensCapabilityNotice[];
  /**
   * The lens's presentation note — e.g. the employee's "my workloads"
   * scope note. NEVER a permission grant; purely explanatory copy.
   */
  readonly scopeNote: string | null;
}

/** The tagged result of a lens projection. */
export type WorkloadRoleLensResult =
  | { readonly ok: true; readonly view: WorkloadRoleLensView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** The lens view-model schema version. */
export const WORKLOAD_ROLE_LENS_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The projection (pure)
// ---------------------------------------------------------------------------

/** The emphasis ordering weight (deterministic section sort). */
const EMPHASIS_ORDER: Readonly<Record<LensEmphasis, number>> = frozen({
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  minimal: 4,
});

const ALL_SECTIONS: readonly WorkloadSectionId[] = frozenArray([
  "listing",
  "recommendations",
  "capacity-linkage",
  "journey",
  "commerce-links",
]);

/**
 * Project the workload listing through one role lens. PURE and
 * DETERMINISTIC.
 *
 * Guarantees (all asserted by test):
 *   - the ROW SET is preserved: every input row appears exactly once,
 *     with byte-identical domain values (only the ORDER may change);
 *   - the view carries NO permission data (there is no field for it);
 *   - tenant scoping: the listing's tenant must equal the acting
 *     tenant (`tenant_mismatch` refusal otherwise — LOCK 17);
 *   - every de-emphasized section below "medium" carries a capability
 *     notice with a reason and an escalation path.
 *
 * @param tenantId the acting tenant
 * @param lensId the lens to project through
 * @param listing the EXISTING listing view (built by listing.ts)
 */
export function applyWorkloadRoleLens(
  tenantId: TenantId,
  lensId: WorkloadRoleLensId,
  listing: WorkloadProfileListView,
): WorkloadRoleLensResult {
  if (!WORKLOAD_ROLE_LENS_IDS.includes(lensId)) {
    return {
      ok: false,
      error: {
        kind: "ValidationError",
        code: "web-workloads.role_lens.unknown_lens",
        message: `applyWorkloadRoleLens: unknown lens id ${String(lensId)}`,
        failures: [{ path: "/lensId", reason: "unknown_lens" }],
        tenantId,
        correlationId: asSurfaceCorrelation(),
      },
    };
  }
  if (listing === null || typeof listing !== "object") {
    return {
      ok: false,
      error: {
        kind: "ValidationError",
        code: "web-workloads.role_lens.listing_required",
        message: "applyWorkloadRoleLens: a listing view is required",
        failures: [{ path: "/listing", reason: "listing_required" }],
        tenantId,
        correlationId: asSurfaceCorrelation(),
      },
    };
  }
  if (listing.tenantId !== tenantId) {
    return {
      ok: false,
      error: {
        kind: "DomainError",
        code: "web-workloads.role_lens.tenant_mismatch",
        message:
          "applyWorkloadRoleLens: the listing's tenant does not match the acting tenant",
        tenantId,
        correlationId: asSurfaceCorrelation(),
        domain: "web-workloads.role_lens",
        invariant: "tenant_mismatch",
      },
    };
  }

  const lens = WORKLOAD_ROLE_LENSES[lensId];

  // Section ordering: emphasis weight, then section id (code-unit).
  const sections = frozenArray(
    [...ALL_SECTIONS].sort(
      (a, b) =>
        EMPHASIS_ORDER[lens.sectionEmphasis[a]] - EMPHASIS_ORDER[lens.sectionEmphasis[b]] ||
        compareStrings(a, b),
    ),
  );

  // Rows: the lens's ordering hint; the row OBJECTS are passed through
  // UNTOUCHED (identity and domain values preserved).
  const rows = frozenArray(orderRows(lens.listingOrder, listing.rows));

  // Capability notices for the sections this lens de-emphasizes.
  const notices = frozenArray(buildNotices(lens));

  const scopeNote =
    lensId === "employee"
      ? "Scoped to the workloads you own or use — the full tenant planning surface stays available to Asset & Procurement roles."
      : lensId === "vendor.operator"
        ? "Scoped to the workloads your service work orders concern — the tenant planning surface stays with fleet roles."
        : null;

  return {
    ok: true,
    view: frozen({
      viewVersion: WORKLOAD_ROLE_LENS_VIEW_VERSION,
      tenantId,
      lensId,
      label: lens.label,
      primaryQuestion: lens.primaryQuestion,
      sections,
      rows,
      notices,
      scopeNote,
    }),
  };
}

/** The deterministic row ordering per lens hint. */
function orderRows(
  order: WorkloadRoleLens["listingOrder"],
  rows: readonly WorkloadProfileRowView[],
): readonly WorkloadProfileRowView[] {
  if (order === "id") return [...rows].sort((a, b) => compareStrings(a.workloadId, b.workloadId));
  if (order === "mine") {
    return [...rows].sort((a, b) => compareStrings(a.workloadId, b.workloadId));
  }
  if (order === "demand") {
    // Active resource planning first: more constraints + more evidence,
    // tie-break by workloadId (machine-stable).
    return [...rows].sort(
      (a, b) =>
        demandSignal(b) - demandSignal(a) || compareStrings(a.workloadId, b.workloadId),
    );
  }
  // "team": team-shaped rows first (a heuristic over the machine-stable
  // name/subjectKind strings), tie-break by workloadId.
  return [...rows].sort(
    (a, b) => teamShape(b) - teamShape(a) || compareStrings(a.workloadId, b.workloadId),
  );
}

/** The demand signal for the asset lens: constraints + evidence coverage. */
function demandSignal(row: WorkloadProfileRowView): number {
  const constraintCount =
    row.constraints.requiredApplications +
    row.constraints.environments +
    row.constraints.peripherals +
    (row.constraints.classification !== null ? 1 : 0);
  return constraintCount * 2 + row.evidenceCount + Math.round(row.vectorConfidence * 10);
}

/** Team-shaped rows (heuristic over the machine-stable name/subjectKind). */
function teamShape(row: WorkloadProfileRowView): number {
  return /team|group|staff|desk/i.test(row.name) || /team|group|staff/i.test(row.subjectKind)
    ? 1
    : 0;
}

/** The capability notices for de-emphasized sections. */
function buildNotices(lens: WorkloadRoleLens): readonly LensCapabilityNotice[] {
  const notices: LensCapabilityNotice[] = [];
  for (const section of ALL_SECTIONS) {
    const emphasis = lens.sectionEmphasis[section];
    if (emphasis === "low" || emphasis === "minimal") {
      notices.push(
        frozen({
          kind: "section_deemphasized",
          section,
          reason: `role_${emphasis}_emphasis`,
          message: `The ${section.replace(/-/g, " ")} section is de-emphasized for the ${lens.label} lens.`,
          escalationPath:
            "This lens changes emphasis only. Switch your active role (asset.manager or fleet.admin) to lead with workload planning; permissions are unaffected by switching.",
        }),
      );
    }
  }
  return notices.sort((a, b) => compareStrings(a.section, b.section));
}

/** The surface correlation sentinel (deterministic — no entropy). */
function asSurfaceCorrelation(): import("@fleetos/contracts").CorrelationId {
  return "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId;
}
