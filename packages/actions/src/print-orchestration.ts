/**
 * @fleetos/actions — D3: Print orchestration — printer routing on top of
 * the frozen `PrintIntentPayload` (documentRef + targetUserId).
 *
 * Per `spec/ARCHITECTURE.md` § Intent model: the Print intent carries a
 * frozen `PrintIntentPayload` OWNED by `@fleetos/actions` (per the
 * frozen `@fleetos/contracts` doc comments; the shape is already frozen
 * for this package — it never modifies it). This module is the BUILDER
 * of print job requests on top of that frozen payload: a print job is a
 * versioned record (the frozen PrintIntentPayload + the resolved
 * printer + queue state + observable evidence links).
 *
 * Per `spec/ARCHITECTURE-LOCK.md` item 16: "Destructive actions require
 * an explicit policy grant and evidence trail" — and per
 * `spec/ARCHITECTURE.md` § Device adapters: "Capability support is
 * explicit. Unsupported destructive behavior may never be emulated."
 * This module applies the SAME principle to print routing: a printer
 * whose declared capabilities do not support the job's required features
 * REFUSES the job (tagged `routing_refused`), and the router NEVER
 * emulates the missing capability via a different printer that lacks it.
 * The router selects the best printer among those that DO support the
 * job's required features; if no printer supports them, the routing
 * fails with a tagged error (never a fallback).
 *
 * Per `spec/ARCHITECTURE.md` § Contract Guardian: routing rules evaluate
 * observable facts (cost, latency, proximity as typed comparable inputs).
 * The router accepts INJECTABLE preferences (a deterministic scoring
 * function over typed comparable values); the default is the identity
 * rank (the first printer that supports the job's features, in the
 * registry's deterministic order).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type {
  CorrelationId,
  CausationId,
  EvidenceRef,
  FleetError,
  PrintIntentPayload,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import { ACTIONS_PIPELINE_CORRELATION_ID, ERROR_CODES, SYNTHETIC_SYSTEM_TENANT, canonicalJson, fnv1a32Hex, frozen, frozenArray, looksLikeIso, makeDomainError, makeValidationError } from "./internal";
import type { ActionAuditSink } from "./audit-seam";
import { ACTION_AUDIT_ACTIONS, NOOP_ACTION_AUDIT_SINK } from "./audit-seam";

// ---------------------------------------------------------------------------
// Print capabilities (typed, deterministic)
// ---------------------------------------------------------------------------

/**
 * The explicit capability set a printer/copier declares. Capability
 * support is explicit: an unsupported feature (`undefined` or `false`)
 * is REFUSED, never emulated. The capability names mirror the
 * conventional printer feature taxonomy.
 */
export interface PrinterCapabilities {
  /** Color printing (vs. monochrome only). */
  readonly color?: boolean;
  /** Duplex (two-sided) printing. */
  readonly duplex?: boolean;
  /** Stapling / finishing. */
  readonly staple?: boolean;
  /** Hole punching. */
  readonly punch?: boolean;
  /** Scanning ( multifunction ). */
  readonly scan?: boolean;
  /** Faxing. */
  readonly fax?: boolean;
  /** Large-format (e.g. A2 / tabloid). */
  readonly largeFormat?: boolean;
  /** Photo / high-resolution printing. */
  readonly photo?: boolean;
  /** Cardstock / heavy media support. */
  readonly cardstock?: boolean;
}

