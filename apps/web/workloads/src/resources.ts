/**
 * @fleetos/web-workloads — the LOCK 12 resource-linkage surface.
 *
 * "Hardware, software, connectivity and maintenance are first-class
 * resources linked to workloads." — `spec/ARCHITECTURE-LOCK.md` item 12.
 *
 * This module projects the four first-class resource kinds — injected at
 * the binding site through their structural seams — into ONE linkage
 * view per workload: every linked hardware class, software subscription,
 * connectivity submission and maintenance work order becomes a typed
 * LINK ROW with a machine-stable linkage status derived from the
 * resource's own domain state (never invented by the surface):
 *
 *   - hardware      -> "fielded_class" | "procurement_required"
 *                      (the W022 candidate's procurementRequired facet);
 *   - software      -> "allocated" (the W032 subscription revision);
 *   - connectivity  -> the W050A submission status verbatim
 *                      (PROPOSED/SUBMITTED/PARKED/APPROVED/REJECTED);
 *   - maintenance   -> "open" (the W042 work order, revision + deadline).
 *
 * The linkage surface is READ-ONLY: it never creates, revises, or
 * dismisses a resource (those are domain surfaces owned by the domain
 * packages under the policy layer's authority).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; every timestamp is echoed from the domain records.
 */

import type { TenantId, WorkloadId } from "@fleetos/contracts";
import type {
  MaintenanceResourceFacets,
  ConnectivityResourceFacets,
  HardwareResourceFacets,
  SoftwareResourceFacets,
  WorkloadProfileFacets,
  WorkloadResourceLinkSource,
} from "./seams";
import { WORKLOAD_RESOURCE_KINDS } from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceDomainError, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The resource-linkage view-model schema version. */
export const RESOURCE_LINKAGE_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The view models
// ---------------------------------------------------------------------------

/**
 * The linkage status vocabulary. Values 2-6 are the W050A submission
 * statuses surfaced VERBATIM; values 1, 7, 8 are derived from the
 * resource's own facets. Machine-stable — the shell matches on strings.
 */
export type WorkloadResourceLinkageStatus =
  | "fielded_class"
  | "procurement_required"
  | "PROPOSED"
  | "SUBMITTED"
  | "PARKED"
  | "APPROVED"
  | "REJECTED"
  | "allocated"
  | "open";

/** One display field (ordered key/value pair, rendered deterministically). */
export interface ResourceLinkFieldView {
  readonly key: string;
  readonly value: string;
}

/** One linked-resource row. */
export interface WorkloadResourceLinkRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  /** The first-class resource kind (LOCK 12: one of the four). */
  readonly kind: "hardware" | "software" | "connectivity" | "maintenance";
  /** The resource's domain identifier (candidateId/subscriptionId/...). */
  readonly resourceId: string;
  /** The display label (when the resource carries one). */
  readonly label: string | null;
  /** The machine-stable linkage status (see the vocabulary above). */
  readonly linkageStatus: WorkloadResourceLinkageStatus;
  /** The resource's own linkage/creation timestamp, when present. */
  readonly linkedAt: string | null;
  /** Ordered display fields (deterministic; kind-templated). */
  readonly details: readonly ResourceLinkFieldView[];
}

/** The per-workload linkage view. */
export interface WorkloadResourceLinkageView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  /** Rows ordered by kind (canonical LOCK 12 order), then resourceId. */
  readonly rows: readonly WorkloadResourceLinkRowView[];
  /** Count by resource kind (all four keys always present). */
  readonly byKind: Readonly<Record<string, number>>;
}

