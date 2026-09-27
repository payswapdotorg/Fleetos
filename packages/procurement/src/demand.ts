/**
 * @fleetos/procurement — D2a: the ProcurementDemand domain model.
 *
 * "FleetOS is the demand-side orchestrator. Local vendors own inventory,
 * pricing and fulfillment." — `spec/ARCHITECTURE.md` § Procurement/service
 * exchange.
 *
 * The demand model consumes W022's WorkloadRecommendation DRAFT
 * `ProcurementIntentPayload` (the frozen shape from `@fleetos/contracts`)
 * and the W022 `CandidateRejection` evidence as machine-stable matching
 * input. Each demand carries:
 *
 *   - the workload it serves (workloadId from the payload, optional);
 *   - the requirement description (payload.description, required);
 *   - the demand quantity (default 1);
 *   - the customer deadline (injected, ISO 8601);
 *   - the delivery area (free-form string; matched against vendor regions);
 *   - the budget cap (USD; matched against vendor price quote);
 *   - the SLA / warranty / quality floors (typed comparable values from
 *     the vendor model; rejected when below the floor);
 *   - the availability floor (vendor inventory ratio in [0, 1]);
 *   - allowed substitutions (capability ids the customer will accept as
 *     alternates);
 *   - the unsatisfiable-candidate rejection evidence carried from W022
 *     (advisory input; the matcher down-ranks vendors whose matched
 *     capability appears in this evidence — never silently dropped).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` and `deadline` are injected by the caller.
 */

import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import type { ProcurementIntentPayload } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type {
  DaysDuration,
  InventoryAvailability,
  QualityScore,
  SlaCoverage,
  UsdAmount,
} from "@fleetos/vendors";
import type { ProcurementAuditSink } from "./audit-seam";
import { NOOP_PROCUREMENT_AUDIT_SINK, PROCUREMENT_AUDIT_ACTIONS } from "./audit-seam";
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

/** The demand schema version. */
export const DEMAND_SCHEMA_VERSION = 1 as const;

