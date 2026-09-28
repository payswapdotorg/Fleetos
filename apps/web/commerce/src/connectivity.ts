/**
 * @fleetos/web-commerce — the CONNECTIVITY surface (W050A ADCOS boundary,
 * provider-neutral).
 *
 * "ADCOS owns network-native topology/path execution; FleetOS owns fleet
 * connectivity intent and device/workload policy." —
 * `spec/ARCHITECTURE-LOCK.md` item 8. "Provider-specific APIs/types
 * never enter core domain contracts" (item 6); "ADCOS, Arena and Aurum
 * integrate through provider-neutral contracts" (item 7).
 *
 * This module surfaces the ADCOS boundary PROVIDER-NEUTRALLY:
 *
 *   - the connectivity INTENT REQUEST display: the typed, provider-
 *     neutral request facets (outcome, targets, properties, hard
 *     constraints, duration, budget refs, security requirements) with
 *     the full GUARDIAN DECISION CONTEXT on every revision (the FROZEN
 *     `GuardianDecision` + the widened evaluation reasons + the matched
 *     rule refs) — PARKED APPROVALS ARE VISIBLE with their decision
 *     context (the human-approval hold is a first-class display state);
 *   - the STATUS INGESTION TIMELINE: the adopted connectivity record's
 *     append-only revision chain with the NORMALIZED execution states
 *     (PROVISIONING/ACTIVE/TERMINATING/TERMINATED) and the machine-
 *     stable DEGRADATION taxonomy surfaced per revision;
 *   - NEVER provider topology or credentials: the seams exclude the
 *     opaque provider handle, the provider refusal DETAIL (the
 *     machine-stable refusal REASON is surfaced), and every
 *     topology/credential/SDK field — asserted by test.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; every timestamp is echoed from the versioned records.
 */

import type { TenantId } from "@fleetos/contracts";
import type { ConnectivityRecordFacets, ConnectivitySubmissionFacets } from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The connectivity view-model schema version. */
export const CONNECTIVITY_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The submission display (intent requests + Guardian decision context)
// ---------------------------------------------------------------------------

/** One submission-revision display row (the decision context carried). */
export interface SubmissionRevisionView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly submissionId: string;
  readonly revision: number;
  /** The machine-stable submission status this revision records. */
  readonly status: string;
  /** The injected transition instant, verbatim. */
  readonly at: string;
  /** The Guardian decision type, when a decision was made. */
  readonly decisionType: string | null;
  /** The matched rule refs (ruleId + version), machine-stable. */
  readonly matchedRules: readonly { readonly ruleId: string; readonly version: number }[];
  /** The machine-stable evaluation reasons (code + rule refs). */
  readonly reasons: readonly {
    readonly code: string;
    readonly ruleId?: string;
    readonly ruleVersion?: number;
    readonly effect?: string;
    readonly chosen?: string;
  }[];
  /** The machine-stable provider refusal REASON (never the detail). */
  readonly providerRefusalReason: string | null;
}

/** The connectivity intent-request display (one submission aggregate). */
export interface ConnectivityRequestView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly submissionId: string;
  /** The current submission status (machine-stable). */
  readonly status: string;
  /** True when the submission is PARKED awaiting human approval. */
  readonly awaitingApproval: boolean;
  /** The originating intent ref (traceability, never provider data). */
  readonly intentRef: { readonly intentId: string; readonly version: number; readonly createdAt: string };
  /** The requested outcome (canonical class + raw string, verbatim). */
  readonly outcome: { readonly canonical: string; readonly raw: string };
  /** The target refs (devices + workload — provider-neutral). */
  readonly targets: {
    readonly sourceDeviceId: string | null;
    readonly targetDeviceId: string | null;
    readonly workloadId: string | null;
  };
  /** The required properties (QoS facets, verbatim). */
  readonly properties: {
    readonly maxLatencyMs: number | null;
    readonly minThroughputMbps: number | null;
    readonly availabilityTarget: number | null;
    readonly isolation: string;
    readonly redundancy: string;
  };
  /** The hard constraints (zones sorted, egress, hops). */
  readonly constraints: {
    readonly requiredZones: readonly string[];
    readonly forbiddenZones: readonly string[];
    readonly maxPathHops: number | null;
    readonly egressAllowed: boolean;
  };
  /** The requested duration window. */
  readonly duration: {
    readonly startAt: string;
    readonly endAt: string | null;
    readonly indefinite: boolean;
  };
  /** The budget/policy refs (opaque tenant-side references). */
  readonly budget: { readonly budgetRef: string | null; readonly policyRefs: readonly string[] };
  /** The security requirements. */
  readonly security: {
    readonly encryption: string;
    readonly privateRouting: boolean;
    readonly complianceRefs: readonly string[];
  };
  /** The append-only revision timeline (the decision context). */
  readonly revisions: readonly SubmissionRevisionView[];
}

