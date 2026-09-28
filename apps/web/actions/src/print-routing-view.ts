/**
 * @fleetos/web-actions — the print orchestration surface (W060B).
 *
 * Printer routing presented READ-ONLY with capability-based routing
 * REFUSALS visible and NEVER emulated:
 *
 *   - the job's required features pass through VERBATIM (never
 *     re-derived, never altered);
 *   - a REFUSED job carries the router's machine-stable
 *     `unsupported_feature:*` reasons VERBATIM and NO printer — the
 *     surface never suggests a fallback printer and never re-routes;
 *   - the per-printer capability disclosure exposes each printer's
 *     DECLARED capability flags (observable only) and the observable
 *     satisfaction comparison — computed by the local capability-gate
 *     mirror, proven EQUAL to the real W041 `supportsPrintFeatures`
 *     gate by the binding test;
 *   - the linked Guardian print-policy decision (document.print)
 *     presents as the decision context when the flow consulted the
 *     Guardian.
 *
 * The W041 record discipline is VALIDATED (fail-closed): a REFUSED job
 * must carry routing reasons and no printer; a ROUTED/QUEUED job must
 * carry a printer; a non-REFUSED job carries no routing reasons.
 *
 * PURE: every input is injected; no clock, no entropy, no I/O.
 * Tenant-scoped: the acting scope's tenant MUST match the job, every
 * printer and the linked decision (fail-closed refusal). Outputs are
 * deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  compareStrings,
  deepFrozen,
  frozen,
  frozenArray,
  isNonEmptyString,
  isPlainObject,
  isPositiveInteger,
  looksLikeIso,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import { projectDecisionContext, validateDecisionRecord } from "./decision-context";
import type { GuardianDecisionContextView } from "./decision-context";
import type {
  GuardianDecisionRecord,
  SurfacePrintJobRecord,
  SurfacePrintJobStatus,
  SurfacePrinterCapabilities,
  SurfacePrinterRecord,
  SurfaceTenantScope,
} from "./surface-contracts";
import { ALL_SURFACE_PRINT_JOB_STATUSES, ALL_SURFACE_PRINTER_CAPABILITIES } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The capability gate mirror (the W041 supportsPrintFeatures semantics)
// ---------------------------------------------------------------------------

/**
 * Does the declared capability set satisfy the required features? A
 * required feature is satisfied ONLY when the declared flag is `true`;
 * undefined/false is UNSUPPORTED and is REFUSED — never emulated. The
 * binding test proves this EQUALS the real W041
 * `supportsPrintFeatures` over the full feature matrix.
 *
 * @param required the required features (subset with `true`)
 * @param flags the printer's declared capabilities
 * @returns true if every required feature is declared `true`
 */
export function supportsPrintFeaturesView(
  required: SurfacePrinterCapabilities,
  flags: SurfacePrinterCapabilities,
): boolean {
  for (const feature of ALL_SURFACE_PRINTER_CAPABILITIES) {
    if (required[feature] === true && flags[feature] !== true) {
      return false;
    }
  }
  return true;
}

export { ALL_SURFACE_PRINTER_CAPABILITIES };

// ---------------------------------------------------------------------------
// The presentation view-models
// ---------------------------------------------------------------------------

/** One per-printer capability disclosure (observable, declared flags only). */
export interface PrinterCapabilityDisclosureView {
  /** The printer identity. */
  readonly printerId: string;
  /** Whether the printer is on the tenant's approved list (observable). */
  readonly approved?: boolean;
  /** The printer's location (open string, observable). */
  readonly location?: string;
  /** The printer's DECLARED capability flags (verbatim). */
  readonly capabilities: SurfacePrinterCapabilities;
  /** The observable comparison: do the DECLARED flags satisfy the job's required features? */
  readonly satisfiesRequiredFeatures: boolean;
}

/** The print routing presentation view. */
export interface PrintRoutingPresentationView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The job identity. */
  readonly jobId: string;
  /** The job status. */
  readonly status: SurfacePrintJobStatus;
  /** Whether the routing was REFUSED (derived from the status). */
  readonly refused: boolean;
  /** The document reference (opaque payload projection, verbatim). */
  readonly documentRef: string;
  /** The target user id, when present (opaque, verbatim). */
  readonly targetUserId?: string;
  /** The required printer features (VERBATIM — never altered, never re-derived). */
  readonly requiredFeatures: SurfacePrinterCapabilities;
  /** The resolved printer, when routed/queued/completed (absent when REFUSED). */
  readonly printerId?: string;
  /** The queue position, when assigned. */
  readonly queuePosition?: number;
  /** ISO 8601 creation timestamp (verbatim). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (verbatim). */
  readonly transitionedAt?: string;
  /** The correlation id of the originating request (verbatim). */
  readonly correlationId: SurfacePrintJobRecord["correlationId"];
  /** OPAQUE evidence refs (verbatim). */
  readonly evidence: SurfacePrintJobRecord["evidence"];
  /** The machine-stable routing reasons (VERBATIM; non-empty iff REFUSED). */
  readonly routingReasons: readonly string[];
  /** The per-printer DECLARED capability disclosures (ordered by printerId). */
  readonly printerDisclosures: readonly PrinterCapabilityDisclosureView[];
  /** The linked Guardian print-policy decision context, when linked. */
  readonly linkedDecision: GuardianDecisionContextView | null;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The tagged result of `buildPrintRoutingView`. */
