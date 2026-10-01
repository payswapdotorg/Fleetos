/**
 * @fleetos/actions — D5 (W100B): print DISTRIBUTION planning.
 *
 * The W100B product sentence, made a domain guarantee:
 *
 *   "selected people + document -> each person's approved printer
 *    receives the job."
 *
 * `planPrintDistribution` composes the W041 `routePrintJob` router (D3,
 * unchanged) once per selected person: each person's job routes ONLY
 * among THAT person's APPROVED printers (same tenant, `approved ===
 * true`, capability-satisfying). A person whose approved pool cannot
 * satisfy the document's required features receives a REFUSED job
 * record — the refusal is VISIBLE per person and NEVER emulated (no
 * fallback printer, no capability emulation, no unapproved printer is
 * ever silently promoted — LOCK 16 discipline).
 *
 * Escalation context is OBSERVABLE DATA: each entry counts the person's
 * unapproved printers that WOULD have satisfied the required features
 * (`unapprovedCapablePrinterCount`) so the surface can explain "ask an
 * administrator to approve printer X for this person" — the restricted
 * capability carries its reason and escalation path.
 *
 * Deterministic: entries are output in userId ascending order; the same
 * inputs produce a byte-identical plan regardless of input order.
 * Tenant-scoped: foreign-tenant printers never enter a person's
 * routable pool (they are counted out — observable, never a side
 * channel). Audited: every per-person routing emits through the router's
 * own audit sink; the distribution additionally emits ONE summary
 * record (`action.print.distribution.planned`) through the injected
 * sink (default: no-op).
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
import {
  ACTIONS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ActionAuditSink } from "./audit-seam";
import { ACTION_AUDIT_ACTIONS, NOOP_ACTION_AUDIT_SINK } from "./audit-seam";
import {
  ALL_PRINTER_CAPABILITIES,
  PRINT_JOB_REFUSED,
  printJobId,
  routePrintJob,
  supportsPrintFeatures,
} from "./print-orchestration";
import type { PrinterCapabilities, PrinterDescriptor, PrintJobRequest } from "./print-orchestration";

// ---------------------------------------------------------------------------
// The distribution input
// ---------------------------------------------------------------------------

/**
 * One selected person: the userId plus THAT person's printer pool (the
 * printers the consumer associates with the person). The planner routes
 * the person's job among the pool's APPROVED, tenant-matching,
 * capability-satisfying printers only.
 */
export interface PrintDistributionPerson {
  /** The selected person (the job's targetUserId). */
  readonly userId: UserId;
  /** The person's printer pool (approved + unapproved; the planner counts and never promotes unapproved). */
  readonly printers: readonly PrinterDescriptor[];
}

/** Input for `planPrintDistribution`. */
export interface PlanPrintDistributionInput {
  /** The acting tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The document to distribute (each person's job carries this documentRef). */
  readonly documentRef: string;
  /** The required printer features the document demands (verbatim). */
  readonly requiredFeatures: PrinterCapabilities;
  /** The selected people (non-empty; duplicate userIds REFUSE). */
  readonly people: readonly PrintDistributionPerson[];
  /** The injected scoring function (default: identity rank — first supporting printer). */
  readonly scoreFn?: (preferences: PrinterDescriptor["preferences"]) => number;
  /** Injected planning timestamp (ISO 8601 — becomes each job's createdAt). */
  readonly at: string;
  /** The correlation id of the distribution request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the distribution is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Observable evidence artifacts attached to every job (never interpreted). */
  readonly evidence?: readonly EvidenceRef[];
  /** The injected audit sink (the summary record emits; default: no-op). */
  readonly auditSink?: ActionAuditSink;
}

// ---------------------------------------------------------------------------
// The distribution plan (deterministic output)
// ---------------------------------------------------------------------------

/**
 * One person's distribution outcome: the job (ROUTED to that person's
 * approved printer, or REFUSED — visible, never emulated) plus the
 * observable escalation context.
 */
export interface PrintDistributionEntry {
  /** The person (the job's targetUserId). */
  readonly userId: UserId;
  /** The person's job: ROUTED (an approved printer receives it) or REFUSED (machine-stable reasons). */
  readonly job: PrintJobRequest;
  /** Whether the person's entry was REFUSED (derived from the job status). */
  readonly refused: boolean;
  /** The count of tenant-matching APPROVED printers in the person's pool. */
  readonly approvedPrinterCount: number;
  /**
   * The count of tenant-matching printers in the person's pool that are
   * NOT approved but WOULD satisfy the required features — the
   * observable escalation context ("request printer approval"), never a
   * routing input.
   */
  readonly unapprovedCapablePrinterCount: number;
  /** The capable-but-unapproved printer ids (sorted ascending; escalation affordances). */
  readonly unapprovedCapablePrinterIds: readonly string[];
}

