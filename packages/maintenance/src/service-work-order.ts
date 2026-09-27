/**
 * @fleetos/maintenance — D1: the ServiceWorkOrder domain model.
 *
 * "FleetOS owns maintenance plans; local vendors own fulfillment."
 * — `spec/ARCHITECTURE.md` § Procurement/service exchange.
 * "Module map: maintenance -> devices, health, actions, vendors, audit."
 * — `spec/MODULE-DEPENDENCY-MAP.md`.
 *
 * Health/diagnosis (W021) produces diagnosis hypotheses and treatment
 * recommendations as PROPOSALS; maintenance turns approved treatments
 * into service work orders matched to vendors (W032's matching pattern).
 *
 * The service work order model consumes W021 health's diagnosis
 * hypotheses + treatment recommendations as INJECTED inputs via the
 * frozen contracts shapes (the `MaintainDeviceIntentPayload` shape
 * — owned by this package per the frozen contracts doc comment — is
 * the binding payload; the `ReplacementIntentPayload` shape is the
 * frozen payload for the replacement-escalation linkage, owned by
 * `@fleetos/recovery` per the frozen contracts doc comment — both
 * consumed VERBATIM, never re-declared). Health is worker-b's lane
 * (the ownership gate forbids importing `@fleetos/health` from src/
 * — but this is worker-c's lane, and the same-lane rule permits it;
 * still, the contract is preserved as structural twins so the
 * module-map edge is honored via the frozen contracts shapes only,
 * never health's internals, matching W040's pattern).
 *
 * A ServiceWorkOrder carries:
 *   - the device it serves (deviceId, a typed ref);
 *   - the diagnosis evidence it cites (W021 refs + the DRAFT
 *     MaintainDeviceIntentPayload — the frozen shape, verbatim);
 *   - the service area (free-form string; matched against vendor regions);
 *   - the customer deadline (injected, ISO 8601);
 *   - the warranty eligibility as typed rules against vendor terms
 *     from @fleetos/vendors (the matcher consumes the typed comparable
 *     values directly: VendorTerms.warranty.days, VendorTerms.sla.coverage,
 *     VendorTerms.quality.score);
 *   - the SLA / warranty / quality floors (typed comparable values);
 *   - the replacement-escalation linkage: when a treatment recommends
 *     replacement, the work order carries the DRAFT ReplacementIntentPayload
 *     (frozen shape only — no intent lifecycle, no intent id; the
 *     procurement wave is responsible for materializing any procurement).
 *
 * Work orders are VERSIONED records (append-only revisions — the
 * "versioned-interpretation discipline" from
 * `spec/ARCHITECTURE-LOCK.md` item 3). A new revision is a NEW record;
 * the prior is never rewritten. `buildServiceWorkOrder` /
 * `buildServiceWorkOrderRevision` are pure builders (the store in
 * `store.ts` owns persistence and tenant isolation; the audit emission
 * lives at the service boundary in `createServiceWorkOrder` /
 * `reviseServiceWorkOrder` — pure except for the audit emission,
 * which is the consequential side effect).
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every
 * operation takes the acting `MaintenanceTenantScope` FIRST;
 * partitioned per-tenant storage; foreign ids are indistinguishable
 * from unknown ones (no existence side channel).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` and `deadline` are injected by the caller.
 */

