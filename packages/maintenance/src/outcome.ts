/**
 * @fleetos/maintenance — W072 D3: aggregation outcome measurement.
 *
 * Outcome measurement over the W042 aggregated service orders
 * (`AggregatedServiceOrder` — this package's own frozen surface,
 * consumed directly, no twin needed):
 *
 *   - PER-AGGREGATE measurement: the coverage ratio (orders served /
 *     orders aggregated) with a machine-stable denominator — the
 *     aggregation's member count. A zero-aggregate REFUSES with the
 *     `empty_aggregation` invariant (a measurement over nothing is not
 *     a zero, it is a refusal);
 *   - PER-CONTRACT completion evidence: every served member work order
 *     carries its completion timestamp and its own deadline verbatim,
 *     with deadline adherence derived from INJECTED timestamps only
 *     (never a clock read — `completedAt` vs the work order's
 *     `deadline`, both injected);
 *   - PER-VENDOR contribution breakdowns: which vendor completed which
 *     member work orders (counts + member refs), deterministic under
 *     input permutations (canonical ordering everywhere).
 *
 * The completion evidence is INJECTED (`ServiceCompletionEvidence`):
 * the measurement reads no ambient state — no store, no log, no clock.
 * The same aggregation + evidence (in any order) + the same injected
 * `at` produce the byte-identical outcome record (content-addressed
 * outcomeId).
 *
 * Emission policy: a successful measurement emits exactly one
 * `maintenance.outcome.measured` audit record per measured aggregation
 * to the injected sink; failed measurements emit none.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` and every completion timestamp are injected.
 */

