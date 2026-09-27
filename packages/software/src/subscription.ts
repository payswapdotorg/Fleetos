/**
 * @fleetos/software — D4: SoftwareSubscription contracts.
 *
 * The subscription model consumes W022's WorkloadRecommendation DRAFT
 * `SoftwareSubscriptionIntentPayload` (the frozen shape from
 * `@fleetos/contracts`). Each subscription carries:
 *
 *   - the software id (from the payload's `softwareId`);
 *   - the seat count (from the payload's `seatCount`);
 *   - the term in days (the subscription's duration — defaults to
 *     365 days when not supplied);
 *   - the tenant scope;
 *   - the workload the subscription serves (when supplied via the
 *     payload's optional workload linkage);
 *   - injected allocation timestamp;
 *   - deterministic subscription id;
 *   - versioned subscription records (append-only revisions).
 *
 * The allocation engine is a PURE FUNCTION: it consumes a W022 draft
 * payload and produces a deterministic SoftwareSubscription (revision 1).
 * Revisions are append-only: `reviseSubscription` appends revision+1
 * and never rewrites the prior.
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): the
 * allocation engine PROPOSES subscriptions; the deterministic policy
 * layer (W031, Contract Guardian) remains authoritative for whether
 * an allocation is permitted. The subscription consumes a W022 DRAFT
 * SoftwareSubscriptionIntentPayload (the payload shape only — no
 * intent id, no lifecycle).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import type { SoftwareSubscriptionIntentPayload } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { SoftwareAuditSink } from "./audit-seam";
import { NOOP_SOFTWARE_AUDIT_SINK, SOFTWARE_AUDIT_ACTIONS } from "./audit-seam";
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

/** The subscription schema version. */
export const SUBSCRIPTION_SCHEMA_VERSION = 1 as const;

/** The subscription model version. */
export const SUBSCRIPTION_MODEL_VERSION = 1 as const;

/** The allocation engine version. */
export const ALLOCATION_ENGINE_VERSION = "software-allocation/1" as const;

/** The default subscription term in days (1 year). */
export const DEFAULT_SUBSCRIPTION_TERM_DAYS = 365;

// ---------------------------------------------------------------------------
// The SoftwareSubscription record
// ---------------------------------------------------------------------------

/**
 * A SoftwareSubscription: one allocation of seats for one software id,
 * at one immutable revision. Frozen at construction; updates create
 * new revisions.
 */
export interface SoftwareSubscription extends TenantScoped {
  /** Deterministic id: `sub_` + fnv1a32 of the identity tuple. */
  readonly subscriptionId: string;
  readonly tenantId: TenantId;
  /** The software id (from SoftwareSubscriptionIntentPayload.softwareId). */
  readonly softwareId: string;
  /** The seat count (from SoftwareSubscriptionIntentPayload.seatCount). */
  readonly seatCount: number;
  /** The subscription term in days. */
  readonly termDays: number;
  /** The workload the subscription serves (when supplied). */
  readonly workloadId: WorkloadId;
  /** 1-based revision. */
  readonly revision: number;
  /** The prior revision, when revising. */
  readonly supersedes?: string;
  /** Injected allocation/revision timestamp. */
  readonly allocatedAt: string;
  /** Deterministic content hash. */
  readonly contentHash: string;
  /** The subscription payload schema version. */
  readonly schemaVersion: number;
  /** The subscription model version. */
  readonly modelVersion: number;
}