import {
  MAINTAIN_DEVICE_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
} from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  DeviceId,
  FleetError,
  MaintainDeviceIntentPayload,
  ReplacementIntentPayload,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type {
  DaysDuration,
  InventoryAvailability,
  QualityScore,
  SlaCoverage,
} from "@fleetos/vendors";
import type { MaintenanceAuditSink } from "./audit-seam";
import { NOOP_MAINTENANCE_AUDIT_SINK, MAINTENANCE_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  MAINTENANCE_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { MaintenanceTenantScope } from "./internal";
import { checkMaintenanceTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The service work order schema version. */
export const WORK_ORDER_SCHEMA_VERSION = 1 as const;

/** The service work order model version (bumped when comparable shapes change). */
export const WORK_ORDER_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Health diagnosis evidence (the health module edge — structural twin)
// ---------------------------------------------------------------------------

/**
 * A W021 health treatment proposal carrying a DRAFT
 * `MaintainDeviceIntentPayload` — a STRUCTURAL twin of the health
 * package's `TreatmentRecommendation` maintenance arm (the module-map
 * edge `maintenance -> health` honored via the frozen contracts shapes
 * only). The binding site passes health's REAL
 * `TreatmentRecommendation.proposedIntent` value through this shape
 * (proven by test); the payload is the FROZEN contracts shape
 * (`MaintainDeviceIntentPayload`, owned by this package per the
 * frozen doc comment — consumed VERBATIM).
 */
export interface MaintenanceDiagnosisProposal {
  /** The frozen intent kind this proposal drafts (`MaintainDeviceIntent`). */
  readonly intentKind: typeof MAINTAIN_DEVICE_INTENT_KIND;
  /** The DRAFT payload — the FROZEN `MaintainDeviceIntentPayload` shape, verbatim. */
  readonly payload: MaintainDeviceIntentPayload;
}

/**
 * The diagnosis evidence a service work order cites. Carries the
 * W021 diagnosis hypothesis id (a typed ref), the W021 treatment-
 * recommendation id (a typed ref), the hypothesized cause id, the
 * hypothesis confidence, the DRAFT maintenance intent proposal the
 * recommendation carries, and the observation ids behind the
 * anomalies that produced the hypothesis.
 *
 * Structural twin of W040's `ReplacementDiagnosisEvidence` (recovery
 * lane) for the maintenance arm — same shape discipline, same
 * machine-stable refs. NEVER re-derived here; the binding site
 * passes the real W021 values through (proven by test).
 */
export interface MaintenanceDiagnosisEvidence {
  /** The W021 diagnosis hypothesis id (a typed ref). */
  readonly hypothesisId: string;
  /** The W021 treatment-recommendation id (a typed ref). */
  readonly recommendationId: string;
  /** The hypothesized cause id (e.g. "health.battery_aging"). */
  readonly causeId: string;
  /** The hypothesis confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The DRAFT maintenance intent proposal the recommendation carries. */
  readonly proposedIntent: MaintenanceDiagnosisProposal;
  /** The observation ids behind the anomalies that produced the hypothesis. */
  readonly observationIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Replacement-escalation linkage (the replacement module edge)
// ---------------------------------------------------------------------------

/**
 * A W021 health treatment proposal carrying a DRAFT
 * `ReplacementIntentPayload` — a STRUCTURAL twin of the health
 * package's `TreatmentRecommendation` replacement arm (the module-map
 * edge `maintenance -> health` honored via the frozen contracts shapes
 * only). The payload is the FROZEN contracts shape (owned by
 * `@fleetos/recovery` per the frozen doc comment — consumed VERBATIM,
 * DRAFT only — no intent lifecycle, no intent id).
 */
export interface ReplacementLinkProposal {
  /** The frozen intent kind this proposal drafts (`ReplacementIntent`). */
  readonly intentKind: typeof REPLACEMENT_INTENT_KIND;
  /** The DRAFT payload — the FROZEN `ReplacementIntentPayload` shape, verbatim. */
  readonly payload: ReplacementIntentPayload;
}

/**
 * The replacement-escalation linkage a work order may carry when its
 * diagnosis evidence recommends replacement (the maintenance lane's
 * `maintenance -> recovery` module-map edge honored via the frozen
 * contracts shapes only — DRAFT payloads, no intent lifecycle).
 *
 * The linkage cites the same diagnosis evidence refs (hypothesis id,
 * recommendation id, cause id, observation ids) plus the DRAFT
 * `ReplacementIntentPayload`. The matcher treats the linkage as
 * advisory input — a vendor whose capability matches a replacement
 * is up-ranked when the work order carries a replacement linkage;
 * the procurement wave is responsible for materializing any
 * procurement (this package creates no demand and orders nothing).
 */
export interface ReplacementEscalationLink {
  /** The frozen intent kind this linkage drafts (`ReplacementIntent`). */
  readonly intentKind: typeof REPLACEMENT_INTENT_KIND;
  /** The DRAFT payload — the FROZEN `ReplacementIntentPayload` shape, verbatim. */
  readonly payload: ReplacementIntentPayload;
  /** The same diagnosis evidence refs the work order cites (machine-stable). */
  readonly diagnosisRefs: {
    readonly hypothesisId: string;
    readonly recommendationId: string;
    readonly causeId: string;
    readonly observationIds: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// Warranty eligibility (typed rules against vendor terms)
// ---------------------------------------------------------------------------

/**
 * The warranty-eligibility rules a work order carries as typed
 * comparable values. These rules consume `@fleetos/vendors`'
 * `VendorTerms.warranty.days` directly (the matcher compares the
 * work order's warranty floor against the vendor's typed terms —
 * the module-map edge `maintenance -> vendors` honored via the
 * frozen comparable values; the ownership gate permits the same-lane
 * import of `@fleetos/vendors`).
 *
 * `warrantyFloor` is the minimum vendor warranty days the work order
 * requires; `requireInWarranty` is the typed rule that the vendor's
 * standard warranty duration MUST cover the work order's expected
 * service lifetime (the warranty headroom in days — a positive
 * headroom is `in_warranty_headroom`, a negative headroom is
 * `out_of_warranty_shortfall`).
 */
export interface WarrantyEligibilityRules {
  /** The minimum vendor warranty duration in days (>= 0). */
  readonly warrantyFloor: DaysDuration;
  /**
   * True when the work order requires the vendor's standard warranty
   * to cover the expected service lifetime (the warranty headroom
   * must be >= 0). False when the work order accepts out-of-warranty
   * vendors (the matcher down-ranks them but does not reject).
   */
  readonly requireInWarranty: boolean;
}

/** The warranty-aware standing of a work order against a vendor's terms. */
export type WarrantyEligibilityStanding =
  | "in_warranty_headroom"
  | "out_of_warranty_shortfall"
  | "warranty_floor_unmet";

/** All standings (for validation + iteration). */
export const ALL_WARRANTY_STANDINGS: readonly WarrantyEligibilityStanding[] = Object.freeze([
  "in_warranty_headroom",
  "out_of_warranty_shortfall",
  "warranty_floor_unmet",
]);

/**
 * Classify the warranty standing of a work order against a vendor's
 * warranty terms. PURE and deterministic:
 *   - `warranty_floor_unmet` — the vendor's warranty days are below
 *     the work order's warranty floor (a hard gate failure);
 *   - `in_warranty_headroom` — the vendor's warranty days are above
 *     or equal to the floor (positive headroom — the vendor covers
 *     the work order's expected service lifetime).
 *
 * The `out_of_warranty_shortfall` standing is reserved for a later
 * wave that introduces a tenant-configurable in-warranty threshold
 * above the floor (currently the floor IS the threshold, so the
 * standing is unreachable in the v1 rules — kept in the type union
 * for forward compatibility).
 *
 * @param vendorWarrantyDays the vendor's standard warranty days
 * @param rules the work order's warranty eligibility rules
 * @returns the machine-stable standing
 */
export function classifyWarrantyEligibility(
  vendorWarrantyDays: number,
  rules: WarrantyEligibilityRules,
): WarrantyEligibilityStanding {
  if (vendorWarrantyDays < rules.warrantyFloor.days) return "warranty_floor_unmet";
  return "in_warranty_headroom";
}

// ---------------------------------------------------------------------------
// The versioned service work order record
// ---------------------------------------------------------------------------

/**
 * A versioned ServiceWorkOrder: a tenant-scoped, versioned, warranty-
 * aware service work order derived from a W021 health diagnosis +
 * treatment recommendation. Frozen at construction; revisions append
 * a new record (`revision = prior + 1`) with a fresh content hash —
 * the prior revision is never rewritten.
 */
export interface ServiceWorkOrder extends TenantScoped {
  /** Deterministic id: `swo_` + fnv1a32 of the identity tuple. */
  readonly workOrderId: string;
  readonly tenantId: TenantId;
  /** The device the work order concerns. */
  readonly deviceId: DeviceId;
  /** 1-based revision. Immutable once written; updates append revision+1. */
  readonly revision: number;
  /** The prior revision this one supersedes (absent on revision 1). */
  readonly supersedes?: string;
  /** The diagnosis evidence the work order cites (W021 refs + the DRAFT payload). */
  readonly diagnosis: MaintenanceDiagnosisEvidence;
  /** The replacement-escalation linkage, when the diagnosis recommends replacement. */
  readonly replacementLink?: ReplacementEscalationLink;
  /** The service area (free-form string; matched against vendor regions). */
  readonly serviceArea: string;
  /** The customer deadline (injected, ISO 8601). */
  readonly deadline: string;
  /** The SLA coverage floor (vendor must be >= this). */
  readonly slaFloor: SlaCoverage;
  /** The warranty eligibility rules (typed rules against vendor terms). */
  readonly warrantyRules: WarrantyEligibilityRules;
  /** The minimum vendor quality score floor (vendor must be >= this). */
  readonly qualityFloor: QualityScore;
  /** The minimum vendor inventory availability floor (vendor must be >= this). */
  readonly availabilityFloor: InventoryAvailability;
  /** The service category id (a vendor capability id — e.g. "service.battery"). */
  readonly serviceCategory: string;
  /** Allowed substitution capability ids (alternates the customer accepts). */
  readonly allowedSubstitutions: readonly string[];
  /** Injected creation/revision timestamp. */
  readonly createdAt: string;
  /** Deterministic content digest of the revision's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
  /** The work order payload schema version. */
  readonly schemaVersion: number;
  /** The work order model version. */
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The input of a work order creation (revision 1). */
export interface CreateServiceWorkOrderInput {
  /** The device the work order concerns. */
  readonly deviceId: DeviceId;
  /** The diagnosis evidence the work order cites (W021 refs + the DRAFT payload). */
  readonly diagnosis: MaintenanceDiagnosisEvidence;
  /** The replacement-escalation linkage, when the diagnosis recommends replacement. */
  readonly replacementLink?: ReplacementEscalationLink;
  /** The service area (free-form string). */
  readonly serviceArea: string;
  /** The customer deadline (ISO 8601; should be after `at`). */
  readonly deadline: string;
  /** The SLA coverage floor. */
  readonly slaFloor: SlaCoverage;
  /** The warranty eligibility rules. */
  readonly warrantyRules: WarrantyEligibilityRules;
  /** The quality floor. */
  readonly qualityFloor: QualityScore;
  /** The availability floor. */
  readonly availabilityFloor: InventoryAvailability;
  /** The service category id (a vendor capability id). */
  readonly serviceCategory: string;
  /** Allowed substitution capability ids (defaults to empty). */
  readonly allowedSubstitutions?: readonly string[];
  /** Injected creation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
}

/** The input of a work order revision (revision = prior + 1). */
export interface ReviseServiceWorkOrderInput {
  /** The updated diagnosis evidence (when re-diagnosed). */
  readonly diagnosis?: MaintenanceDiagnosisEvidence;
  /** The updated replacement-escalation linkage. */
  readonly replacementLink?: ReplacementEscalationLink;
  /** The updated service area. */
  readonly serviceArea?: string;
  /** The updated deadline. */
  readonly deadline?: string;
  /** The updated SLA floor. */
  readonly slaFloor?: SlaCoverage;
  /** The updated warranty eligibility rules. */
  readonly warrantyRules?: WarrantyEligibilityRules;
  /** The updated quality floor. */
  readonly qualityFloor?: QualityScore;
  /** The updated availability floor. */
  readonly availabilityFloor?: InventoryAvailability;
  /** The updated service category id. */
  readonly serviceCategory?: string;
  /** The updated allowed substitutions. */
  readonly allowedSubstitutions?: readonly string[];
  /** Injected revision timestamp. */
  readonly at: string;
  /** Correlation id of the revision request. */
  readonly correlationId: CorrelationId;
}

/**
 * The boundary-side revision overrides: the pure-builder input minus
 * the `at` and `correlationId` fields (these come from the boundary's
 * `ServiceWorkOrderOptions`). The boundary merges the overrides with
 * the options before calling `buildServiceWorkOrderRevision`.
 */
export type ReviseServiceWorkOrderOverrides = Omit<
  ReviseServiceWorkOrderInput,
  "at" | "correlationId"
>;

/** The tagged result of a pure work order build. */
export type ServiceWorkOrderBuildResult =
  | { readonly ok: true; readonly workOrder: ServiceWorkOrder }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a `MaintenanceDiagnosisEvidence` input. */
function validateDiagnosisEvidence(
  diagnosis: unknown,
  path: string,
): { path: string; reason: string }[] | null {
  const failures: { path: string; reason: string }[] = [];
  if (diagnosis === null || typeof diagnosis !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = diagnosis as Record<string, unknown>;
  for (const field of ["hypothesisId", "recommendationId", "causeId"] as const) {
    if (typeof candidate[field] !== "string" || (candidate[field] as string).length === 0) {
      failures.push({ path: `${path}/${field}`, reason: "required" });
    }
  }
  const confidence = candidate["confidence"];
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    failures.push({ path: `${path}/confidence`, reason: "unit_interval_number_required" });
  }
  const intent = candidate["proposedIntent"];
  if (intent === null || typeof intent !== "object") {
    failures.push({ path: `${path}/proposedIntent`, reason: "object_required" });
  } else {
    const intentRecord = intent as Record<string, unknown>;
    if (intentRecord["intentKind"] !== MAINTAIN_DEVICE_INTENT_KIND) {
      failures.push({
        path: `${path}/proposedIntent/intentKind`,
        reason: "maintain_device_intent_kind_required",
      });
    }
    const payload = intentRecord["payload"];
    if (payload === null || typeof payload !== "object") {
      failures.push({ path: `${path}/proposedIntent/payload`, reason: "object_required" });
    } else {
      const payloadRecord = payload as Record<string, unknown>;
      if (
        payloadRecord["deviceId"] !== undefined &&
        (typeof payloadRecord["deviceId"] !== "string" ||
          (payloadRecord["deviceId"] as string).length === 0)
      ) {
        failures.push({
          path: `${path}/proposedIntent/payload/deviceId`,
          reason: "non_empty_string_required",
        });
      }
      if (
        typeof payloadRecord["description"] !== "string" ||
        (payloadRecord["description"] as string).length === 0
      ) {
        failures.push({
          path: `${path}/proposedIntent/payload/description`,
          reason: "required",
        });
      }
    }
  }
  const observationIds = candidate["observationIds"];
  if (
    !Array.isArray(observationIds) ||
    !observationIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    failures.push({ path: `${path}/observationIds`, reason: "string_array_required" });
  }
  return failures.length === 0 ? null : failures;
}

/** Validate a `ReplacementEscalationLink` input. */
function validateReplacementLink(
  link: unknown,
  path: string,
): { path: string; reason: string }[] | null {
  if (link === undefined) return null;
  const failures: { path: string; reason: string }[] = [];
  if (link === null || typeof link !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = link as Record<string, unknown>;
  if (candidate["intentKind"] !== REPLACEMENT_INTENT_KIND) {
    failures.push({
      path: `${path}/intentKind`,
      reason: "replacement_intent_kind_required",
    });
  }
  const payload = candidate["payload"];
  if (payload === null || typeof payload !== "object") {
    failures.push({ path: `${path}/payload`, reason: "object_required" });
  } else {
    const payloadRecord = payload as Record<string, unknown>;
    if (
      payloadRecord["deviceId"] !== undefined &&
      (typeof payloadRecord["deviceId"] !== "string" ||
        (payloadRecord["deviceId"] as string).length === 0)
    ) {
      failures.push({ path: `${path}/payload/deviceId`, reason: "non_empty_string_required" });
    }
    if (
      typeof payloadRecord["reason"] !== "string" ||
      (payloadRecord["reason"] as string).length === 0
    ) {
      failures.push({ path: `${path}/payload/reason`, reason: "required" });
    }
  }
  const refs = candidate["diagnosisRefs"];
  if (refs === null || typeof refs !== "object") {
    failures.push({ path: `${path}/diagnosisRefs`, reason: "object_required" });
  } else {
    const refsRecord = refs as Record<string, unknown>;
    for (const field of ["hypothesisId", "recommendationId", "causeId"] as const) {
      if (
        typeof refsRecord[field] !== "string" ||
        (refsRecord[field] as string).length === 0
      ) {
        failures.push({ path: `${path}/diagnosisRefs/${field}`, reason: "required" });
      }
    }
    const obsIds = refsRecord["observationIds"];
    if (
      !Array.isArray(obsIds) ||
      !obsIds.every((id) => typeof id === "string" && id.length > 0)
    ) {
      failures.push({
        path: `${path}/diagnosisRefs/observationIds`,
        reason: "string_array_required",
      });
    }
  }
  return failures.length === 0 ? null : failures;
}

/** Validate the shared payload fields; returns the failure list (empty = ok). */
function validatePayloadFields(
  input: CreateServiceWorkOrderInput,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  const diagnosisFailures = validateDiagnosisEvidence(input?.diagnosis, "/diagnosis");
  if (diagnosisFailures !== null) failures.push(...diagnosisFailures);
  const linkFailures = validateReplacementLink(input?.replacementLink, "/replacementLink");
  if (linkFailures !== null) failures.push(...linkFailures);
  if (typeof input?.serviceArea !== "string" || input.serviceArea.length === 0) {
    failures.push({ path: "/serviceArea", reason: "required" });
  }
  if (typeof input?.deadline !== "string" || !looksLikeIso(input.deadline)) {
    failures.push({ path: "/deadline", reason: "not_iso" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (typeof input?.serviceCategory !== "string" || input.serviceCategory.length === 0) {
    failures.push({ path: "/serviceCategory", reason: "required" });
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
  const warrantyRules = input?.warrantyRules as
    | {
        warrantyFloor?: unknown;
        requireInWarranty?: unknown;
      }
    | undefined;
  if (
    warrantyRules === undefined ||
    typeof warrantyRules.warrantyFloor !== "object" ||
    warrantyRules.warrantyFloor === null
  ) {
    failures.push({ path: "/warrantyRules/warrantyFloor", reason: "object_required" });
  } else {
    const wf = warrantyRules.warrantyFloor as { days?: unknown };
    if (
      typeof wf.days !== "number" ||
      !Number.isFinite(wf.days) ||
      wf.days < 0
    ) {
      failures.push({ path: "/warrantyRules/warrantyFloor/days", reason: "must_be_non_negative" });
    }
  }
  if (
    warrantyRules !== undefined &&
    typeof warrantyRules.requireInWarranty !== "boolean"
  ) {
    failures.push({ path: "/warrantyRules/requireInWarranty", reason: "boolean_required" });
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
  if (
    input?.allowedSubstitutions !== undefined &&
    !Array.isArray(input.allowedSubstitutions)
  ) {
    failures.push({ path: "/allowedSubstitutions", reason: "not_array" });
  } else if (input?.allowedSubstitutions !== undefined) {
    for (let i = 0; i < input.allowedSubstitutions.length; i++) {
      if (
        typeof input.allowedSubstitutions[i] !== "string" ||
        (input.allowedSubstitutions[i] as string).length === 0
      ) {
        failures.push({ path: `/allowedSubstitutions/${i}`, reason: "non_empty_string_required" });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Identity + content digest
// ---------------------------------------------------------------------------

/** Deterministic work order identity: `swo_` + fnv1a32 of the identity tuple. */
function workOrderId(
  tenantId: TenantId,
  deviceId: DeviceId,
  diagnosis: MaintenanceDiagnosisEvidence,
  serviceCategory: string,
): string {
  return `swo_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      deviceId: deviceId as string,
      hypothesisId: diagnosis.hypothesisId,
      recommendationId: diagnosis.recommendationId,
      causeId: diagnosis.causeId,
      serviceCategory,
    }),
  )}`;
}

/** Compute the deterministic content digest of a revision's content. */
function computeContentDigest(
  record: Omit<ServiceWorkOrder, "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson({
      tenantId: record.tenantId as string,
      deviceId: record.deviceId as string,
      revision: record.revision,
      supersedes: record.supersedes ?? null,
      diagnosis: record.diagnosis,
      replacementLink: record.replacementLink ?? null,
      serviceArea: record.serviceArea,
      deadline: record.deadline,
      slaFloor: record.slaFloor,
      warrantyRules: record.warrantyRules,
      qualityFloor: record.qualityFloor,
      availabilityFloor: record.availabilityFloor,
      serviceCategory: record.serviceCategory,
      allowedSubstitutions: record.allowedSubstitutions,
      createdAt: record.createdAt,
      schemaVersion: record.schemaVersion,
      modelVersion: record.modelVersion,
    }),
  );
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

/**
 * Build revision 1 of a service work order. Pure and deterministic: the
 * same inputs produce the byte-identical frozen work order (including the
 * derived work order id and content digest). The tenant scope comes from
 * the acting context (the store passes it); it is stamped onto the record.
 *
 * The diagnosis evidence's observation ids are sorted for byte-identical
 * determinism (the binding site may pass them in any order).
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param input the creation input
 * @returns the tagged build result
 */
export function buildServiceWorkOrder(
  tenantId: TenantId,
  input: CreateServiceWorkOrderInput,
): ServiceWorkOrderBuildResult {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.workOrderInvalid,
        "service work order request is invalid",
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  const failures = validatePayloadFields(input);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.workOrderInvalid,
        "service work order request is invalid",
        { tenantId, correlationId: input.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  // Sort the diagnosis evidence's observation ids for byte-identical determinism.
  const diagnosis: MaintenanceDiagnosisEvidence = frozen({
    ...input.diagnosis,
    observationIds: frozenArray([...input.diagnosis.observationIds].sort()),
  });

  const woId = workOrderId(tenantId, input.deviceId, diagnosis, input.serviceCategory);

  // Replacement link, if any (with its diagnosis refs' observation ids sorted).
  const replacementLink =
    input.replacementLink !== undefined
      ? frozen<ReplacementEscalationLink>({
          intentKind: REPLACEMENT_INTENT_KIND,
          payload: input.replacementLink.payload,
          diagnosisRefs: frozen({
            hypothesisId: input.replacementLink.diagnosisRefs.hypothesisId,
            recommendationId: input.replacementLink.diagnosisRefs.recommendationId,
            causeId: input.replacementLink.diagnosisRefs.causeId,
            observationIds: frozenArray(
              [...input.replacementLink.diagnosisRefs.observationIds].sort(),
            ),
          }),
        })
      : undefined;

  const content: Omit<ServiceWorkOrder, "contentDigest"> = frozen({
    workOrderId: woId,
    tenantId,
    deviceId: input.deviceId,
    revision: 1,
    diagnosis,
    ...(replacementLink !== undefined ? { replacementLink } : {}),
    serviceArea: input.serviceArea,
    deadline: input.deadline,
    slaFloor: frozen(input.slaFloor),
    warrantyRules: frozen(input.warrantyRules),
    qualityFloor: frozen(input.qualityFloor),
    availabilityFloor: frozen(input.availabilityFloor),
    serviceCategory: input.serviceCategory,
    allowedSubstitutions: frozenArray(input.allowedSubstitutions ?? []),
    createdAt: input.at,
    schemaVersion: WORK_ORDER_SCHEMA_VERSION,
    modelVersion: WORK_ORDER_MODEL_VERSION,
  });
  const contentDigest = computeContentDigest(content);
  return { ok: true, workOrder: frozen({ ...content, contentDigest }) };
}

/**
 * Build the next revision of a work order (revision = prior + 1). Pure
 * and deterministic; the prior revision is never rewritten. Only the
 * fields supplied in `input` are updated; the rest are inherited from
 * the prior revision.
 *
 * This is the pure builder; the audit-emitting boundary is
 * `reviseServiceWorkOrder` (below). The naming mirrors W040's
 * recovery pattern (pure builder `buildVendor` + boundary
 * `escalateReplacement`).
 *
 * @param prior the prior revision (must be the latest)
 * @param input the revision input
 * @returns the tagged build result
 */
export function buildServiceWorkOrderRevision(
  prior: ServiceWorkOrder,
  input: ReviseServiceWorkOrderInput,
): ServiceWorkOrderBuildResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.diagnosis !== undefined) {
    const diagFailures = validateDiagnosisEvidence(input.diagnosis, "/diagnosis");
    if (diagFailures !== null) failures.push(...diagFailures);
  }
  if (input?.replacementLink !== undefined) {
    const linkFailures = validateReplacementLink(input.replacementLink, "/replacementLink");
    if (linkFailures !== null) failures.push(...linkFailures);
  }
  if (input?.serviceArea !== undefined && input.serviceArea.length === 0) {
    failures.push({ path: "/serviceArea", reason: "required" });
  }
  if (input?.deadline !== undefined && !looksLikeIso(input.deadline)) {
    failures.push({ path: "/deadline", reason: "not_iso" });
  }
  if (input?.slaFloor !== undefined) {
    const sla = input.slaFloor as { coverage?: unknown };
    if (
      typeof sla.coverage !== "number" ||
      !Number.isFinite(sla.coverage) ||
      sla.coverage < 0 ||
      sla.coverage > 1
    ) {
      failures.push({ path: "/slaFloor/coverage", reason: "must_be_in_0_1" });
    }
  }
  if (input?.warrantyRules !== undefined) {
    const wr = input.warrantyRules as {
      warrantyFloor?: unknown;
      requireInWarranty?: unknown;
    };
    if (
      typeof wr.warrantyFloor !== "object" ||
      wr.warrantyFloor === null
    ) {
      failures.push({ path: "/warrantyRules/warrantyFloor", reason: "object_required" });
    } else {
      const wf = wr.warrantyFloor as { days?: unknown };
      if (
        typeof wf.days !== "number" ||
        !Number.isFinite(wf.days) ||
        wf.days < 0
      ) {
        failures.push({ path: "/warrantyRules/warrantyFloor/days", reason: "must_be_non_negative" });
      }
    }
    if (typeof wr.requireInWarranty !== "boolean") {
      failures.push({ path: "/warrantyRules/requireInWarranty", reason: "boolean_required" });
    }
  }
  if (input?.qualityFloor !== undefined) {
    const qf = input.qualityFloor as { score?: unknown };
    if (
      typeof qf.score !== "number" ||
      !Number.isFinite(qf.score) ||
      qf.score < 0 ||
      qf.score > 1
    ) {
      failures.push({ path: "/qualityFloor/score", reason: "must_be_in_0_1" });
    }
  }
  if (input?.availabilityFloor !== undefined) {
    const af = input.availabilityFloor as { ratio?: unknown };
    if (
      typeof af.ratio !== "number" ||
      !Number.isFinite(af.ratio) ||
      af.ratio < 0 ||
      af.ratio > 1
    ) {
      failures.push({ path: "/availabilityFloor/ratio", reason: "must_be_in_0_1" });
    }
  }
  if (input?.serviceCategory !== undefined && input.serviceCategory.length === 0) {
    failures.push({ path: "/serviceCategory", reason: "required" });
  }
  if (input?.allowedSubstitutions !== undefined && !Array.isArray(input.allowedSubstitutions)) {
    failures.push({ path: "/allowedSubstitutions", reason: "not_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.workOrderInvalid,
        "service work order revision is invalid",
        { tenantId: prior.tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  // Merge: inherit fields not supplied in the input.
  const diagnosis: MaintenanceDiagnosisEvidence =
    input.diagnosis !== undefined
      ? frozen({
          ...input.diagnosis,
          observationIds: frozenArray([...input.diagnosis.observationIds].sort()),
        })
      : prior.diagnosis;
  const replacementLink =
    input.replacementLink !== undefined
      ? frozen<ReplacementEscalationLink>({
          intentKind: REPLACEMENT_INTENT_KIND,
          payload: input.replacementLink.payload,
          diagnosisRefs: frozen({
            hypothesisId: input.replacementLink.diagnosisRefs.hypothesisId,
            recommendationId: input.replacementLink.diagnosisRefs.recommendationId,
            causeId: input.replacementLink.diagnosisRefs.causeId,
            observationIds: frozenArray(
              [...input.replacementLink.diagnosisRefs.observationIds].sort(),
            ),
          }),
        })
      : prior.replacementLink;
  const serviceArea = input.serviceArea ?? prior.serviceArea;
  const deadline = input.deadline ?? prior.deadline;
  const slaFloor = input.slaFloor ?? prior.slaFloor;
  const warrantyRules = input.warrantyRules ?? prior.warrantyRules;
  const qualityFloor = input.qualityFloor ?? prior.qualityFloor;
  const availabilityFloor = input.availabilityFloor ?? prior.availabilityFloor;
  const serviceCategory = input.serviceCategory ?? prior.serviceCategory;
  const allowedSubstitutions = input.allowedSubstitutions ?? prior.allowedSubstitutions;

  const content: Omit<ServiceWorkOrder, "contentDigest"> = frozen({
    workOrderId: prior.workOrderId,
    tenantId: prior.tenantId,
    deviceId: prior.deviceId,
    revision: prior.revision + 1,
    supersedes: prior.workOrderId,
    diagnosis,
    ...(replacementLink !== undefined ? { replacementLink } : {}),
    serviceArea,
    deadline,
    slaFloor: frozen(slaFloor),
    warrantyRules: frozen(warrantyRules),
    qualityFloor: frozen(qualityFloor),
    availabilityFloor: frozen(availabilityFloor),
    serviceCategory,
    allowedSubstitutions: frozenArray(allowedSubstitutions),
    createdAt: input.at,
    schemaVersion: WORK_ORDER_SCHEMA_VERSION,
    modelVersion: WORK_ORDER_MODEL_VERSION,
  });
  const contentDigest = computeContentDigest(content);
  return { ok: true, workOrder: frozen({ ...content, contentDigest }) };
}

// ---------------------------------------------------------------------------
// Boundary functions (audit-emitting)
// ---------------------------------------------------------------------------

/** The tagged result of a work order boundary write. */
export type ServiceWorkOrderWrite =
  | { readonly ok: true; readonly workOrder: ServiceWorkOrder }
  | { readonly ok: false; readonly error: FleetError };

/** Options for `createServiceWorkOrder` / `reviseServiceWorkOrder` (boundary). */
export interface ServiceWorkOrderOptions {
  /** The injected creation/revision timestamp (ISO 8601). */
  readonly at: string;
  /** The correlation id of the request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (default: no-op). */
  readonly auditSink?: MaintenanceAuditSink;
}

/**
 * Build a work order (revision 1) and emit a
 * `maintenance.workorder.created` audit record to the sink. Pure
 * except for the audit emission (the consequential side effect — the
 * sink contract requires append-only durability). The tenant scope
 * is taken FIRST (W012's pattern).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param input the creation input
 * @param options the injected options
 * @returns the tagged write result
 */
export function createServiceWorkOrder(
  scope: MaintenanceTenantScope,
  input: CreateServiceWorkOrderInput,
  options: ServiceWorkOrderOptions,
): ServiceWorkOrderWrite {
  const guard = checkMaintenanceTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.workOrderStoreDomain,
        `service work order boundary refused access (${guard.reason}: ${guard.detail})`,
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? MAINTENANCE_PIPELINE_CORRELATION_ID,
        },
        "maintenance.workorder.boundary",
        guard.reason,
      ),
    };
  }
  const built = buildServiceWorkOrder(guard.tenantId, input);
  if (!built.ok) return built;
  const sink: MaintenanceAuditSink = options.auditSink ?? NOOP_MAINTENANCE_AUDIT_SINK;
  sink.append(
    frozen({
      action: MAINTENANCE_AUDIT_ACTIONS.workOrderCreated,
      tenantId: guard.tenantId,
      subject: built.workOrder.workOrderId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      causationId: options.causationId,
      details: frozen({
        workOrderId: built.workOrder.workOrderId,
        deviceId: built.workOrder.deviceId as string,
        revision: built.workOrder.revision,
        serviceArea: built.workOrder.serviceArea,
        deadline: built.workOrder.deadline,
        serviceCategory: built.workOrder.serviceCategory,
        hypothesisId: built.workOrder.diagnosis.hypothesisId,
        recommendationId: built.workOrder.diagnosis.recommendationId,
        causeId: built.workOrder.diagnosis.causeId,
        confidence: built.workOrder.diagnosis.confidence,
        intentKind: built.workOrder.diagnosis.proposedIntent.intentKind,
        intentPayload: built.workOrder.diagnosis.proposedIntent.payload,
        hasReplacementLink: built.workOrder.replacementLink !== undefined,
        slaFloor: built.workOrder.slaFloor.coverage,
        warrantyFloorDays: built.workOrder.warrantyRules.warrantyFloor.days,
        requireInWarranty: built.workOrder.warrantyRules.requireInWarranty,
        qualityFloor: built.workOrder.qualityFloor.score,
        availabilityFloor: built.workOrder.availabilityFloor.ratio,
        allowedSubstitutions: built.workOrder.allowedSubstitutions,
        observationIds: built.workOrder.diagnosis.observationIds,
        contentDigest: built.workOrder.contentDigest,
        schemaVersion: built.workOrder.schemaVersion,
        modelVersion: built.workOrder.modelVersion,
      }),
    }),
  );
  return { ok: true, workOrder: built.workOrder };
}

/**
 * Revise a work order (append revision+1) and emit a
 * `maintenance.workorder.revised` audit record to the sink. Pure
 * except for the audit emission. The prior revision is never
 * rewritten — the new revision cites the prior via `supersedes`.
 *
 * The `at` and `correlationId` come from `options`; the rest of the
 * overrides come from `overrides`. The boundary merges them before
 * calling `buildServiceWorkOrderRevision`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param prior the prior revision (must be the latest)
 * @param overrides the revision overrides (at/correlationId from options)
 * @param options the injected options
 * @returns the tagged write result
 */
export function reviseServiceWorkOrder(
  scope: MaintenanceTenantScope,
  prior: ServiceWorkOrder,
  overrides: ReviseServiceWorkOrderOverrides,
  options: ServiceWorkOrderOptions,
): ServiceWorkOrderWrite {
  const guard = checkMaintenanceTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.workOrderStoreDomain,
        `service work order boundary refused access (${guard.reason}: ${guard.detail})`,
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? MAINTENANCE_PIPELINE_CORRELATION_ID,
        },
        "maintenance.workorder.boundary",
        guard.reason,
      ),
    };
  }
  if (prior.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.workOrderStoreDomain,
        "service work order tenant does not match the acting tenant scope",
        {
          tenantId: guard.tenantId,
          correlationId: options.correlationId ?? MAINTENANCE_PIPELINE_CORRELATION_ID,
        },
        "maintenance.workorder.revise",
        "tenant_mismatch",
      ),
    };
  }
  const built = buildServiceWorkOrderRevision(prior, {
    ...overrides,
    at: options.at,
    correlationId: options.correlationId,
  });
  if (!built.ok) return built;
  const sink: MaintenanceAuditSink = options.auditSink ?? NOOP_MAINTENANCE_AUDIT_SINK;
  sink.append(
    frozen({
      action: MAINTENANCE_AUDIT_ACTIONS.workOrderRevised,
      tenantId: guard.tenantId,
      subject: prior.workOrderId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      causationId: options.causationId,
      details: frozen({
        workOrderId: prior.workOrderId,
        revision: built.workOrder.revision,
        supersedes: prior.workOrderId,
        priorRevision: prior.revision,
        serviceArea: built.workOrder.serviceArea,
        deadline: built.workOrder.deadline,
        serviceCategory: built.workOrder.serviceCategory,
        hasReplacementLink: built.workOrder.replacementLink !== undefined,
        contentDigest: built.workOrder.contentDigest,
      }),
    }),
  );
  return { ok: true, workOrder: built.workOrder };
}
