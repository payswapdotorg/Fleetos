/**
 * @fleetos/web-security — D1: the Security Doctor findings surface.
 *
 * The W031 Security Doctor's findings surfaced READ-ONLY via the
 * structural seam (`SecurityFindingRecord`): a findings LIST
 * view-model with machine-stable severity ordering (severity rank
 * desc, code asc, deviceId asc, interpretation version desc — input
 * order never matters), OPAQUE evidence refs (observation ids pass
 * through untouched, never interpreted), and recommended remediations
 * displayed as PROPOSALs — never direct execution (no intent id, no
 * lifecycle status, no dispatch path; LOCK 16: the gated path is
 * exposed with its decision context, not a button).
 *
 * Findings are INTERPRETATIONS (ARCHITECTURE-LOCK item 3): the surface
 * presents them as versioned records with supersedes links — the
 * version discipline of the W031 ledger stays visible.
 *
 * PURE: every input is injected; no clock, no entropy, no I/O. The
 * same inputs produce byte-identical views. Tenant-scoped: the acting
 * scope's tenant MUST match every finding's tenant (a mismatch REFUSES
 * the whole build with a tagged error — fail-closed, never silently
 * filtered).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { deepFrozen, frozen, frozenArray, isNonEmptyString, isPlainObject, isPositiveInteger, looksLikeIso, makeSurfaceError, SURFACE_ERROR_CODES, SYNTHETIC_SURFACE_TENANT, compareStrings } from "./internal";
import type { SurfaceError, SurfaceResult, SurfaceValidationFailure } from "./internal";
import type {
  FindingEvidenceRef,
  RemediationProposalDraft,
  SecurityFindingRecord,
  SurfaceFindingClassification,
  SurfaceSeverity,
  SurfaceTenantScope,
} from "./surface-contracts";
import { ALL_SURFACE_DECISION_TYPES, ALL_SURFACE_SEVERITIES, SECURITY_REMEDIATION_INTENT_KIND, SURFACE_SEVERITY_RANK } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The remediation PROPOSAL view (never an execution)
// ---------------------------------------------------------------------------

/**
 * A remediation presented as a PROPOSAL: the frozen intent kind + the
 * DRAFT payload + the explicit disclosure that no direct-execution
 * path exists on this surface. The serialized view carries neither an
 * intent id nor a lifecycle status (proven by test) — the deterministic
 * policy layer (the Contract Guardian) decides whether any action is
 * ever permitted.
 */
export interface RemediationProposalView {
  /** The presentation discipline: this is a PROPOSAL, never an execution. */
  readonly presentation: "PROPOSAL";
  /** The frozen intent kind this proposal drafts (SecurityRemediationIntent). */
  readonly intentKind: typeof SECURITY_REMEDIATION_INTENT_KIND;
  /** The DRAFT payload (deviceId?/findingId?/description) — nothing else. */
  readonly payload: RemediationProposalDraft["payload"];
  /** LOCK 16 disclosure: no direct-execution path exists on this surface. */
  readonly executionPath: "none";
}

// ---------------------------------------------------------------------------
// The findings list view-model
// ---------------------------------------------------------------------------

/** One findings-list row (a read-only projection of a finding record). */
export interface FindingsListItemView {
  /** The stable finding identity. */
  readonly findingId: string;
  /** The record identity (this interpretation version). */
  readonly recordId: string;
  /** The device the finding concerns. */
  readonly deviceId: SecurityFindingRecord["deviceId"];
  /** The machine-stable finding code. */
  readonly code: string;
  /** The human title (displayed; never matched on). */
  readonly title: string;
  /** The severity. */
  readonly severity: SurfaceSeverity;
  /** The machine-stable severity rank (ordering key). */
  readonly severityRank: number;
  /** The classification. */
  readonly classification: SurfaceFindingClassification;
  /** The interpretation version (>= 1). */
  readonly interpretationVersion: number;
  /** The prior record this interpretation supersedes (absent on version 1). */
  readonly supersedes?: string;
  /** ISO 8601 assessment instant (injected upstream; passed through verbatim). */
  readonly detectedAt: string;
  /** ISO 8601 source-observation instant (injected upstream; verbatim). */
  readonly observedAt: string;
  /** OPAQUE evidence refs (observation ids + kinds — never interpreted). */
  readonly evidence: readonly FindingEvidenceRef[];
  /** The evidence count (derived). */
  readonly evidenceCount: number;
  /** The remediation PROPOSAL (absent when the finding carries no draft). */
  readonly remediationProposal: RemediationProposalView | null;
}

/** The findings list view (ordered, counted, read-only). */
export interface FindingsListView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The total number of findings. */
  readonly total: number;
  /** The derived per-severity counts. */
  readonly severityCounts: Readonly<Record<SurfaceSeverity, number>>;
  /** The ordered items (severity rank desc, code asc, deviceId asc, version desc). */
  readonly items: readonly FindingsListItemView[];
}

/** The tagged result of `buildFindingsListView`. */
export type FindingsListViewResult = SurfaceResult<FindingsListView>;

// ---------------------------------------------------------------------------
// Validation (pure, machine-stable failures)
// ---------------------------------------------------------------------------