export type PrintRoutingPresentationResult = SurfaceResult<PrintRoutingPresentationView>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isCapabilityFlags(value: unknown): value is SurfacePrinterCapabilities {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (
      !(ALL_SURFACE_PRINTER_CAPABILITIES as readonly string[]).includes(key) ||
      typeof (value as Record<string, unknown>)[key] !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

function validateCapabilities(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const key of Object.keys(candidate)) {
    const value = (candidate as Record<string, unknown>)[key];
    if (!(ALL_SURFACE_PRINTER_CAPABILITIES as readonly string[]).includes(key)) {
      failures.push({ path: `${path}/${key}`, reason: "unknown_feature" });
    } else if (typeof value !== "boolean") {
      failures.push({ path: `${path}/${key}`, reason: "boolean_required" });
    }
  }
}

function validatePrintJobRecord(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["jobId", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  const status = candidate["status"];
  if (
    typeof status !== "string" ||
    !(ALL_SURFACE_PRINT_JOB_STATUSES as readonly string[]).includes(status)
  ) {
    failures.push({ path: `${path}/status`, reason: "unknown_status" });
  }
  const payload = candidate["payload"];
  if (!isPlainObject(payload) || !isNonEmptyString(payload["documentRef"])) {
    failures.push({ path: `${path}/payload/documentRef`, reason: "non_empty_string_required" });
  } else if (
    payload["targetUserId"] !== undefined &&
    !isNonEmptyString(payload["targetUserId"])
  ) {
    failures.push({ path: `${path}/payload/targetUserId`, reason: "non_empty_string_required" });
  }
  const requiredFeatures = candidate["requiredFeatures"];
  if (requiredFeatures === undefined) {
    failures.push({ path: `${path}/requiredFeatures`, reason: "required" });
  } else {
    validateCapabilities(requiredFeatures, `${path}/requiredFeatures`, failures);
  }
  if (!looksLikeIso(String(candidate["createdAt"] ?? ""))) {
    failures.push({ path: `${path}/createdAt`, reason: "not_iso" });
  }
  if (
    candidate["transitionedAt"] !== undefined &&
    !looksLikeIso(String(candidate["transitionedAt"]))
  ) {
    failures.push({ path: `${path}/transitionedAt`, reason: "not_iso" });
  }
  const evidence = candidate["evidence"];
  if (!Array.isArray(evidence)) {
    failures.push({ path: `${path}/evidence`, reason: "array_required" });
  }
  if (!isNonEmptyString(candidate["correlationId"])) {
    failures.push({ path: `${path}/correlationId`, reason: "non_empty_string_required" });
  }
  // The W041 record discipline (machine-stable, fail-closed).
  const printerId = candidate["printerId"];
  if (printerId !== undefined && !isNonEmptyString(printerId)) {
    failures.push({ path: `${path}/printerId`, reason: "non_empty_string_required" });
  }
  const queuePosition = candidate["queuePosition"];
  if (
    queuePosition !== undefined &&
    (typeof queuePosition !== "number" || !Number.isInteger(queuePosition) || (queuePosition as number) < 1)
  ) {
    failures.push({ path: `${path}/queuePosition`, reason: "positive_integer_required" });
  }
  const routingReasons = candidate["routingReasons"];
  const routingReasonsEmpty =
    routingReasons === undefined ||
    (Array.isArray(routingReasons) && routingReasons.length === 0);
  if (routingReasons !== undefined) {
    if (!Array.isArray(routingReasons)) {
      failures.push({ path: `${path}/routingReasons`, reason: "array_required" });
    } else {
      for (let i = 0; i < routingReasons.length; i++) {
        if (!isNonEmptyString(routingReasons[i])) {
          failures.push({ path: `${path}/routingReasons/${i}`, reason: "non_empty_string_required" });
        }
      }
    }
  }
  if (status === "REFUSED") {
    if (printerId !== undefined) {
      failures.push({ path: `${path}/printerId`, reason: "refused_job_has_printer" });
    }
    if (routingReasonsEmpty) {
      failures.push({ path: `${path}/routingReasons`, reason: "refused_job_missing_reasons" });
    }
  } else {
    if (!routingReasonsEmpty) {
      failures.push({ path: `${path}/routingReasons`, reason: "non_refused_job_has_reasons" });
    }
    if ((status === "ROUTED" || status === "QUEUED") && printerId === undefined) {
      failures.push({ path: `${path}/printerId`, reason: "routed_job_missing_printer" });
    }
  }
}

function validatePrinterRecord(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  if (!isNonEmptyString(candidate["printerId"])) {
    failures.push({ path: `${path}/printerId`, reason: "non_empty_string_required" });
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  const capabilities = candidate["capabilities"];
  if (capabilities === undefined) {
    failures.push({ path: `${path}/capabilities`, reason: "required" });
  } else if (!isCapabilityFlags(capabilities)) {
    validateCapabilities(capabilities, `${path}/capabilities`, failures);
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the print routing presentation view. The job record passes the
 * W041 discipline validation (REFUSED carries reasons and no printer;
 * ROUTED/QUEUED carry a printer); the printers (when provided) are
 * disclosed with their DECLARED capability flags and the observable
 * satisfaction comparison; the linked Guardian decision presents as
 * context. Disclosures are ordered by printerId (machine-stable).
 *
 * @param scope the acting tenant scope
 * @param job the print job record (the real W041 PrintJobRequest, bound at the binding site)
 * @param printers the available printers for the capability disclosure (optional)
 * @param linkedDecision the Guardian print-policy decision, when linked
 * @returns the tagged result: the presentation or a machine-stable error
 */
export function buildPrintRoutingView(
  scope: SurfaceTenantScope,
  job: SurfacePrintJobRecord,
  printers?: readonly SurfacePrinterRecord[],
  linkedDecision?: GuardianDecisionRecord,
): PrintRoutingPresentationResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "print routing surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of the job, printers + decision.
  const jobFailures: SurfaceValidationFailure[] = [];
  const printerFailures: SurfaceValidationFailure[] = [];
  if (!isPlainObject(job)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.jobInvalid,
        "print routing surface requires a job record",
        scope.tenantId,
        [{ path: "/job", reason: "object_required" }],
      ),
    };
  }
  validatePrintJobRecord(job, "", jobFailures);
  const printerList = printers === undefined ? [] : printers;
  if (!Array.isArray(printerList)) {
    printerFailures.push({ path: "/printers", reason: "array_required" });
  } else {
    for (let i = 0; i < printerList.length; i++) {
      validatePrinterRecord(printerList[i], `/printers/${i}`, printerFailures);
    }
  }
  const decisionFailures: SurfaceValidationFailure[] = [];
  if (linkedDecision !== undefined) {
    validateDecisionRecord(linkedDecision, "/linkedDecision", decisionFailures);
  }
  if (jobFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.jobInvalid,
        "print routing surface job record is invalid",
        scope.tenantId,
        jobFailures,
      ),
    };
  }
  if (printerFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.printerInvalid,
        "print routing surface printer records are invalid",
        scope.tenantId,
        printerFailures,
      ),
    };
  }
  if (decisionFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.decisionInvalid,
        "print routing surface linked decision is invalid",
        scope.tenantId,
        decisionFailures,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection (job + printers + decision).
  const tenantFailures: SurfaceValidationFailure[] = [];
  if ((job as { tenantId: unknown }).tenantId !== scope.tenantId) {
    tenantFailures.push({ path: "/job/tenantId", reason: "tenant_mismatch" });
  }
  for (let i = 0; i < printerList.length; i++) {
    if ((printerList[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/printers/${i}/tenantId`, reason: "tenant_mismatch" });
    }
  }
  if (linkedDecision !== undefined && linkedDecision.tenantId !== scope.tenantId) {
    tenantFailures.push({ path: "/linkedDecision/tenantId", reason: "tenant_mismatch" });
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "print routing surface refuses cross-tenant records",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the verbatim presentation + the observable disclosure.
  const requiredFeatures: SurfacePrinterCapabilities = frozen({ ...job.requiredFeatures });
  const disclosures = [...printerList]
    .sort((a, b) => compareStrings(a.printerId, b.printerId))
    .map((record) =>
      frozen({
        printerId: record.printerId,
        approved: record.approved,
        location: record.location,
        capabilities: frozen({ ...record.capabilities }),
        satisfiesRequiredFeatures: supportsPrintFeaturesView(
          job.requiredFeatures,
          record.capabilities,
        ),
      } satisfies PrinterCapabilityDisclosureView),
    );
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        jobId: job.jobId,
        status: job.status,
        refused: job.status === "REFUSED",
        documentRef: job.payload.documentRef,
        targetUserId: job.payload.targetUserId,
        requiredFeatures,
        printerId: job.printerId,
        queuePosition: job.queuePosition,
        createdAt: job.createdAt,
        transitionedAt: job.transitionedAt,
        correlationId: job.correlationId,
        evidence: frozenArray(job.evidence),
        routingReasons: frozenArray(job.routingReasons ?? []),
        printerDisclosures: frozenArray(disclosures),
        linkedDecision:
          linkedDecision === undefined ? null : projectDecisionContext(linkedDecision),
        contentDigest: job.contentDigest,
      } satisfies PrintRoutingPresentationView),
    ),
  };
}