/** The tagged result of a linkage build. */
export type ResourceLinkageResult =
  | { readonly ok: true; readonly view: WorkloadResourceLinkageView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Per-kind projections (pure)
// ---------------------------------------------------------------------------

/** Project a hardware resource (the W022 candidate class). */
function projectHardware(resource: HardwareResourceFacets): {
  resourceId: string;
  label: string | null;
  linkageStatus: WorkloadResourceLinkageStatus;
  linkedAt: string | null;
  details: readonly ResourceLinkFieldView[];
} {
  return {
    resourceId: resource.candidateId,
    label: resource.label,
    linkageStatus: resource.procurementRequired === true ? "procurement_required" : "fielded_class",
    linkedAt: null,
    details: frozenArray([
      frozen({ key: "candidateId", value: resource.candidateId }),
      frozen({
        key: "procurementRequired",
        value: resource.procurementRequired === true ? "true" : "false",
      }),
    ]),
  };
}

/** Project a software resource (the W032 subscription). */
function projectSoftware(resource: SoftwareResourceFacets): {
  resourceId: string;
  label: string | null;
  linkageStatus: WorkloadResourceLinkageStatus;
  linkedAt: string | null;
  details: readonly ResourceLinkFieldView[];
} {
  return {
    resourceId: resource.subscriptionId,
    label: resource.softwareId,
    linkageStatus: "allocated",
    linkedAt: resource.allocatedAt,
    details: frozenArray([
      frozen({ key: "softwareId", value: resource.softwareId }),
      frozen({ key: "seatCount", value: String(resource.seatCount) }),
      frozen({ key: "termDays", value: String(resource.termDays) }),
      frozen({ key: "revision", value: String(resource.revision) }),
    ]),
  };
}

/**
 * Project a connectivity resource (the W050A submission). The projection
 * surfaces ONLY the machine-stable submission status, the outcome facet,
 * and the status timeline count — NEVER the provider handle, refusal
 * detail, or any topology/credential field (ARCHITECTURE-LOCK 6-8).
 */
function projectConnectivity(resource: ConnectivityResourceFacets): {
  resourceId: string;
  label: string | null;
  linkageStatus: WorkloadResourceLinkageStatus;
  linkedAt: string | null;
  details: readonly ResourceLinkFieldView[];
} {
  const status = resource.status as WorkloadResourceLinkageStatus;
  const firstRevisionAt = resource.revisions.length > 0 ? resource.revisions[0]?.at ?? null : null;
  return {
    resourceId: resource.submissionId,
    label: resource.request.outcome.canonical,
    linkageStatus: status,
    linkedAt: firstRevisionAt,
    details: frozenArray([
      frozen({ key: "submissionId", value: resource.submissionId }),
      frozen({ key: "outcome", value: resource.request.outcome.canonical }),
      frozen({ key: "status", value: resource.status }),
      frozen({ key: "timelineRevisions", value: String(resource.revisions.length) }),
    ]),
  };
}

/** Project a maintenance resource (the W042 service work order). */
function projectMaintenance(resource: MaintenanceResourceFacets): {
  resourceId: string;
  label: string | null;
  linkageStatus: WorkloadResourceLinkageStatus;
  linkedAt: string | null;
  details: readonly ResourceLinkFieldView[];
} {
  return {
    resourceId: resource.workOrderId,
    label: resource.serviceCategory,
    linkageStatus: "open",
    linkedAt: resource.deadline,
    details: frozenArray([
      frozen({ key: "workOrderId", value: resource.workOrderId }),
      frozen({ key: "deviceId", value: resource.deviceId }),
      frozen({ key: "serviceArea", value: resource.serviceArea }),
      frozen({ key: "serviceCategory", value: resource.serviceCategory }),
      frozen({ key: "deadline", value: resource.deadline }),
      frozen({ key: "revision", value: String(resource.revision) }),
    ]),
  };
}

// ---------------------------------------------------------------------------
// The linkage builder
// ---------------------------------------------------------------------------

/**
 * Build the LOCK 12 resource-linkage view for ONE workload. PURE and
 * DETERMINISTIC: rows are ordered by the canonical resource-kind order
 * (hardware, software, connectivity, maintenance) then resourceId; the
 * input order never affects the output.
 *
 * Links whose workloadId differs from the profile's are NOT part of this
 * workload's linkage (skipped silently — they belong to another
 * workload's view, and the caller filters at the binding site); links
 * whose TENANT scope differs from the acting tenant are REFUSED
 * (`tenant_mismatch` — cross-tenant records never render).
 *
 * @param tenantId the acting tenant
 * @param profile the workload profile the resources link to (W022)
 * @param links the linked resources, injected at the binding site
 * @returns the tagged linkage result
 */
export function buildWorkloadResourceLinkageView(
  tenantId: TenantId,
  profile: WorkloadProfileFacets,
  links: readonly WorkloadResourceLinkSource[],
): ResourceLinkageResult {
  if (profile === null || typeof profile !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-workloads.resources",
        "resource linkage request is invalid",
        tenantId,
        [{ path: "/profile", reason: "profile_required" }],
      ),
    };
  }
  const profileMismatch = tenantMismatch(tenantId, profile.tenantId, "web-workloads.resources");
  if (profileMismatch !== null) return { ok: false, error: profileMismatch };
  if (!Array.isArray(links)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-workloads.resources",
        "resource linkage request is invalid",
        tenantId,
        [{ path: "/links", reason: "array_required" }],
      ),
    };
  }
  for (const link of links) {
    const mismatch = tenantMismatch(tenantId, link?.tenantId, "web-workloads.resources");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const kindOrder = new Map<string, number>(WORKLOAD_RESOURCE_KINDS.map((kind, index) => [kind, index]));
  const rows: WorkloadResourceLinkRowView[] = [];
  for (const link of links) {
    if (link.workloadId !== profile.workloadId) continue; // another workload's link
    const projection =
      link.kind === "hardware"
        ? projectHardware(link.resource)
        : link.kind === "software"
          ? projectSoftware(link.resource)
          : link.kind === "connectivity"
            ? projectConnectivity(link.resource)
            : projectMaintenance(link.resource);
    rows.push(
      frozen({
        viewVersion: RESOURCE_LINKAGE_VIEW_VERSION,
        tenantId,
        workloadId: profile.workloadId,
        kind: link.kind,
        resourceId: projection.resourceId,
        label: projection.label,
        linkageStatus: projection.linkageStatus,
        linkedAt: projection.linkedAt,
        details: projection.details,
      }),
    );
  }
  rows.sort((a, b) => {
    const kindDelta = (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0);
    if (kindDelta !== 0) return kindDelta;
    return compareStrings(a.resourceId, b.resourceId);
  });

  const byKind: Record<string, number> = {};
  for (const kind of WORKLOAD_RESOURCE_KINDS) byKind[kind] = 0;
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;

  return {
    ok: true,
    view: frozen({
      viewVersion: RESOURCE_LINKAGE_VIEW_VERSION,
      tenantId,
      workloadId: profile.workloadId,
      rows: frozenArray(rows),
      byKind: frozen({ ...byKind }),
    }),
  };
}

/**
 * Select the rows of ONE first-class resource kind from a linkage view
 * (LOCK 12: the four kinds are independently selectable). Machine-stable
 * `unknown_resource_kind` refusal for anything outside the closed set.
 */
export function selectResourceKindRows(
  view: WorkloadResourceLinkageView,
  kind: WorkloadResourceLinkSource["kind"],
): { readonly ok: true; readonly rows: readonly WorkloadResourceLinkRowView[] } | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError } {
  if (!WORKLOAD_RESOURCE_KINDS.includes(kind)) {
    return {
      ok: false,
      error: makeSurfaceDomainError(
        "web-workloads.resources",
        "unknown_resource_kind",
        "resource kind is not one of the four first-class kinds",
        view.tenantId,
      ),
    };
  }
  return { ok: true, rows: frozenArray(view.rows.filter((row) => row.kind === kind)) };
}