/** The tagged result of a submission display build. */
export type ConnectivityRequestResult =
  | { readonly ok: true; readonly view: ConnectivityRequestView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the connectivity intent-request display for ONE W050A
 * submission record: the typed provider-neutral request facets + the
 * full Guardian decision context on every revision. PARKED submissions
 * surface `awaitingApproval: true` (the human-approval hold is visible
 * with its decision + reasons). PURE and DETERMINISTIC.
 *
 * @param tenantId the acting tenant
 * @param submission the W050A `ConnectivitySubmissionRecord`
 * @returns the tagged display result
 */
export function buildConnectivityRequestView(
  tenantId: TenantId,
  submission: ConnectivitySubmissionFacets,
): ConnectivityRequestResult {
  if (submission === null || typeof submission !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.connectivity",
        "connectivity request display request is invalid",
        tenantId,
        [{ path: "/submission", reason: "submission_required" }],
      ),
    };
  }
  const mismatch = tenantMismatch(tenantId, submission.tenantId, "web-commerce.connectivity");
  if (mismatch !== null) return { ok: false, error: mismatch };

  const revisions: SubmissionRevisionView[] = submission.revisions.map((revision) =>
    frozen({
      viewVersion: CONNECTIVITY_VIEW_VERSION,
      tenantId,
      submissionId: submission.submissionId,
      revision: revision.revision,
      status: revision.status,
      at: revision.at,
      decisionType: revision.decision?.decision ?? null,
      matchedRules: frozenArray([...revision.matchedRules]),
      reasons: frozenArray([...revision.reasons]),
      providerRefusalReason: revision.providerRefusal?.reason ?? null,
    }),
  );

  return {
    ok: true,
    view: frozen({
      viewVersion: CONNECTIVITY_VIEW_VERSION,
      tenantId,
      submissionId: submission.submissionId,
      status: submission.status,
      awaitingApproval: submission.status === "PARKED",
      intentRef: frozen({
        intentId: submission.request.intentRef.intentId,
        version: submission.request.intentRef.version,
        createdAt: submission.request.intentRef.createdAt,
      }),
      outcome: frozen({
        canonical: submission.request.outcome.canonical,
        raw: submission.request.outcome.raw,
      }),
      targets: frozen({
        sourceDeviceId: submission.request.targets.sourceDeviceId ?? null,
        targetDeviceId: submission.request.targets.targetDeviceId ?? null,
        workloadId: submission.request.targets.workloadId ?? null,
      }),
      properties: frozen({
        maxLatencyMs: submission.request.properties.maxLatencyMs ?? null,
        minThroughputMbps: submission.request.properties.minThroughputMbps ?? null,
        availabilityTarget: submission.request.properties.availabilityTarget ?? null,
        isolation: submission.request.properties.isolation,
        redundancy: submission.request.properties.redundancy,
      }),
      constraints: frozen({
        requiredZones: frozenArray([...submission.request.constraints.requiredZones].sort(compareStrings)),
        forbiddenZones: frozenArray([...submission.request.constraints.forbiddenZones].sort(compareStrings)),
        maxPathHops: submission.request.constraints.maxPathHops ?? null,
        egressAllowed: submission.request.constraints.egressAllowed,
      }),
      duration: frozen({
        startAt: submission.request.duration.startAt,
        endAt: submission.request.duration.endAt ?? null,
        indefinite: submission.request.duration.indefinite === true,
      }),
      budget: frozen({
        budgetRef: submission.request.budget?.budgetRef ?? null,
        policyRefs: frozenArray([...(submission.request.budget?.policyRefs ?? [])].sort(compareStrings)),
      }),
      security: frozen({
        encryption: submission.request.security.encryption,
        privateRouting: submission.request.security.privateRouting,
        complianceRefs: frozenArray([...submission.request.security.complianceRefs].sort(compareStrings)),
      }),
      revisions: frozenArray(revisions),
    }),
  };
}

/** The connectivity submission list view. */
export interface ConnectivitySubmissionListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by submissionId (deterministic). */
  readonly rows: readonly ConnectivityRequestView[];
  readonly total: number;
  /** The count of submissions PARKED awaiting human approval. */
  readonly parkedCount: number;
}