/** The deterministic distribution plan (entries sorted by userId ascending). */
export interface PrintDistributionPlan {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The distributed document (verbatim). */
  readonly documentRef: string;
  /** The required features the document demanded (verbatim). */
  readonly requiredFeatures: PrinterCapabilities;
  /** The injected planning instant (verbatim). */
  readonly at: string;
  /** The correlation id of the distribution request (verbatim). */
  readonly correlationId: CorrelationId;
  /** The number of selected people. */
  readonly personCount: number;
  /** The number of entries whose job was ROUTED to an approved printer. */
  readonly routedCount: number;
  /** The number of entries whose job was REFUSED (visible, never emulated). */
  readonly refusedCount: number;
  /** The per-person entries, sorted by userId ascending (input-order invariant). */
  readonly entries: readonly PrintDistributionEntry[];
}

/** The tagged result of `planPrintDistribution`. */
export type PlanPrintDistributionResult =
  | { readonly ok: true; readonly plan: PrintDistributionPlan }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Validation (pure, machine-stable)
// ---------------------------------------------------------------------------

function isCapabilityObject(value: unknown): value is PrinterCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    if (
      !(ALL_PRINTER_CAPABILITIES as readonly string[]).includes(key) ||
      typeof (value as Record<string, unknown>)[key] !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

function isPrinterDescriptor(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["printerId"] !== "string" || (record["printerId"] as string).length === 0) {
    return false;
  }
  if (typeof record["tenantId"] !== "string" || (record["tenantId"] as string).length === 0) {
    return false;
  }
  if (!isCapabilityObject(record["capabilities"])) return false;
  if (record["approved"] !== undefined && typeof record["approved"] !== "boolean") return false;
  if (typeof record["preferences"] !== "object" || record["preferences"] === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The refused-job synthesizer (the router's discipline, person-scoped)
// ---------------------------------------------------------------------------

/**
 * Synthesize the person-scoped REFUSED job record: the same identity
 * digest discipline as the router (`printJobId` over tenant + payload +
 * instant), the same content shape, and the machine-stable routing
 * reasons. The leading reason names the approved-pool failure mode:
 * `no_approved_printer` (the pool has no approved printers at all) or
 * `no_capable_approved_printer` (approved printers exist but none
 * satisfies the required features); the required features follow as
 * `unsupported_feature:{feature}` entries (the router's convention).
 */
function refusedJobFor(
  tenantId: TenantId,
  documentRef: string,
  userId: UserId,
  requiredFeatures: PrinterCapabilities,
  at: string,
  correlationId: CorrelationId,
  evidence: readonly EvidenceRef[],
  approvedPoolIsEmpty: boolean,
): PrintJobRequest {
  const payload: PrintIntentPayload = { documentRef, targetUserId: userId };
  const requiredFeatureNames = ALL_PRINTER_CAPABILITIES.filter(
    (feature) => requiredFeatures[feature] === true,
  );
  const routingReasons: string[] = [
    approvedPoolIsEmpty ? "no_approved_printer" : "no_capable_approved_printer",
    ...requiredFeatureNames.map((feature) => `unsupported_feature:${feature}`),
  ];
  // The content digest follows the router's exact discipline (fnv1a32 of
  // the canonical JSON of the content fields — identity excluded). The
  // binding test proves the refused job's digest discipline matches the
  // router's for the same content.
  const contentDigest = fnv1a32Hex(
    canonicalJson({
      payload,
      requiredFeatures,
      printerId: undefined,
      queuePosition: undefined,
      status: PRINT_JOB_REFUSED,
    }),
  );
  return frozen({
    jobId: printJobId(tenantId, payload, at),
    tenantId,
    version: 1,
    payload,
    requiredFeatures: frozen({ ...requiredFeatures }) as PrinterCapabilities,
    status: PRINT_JOB_REFUSED,
    createdAt: at,
    evidence: frozenArray(evidence),
    correlationId,
    routingReasons: frozenArray(routingReasons),
    contentDigest,
  });
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * Plan the print distribution: one job per selected person, routed
 * among THAT person's approved printers. PURE and deterministic.
 *
 * Semantics per person:
 *   1. the pool is filtered to tenant-matching printers (foreign-tenant
 *      printers are never routable — no side channel);
 *   2. the routable pool is the tenant-matching APPROVED printers
 *      (`approved === true`) — "each person's approved printer receives
 *      the job";
 *   3. `routePrintJob` (the W041 router, unchanged) selects the best
 *      approved printer by capability + score;
 *   4. a person whose approved pool cannot satisfy the required
 *      features receives a REFUSED job record with machine-stable
 *      reasons (visible, never emulated) plus the observable escalation
 *      context (unapproved capable printers are COUNTED and NAMED,
 *      never promoted).
 *
 * The plan output is sorted by userId ascending (input-order
 * invariant). Each per-person routing emits its own audit record
 * through the router; the planner emits ONE summary record
 * (`action.print.distribution.planned`).
 *
 * @param input the distribution request
 * @returns the tagged result: the deterministic plan or a machine-stable error
 */
export function planPrintDistribution(input: PlanPrintDistributionInput): PlanPrintDistributionResult {
  // Phase 1 — structural validation (machine-stable failures).
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.tenantId !== "string" || input.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof input?.documentRef !== "string" || input.documentRef.length === 0) {
    failures.push({ path: "/documentRef", reason: "non_empty_string_required" });
  }
  if (!isCapabilityObject(input?.requiredFeatures)) {
    failures.push({ path: "/requiredFeatures", reason: "capability_object_required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(input?.people)) {
    failures.push({ path: "/people", reason: "array_required" });
  } else {
    if (input.people.length === 0) {
      failures.push({ path: "/people", reason: "non_empty_array_required" });
    }
    const seen = new Set<string>();
    for (let i = 0; i < input.people.length; i++) {
      const person = input.people[i];
      if (typeof person !== "object" || person === null) {
        failures.push({ path: `/people/${i}`, reason: "object_required" });
        continue;
      }
      const userId = (person as { userId?: unknown }).userId;
      if (typeof userId !== "string" || userId.length === 0) {
        failures.push({ path: `/people/${i}/userId`, reason: "non_empty_string_required" });
      } else if (seen.has(userId)) {
        failures.push({ path: `/people/${i}/userId`, reason: "duplicate_person" });
      } else {
        seen.add(userId);
      }
      const printers = (person as { printers?: unknown }).printers;
      if (!Array.isArray(printers)) {
        failures.push({ path: `/people/${i}/printers`, reason: "array_required" });
      } else {
        for (let j = 0; j < printers.length; j++) {
          if (!isPrinterDescriptor(printers[j])) {
            failures.push({ path: `/people/${i}/printers/${j}`, reason: "printer_descriptor_invalid" });
          }
        }
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.printJobInvalid,
        "print distribution request is invalid",
        {
          tenantId:
            typeof input?.tenantId === "string" && input.tenantId.length > 0
              ? input.tenantId
              : SYNTHETIC_SYSTEM_TENANT,
          correlationId: input?.correlationId ?? ACTIONS_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Phase 2 — the per-person routing (each person's approved printer
  // receives the job; refusals are visible per person).
  const typedInput = input as PlanPrintDistributionInput;
  const people = [...typedInput.people].sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
  );
  const entries: PrintDistributionEntry[] = [];
  let routedCount = 0;
  let refusedCount = 0;
  for (const person of people) {
    // The tenant-matching pool (foreign-tenant printers never route).
    const tenantPool = person.printers.filter((p) => p.tenantId === typedInput.tenantId);
    // The routable pool: tenant-matching APPROVED printers only.
    const approvedPool = tenantPool.filter((p) => p.approved === true);
    // The observable escalation context: unapproved printers that would
    // satisfy the required features (counted + named, never promoted).
    const unapprovedCapable = tenantPool
      .filter((p) => p.approved !== true)
      .filter((p) => supportsPrintFeatures(typedInput.requiredFeatures, p.capabilities))
      .map((p) => p.printerId)
      .sort();
    const payload: PrintIntentPayload = {
      documentRef: typedInput.documentRef,
      targetUserId: person.userId,
    };
    const routed = routePrintJob({
      payload,
      requiredFeatures: typedInput.requiredFeatures,
      tenantId: typedInput.tenantId,
      printers: approvedPool,
      scoreFn: typedInput.scoreFn,
      at: typedInput.at,
      correlationId: typedInput.correlationId,
      causationId: typedInput.causationId,
      evidence: typedInput.evidence,
      auditSink: NOOP_ACTION_AUDIT_SINK,
    });
    let job: PrintJobRequest;
    if (routed.ok) {
      job = routed.job;
      routedCount += 1;
    } else {
      job = refusedJobFor(
        typedInput.tenantId,
        typedInput.documentRef,
        person.userId,
        typedInput.requiredFeatures,
        typedInput.at,
        typedInput.correlationId,
        typedInput.evidence ?? [],
        approvedPool.length === 0,
      );
      refusedCount += 1;
    }
    entries.push(
      frozen({
        userId: person.userId,
        job,
        refused: job.status === PRINT_JOB_REFUSED,
        approvedPrinterCount: approvedPool.length,
        unapprovedCapablePrinterCount: unapprovedCapable.length,
        unapprovedCapablePrinterIds: frozenArray(unapprovedCapable),
      } satisfies PrintDistributionEntry),
    );
  }

  // Phase 3 — the summary audit record + the frozen plan.
  const sink: ActionAuditSink = typedInput.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  sink.append(
    frozen({
      action: ACTION_AUDIT_ACTIONS.printDistributionPlanned,
      tenantId: typedInput.tenantId,
      subject: typedInput.documentRef,
      occurredAt: typedInput.at,
      correlationId: typedInput.correlationId,
      causationId: typedInput.causationId,
      details: frozen({
        documentRef: typedInput.documentRef,
        personCount: entries.length,
        routedCount,
        refusedCount,
      }),
    }),
  );
  return {
    ok: true,
    plan: frozen({
      tenantId: typedInput.tenantId,
      documentRef: typedInput.documentRef,
      requiredFeatures: frozen({ ...typedInput.requiredFeatures }) as PrinterCapabilities,
      at: typedInput.at,
      correlationId: typedInput.correlationId,
      personCount: entries.length,
      routedCount,
      refusedCount,
      entries: frozenArray(entries),
    } satisfies PrintDistributionPlan),
  };
}