function validateFinding(
  candidate: unknown,
  index: number,
  failures: SurfaceValidationFailure[],
): void {
  const path = `/findings/${index}`;
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["findingId", "recordId", "code", "title"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["deviceId"])) {
    failures.push({ path: `${path}/deviceId`, reason: "non_empty_string_required" });
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  const severity = candidate["severity"];
  if (typeof severity !== "string" || !(ALL_SURFACE_SEVERITIES as readonly string[]).includes(severity)) {
    failures.push({ path: `${path}/severity`, reason: "unknown_severity" });
  }
  const classification = candidate["classification"];
  if (
    typeof classification !== "string" ||
    !["compliance", "configuration", "exposure", "threat"].includes(classification)
  ) {
    failures.push({ path: `${path}/classification`, reason: "unknown_classification" });
  }
  if (!isPositiveInteger(candidate["interpretationVersion"])) {
    failures.push({ path: `${path}/interpretationVersion`, reason: "positive_integer_required" });
  }
  if (candidate["supersedes"] !== undefined && !isNonEmptyString(candidate["supersedes"])) {
    failures.push({ path: `${path}/supersedes`, reason: "non_empty_string_required" });
  }
  if (!looksLikeIso(String(candidate["detectedAt"] ?? ""))) {
    failures.push({ path: `${path}/detectedAt`, reason: "not_iso" });
  }
  if (!looksLikeIso(String(candidate["observedAt"] ?? ""))) {
    failures.push({ path: `${path}/observedAt`, reason: "not_iso" });
  }
  const evidence = candidate["evidence"];
  if (!Array.isArray(evidence)) {
    failures.push({ path: `${path}/evidence`, reason: "array_required" });
  } else {
    for (let i = 0; i < evidence.length; i++) {
      const ref = evidence[i];
      if (
        !isPlainObject(ref) ||
        !isNonEmptyString(ref["observationId"]) ||
        !isNonEmptyString(ref["kind"])
      ) {
        failures.push({ path: `${path}/evidence/${i}`, reason: "evidence_ref_invalid" });
      }
    }
  }
  const remediation = candidate["remediation"];
  if (remediation !== undefined) {
    if (
      !isPlainObject(remediation) ||
      (remediation as { intentKind?: unknown })["intentKind"] !== SECURITY_REMEDIATION_INTENT_KIND
    ) {
      failures.push({ path: `${path}/remediation/intentKind`, reason: "intent_kind_mismatch" });
    } else {
      const payload = (remediation as { payload?: unknown })["payload"];
      if (
        !isPlainObject(payload) ||
        !isNonEmptyString((payload as { description?: unknown })["description"])
      ) {
        failures.push({ path: `${path}/remediation/payload/description`, reason: "non_empty_string_required" });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the read-only findings list view.
 *
 * Ordering (machine-stable, input-order invariant):
 *   1. severity rank desc (CRITICAL first);
 *   2. code asc;
 *   3. deviceId asc;
 *   4. interpretationVersion desc (the LATEST interpretation leads).
 *
 * The view is deeply frozen. The builder never mutates its input.
 *
 * @param scope the acting tenant scope (first parameter, tenant discipline)
 * @param findings the finding records (the W031 ledger's derived active view, bound at the binding site)
 * @returns the tagged result: the ordered view or a machine-stable error
 */
export function buildFindingsListView(
  scope: SurfaceTenantScope,
  findings: readonly SecurityFindingRecord[],
): FindingsListViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "findings surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every finding (field-level paths).
  const structural: SurfaceValidationFailure[] = [];
  if (!Array.isArray(findings)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.findingInvalid,
        "findings surface requires an array of finding records",
        scope.tenantId,
        [{ path: "/findings", reason: "array_required" }],
      ),
    };
  }
  for (let i = 0; i < findings.length; i++) {
    validateFinding(findings[i], i, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.findingInvalid,
        "findings surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection: EVERY finding must belong
  // to the acting tenant (fail-closed, never silently filtered).
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < findings.length; i++) {
    if ((findings[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/findings/${i}`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "findings surface refuses cross-tenant finding records",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, counted projection.
  const severityCounts: Record<SurfaceSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  const items: FindingsListItemView[] = findings.map(
    (record: SecurityFindingRecord): FindingsListItemView => {
      severityCounts[record.severity] += 1;
      return frozen({
      findingId: record.findingId,
      recordId: record.recordId,
      deviceId: record.deviceId,
      code: record.code,
      title: record.title,
      severity: record.severity,
      severityRank: SURFACE_SEVERITY_RANK[record.severity],
      classification: record.classification,
      interpretationVersion: record.interpretationVersion,
      supersedes: record.supersedes,
      detectedAt: record.detectedAt,
      observedAt: record.observedAt,
      evidence: frozenArray(record.evidence),
      evidenceCount: record.evidence.length,
      remediationProposal:
        record.remediation === undefined
          ? null
          : frozen({
              presentation: "PROPOSAL",
              intentKind: record.remediation.intentKind,
              payload: frozen({ ...record.remediation.payload }),
              executionPath: "none",
            } satisfies RemediationProposalView),
    } satisfies FindingsListItemView);
    },
  );
  items.sort((a, b) => {
    if (a.severityRank !== b.severityRank) return b.severityRank - a.severityRank;
    const byCode = compareStrings(a.code, b.code);
    if (byCode !== 0) return byCode;
    const byDevice = compareStrings(a.deviceId, b.deviceId);
    if (byDevice !== 0) return byDevice;
    return b.interpretationVersion - a.interpretationVersion;
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: items.length,
        severityCounts: frozen({ ...severityCounts }),
        items: frozenArray(items),
      } satisfies FindingsListView),
    ),
  };
}

// Re-exported for the surface's public index (the seam's severity data).
export { SURFACE_SEVERITY_RANK, ALL_SURFACE_SEVERITIES } from "./surface-contracts";