import type { CorrelationId, FleetError, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { AggregatedServiceOrder } from "./aggregation";
import type { MaintenanceAuditSink } from "./audit-seam";
import { NOOP_MAINTENANCE_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The aggregation outcome schema version. */
export const OUTCOME_SCHEMA_VERSION = 1 as const;

/** The aggregation outcome model version. */
export const OUTCOME_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Completion evidence (INJECTED per-contract)
// ---------------------------------------------------------------------------

/**
 * The per-contract completion evidence, injected by the caller: which
 * vendor completed which member work order, and when (an injected
 * timestamp — never a clock read). A member work order with no
 * evidence is UNSERVED (it contributes to the coverage ratio's
 * denominator, not its numerator).
 */
export interface ServiceCompletionEvidence {
  /** The member work order this evidence completes. */
  readonly workOrderId: string;
  /** The vendor that actually completed the contract. */
  readonly vendorId: VendorId;
  /** When the contract completed (injected, ISO 8601). */
  readonly completedAt: string;
}

// ---------------------------------------------------------------------------
// The outcome record
// ---------------------------------------------------------------------------

/**
 * One served contract's measured outcome: the completion evidence
 * verbatim, joined with the member work order's own deadline, and the
 * derived deadline adherence (`completedAt <= deadline`, both
 * injected — deterministic).
 */
export interface ServiceContractOutcome {
  readonly workOrderId: string;
  readonly vendorId: VendorId;
  readonly completedAt: string;
  /** The member work order's own deadline (verbatim). */
  readonly deadline: string;
  /** completedAt <= deadline (derived from injected timestamps only). */
  readonly metDeadline: boolean;
}

/**
 * One vendor's contribution to an aggregated service order: how many
 * member work orders it completed, and which ones (member refs,
 * canonical order).
 */
export interface VendorContribution {
  readonly vendorId: VendorId;
  /** The count of member work orders this vendor completed. */
  readonly completedCount: number;
  /** The member work order ids this vendor completed (sorted). */
  readonly memberRefs: readonly string[];
}

/**
 * The measured outcome of one aggregated service order. Frozen at
 * construction; content-addressed (identical content produces the
 * identical outcomeId). READ-ONLY derivation: nothing in this surface
 * writes back to the aggregation or any store.
 */
export interface ServiceAggregationOutcome extends TenantScoped {
  /** Deterministic id: `mout_` + fnv1a32 of the identity + content hash. */
  readonly outcomeId: string;
  readonly tenantId: TenantId;
  /** The measured aggregation (its id, verbatim). */
  readonly aggregationId: string;
  /** The aggregation's matched vendor (verbatim). */
  readonly vendorId: VendorId;
  /** The aggregation's service area (verbatim). */
  readonly serviceArea: string;
  /** The aggregation's shared deadline (verbatim). */
  readonly deadline: string;
  /** Machine-stable denominator: the orders aggregated (member count). */
  readonly ordersAggregated: number;
  /** Orders served (member work orders with completion evidence). */
  readonly ordersServed: number;
  /** coverageRatio = ordersServed / ordersAggregated, in [0, 1]. */
  readonly coverageRatio: number;
  /** Deadline adherence over the SERVED contracts (injected timestamps). */
  readonly deadlineAdherence: Readonly<{
    readonly metCount: number;
    readonly missedCount: number;
    /** metCount / (metCount + missedCount); null when nothing was served. */
    readonly onTimeRatio: number | null;
  }>;
  /** Per-contract outcomes (sorted by workOrderId — canonical order). */
  readonly perContract: readonly ServiceContractOutcome[];
  /** Per-vendor contributions (sorted by vendorId — canonical order). */
  readonly vendorContributions: readonly VendorContribution[];
  /** Injected computation timestamp. */
  readonly computedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
  /** Deterministic content hash (fnv1a32 over canonical JSON; not security). */
  readonly contentHash: string;
}

/** Options of an outcome measurement. */
export interface OutcomeOptions {
  /** Injected measurement timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Audit sink (default: no-op). The measurement is consequential — it audits. */
  readonly auditSink?: MaintenanceAuditSink;
}

/** The tagged result of an outcome measurement. */
export type OutcomeResult =
  | { readonly ok: true; readonly outcome: ServiceAggregationOutcome }
  | { readonly ok: false; readonly error: FleetError };

/** Stable machine action names emitted by the outcome-measurement surface. */
export const MAINTENANCE_OUTCOME_AUDIT_ACTIONS = frozen({
  /** An aggregation outcome was measured (READ-ONLY derivation). */
  outcomeMeasured: "maintenance.outcome.measured",
} as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the measurement inputs for one aggregation. Returns the
 * failure list (empty = ok). Enforces:
 *   - the tenant scope (the aggregation belongs to the acting tenant);
 *   - the machine-stable denominator (a zero-aggregate REFUSES);
 *   - the evidence discipline (members only, no duplicates, ISO
 *     timestamps, parseable deadlines).
 */
function validateMeasurement(
  tenantId: TenantId,
  aggregation: AggregatedServiceOrder,
  evidence: readonly ServiceCompletionEvidence[],
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (aggregation.tenantId !== tenantId) {
    failures.push({ path: "/aggregation/tenantId", reason: "tenant_mismatch" });
  }
  // The machine-stable denominator: a zero-aggregate refuses.
  if (
    !Array.isArray(aggregation.memberWorkOrderIds) ||
    aggregation.memberWorkOrderIds.length === 0 ||
    aggregation.memberCount !== aggregation.memberWorkOrderIds.length
  ) {
    failures.push({ path: "/aggregation", reason: "empty_aggregation" });
  }
  if (typeof aggregation.aggregationId !== "string" || aggregation.aggregationId.length === 0) {
    failures.push({ path: "/aggregation/aggregationId", reason: "required" });
  }
  if (!Array.isArray(evidence)) {
    failures.push({ path: "/evidence", reason: "array_required" });
    return failures;
  }
  const memberIds = new Set(aggregation.memberWorkOrderIds);
  const seenEvidence = new Set<string>();
  for (let i = 0; i < evidence.length; i++) {
    const one = evidence[i];
    const path = `/evidence/${i}`;
    if (one === null || typeof one !== "object") {
      failures.push({ path, reason: "object_required" });
      continue;
    }
    const candidate = one as Record<string, unknown>;
    if (typeof candidate["workOrderId"] !== "string" || (candidate["workOrderId"] as string).length === 0) {
      failures.push({ path: `${path}/workOrderId`, reason: "required" });
    } else if (!memberIds.has(candidate["workOrderId"] as string)) {
      // Evidence for a work order that is NOT a member of this
      // aggregation: fail closed (foreign evidence is refused, never
      // silently dropped).
      failures.push({ path: `${path}/workOrderId`, reason: "evidence_not_member" });
    } else if (seenEvidence.has(candidate["workOrderId"] as string)) {
      failures.push({ path: `${path}/workOrderId`, reason: "duplicate_evidence" });
    } else {
      seenEvidence.add(candidate["workOrderId"] as string);
    }
    if (typeof candidate["vendorId"] !== "string" || (candidate["vendorId"] as string).length === 0) {
      failures.push({ path: `${path}/vendorId`, reason: "required" });
    }
    if (typeof candidate["completedAt"] !== "string" || !looksLikeIso(candidate["completedAt"] as string)) {
      failures.push({ path: `${path}/completedAt`, reason: "not_iso" });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The pure measurement
// ---------------------------------------------------------------------------

/**
 * Measure one aggregated service order's outcome from the injected
 * completion evidence. PURE and DETERMINISTIC: the same aggregation +
 * evidence (in any order) + the same `at` produce the byte-identical
 * outcome. Deadline adherence is derived from INJECTED timestamps only
 * (never a clock read). READ-ONLY: the aggregation and the evidence are
 * never mutated; the result is a new frozen record.
 *
 * Machine-stable refusals (fail closed):
 *   - `empty_aggregation` — a zero-aggregate (no member work orders);
 *   - `evidence_not_member` — evidence citing a work order outside the
 *     aggregation;
 *   - `duplicate_evidence` — two evidence records for one work order.
 *
 * @param tenantId the acting tenant
 * @param aggregation the W042 aggregated service order to measure
 * @param evidence the injected per-contract completion evidence
 * @param options the measurement options (at, correlationId, audit sink)
 * @returns the tagged measurement result
 */
export function measureServiceAggregationOutcome(
  tenantId: TenantId,
  aggregation: AggregatedServiceOrder,
  evidence: readonly ServiceCompletionEvidence[],
  options: OutcomeOptions,
): OutcomeResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (aggregation === null || typeof aggregation !== "object") {
    failures.push({ path: "/aggregation", reason: "object_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.outcomeInvalid,
        "outcome measurement request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const measurementFailures = validateMeasurement(tenantId, aggregation, evidence);
  if (measurementFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.outcomeInvalid,
        "outcome measurement request is invalid",
        { tenantId, correlationId: options.correlationId },
        measurementFailures,
      ),
    };
  }

  // Canonical evidence order (deterministic under input permutations).
  const sortedEvidence = [...evidence].sort((a, b) =>
    a.workOrderId < b.workOrderId ? -1 : a.workOrderId > b.workOrderId ? 1 : 0,
  );

  // Per-contract outcomes: join the evidence with the member work orders
  // (each member's own deadline, verbatim; injected timestamps only).
  const memberById = new Map<string, { deadline: string }>();
  for (const workOrder of aggregation.memberWorkOrders) {
    memberById.set(workOrder.workOrderId, { deadline: workOrder.deadline });
  }
  const perContract: ServiceContractOutcome[] = sortedEvidence.map((one) => {
    const member = memberById.get(one.workOrderId) ?? { deadline: aggregation.deadline };
    const completedMs = Date.parse(one.completedAt);
    const deadlineMs = Date.parse(member.deadline);
    const metDeadline =
      Number.isFinite(completedMs) && Number.isFinite(deadlineMs) ? completedMs <= deadlineMs : false;
    return frozen({
      workOrderId: one.workOrderId,
      vendorId: one.vendorId,
      completedAt: one.completedAt,
      deadline: member.deadline,
      metDeadline,
    });
  });

  const metCount = perContract.filter((c) => c.metDeadline).length;
  const missedCount = perContract.length - metCount;
  const ordersAggregated = aggregation.memberWorkOrderIds.length;
  const ordersServed = perContract.length;
  const coverageRatio = ordersAggregated === 0 ? 0 : ordersServed / ordersAggregated;
  const onTimeRatio = ordersServed === 0 ? null : metCount / ordersServed;

  // Per-vendor contributions (sorted by vendorId; member refs sorted).
  const byVendor = new Map<string, { vendorId: VendorId; memberRefs: string[] }>();
  for (const contract of perContract) {
    const key = contract.vendorId as string;
    const entry = byVendor.get(key);
    if (entry === undefined) {
      byVendor.set(key, { vendorId: contract.vendorId, memberRefs: [contract.workOrderId] });
    } else {
      entry.memberRefs.push(contract.workOrderId);
    }
  }
  const vendorContributions: VendorContribution[] = [...byVendor.values()]
    .map((entry) =>
      frozen({
        vendorId: entry.vendorId,
        completedCount: entry.memberRefs.length,
        memberRefs: frozenArray([...entry.memberRefs].sort()),
      }),
    )
    .sort((a, b) => (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0));

  const content: Omit<ServiceAggregationOutcome, "contentHash" | "outcomeId"> = frozen({
    tenantId,
    aggregationId: aggregation.aggregationId,
    vendorId: aggregation.vendorId,
    serviceArea: aggregation.serviceArea,
    deadline: aggregation.deadline,
    ordersAggregated,
    ordersServed,
    coverageRatio,
    deadlineAdherence: frozen({
      metCount,
      missedCount,
      onTimeRatio,
    }),
    perContract: frozenArray(perContract),
    vendorContributions: frozenArray(vendorContributions),
    computedAt: options.at,
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    modelVersion: OUTCOME_MODEL_VERSION,
  });
  const contentHash = fnv1a32Hex(
    canonicalJson({
      tenantId: content.tenantId as string,
      aggregationId: content.aggregationId,
      vendorId: content.vendorId as string,
      serviceArea: content.serviceArea,
      deadline: content.deadline,
      ordersAggregated: content.ordersAggregated,
      ordersServed: content.ordersServed,
      coverageRatio: content.coverageRatio,
      deadlineAdherence: content.deadlineAdherence,
      perContract: content.perContract,
      vendorContributions: content.vendorContributions,
      computedAt: content.computedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
  const outcomeId = `mout_${fnv1a32Hex(
    canonicalJson({ tenantId: tenantId as string, aggregationId: content.aggregationId, contentHash }),
  )}`;
  const outcome: ServiceAggregationOutcome = frozen({ ...content, outcomeId, contentHash });

  (options.auditSink ?? NOOP_MAINTENANCE_AUDIT_SINK).append(
    frozen({
      action: MAINTENANCE_OUTCOME_AUDIT_ACTIONS.outcomeMeasured,
      tenantId,
      subject: outcomeId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        aggregationId: outcome.aggregationId,
        vendorId: outcome.vendorId as string,
        ordersAggregated: outcome.ordersAggregated,
        ordersServed: outcome.ordersServed,
        coverageRatio: outcome.coverageRatio,
        deadlineAdherence: outcome.deadlineAdherence,
        vendorContributionCount: outcome.vendorContributions.length,
        contentHash: outcome.contentHash,
        readOnly: true,
      },
    }),
  );

  return { ok: true, outcome };
}

// ---------------------------------------------------------------------------
// Multi-aggregate measurement (deterministic under permutations)
// ---------------------------------------------------------------------------

/** The tagged result of a multi-aggregate measurement. */
export type OutcomesResult =
  | { readonly ok: true; readonly outcomes: readonly ServiceAggregationOutcome[] }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Measure many aggregated service orders from one flat evidence list.
 * Every evidence record must cite a work order that is a member of
 * EXACTLY ONE aggregation in the input (evidence for an unknown work
 * order REFUSES with `evidence_unknown` — fail closed, never silently
 * dropped). Returns one outcome per aggregation, sorted by
 * aggregationId (deterministic under input permutations of both the
 * aggregations and the evidence).
 *
 * @param tenantId the acting tenant
 * @param aggregations the W042 aggregated service orders to measure
 * @param evidence the injected per-contract completion evidence (flat)
 * @param options the measurement options (at, correlationId, audit sink)
 * @returns the tagged multi-measurement result
 */
export function measureServiceAggregationOutcomes(
  tenantId: TenantId,
  aggregations: readonly AggregatedServiceOrder[],
  evidence: readonly ServiceCompletionEvidence[],
  options: OutcomeOptions,
): OutcomesResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(aggregations) || aggregations.length === 0) {
    failures.push({ path: "/aggregations", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.outcomeInvalid,
        "outcome measurement request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Route the evidence: every work order must be a member of exactly
  // one aggregation; duplicate aggregation ids are refused.
  const memberToAggregation = new Map<string, AggregatedServiceOrder>();
  const seenAggregationIds = new Set<string>();
  const routingFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < aggregations.length; i++) {
    const aggregation = aggregations[i];
    if (aggregation === null || typeof aggregation !== "object") {
      routingFailures.push({ path: `/aggregations/${i}`, reason: "object_required" });
      continue;
    }
    if (seenAggregationIds.has(aggregation.aggregationId)) {
      routingFailures.push({ path: `/aggregations/${i}`, reason: "duplicate_aggregation" });
      continue;
    }
    seenAggregationIds.add(aggregation.aggregationId);
    for (const workOrderId of aggregation.memberWorkOrderIds) {
      if (memberToAggregation.has(workOrderId)) {
        routingFailures.push({
          path: `/aggregations/${i}`,
          reason: "member_in_two_aggregations",
        });
        break;
      }
      memberToAggregation.set(workOrderId, aggregation);
    }
  }
  const evidenceByAggregation = new Map<string, ServiceCompletionEvidence[]>();
  if (Array.isArray(evidence)) {
    for (const one of evidence) {
      const workOrderId = one?.workOrderId;
      if (typeof workOrderId !== "string" || workOrderId.length === 0) {
        routingFailures.push({ path: "/evidence", reason: "workOrderId_required" });
        continue;
      }
      const owner = memberToAggregation.get(workOrderId);
      if (owner === undefined) {
        routingFailures.push({ path: "/evidence", reason: "evidence_unknown" });
        continue;
      }
      const bucket = evidenceByAggregation.get(owner.aggregationId);
      if (bucket === undefined) {
        evidenceByAggregation.set(owner.aggregationId, [one]);
      } else {
        bucket.push(one);
      }
    }
  } else {
    routingFailures.push({ path: "/evidence", reason: "array_required" });
  }
  if (routingFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.outcomeInvalid,
        "outcome measurement request is invalid",
        { tenantId, correlationId: options.correlationId },
        routingFailures,
      ),
    };
  }

  // Canonical aggregation order (deterministic under permutations).
  const sortedAggregations = [...aggregations].sort((a, b) =>
    a.aggregationId < b.aggregationId ? -1 : a.aggregationId > b.aggregationId ? 1 : 0,
  );

  const outcomes: ServiceAggregationOutcome[] = [];
  for (const aggregation of sortedAggregations) {
    const result = measureServiceAggregationOutcome(
      tenantId,
      aggregation,
      evidenceByAggregation.get(aggregation.aggregationId) ?? [],
      options,
    );
    if (!result.ok) return result;
    outcomes.push(result.outcome);
  }

  return { ok: true, outcomes: frozenArray(outcomes) };
}