/** The demand model version. */
export const DEMAND_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Demand (consumes W022's DRAFT ProcurementIntentPayload + rejection evidence)
// ---------------------------------------------------------------------------

/**
 * A rejected candidate carried from W022's WorkloadRecommendation (the
 * unsatisfiable-candidate rejection evidence). Machine-stable: the
 * matcher treats it as advisory input — a vendor capability declared
 * by the demand's allowed substitutions that matches a rejection is
 * down-ranked, not silently dropped.
 *
 * This shape mirrors W022's `CandidateRejection` (the lane-local type)
 * but is defined locally so this package never imports a non-contract
 * type from `@fleetos/workloads` in `src/`. The bridge is the test
 * suite, which constructs demand input from a real W022
 * WorkloadRecommendation run and verifies the evidence flows through.
 */
export interface DemandRejectionEvidence {
  /** The candidate id W022 rejected (e.g. "class.engineering_workstation"). */
  readonly candidateId: string;
  /** The W022-determined rejection reason (machine-stable string). */
  readonly reason: string;
}

/**
 * The demand: one procurement need, derived from a W022 WorkloadRecommendation
 * DRAFT ProcurementIntentPayload. Carries the workload linkage, the
 * requirement description, the quantity, the deadline, the delivery
 * area, the budget cap, the SLA/warranty/quality floors, and the
 * allowed substitutions (vendor capability ids the customer will
 * accept as alternates).
 *
 * A demand is a frozen, append-only record: lifecycle transitions
 * (DRAFT -> SUBMITTED -> MATCHING -> QUOTED -> ACCEPTED -> FULFILLING ->
 * DELIVERED -> VERIFIED -> CLOSED per
 * `spec/procurement/PROCUREMENT-EXCHANGE.md`) are tracked by the
 * quote/acceptance engine (D3), not by editing the demand.
 */
export interface ProcurementDemand extends TenantScoped {
  /** Deterministic id: `dmd_` + fnv1a32 of the identity tuple. */
  readonly demandId: string;
  /** The tenant scope. */
  readonly tenantId: TenantId;
  /** The workload this demand serves (from ProcurementIntentPayload.workloadId). */
  readonly workloadId: WorkloadId;
  /** The requirement description (from ProcurementIntentPayload.description). */
  readonly description: string;
  /** The demand quantity (default 1). */
  readonly quantity: number;
  /** Injected creation timestamp. */
  readonly createdAt: string;
  /** The customer deadline (injected, ISO 8601). */
  readonly deadline: string;
  /** The delivery area (free-form string; matched against vendor regions). */
  readonly deliveryArea: string;
  /** The budget cap (USD). */
  readonly budget: UsdAmount;
  /** The minimum SLA coverage floor (vendor must be >= this). */
  readonly slaFloor: SlaCoverage;
  /** The minimum warranty duration floor (vendor must be >= this, days). */
  readonly warrantyFloor: DaysDuration;
  /** The minimum vendor quality score floor (vendor must be >= this). */
  readonly qualityFloor: QualityScore;
  /** The minimum vendor inventory availability floor (vendor must be >= this). */
  readonly availabilityFloor: InventoryAvailability;
  /** Allowed substitution capability ids (the demand accepts these alternates). */
  readonly allowedSubstitutions: readonly string[];
  /** Rejection evidence carried from W022 (advisory, machine-stable). */
  readonly rejectionEvidence: readonly DemandRejectionEvidence[];
  /** The demand payload schema version. */
  readonly schemaVersion: number;
  /** The demand model version. */
  readonly modelVersion: number;
}

/** The input of a demand creation. */
export interface CreateDemandInput {
  /** The W022 draft payload (consumed as machine-stable input). */
  readonly procurementIntent: ProcurementIntentPayload;
  /** Demand quantity (default 1). */
  readonly quantity?: number;
  /** Injected creation timestamp. */
  readonly at: string;
  /** The customer deadline (ISO 8601; should be after `at`). */
  readonly deadline: string;
  /** The delivery area. */
  readonly deliveryArea: string;
  /** The budget cap. */
  readonly budget: UsdAmount;
  /** The SLA floor. */
  readonly slaFloor: SlaCoverage;
  /** The warranty floor (days). */
  readonly warrantyFloor: DaysDuration;
  /** The quality floor. */
  readonly qualityFloor: QualityScore;
  /** The availability floor. */
  readonly availabilityFloor: InventoryAvailability;
  /** Allowed substitutions (capability ids; defaults to empty). */
  readonly allowedSubstitutions?: readonly string[];
  /** Rejection evidence carried from W022 (defaults to empty). */
  readonly rejectionEvidence?: readonly DemandRejectionEvidence[];
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
}

/** The tagged result of a demand build. */
export type DemandBuildResult =
  | { readonly ok: true; readonly demand: ProcurementDemand }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** Validate the demand input. Returns the failure list (empty = ok). */
function validateDemandInput(input: CreateDemandInput): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (input?.procurementIntent === null || typeof input?.procurementIntent !== "object") {
    failures.push({ path: "/procurementIntent", reason: "required" });
  } else {
    const payload = input.procurementIntent as { description?: unknown };
    if (typeof payload.description !== "string" || payload.description.length === 0) {
      failures.push({ path: "/procurementIntent/description", reason: "required" });
    }
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.deadline !== "string" || !looksLikeIso(input.deadline)) {
    failures.push({ path: "/deadline", reason: "not_iso" });
  }
  if (typeof input?.deliveryArea !== "string" || input.deliveryArea.length === 0) {
    failures.push({ path: "/deliveryArea", reason: "required" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  const qty = input?.quantity ?? 1;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
    failures.push({ path: "/quantity", reason: "must_be_positive_integer" });
  }
  const budget = input?.budget as { usd?: unknown } | undefined;
  if (
    budget === undefined ||
    typeof budget.usd !== "number" ||
    !Number.isFinite(budget.usd) ||
    budget.usd < 0
  ) {
    failures.push({ path: "/budget/usd", reason: "must_be_non_negative" });
  }
  const slaFloor = input?.slaFloor as { coverage?: unknown } | undefined;
  if (
    slaFloor === undefined ||
    typeof slaFloor.coverage !== "number" ||
    !Number.isFinite(slaFloor.coverage) ||
    slaFloor.coverage < 0 ||
    slaFloor.coverage > 1
  ) {
    failures.push({ path: "/slaFloor/coverage", reason: "must_be_in_0_1" });
  }
  const warrantyFloor = input?.warrantyFloor as { days?: unknown } | undefined;
  if (
    warrantyFloor === undefined ||
    typeof warrantyFloor.days !== "number" ||
    !Number.isFinite(warrantyFloor.days) ||
    warrantyFloor.days < 0
  ) {
    failures.push({ path: "/warrantyFloor/days", reason: "must_be_non_negative" });
  }
  const qualityFloor = input?.qualityFloor as { score?: unknown } | undefined;
  if (
    qualityFloor === undefined ||
    typeof qualityFloor.score !== "number" ||
    !Number.isFinite(qualityFloor.score) ||
    qualityFloor.score < 0 ||
    qualityFloor.score > 1
  ) {
    failures.push({ path: "/qualityFloor/score", reason: "must_be_in_0_1" });
  }
  const availabilityFloor = input?.availabilityFloor as { ratio?: unknown } | undefined;
  if (
    availabilityFloor === undefined ||
    typeof availabilityFloor.ratio !== "number" ||
    !Number.isFinite(availabilityFloor.ratio) ||
    availabilityFloor.ratio < 0 ||
    availabilityFloor.ratio > 1
  ) {
    failures.push({ path: "/availabilityFloor/ratio", reason: "must_be_in_0_1" });
  }
  if (input?.allowedSubstitutions !== undefined && !Array.isArray(input.allowedSubstitutions)) {
    failures.push({ path: "/allowedSubstitutions", reason: "not_array" });
  }
  if (input?.rejectionEvidence !== undefined && !Array.isArray(input.rejectionEvidence)) {
    failures.push({ path: "/rejectionEvidence", reason: "not_array" });
  }
  return failures;
}

/**
 * Build a procurement demand from a W022 DRAFT ProcurementIntentPayload.
 * Pure and deterministic: the same inputs produce the byte-identical
 * frozen demand. The tenant scope is stamped onto the demand.
 *
 * @param tenantId the acting tenant
 * @param input the demand creation input
 * @returns the tagged build result
 */
export function buildDemand(
  tenantId: TenantId,
  input: CreateDemandInput,
): DemandBuildResult {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.demandInvalid,
        "demand request is invalid",
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  const failures = validateDemandInput(input);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.demandInvalid,
        "demand request is invalid",
        { tenantId, correlationId: input.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const payload = input.procurementIntent as ProcurementIntentPayload;
  // workloadId is OPTIONAL on the frozen payload — when absent, the
  // demand carries an empty workload id and the matcher treats it as
  // an unscoped demand.
  const workloadId = (payload as { workloadId?: string }).workloadId ?? "";
  const demandId = `dmd_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      workloadId,
      description: payload.description,
      deadline: input.deadline,
      deliveryArea: input.deliveryArea,
    }),
  )}`;
  const demand: ProcurementDemand = frozen({
    demandId,
    tenantId,
    workloadId: workloadId as WorkloadId,
    description: payload.description,
    quantity: input.quantity ?? 1,
    createdAt: input.at,
    deadline: input.deadline,
    deliveryArea: input.deliveryArea,
    budget: frozen(input.budget),
    slaFloor: frozen(input.slaFloor),
    warrantyFloor: frozen(input.warrantyFloor),
    qualityFloor: frozen(input.qualityFloor),
    availabilityFloor: frozen(input.availabilityFloor),
    allowedSubstitutions: frozenArray(input.allowedSubstitutions ?? []),
    rejectionEvidence: frozenArray(input.rejectionEvidence ?? []),
    schemaVersion: DEMAND_SCHEMA_VERSION,
    modelVersion: DEMAND_MODEL_VERSION,
  });
  return { ok: true, demand };
}

/** The result of `createDemand` (audit-emitting). */
export type CreateDemandResult =
  | { readonly ok: true; readonly demand: ProcurementDemand }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build a demand and emit a `procurement.demand.created` audit record
 * to the sink. Pure except for the audit emission (which is the
 * consequential side effect — the sink contract requires append-only
 * durability).
 */
export function createDemand(
  tenantId: TenantId,
  input: CreateDemandInput,
  sink: ProcurementAuditSink = NOOP_PROCUREMENT_AUDIT_SINK,
): CreateDemandResult {
  const built = buildDemand(tenantId, input);
  if (!built.ok) return built;
  sink.append(
    frozen({
      action: PROCUREMENT_AUDIT_ACTIONS.demandCreated,
      tenantId: built.demand.tenantId,
      subject: built.demand.demandId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      details: {
        workloadId: built.demand.workloadId,
        description: built.demand.description,
        quantity: built.demand.quantity,
        deadline: built.demand.deadline,
        deliveryArea: built.demand.deliveryArea,
        budgetUsd: built.demand.budget.usd,
        slaFloor: built.demand.slaFloor.coverage,
        warrantyFloorDays: built.demand.warrantyFloor.days,
        qualityFloor: built.demand.qualityFloor.score,
        availabilityFloor: built.demand.availabilityFloor.ratio,
        allowedSubstitutions: built.demand.allowedSubstitutions,
        rejectionEvidenceCount: built.demand.rejectionEvidence.length,
        modelVersion: built.demand.modelVersion,
      },
    }),
  );
  return { ok: true, demand: built.demand };
}
