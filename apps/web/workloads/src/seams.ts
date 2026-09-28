/**
 * @fleetos/web-workloads — the structural seams (the W040-disclosed pattern).
 *
 * `src/` in this package imports `@fleetos/contracts` ONLY (the frozen
 * shared seam — the ownership gate permits same-lane imports, but the
 * surface discipline is stricter: a UI surface never compiles against a
 * domain package). Every domain record the surface consumes is declared
 * here as a FACET interface — the minimum the display needs — and the
 * REAL accepted domain records (W022 `WorkloadProfile` and
 * `WorkloadRecommendation` from `@fleetos/workloads`, W032
 * `SoftwareSubscription` from `@fleetos/software`, W042
 * `ServiceWorkOrder` from `@fleetos/maintenance`, W050A
 * `ConnectivitySubmissionRecord` from `@fleetos/integration-adcos`) are
 * ASSIGNABLE to those facets by TypeScript structural typing. The
 * binding site (the W061 shell) injects the real records; the test suite
 * in `test/` is the runtime proof (the ownership gate permits cross-lane
 * imports in `test/` only).
 *
 * Facet rules:
 *   - A facet NEVER widens a domain field's meaning; names and types are
 *     copied verbatim from the owning package's public contract, minus
 *     the fields the display does not need.
 *   - Unions may be widened to their string base ONLY where the surface
 *     treats the value as opaque display text plus the machine-stable
 *     literal itself (e.g. status unions).
 *   - No facet mentions a provider, transport, credential or SDK type
 *     (ARCHITECTURE-LOCK items 6-8).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import type {
  ProcurementIntentPayload,
  SoftwareSubscriptionIntentPayload,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The workload-profile facets (W022 WorkloadProfile at the binding site)
// ---------------------------------------------------------------------------

/**
 * The requirement-vector facets the listing displays. The dimension keys
 * are surfaced generically (machine-stable alphabetical iteration) so a
 * future vector schema version with NEW dimensions still renders — the
 * surface never hard-codes the ten W022 dimension names.
 */
export interface RequirementVectorFacets {
  /** The vector schema version (echoed for display). */
  readonly vectorVersion: number;
  /** The normalized dimension values, each in [0, 1]. */
  readonly values: Readonly<Record<string, number>>;
  /** Coverage confidence in [0, 1]. */
  readonly confidence: number;
}

/** One required-application constraint (machine-stable display input). */
export interface ApplicationRequirementFacets {
  readonly appId: string;
  readonly minVersion?: string;
}

/**
 * The hard-constraint facets the listing and recommendation displays
 * consume. Optional fields mirror the W022 shape exactly.
 */
export interface WorkloadConstraintsFacets {
  readonly requiredApplications?: readonly ApplicationRequirementFacets[];
  readonly environments?: readonly string[];
  readonly peripherals?: readonly string[];
  readonly classification?: string;
}

/** The working-hours informational facet. */
export interface WorkingHoursFacets {
  readonly startHour: number;
  readonly endHour: number;
}

/** One evidence link (the observation that informed a revision). */
export interface RequirementEvidenceFacets {
  readonly observationId: string;
  readonly kind?: string;
  readonly note?: string;
}

/**
 * The workload-profile facets — the W022 `WorkloadProfile` at the binding
 * site is ASSIGNABLE to this shape (extra fields are irrelevant).
 */