/** The tagged result of a submission list build. */
export type ConnectivitySubmissionListResult =
  | { readonly ok: true; readonly view: ConnectivitySubmissionListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the tenant-scoped connectivity submission list (the intent
 * request inbox): every submission with its status + awaiting-approval
 * flag; PARKED counts surfaced for the approval worklist.
 *
 * @param tenantId the acting tenant
 * @param submissions the W050A submission records
 * @returns the tagged list result
 */
export function buildConnectivitySubmissionListView(
  tenantId: TenantId,
  submissions: readonly ConnectivitySubmissionFacets[],
): ConnectivitySubmissionListResult {
  if (!Array.isArray(submissions)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.connectivity",
        "connectivity submission list request is invalid",
        tenantId,
        [{ path: "/submissions", reason: "array_required" }],
      ),
    };
  }
  const views: ConnectivityRequestView[] = [];
  for (const submission of submissions) {
    const result = buildConnectivityRequestView(tenantId, submission);
    if (!result.ok) return result;
    views.push(result.view);
  }
  views.sort((a, b) => compareStrings(a.submissionId, b.submissionId));
  return {
    ok: true,
    view: frozen({
      viewVersion: CONNECTIVITY_VIEW_VERSION,
      tenantId,
      rows: frozenArray(views),
      total: views.length,
      parkedCount: views.filter((view) => view.awaitingApproval).length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The status ingestion timeline (normalized states + degradation)
// ---------------------------------------------------------------------------

/** One timeline entry (one adopted revision). */
export interface ConnectivityTimelineEntryView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly connectivityId: string;
  readonly revision: number;
  /** The injected adoption instant, verbatim. */
  readonly adoptedAt: string;
  /** The NORMALIZED execution state (machine-stable lifecycle). */
  readonly executionState: string;
  /** The machine-stable degradation kind surfaced on this revision. */
  readonly degradationKind: string;
  /** True when the revision is degraded (degradation kind != "none"). */
  readonly degraded: boolean;
  /** The machine-stable failure kind surfaced on this revision. */
  readonly failureKind: string;
  /** True when the revision carries a failure (failure kind != "none"). */
  readonly failed: boolean;
  /** The termination reason, when the revision terminated the contract. */
  readonly terminationReason: string | null;
  /** The measurement kinds on this revision (sorted, machine-stable). */
  readonly measurementKinds: readonly string[];
  /** The revision's content digest (the hash-linked chain evidence). */
  readonly contentDigest: string;
}

/** The connectivity status timeline view (one adopted record). */
export interface ConnectivityTimelineView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly connectivityId: string;
  /** The current (latest revision's) normalized execution state. */
  readonly executionState: string;
  /** True when the LATEST revision is degraded. */
  readonly degraded: boolean;
  /** True when the LATEST revision carries a failure. */
  readonly failed: boolean;
  /** The originating intent ref, when the record is bound to a submission. */
  readonly intentRef: { readonly intentId: string; readonly version: number; readonly createdAt: string } | null;
  /** The append-only timeline (revision order — never reordered). */
  readonly entries: readonly ConnectivityTimelineEntryView[];
  /** The distinct degradation kinds observed across the chain (sorted). */
  readonly observedDegradationKinds: readonly string[];
}

/** The tagged result of a timeline build. */
export type ConnectivityTimelineResult =
  | { readonly ok: true; readonly view: ConnectivityTimelineView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the STATUS INGESTION TIMELINE for one adopted connectivity
 * record: the append-only revision chain with the NORMALIZED execution
 * states and the machine-stable degradation/failure taxonomies per
 * revision. The seam EXCLUDES the provider handle — the timeline is
 * pure provider-neutral display (asserted by test).
 *
 * @param tenantId the acting tenant
 * @param record the W050A `ConnectivityRecord` (the adopted timeline)
 * @returns the tagged timeline result
 */
export function buildConnectivityTimelineView(
  tenantId: TenantId,
  record: ConnectivityRecordFacets,
): ConnectivityTimelineResult {
  if (record === null || typeof record !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.connectivity",
        "connectivity timeline request is invalid",
        tenantId,
        [{ path: "/record", reason: "record_required" }],
      ),
    };
  }
  const mismatch = tenantMismatch(tenantId, record.tenantId, "web-commerce.connectivity");
  if (mismatch !== null) return { ok: false, error: mismatch };

  const entries: ConnectivityTimelineEntryView[] = record.revisions.map((revision) =>
    frozen({
      viewVersion: CONNECTIVITY_VIEW_VERSION,
      tenantId,
      connectivityId: record.connectivityId,
      revision: revision.revision,
      adoptedAt: revision.adoptedAt,
      executionState: revision.executionState,
      degradationKind: revision.degradation.kind,
      degraded: revision.degradation.kind !== "none",
      failureKind: revision.failure.kind,
      failed: revision.failure.kind !== "none",
      terminationReason: revision.termination?.reason ?? null,
      measurementKinds: frozenArray(
        [...new Set(revision.measurements.map((m) => m.kind))].sort(compareStrings),
      ),
      contentDigest: revision.contentDigest,
    }),
  );

  const latest = record.revisions[record.revisions.length - 1];
  const observedDegradationKinds = [
    ...new Set(record.revisions.map((revision) => revision.degradation.kind)),
  ].sort(compareStrings);

  return {
    ok: true,
    view: frozen({
      viewVersion: CONNECTIVITY_VIEW_VERSION,
      tenantId,
      connectivityId: record.connectivityId,
      executionState: record.executionState,
      degraded: latest !== undefined && latest.degradation.kind !== "none",
      failed: latest !== undefined && latest.failure.kind !== "none",
      intentRef:
        record.intentRef !== null
          ? frozen({
              intentId: record.intentRef.intentId,
              version: record.intentRef.version,
              createdAt: record.intentRef.createdAt,
            })
          : null,
      entries: frozenArray(entries),
      observedDegradationKinds: frozenArray(observedDegradationKinds),
    }),
  };
}