/** The input of a subscription allocation (revision 1). */
export interface AllocateSubscriptionInput {
  /** The W022 draft payload (consumed as machine-stable input). */
  readonly softwareIntent: SoftwareSubscriptionIntentPayload;
  /** Optional workload linkage (the subscription serves one workload). */
  readonly workloadId?: WorkloadId;
  /** The subscription term in days (defaults to 365). */
  readonly termDays?: number;
  /** Injected allocation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
}

/** The input of a subscription revision (revision = prior + 1). */
export interface ReviseSubscriptionInput {
  /** The new seat count. */
  readonly seatCount: number;
  /** The new term in days. */
  readonly termDays?: number;
  /** Injected revision timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
}

/** The tagged result of a subscription build. */
export type SubscriptionBuildResult =
  | { readonly ok: true; readonly subscription: SoftwareSubscription }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** Validate the allocation input. Returns the failure list (empty = ok). */
function validateAllocationInput(
  input: AllocateSubscriptionInput,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (input?.softwareIntent === null || typeof input?.softwareIntent !== "object") {
    failures.push({ path: "/softwareIntent", reason: "required" });
  } else {
    const payload = input.softwareIntent as { softwareId?: unknown; seatCount?: unknown };
    if (typeof payload.softwareId !== "string" || payload.softwareId.length === 0) {
      failures.push({ path: "/softwareIntent/softwareId", reason: "required" });
    }
    if (
      typeof payload.seatCount !== "number" ||
      !Number.isInteger(payload.seatCount) ||
      payload.seatCount < 0
    ) {
      failures.push({ path: "/softwareIntent/seatCount", reason: "must_be_non_negative_integer" });
    }
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.termDays !== undefined) {
    if (
      typeof input.termDays !== "number" ||
      !Number.isInteger(input.termDays) ||
      input.termDays < 1
    ) {
      failures.push({ path: "/termDays", reason: "must_be_positive_integer" });
    }
  }
  return failures;
}

/** Compute the deterministic content hash of a revision's content. */
function computeSubscriptionContentHash(
  content: Omit<SoftwareSubscription, "contentHash">,
): string {
  return fnv1a32Hex(
    canonicalJson({
      subscriptionId: content.subscriptionId,
      tenantId: content.tenantId as string,
      softwareId: content.softwareId,
      seatCount: content.seatCount,
      termDays: content.termDays,
      workloadId: content.workloadId as string,
      revision: content.revision,
      allocatedAt: content.allocatedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
}

/**
 * Allocate a software subscription from a W022 DRAFT
 * SoftwareSubscriptionIntentPayload. Pure and deterministic: the same
 * inputs produce the byte-identical frozen subscription (including the
 * derived subscription id and content hash). The tenant scope is
 * stamped onto the subscription.
 *
 * @param tenantId the acting tenant
 * @param input the allocation input
 * @returns the tagged build result
 */
export function allocateSubscription(
  tenantId: TenantId,
  input: AllocateSubscriptionInput,
): SubscriptionBuildResult {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.subscriptionInvalid,
        "subscription request is invalid",
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  const failures = validateAllocationInput(input);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.subscriptionInvalid,
        "subscription request is invalid",
        { tenantId, correlationId: input.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const payload = input.softwareIntent as SoftwareSubscriptionIntentPayload;
  const workloadId = (input.workloadId ?? "") as WorkloadId;
  const termDays = input.termDays ?? DEFAULT_SUBSCRIPTION_TERM_DAYS;
  const subscriptionId = `sub_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      softwareId: payload.softwareId ?? "",
      workloadId: workloadId as string,
    }),
  )}`;
  const content: Omit<SoftwareSubscription, "contentHash"> = frozen({
    subscriptionId,
    tenantId,
    softwareId: payload.softwareId ?? "",
    seatCount: payload.seatCount,
    termDays,
    workloadId,
    revision: 1,
    allocatedAt: input.at,
    schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
    modelVersion: SUBSCRIPTION_MODEL_VERSION,
  });
  const contentHash = computeSubscriptionContentHash(content);
  return { ok: true, subscription: frozen({ ...content, contentHash }) };
}

/**
 * Revise a software subscription (revision = prior + 1). Pure and
 * deterministic; the prior revision is never rewritten.
 *
 * @param prior the prior revision (must be the latest)
 * @param input the revision input
 * @returns the tagged build result
 */
export function reviseSubscription(
  prior: SoftwareSubscription,
  input: ReviseSubscriptionInput,
): SubscriptionBuildResult {
  const failures: { path: string; reason: string }[] = [];
  if (
    typeof input?.seatCount !== "number" ||
    !Number.isInteger(input.seatCount) ||
    input.seatCount < 0
  ) {
    failures.push({ path: "/seatCount", reason: "must_be_non_negative_integer" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.termDays !== undefined) {
    if (
      typeof input.termDays !== "number" ||
      !Number.isInteger(input.termDays) ||
      input.termDays < 1
    ) {
      failures.push({ path: "/termDays", reason: "must_be_positive_integer" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.subscriptionInvalid,
        "subscription revision is invalid",
        { tenantId: prior.tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const termDays = input.termDays ?? prior.termDays;
  const content: Omit<SoftwareSubscription, "contentHash"> = frozen({
    subscriptionId: prior.subscriptionId,
    tenantId: prior.tenantId,
    softwareId: prior.softwareId,
    seatCount: input.seatCount,
    termDays,
    workloadId: prior.workloadId,
    revision: prior.revision + 1,
    supersedes: prior.subscriptionId,
    allocatedAt: input.at,
    schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
    modelVersion: SUBSCRIPTION_MODEL_VERSION,
  });
  const contentHash = computeSubscriptionContentHash(content);
  return { ok: true, subscription: frozen({ ...content, contentHash }) };
}

// ---------------------------------------------------------------------------
// Allocation result (audit-emitting boundary)
// ---------------------------------------------------------------------------

/** The result of `createSubscription` (audit-emitting). */
export type CreateSubscriptionResult =
  | { readonly ok: true; readonly subscription: SoftwareSubscription }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Allocate a subscription and emit a
 * `software.subscription.allocated` audit record to the sink. Pure
 * except for the audit emission (the consequential side effect).
 */
export function createSubscription(
  tenantId: TenantId,
  input: AllocateSubscriptionInput,
  sink: SoftwareAuditSink = NOOP_SOFTWARE_AUDIT_SINK,
): CreateSubscriptionResult {
  const built = allocateSubscription(tenantId, input);
  if (!built.ok) return built;
  sink.append(
    frozen({
      action: SOFTWARE_AUDIT_ACTIONS.subscriptionAllocated,
      tenantId: built.subscription.tenantId,
      subject: built.subscription.subscriptionId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      details: {
        softwareId: built.subscription.softwareId,
        seatCount: built.subscription.seatCount,
        termDays: built.subscription.termDays,
        workloadId: built.subscription.workloadId,
        revision: built.subscription.revision,
        contentHash: built.subscription.contentHash,
        modelVersion: built.subscription.modelVersion,
      },
    }),
  );
  return { ok: true, subscription: built.subscription };
}

// ---------------------------------------------------------------------------
// Re-export the allocation engine version (for conformance tests)
// ---------------------------------------------------------------------------

export { ALLOCATION_ENGINE_VERSION as SOFTWARE_ALLOCATION_ENGINE_VERSION };