export interface WorkloadProfileFacets {
  readonly workloadId: WorkloadId;
  readonly tenantId: TenantId;
  readonly subjectKind: string;
  readonly name: string;
  readonly description: string;
  readonly revision: number;
  readonly requirements: RequirementVectorFacets;
  readonly constraints: WorkloadConstraintsFacets;
  readonly workingHours?: WorkingHoursFacets;
  readonly evidence: readonly RequirementEvidenceFacets[];
  readonly createdAt: string;
  readonly contentHash: string;
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// The fit-assessment facets (W022 FitAssessment on a recommendation)
// ---------------------------------------------------------------------------

/**
 * One constraint failure, widened for display: every arm of the W022
 * `ConstraintFailure` union is assignable (kind verbatim; the offending
 * values optional).
 */
export interface ConstraintFailureFacets {
  readonly kind: string;
  readonly appId?: string;
  readonly minVersion?: string;
  readonly availableVersion?: string;
  readonly environment?: string;
  readonly peripheral?: string;
  readonly required?: string;
  readonly supported?: string;
}

/** The constraint-check facet (the hard-gate result). */
export interface ConstraintCheckFacets {
  readonly satisfied: boolean;
  readonly failures: readonly ConstraintFailureFacets[];
}

/** One per-dimension fit row (the W022 DimensionFit). */
export interface DimensionFitFacets {
  readonly dimension: string;
  readonly required: number;
  readonly offered: number;
  readonly satisfaction: number;
}

/** The vector-comparison facet (the soft-score detail). */
export interface VectorComparisonFacets {
  readonly deltas: Readonly<Record<string, number>>;
  readonly satisfied: readonly string[];
  readonly deficits: readonly string[];
  readonly dimensions: readonly DimensionFitFacets[];
  readonly satisfaction: number;
  readonly worstDimension: string | null;
}

/** The fit-assessment facet (soft score + hard gate + verdict). */
export interface FitAssessmentFacets {
  readonly satisfaction: number;
  readonly comparison: VectorComparisonFacets;
  readonly constraintCheck: ConstraintCheckFacets;
  readonly meetsThreshold: boolean;
  readonly threshold: number;
}

// ---------------------------------------------------------------------------
// The recommendation facets (W022 WorkloadRecommendation at the binding site)
// ---------------------------------------------------------------------------

/**
 * A DRAFT Fleet Intent proposal carried by a recommendation — the frozen
 * contracts payload shapes, VERBATIM (the surface displays proposals as
 * read-only descriptors; it never constructs, dispatches, or mutates an
 * intent — the decision boundary belongs to the policy layer).
 */
export type WorkloadIntentProposalFacets =
  | { readonly intentKind: string; readonly payload: ProcurementIntentPayload }
  | { readonly intentKind: string; readonly payload: SoftwareSubscriptionIntentPayload };

/**
 * The workload-recommendation facets — the W022 `WorkloadRecommendation`
 * at the binding site is ASSIGNABLE to this shape.
 */
export interface WorkloadRecommendationFacets {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly workloadId: WorkloadId;
  readonly profileRevision: number;
  readonly kind: string;
  readonly candidateId: string;
  readonly label: string;
  readonly fit: FitAssessmentFacets;
  readonly confidence: number;
  readonly evidence: readonly RequirementEvidenceFacets[];
  readonly proposedIntents: readonly WorkloadIntentProposalFacets[];
  readonly rationale: string;
  readonly recommendationVersion: number;
  readonly supersedes?: string;
  readonly recommendedAt: string;
  readonly engineVersion: string;
  readonly modelVersion: number;
  readonly schemaVersion: number;
}

/** A recorded dismissal of a recommendation (machine-stable reason). */
export interface RecommendationDismissalFacets {
  readonly recommendationId: string;
  readonly reason: string;
  readonly dismissedAt: string;
  readonly correlationId: CorrelationId;
  readonly note?: string;
}

/** One append-only ledger entry (the W022 union, widened to facets). */
export type RecommendationLedgerEntryFacets =
  | { readonly kind: "recommendation"; readonly recommendation: WorkloadRecommendationFacets }
  | { readonly kind: "dismissal"; readonly dismissal: RecommendationDismissalFacets };

/**
 * The per-workload recommendation-ledger facets — the W022
 * `WorkloadRecommendationLedger` is ASSIGNABLE to this shape.
 */
export interface RecommendationLedgerFacets {
  readonly tenantId: TenantId;
  readonly workloadId: WorkloadId;
  readonly entries: readonly RecommendationLedgerEntryFacets[];
}

// ---------------------------------------------------------------------------
// LOCK 12 — the first-class linked-resource facets
// (hardware / software / connectivity / maintenance)
// ---------------------------------------------------------------------------

/**
 * A hardware resource: the recommended device class (the W022
 * `CandidateCapabilities` at the binding site is ASSIGNABLE — the
 * candidateId/label/procurementRequired triplet).
 */
export interface HardwareResourceFacets {
  readonly candidateId: string;
  readonly label: string;
  readonly procurementRequired?: boolean;
}

/**
 * A software resource: one allocated subscription — the W032
 * `SoftwareSubscription` is ASSIGNABLE to this shape.
 */
export interface SoftwareResourceFacets {
  readonly subscriptionId: string;
  readonly tenantId: TenantId;
  readonly softwareId: string;
  readonly seatCount: number;
  readonly termDays: number;
  readonly workloadId: WorkloadId;
  readonly revision: number;
  readonly supersedes?: string;
  readonly allocatedAt: string;
  readonly contentHash: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/**
 * A connectivity resource: one policy-gated ADCOS submission bound to the
 * workload — the W050A `ConnectivitySubmissionRecord` is ASSIGNABLE to
 * this shape. The seam deliberately EXCLUDES the opaque provider handle,
 * the provider refusal detail, and every provider topology/credential
 * field: the linkage surface displays the machine-stable submission
 * status, the outcome facet, and the append-only status timeline ONLY
 * (ARCHITECTURE-LOCK items 6-8).
 */
export interface ConnectivityResourceFacets {
  readonly tenantId: TenantId;
  readonly submissionId: string;
  readonly status: string;
  readonly request: {
    readonly targets: {
      readonly sourceDeviceId?: string;
      readonly targetDeviceId?: string;
      readonly workloadId?: string;
    };
    readonly outcome: { readonly canonical: string; readonly raw: string };
  };
  readonly revisions: readonly {
    readonly revision: number;
    readonly status: string;
    readonly at: string;
  }[];
}

/**
 * A maintenance resource: one service work order — the W042
 * `ServiceWorkOrder` is ASSIGNABLE to this shape. The diagnosis evidence
 * refs are surfaced machine-stable (hypothesis/recommendation/cause).
 */
export interface MaintenanceResourceFacets {
  readonly workOrderId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly revision: number;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly serviceCategory: string;
  readonly diagnosis: {
    readonly hypothesisId: string;
    readonly recommendationId: string;
    readonly causeId: string;
    readonly confidence: number;
  };
}

/**
 * One linked resource supplied at the binding site: the resource kind
 * (LOCK 12's four first-class kinds), the workload it is linked to, the
 * tenant scope, and the resource record itself (via its facet).
 */
export type WorkloadResourceLinkSource =
  | {
      readonly kind: "hardware";
      readonly workloadId: WorkloadId;
      readonly tenantId: TenantId;
      readonly resource: HardwareResourceFacets;
    }
  | {
      readonly kind: "software";
      readonly workloadId: WorkloadId;
      readonly tenantId: TenantId;
      readonly resource: SoftwareResourceFacets;
    }
  | {
      readonly kind: "connectivity";
      readonly workloadId: WorkloadId;
      readonly tenantId: TenantId;
      readonly resource: ConnectivityResourceFacets;
    }
  | {
      readonly kind: "maintenance";
      readonly workloadId: WorkloadId;
      readonly tenantId: TenantId;
      readonly resource: MaintenanceResourceFacets;
    };

/** The four first-class resource kinds (LOCK 12). */
export const WORKLOAD_RESOURCE_KINDS: readonly ("hardware" | "software" | "connectivity" | "maintenance")[] =
  Object.freeze(["hardware", "software", "connectivity", "maintenance"] as const);