/** The full list of capability names (for iteration + validation). */
export const ALL_PRINTER_CAPABILITIES: readonly (keyof PrinterCapabilities)[] = Object.freeze([
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
 * Pure helper: does the printer's declared capabilities satisfy the job's
 * required features? A required feature is satisfied only when the
 * printer's capability flag is `true`. Unsupported features (undefined /
 * false) are REFUSED — never emulated via a different printer.
 *
 * @param required the required features (subset of PrinterCapabilities with `true`)
 * @param flags the printer's declared capabilities
 * @returns true if the printer satisfies every required feature
 */
export function supportsPrintFeatures(
  required: PrinterCapabilities,
  flags: PrinterCapabilities,
): boolean {
  for (const feature of ALL_PRINTER_CAPABILITIES) {
    if (required[feature] === true && flags[feature] !== true) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Printer descriptor (typed)
// ---------------------------------------------------------------------------

/**
 * A typed printer descriptor. Capability-aware: the declared
 * `capabilities` gate the routing decision (a printer missing a required
 * feature REFUSES the job). The `preferences` bag carries the typed
 * comparable inputs (cost / latency / proximity) the router uses to
 * select the best printer among those that support the job's required
 * features. Preferences are INJECTABLE: the consumer supplies the
 * scoring function; the actions package never interprets the preference
 * values' meaning (only the comparable ordering).
 */
export interface PrinterDescriptor {
  /** The printer identifier (open string; the consumer assigns it). */
  readonly printerId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The printer's declared capabilities (explicit support only). */
  readonly capabilities: PrinterCapabilities;
  /** The printer's preferences (cost / latency / proximity as typed comparables). */
  readonly preferences: PrinterPreferences;
  /** Whether the printer is on the tenant's approved list (observable; mirrors the policy rule model's printer facet). */
  readonly approved?: boolean;
  /** The printer's geographic location (open string; for proximity routing). */
  readonly location?: string;
}

/**
 * Typed comparable preferences. The router accepts these as opaque
 * comparable values: a SCORING FUNCTION (injected by the caller) maps
 * the preferences to a number; the router selects the printer with the
 * best score (lowest cost / lowest latency / nearest proximity per the
 * caller's metric). The actions package never interprets the values'
 * semantics — only the comparable ordering matters.
 */
export interface PrinterPreferences {
  /** Cost per page, in arbitrary units (lower is better). */
  readonly costPerPage?: number;
  /** Latency in milliseconds (lower is better). */
  readonly latencyMs?: number;
  /** Proximity rank (lower is closer / better). */
  readonly proximityRank?: number;
  /** The printer's declared throughput (pages per minute; higher is better). */
  readonly throughputPpm?: number;
}

/**
 * The injected scoring function. Maps a printer's preferences to a
 * comparable number; the router selects the printer with the LOWEST
 * score (the consumer's function defines the ordering — typically
 * cost-weighted: cost_per_page * w1 + latency * w2 + proximity * w3).
 * Default: identity rank — the first supporting printer in the
 * registry's deterministic order (the actions package's "no
 * preference expressed" fallback, mirroring the W031 fail-closed
 * posture).
 */
export type PrinterScoreFn = (preferences: PrinterPreferences) => number;

/** The default score: 0 for every printer (identity rank). */
export const DEFAULT_PRINTER_SCORE_FN: PrinterScoreFn = () => 0;

// ---------------------------------------------------------------------------
// Print job request (versioned, immutable)
// ---------------------------------------------------------------------------

/** The status of a print job. */
export const PRINT_JOB_QUEUED = "QUEUED" as const;
export const PRINT_JOB_ROUTED = "ROUTED" as const;
export const PRINT_JOB_REFUSED = "REFUSED" as const;
export const PRINT_JOB_COMPLETED = "COMPLETED" as const;

export type PrintJobStatus =
  | typeof PRINT_JOB_ROUTED
  | typeof PRINT_JOB_QUEUED
  | typeof PRINT_JOB_REFUSED
  | typeof PRINT_JOB_COMPLETED;

/**
 * A versioned, immutable print job request. Built on top of the FROZEN
 * `PrintIntentPayload` (documentRef + targetUserId — the payload shape
 * OWNED by this package per the frozen contracts doc comments). The
 * print job carries the resolved printer + queue position + observable
 * evidence links; the payload shape is preserved verbatim (the
 * `payload` field carries the frozen `PrintIntentPayload` shape —
 * never modified, only embedded).
 *
 * The job's `requiredFeatures` is the printer-capability subset the
 * document demands (color, duplex, staple, ...). The router refuses any
 * printer whose declared capabilities do not satisfy the required
 * features (no emulation — the W031 device-adapter discipline applied to
 * print routing).
 */
export interface PrintJobRequest {
  /** The deterministic job identity: digest of (tenantId, documentRef, targetUserId?, createdAt). */
  readonly jobId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The schema version of this print job record. */
  readonly version: number;
  /** The FROZEN PrintIntentPayload (documentRef + targetUserId — verbatim, never modified). */
  readonly payload: PrintIntentPayload;
  /** The required printer features (capability subset the document demands). */
  readonly requiredFeatures: PrinterCapabilities;
  /** The resolved printer (when status is ROUTED / QUEUED / COMPLETED; absent when REFUSED). */
  readonly printerId?: string;
  /** The queue position assigned by the router (when status is ROUTED / QUEUED). */
  readonly queuePosition?: number;
  /** The job status. */
  readonly status: PrintJobStatus;
  /** ISO 8601 creation timestamp (injected). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (absent on the initial ROUTED/REFUSED). */
  readonly transitionedAt?: string;
  /** Observable evidence artifacts supporting the job (never interpreted by actions). */
  readonly evidence: readonly EvidenceRef[];
  /** The correlation id of the originating request (the PrintIntent's correlation). */
  readonly correlationId: CorrelationId;
  /** Machine-stable routing reasons (when status is REFUSED — the unsupported features list). */
  readonly routingReasons?: readonly string[];
  /** Canonical digest of the job's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// Print job routing (deterministic, capability-aware)
// ---------------------------------------------------------------------------

/** Input for `routePrintJob`. */
export interface RoutePrintJobInput {
  /** The frozen PrintIntentPayload (documentRef + targetUserId — verbatim). */
  readonly payload: PrintIntentPayload;
  /** The required printer features (capability subset the document demands). */
  readonly requiredFeatures: PrinterCapabilities;
  /** The acting tenant scope. */
  readonly tenantId: TenantId;
  /** The available printers (the router selects among these; structurally compatible with a registry view). */
  readonly printers: readonly PrinterDescriptor[];
  /** The injected scoring function (default: identity rank — first supporting printer). */
  readonly scoreFn?: PrinterScoreFn;
  /** Injected routing timestamp (ISO 8601). */
  readonly at: string;
  /** The correlation id of the routing request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the routing is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Observable evidence artifacts supporting the job. */
  readonly evidence?: readonly EvidenceRef[];
  /** The injected audit sink (the routing transition emits; default: no-op). */
  readonly auditSink?: ActionAuditSink;
}

/** The tagged result of a print job routing. */
export type RoutePrintJobResult =
  | { readonly ok: true; readonly job: PrintJobRequest }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The deterministic job-id digest: FNV-1a over the canonical JSON of
 * the identity tuple (tenantId, documentRef, targetUserId?, createdAt).
 *
 * @param tenantId the owning tenant
 * @param payload the frozen PrintIntentPayload
 * @param createdAt the injected creation timestamp
 * @returns the `prn_`-prefixed id
 */
export function printJobId(
  tenantId: TenantId,
  payload: PrintIntentPayload,
  createdAt: string,
): string {
  return `prn_${fnv1a32Hex(canonicalJson([tenantId, payload, createdAt]))}`;
}

/** Canonical digest of a job's content (identity fields excluded). */
function jobContentDigest(input: {
  payload: PrintIntentPayload;
  requiredFeatures: PrinterCapabilities;
  printerId?: string;
  queuePosition?: number;
  status: PrintJobStatus;
}): string {
  return fnv1a32Hex(
    canonicalJson({
      payload: input.payload,
      requiredFeatures: input.requiredFeatures,
      printerId: input.printerId,
      queuePosition: input.queuePosition,
      status: input.status,
    }),
  );
}

/**
 * Route a print job request to the best printer among those that support
 * the job's required features. PURE: the same payload + the same
 * printers + the same scoring function produce the same routing
 * decision, byte-for-byte, every run. DETERMINISTIC printer selection:
 * among the supporting printers, the router selects the one with the
 * LOWEST score (ties broken by printerId ascending — input-order
 * invariant). The router NEVER emulates a missing capability via a
 * different printer that lacks it — if no printer supports the required
 * features, the routing returns a tagged `routing_refused` error with
 * the unsupported feature names as machine-stable reasons.
 *
 * Audit: a successful routing emits `action.print.job.routed` to the
 * injected sink; a refusal emits `action.print.job.routed` with the
 * refused status (the audit carries the unsupported features list as
 * the routing reasons). Pure reads never audit.
 *
 * @param input the routing input
 * @returns the tagged routing result
 */
export function routePrintJob(input: RoutePrintJobInput): RoutePrintJobResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (typeof input?.tenantId !== "string" || input.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (input?.payload === undefined || typeof input.payload !== "object") {
    failures.push({ path: "/payload", reason: "object_required" });
  } else if (typeof input.payload.documentRef !== "string" || input.payload.documentRef.length === 0) {
    failures.push({ path: "/payload/documentRef", reason: "non_empty_string_required" });
  }
  if (input?.requiredFeatures === undefined || typeof input.requiredFeatures !== "object") {
    failures.push({ path: "/requiredFeatures", reason: "object_required" });
  }
  if (!Array.isArray(input?.printers)) {
    failures.push({ path: "/printers", reason: "array_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.printJobInvalid,
        "print job routing request is invalid",
        {
          tenantId: typeof input?.tenantId === "string" ? input.tenantId : SYNTHETIC_SYSTEM_TENANT,
          correlationId: input?.correlationId ?? ACTIONS_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }
  // Filter the supporting printers: the tenant MUST match the job's
  // tenant (foreign-tenant printers are filtered out — no side channel)
  // and the printer's declared capabilities MUST satisfy the required
  // features (no emulation — unsupported features are refused).
  const supporting = (input.printers as readonly PrinterDescriptor[]).filter(
    (p) =>
      p.tenantId === input.tenantId && supportsPrintFeatures(input.requiredFeatures, p.capabilities),
  );
  // Sort the supporting printers by score (ascending — lowest is best);
  // ties broken by printerId ascending (input-order invariant — the
  // same printers in any input order produce the same selection).
  const scoreFn: PrinterScoreFn = input.scoreFn ?? DEFAULT_PRINTER_SCORE_FN;
  const scored = supporting
    .map((p) => ({ printer: p, score: scoreFn(p.preferences) }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.printer.printerId < b.printer.printerId
        ? -1
        : a.printer.printerId > b.printer.printerId
          ? 1
          : 0;
    });
  const sink: ActionAuditSink = input.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  const jobId = printJobId(input.tenantId, input.payload, input.at);
  if (scored.length === 0) {
    // No printer supports the required features — REFUSED, never
    // emulated. The unsupported feature names are the machine-stable
    // routing reasons (so the caller can surface them deterministically).
    const unsupportedFeatures = ALL_PRINTER_CAPABILITIES.filter(
      (f) => input.requiredFeatures[f] === true,
    );
    const routingReasons = unsupportedFeatures.map(
      (f) => `unsupported_feature:${f}`,
    );
    const job: PrintJobRequest = frozen({
      jobId,
      tenantId: input.tenantId,
      version: 1,
      payload: input.payload,
      requiredFeatures: frozen({ ...input.requiredFeatures }) as PrinterCapabilities,
      status: PRINT_JOB_REFUSED,
      createdAt: input.at,
      evidence: frozenArray(input.evidence ?? []),
      correlationId: input.correlationId,
      routingReasons: frozenArray(routingReasons),
      contentDigest: jobContentDigest({
        payload: input.payload,
        requiredFeatures: input.requiredFeatures,
        status: PRINT_JOB_REFUSED,
      }),
    });
    sink.append(
      frozen({
        action: ACTION_AUDIT_ACTIONS.printJobRouted,
        tenantId: job.tenantId,
        subject: job.jobId,
        occurredAt: input.at,
        correlationId: input.correlationId,
        causationId: input.causationId,
        details: frozen({
          jobId: job.jobId,
          documentRef: job.payload.documentRef,
          status: job.status,
          unsupportedFeatures,
          printerCount: (input.printers as readonly PrinterDescriptor[]).length,
        }),
      }),
    );
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.printRoutingRefused,
        "print job routing refused: no printer supports the required features",
        { tenantId: input.tenantId, correlationId: input.correlationId },
        "action.print.routing",
        "unsupported_features",
      ),
    };
  }
  // The selected printer is the first in the scored order (lowest score;
  // ties broken by printerId ascending). The queue position is 1 + the
  // count of jobs already at this printer (the caller injects the
  // existing queue depth via the print store's enqueue step — for the
  // pure router, we set queuePosition to 1; the store's enqueue step
  // assigns the actual position).
  const selected = scored[0].printer;
  const job: PrintJobRequest = frozen({
    jobId,
    tenantId: input.tenantId,
    version: 1,
    payload: input.payload,
    requiredFeatures: frozen({ ...input.requiredFeatures }) as PrinterCapabilities,
    printerId: selected.printerId,
    queuePosition: 1,
    status: PRINT_JOB_ROUTED,
    createdAt: input.at,
    evidence: frozenArray(input.evidence ?? []),
    correlationId: input.correlationId,
    contentDigest: jobContentDigest({
      payload: input.payload,
      requiredFeatures: input.requiredFeatures,
      printerId: selected.printerId,
      queuePosition: 1,
      status: PRINT_JOB_ROUTED,
    }),
  });
  sink.append(
    frozen({
      action: ACTION_AUDIT_ACTIONS.printJobRouted,
      tenantId: job.tenantId,
      subject: job.jobId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      causationId: input.causationId,
      details: frozen({
        jobId: job.jobId,
        documentRef: job.payload.documentRef,
        printerId: selected.printerId,
        status: job.status,
        queuePosition: job.queuePosition,
        score: scored[0].score,
        supportingPrinterCount: scored.length,
        totalPrinterCount: (input.printers as readonly PrinterDescriptor[]).length,
      }),
    }),
  );
  return { ok: true, job };
}

// ---------------------------------------------------------------------------
// Queue-state contracts (per printer)
// ---------------------------------------------------------------------------

/**
 * The queue-state contract for a printer. The actions package exposes
 * the queue state as a typed, observable record: the printer, the depth
 * (the number of queued jobs), and the observable evidence links (the
 * queued job ids, in queue order). The state is per-(tenant, printer)
 * — a tenant-A queue can never observe tenant-B jobs (structural tenant
 * isolation).
 */
export interface PrinterQueueState {
  readonly tenantId: TenantId;
  readonly printerId: string;
  /** The depth of the queue (the number of queued jobs). */
  readonly depth: number;
  /** The queued job ids, in queue order (FIFO). */
  readonly queuedJobIds: readonly string[];
  /** Observable evidence links (the queued jobs' correlation ids). */
  readonly evidence: readonly EvidenceRef[];
  /** ISO 8601 timestamp of the latest queue mutation (injected). */
  readonly updatedAt: string;
}

/** Options for `enqueuePrintJob`. */
export interface EnqueuePrintJobOptions {
  /** The injected queue timestamp (ISO 8601). */
  readonly at: string;
  /** The correlation id of the enqueue request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the enqueue is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the queue transition emits; default: no-op). */
  readonly auditSink?: ActionAuditSink;
  /** The current queue state (the prior depth + queued job ids). */
  readonly priorState?: PrinterQueueState;
}

/** The tagged result of an enqueue. */
export type EnqueuePrintJobResult =
  | {
      readonly ok: true;
      readonly job: PrintJobRequest;
      readonly queueState: PrinterQueueState;
    }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Enqueue a routed print job at its assigned printer. PURE: the queue
 * state is a pure function of (prior state, job); the enqueue produces a
 * NEW frozen queue state with the job appended (FIFO) and the depth
 * incremented. The job's `queuePosition` is updated to its actual
 * position in the queue; the job's status transitions ROUTED -> QUEUED.
 *
 * @param job the routed print job (must be in ROUTED status)
 * @param options the enqueue options
 * @returns the tagged enqueue result
 */
export function enqueuePrintJob(
  job: PrintJobRequest,
  options: EnqueuePrintJobOptions,
): EnqueuePrintJobResult {
  if (job.status !== PRINT_JOB_ROUTED) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.printQueueDomain,
        `print job enqueue requires status ROUTED (got ${job.status})`,
        { tenantId: job.tenantId, correlationId: options.correlationId },
        "action.print.queue",
        "status_not_routed",
      ),
    };
  }
  if (job.printerId === undefined) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.printQueueDomain,
        "print job enqueue requires a routed printer",
        { tenantId: job.tenantId, correlationId: options.correlationId },
        "action.print.queue",
        "no_printer_assigned",
      ),
    };
  }
  const priorDepth = options.priorState?.depth ?? 0;
  const priorJobIds = options.priorState?.queuedJobIds ?? [];
  const evidence = options.priorState?.evidence ?? [];
  const queuePosition = priorDepth + 1;
  const queuedJobIds = frozenArray([...priorJobIds, job.jobId]);
  // Transition the job: ROUTED -> QUEUED with the assigned queue
  // position. Versioned-interpretation discipline: the prior record is
  // never rewritten; the new revision is a fresh frozen object.
  const nextJob: PrintJobRequest = frozen({
    ...job,
    version: job.version + 1,
    status: PRINT_JOB_QUEUED,
    queuePosition,
    transitionedAt: options.at,
    contentDigest: jobContentDigest({
      payload: job.payload,
      requiredFeatures: job.requiredFeatures,
      printerId: job.printerId,
      queuePosition,
      status: PRINT_JOB_QUEUED,
    }),
  });
  const queueState: PrinterQueueState = frozen({
    tenantId: job.tenantId,
    printerId: job.printerId,
    depth: queuePosition,
    queuedJobIds,
    evidence: frozenArray(evidence),
    updatedAt: options.at,
  });
  const sink: ActionAuditSink = options.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  sink.append(
    frozen({
      action: ACTION_AUDIT_ACTIONS.printJobQueued,
      tenantId: nextJob.tenantId,
      subject: nextJob.jobId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      causationId: options.causationId,
      details: frozen({
        jobId: nextJob.jobId,
        printerId: nextJob.printerId,
        queuePosition,
        depth: queueState.depth,
      }),
    }),
  );
  return { ok: true, job: nextJob, queueState };
}

// ---------------------------------------------------------------------------
// Re-exports for callers + tests
// ---------------------------------------------------------------------------

export type { PrintIntentPayload, UserId } from "@fleetos/contracts";
