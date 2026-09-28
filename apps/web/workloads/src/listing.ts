/**
 * @fleetos/web-workloads — the workload-profile LISTING surface.
 *
 * "A Workload Profile describes what a role/process requires." —
 * `spec/ARCHITECTURE.md` § Workload Intelligence. This module projects
 * W022 workload profiles (injected through the structural seams) into
 * deterministic LIST ROW view-models: identity, revision, requirement
 * highlights, constraint counts, evidence coverage — everything the
 * shell (W061) renders in a tenant's profile list.
 *
 * Determinism discipline: rows are ordered by workloadId (code-unit
 * order); requirement highlights are ordered by value DESC then name ASC
 * (code-unit tie-break); every number is echoed verbatim from the domain
 * record — the surface never recomputes a domain value. No clock, no
 * randomness, no I/O.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import type { WorkloadProfileFacets } from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The listing view-model schema version (bumped on display-shape change). */
export const PROFILE_LIST_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

/** One requirement-dimension highlight row. */
export interface RequirementHighlightView {
  /** The dimension name (machine-stable, verbatim from the vector). */
  readonly dimension: string;
  /** The normalized requirement value in [0, 1], verbatim. */
  readonly value: number;
}

/** The constraint-count summary (machine-stable; absent = zero). */
export interface ConstraintCountView {
  readonly requiredApplications: number;
  readonly environments: number;
  readonly peripherals: number;
  /** The classification ceiling, when constrained. */
  readonly classification: string | null;
}

/** One profile list row (the frozen view-model the shell renders). */
export interface WorkloadProfileRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  readonly subjectKind: string;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: string;
  /** The revision's content hash (verbatim — the immutability evidence). */
  readonly contentHash: string;
  /** Requirement highlights: top dimensions by value, tie-break name ASC. */
  readonly requirementHighlights: readonly RequirementHighlightView[];
  /** The vector coverage confidence, verbatim. */
  readonly vectorConfidence: number;
  /** The constraint summary counts. */
  readonly constraints: ConstraintCountView;
  /** The count of evidence observation links on this revision. */
  readonly evidenceCount: number;
  /** The working-hours window, when the profile declares one. */
  readonly workingHours: WorkingHoursFacetsView | null;
}

/** The working-hours display facet. */
export interface WorkingHoursFacetsView {
  readonly startHour: number;
  readonly endHour: number;
}

/** The listing view (rows + the tenant-scoped summary). */
export interface WorkloadProfileListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by workloadId (code-unit order — deterministic). */
  readonly rows: readonly WorkloadProfileRowView[];
  /** The distinct workload count. */
  readonly total: number;
  /** Count by subjectKind, key sorted (machine-stable). */
  readonly bySubjectKind: Readonly<Record<string, number>>;
}

/** The tagged result of a listing build. */
export type ProfileListResult =
  | { readonly ok: true; readonly view: WorkloadProfileListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Derivations (pure)
// ---------------------------------------------------------------------------

/** The maximum number of requirement highlights per row. */
export const REQUIREMENT_HIGHLIGHT_LIMIT = 3;

/**
 * Derive the requirement highlights: the highest-value dimensions,
 * ordered by value DESC then dimension name ASC (code-unit tie-break).
 * Dimension keys missing from the record are skipped (forward
 * compatibility: an unknown dimension is never an error).
 */
export function deriveRequirementHighlights(
  values: Readonly<Record<string, number>>,
  limit: number = REQUIREMENT_HIGHLIGHT_LIMIT,
): readonly RequirementHighlightView[] {
  const entries: RequirementHighlightView[] = [];
  for (const [dimension, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      entries.push(frozen({ dimension, value }));
    }
  }
  entries.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return compareStrings(a.dimension, b.dimension);
  });
  return frozenArray(entries.slice(0, Math.max(0, limit)));
}

/** Derive the constraint-count summary from the constraint facets. */
export function deriveConstraintCounts(
  constraints: WorkloadProfileFacets["constraints"],
): ConstraintCountView {
  return frozen({
    requiredApplications: constraints.requiredApplications?.length ?? 0,
    environments: constraints.environments?.length ?? 0,
    peripherals: constraints.peripherals?.length ?? 0,
    classification: constraints.classification ?? null,
  });
}

// ---------------------------------------------------------------------------
// The listing builder
// ---------------------------------------------------------------------------

/**
 * Build the tenant-scoped workload-profile listing view. PURE and
 * DETERMINISTIC: the same profiles always produce the same rows in the
 * same order regardless of input order (rows sort by workloadId).
 *
 * Tenant scoping: every profile whose tenant scope differs from the
 * acting tenant is REFUSED (machine-stable `tenant_mismatch`); the
 * surface never silently drops or merges cross-tenant records.
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param profiles the W022 profile records (latest revisions), injected
 *        at the binding site
 * @returns the tagged listing result
 */
export function buildWorkloadProfileListView(
  tenantId: TenantId,
  profiles: readonly WorkloadProfileFacets[],
): ProfileListResult {
  if (!Array.isArray(profiles)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-workloads.listing",
        "workload profile listing request is invalid",
        tenantId,
        [{ path: "/profiles", reason: "array_required" }],
      ),
    };
  }
  for (const profile of profiles) {
    const mismatch = tenantMismatch(tenantId, profile?.tenantId, "web-workloads.listing");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const rows: WorkloadProfileRowView[] = profiles.map((profile) =>
    frozen({
      viewVersion: PROFILE_LIST_VIEW_VERSION,
      tenantId,
      workloadId: profile.workloadId,
      subjectKind: profile.subjectKind,
      name: profile.name,
      revision: profile.revision,
      createdAt: profile.createdAt,
      contentHash: profile.contentHash,
      requirementHighlights: deriveRequirementHighlights(profile.requirements.values),
      vectorConfidence: profile.requirements.confidence,
      constraints: deriveConstraintCounts(profile.constraints),
      evidenceCount: profile.evidence.length,
      workingHours:
        profile.workingHours !== undefined
          ? frozen({
              startHour: profile.workingHours.startHour,
              endHour: profile.workingHours.endHour,
            })
          : null,
    }),
  );
  rows.sort((a, b) => compareStrings(a.workloadId, b.workloadId));

  const bySubjectKind: Record<string, number> = {};
  for (const row of rows) {
    bySubjectKind[row.subjectKind] = (bySubjectKind[row.subjectKind] ?? 0) + 1;
  }

  return {
    ok: true,
    view: frozen({
      viewVersion: PROFILE_LIST_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      bySubjectKind: frozen({ ...bySubjectKind }),
    }),
  };
}
