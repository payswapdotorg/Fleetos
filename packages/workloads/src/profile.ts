/**
 * @fleetos/workloads — D1: the WorkloadProfile domain model.
 *
 * "A Workload Profile describes what a role/process requires." —
 * `spec/ARCHITECTURE.md` § Workload Intelligence. The profile carries:
 *
 *   - role/process identity (`subjectKind`, `name`, `description`);
 *   - the comparable requirement vector (D2);
 *   - the hard constraints (D2);
 *   - the informational observed factors that are not comparable
 *     (working hours);
 *   - evidence links to the observations that informed the revision;
 *   - tenant scoping (`TenantScoped` from the frozen contracts) and a
 *     deterministic content hash binding the full revision content.
 *
 * Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md`
 * item 3): a profile REVISION is immutable. Creating a profile writes
 * revision 1; every update appends a NEW frozen revision
 * (revision = prior + 1) with a fresh content hash — the prior revision
 * is never rewritten. `buildWorkloadProfile` / `reviseWorkloadProfile`
 * are pure builders (the store in `store.ts` owns persistence and tenant
 * isolation; the audit emission lives at the service boundary).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import { asWorkloadId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { WorkloadConstraints } from "./constraints";
import type { RequirementVector } from "./requirement-vector";
import { validateRequirementVector } from "./requirement-vector";
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

/** The workload-profile schema version (>= 1, monotonically increasing). */
export const WORKLOAD_PROFILE_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Whether the workload subject is a human role or an automated process. */
export type WorkloadSubjectKind = "role" | "process";

/**
 * The informational working-hours record (the spec's "working hours"
 * observed factor). Informational on the profile: it is consumed by later
 * waves (connectivity windows, maintenance scheduling), not by the
 * candidate fit checks — the comparable proxy (downtime sensitivity)
 * lives on the vector.
 */
export interface WorkingHours {
  /** Local-time start hour, 0-23. */
  readonly startHour: number;
  /** Local-time end hour, 0-23 (exclusive; 24 expresses "to midnight"). */
  readonly endHour: number;
}

/**
 * An evidence link: the observation that informed a profile revision.
 * The observation id is a string (the frozen `ObservationId` is a branded
 * string; the link stores it as-is).
 */
export interface RequirementEvidence {
  readonly observationId: string;
  /** The source observation kind (context for auditors). */
  readonly kind?: string;
  /** Free-form note (JSON-serializable context). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/**
 * A Workload Profile: what one role/process requires, at one immutable
 * revision. Frozen at construction; updates create new revisions.
 */
export interface WorkloadProfile extends TenantScoped {
  /** The workload this profile describes (stable across revisions). */
  readonly workloadId: WorkloadId;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Role or process. */
  readonly subjectKind: WorkloadSubjectKind;
  /** Stable machine name (e.g. "finance.analyst"). */
  readonly name: string;
  /** The requirement description (human-readable). */
  readonly description: string;
  /** 1-based revision. Immutable once written; updates append revision+1. */
  readonly revision: number;
  /** The comparable requirement vector (D2). */
  readonly requirements: RequirementVector;
  /** The hard constraints (D2). */
  readonly constraints: WorkloadConstraints;
  /** Informational working hours (not a fit-check constraint). */
  readonly workingHours?: WorkingHours;
  /** Evidence links to the observations that informed THIS revision. */
  readonly evidence: readonly RequirementEvidence[];
  /** Injected revision-creation timestamp. */
  readonly createdAt: string;
  /**
   * Deterministic content hash: fnv1a32 over the canonical JSON of the
   * full revision content (identity + requirements + constraints +
   * working hours + evidence + createdAt). Binds the revision content;
   * never used for security.
   */
  readonly contentHash: string;
  /** The profile payload schema version. */
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The input of a profile creation (revision 1). */
export interface CreateWorkloadProfileInput {
  /** Explicit workload id; derived deterministically when absent. */
  readonly workloadId?: WorkloadId;
  readonly subjectKind: WorkloadSubjectKind;
  readonly name: string;
  readonly description: string;
  readonly requirements: RequirementVector;
  /** Defaults to an empty constraint set. */
  readonly constraints?: WorkloadConstraints;
  readonly workingHours?: WorkingHours;
  /** Defaults to an empty evidence list. */
  readonly evidence?: readonly RequirementEvidence[];
  /** Injected creation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph (also stamped on errors). */
  readonly correlationId: CorrelationId;
}

/** The input of a profile revision (revision = prior + 1). */
export interface ReviseWorkloadProfileInput {
  readonly name: string;
  readonly description: string;
  readonly requirements: RequirementVector;
  readonly constraints?: WorkloadConstraints;
  readonly workingHours?: WorkingHours;
  readonly evidence?: readonly RequirementEvidence[];
  /** Injected revision timestamp. */
  readonly at: string;
  readonly correlationId: CorrelationId;
}

/** The tagged result of a pure profile build. */
export type ProfileBuildResult =
  | { readonly ok: true; readonly profile: WorkloadProfile }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate the shared payload fields; returns the failure list (empty = ok). */
function validatePayloadFields(
  input: CreateWorkloadProfileInput,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.name !== "string" || input.name.length === 0 || input.name.length > 200) {
    failures.push({ path: "/name", reason: "required_1_200_chars" });
  }
  if (
    typeof input?.description !== "string" ||
    input.description.length === 0 ||
    input.description.length > 2000
  ) {
    failures.push({ path: "/description", reason: "required_1_2000_chars" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.requirements === undefined || input?.requirements === null) {
    failures.push({ path: "/requirements", reason: "required" });
  } else {
    const vectorCheck = validateRequirementVector(input.requirements);
    if (!vectorCheck.ok) {
      for (const failure of vectorCheck.failures) {
        failures.push({ path: `/requirements/${failure.dimension}`, reason: failure.reason });
      }
    }
  }
  if (input?.workingHours !== undefined) {
    const hours = input.workingHours;
    if (
      typeof hours.startHour !== "number" ||
      !Number.isInteger(hours.startHour) ||
      hours.startHour < 0 ||
      hours.startHour > 23
    ) {
      failures.push({ path: "/workingHours/startHour", reason: "not_hour_0_23" });
    }
    if (
      typeof hours.endHour !== "number" ||
      !Number.isInteger(hours.endHour) ||
      hours.endHour < 1 ||
      hours.endHour > 24
    ) {
      failures.push({ path: "/workingHours/endHour", reason: "not_hour_1_24" });
    }
  }
  if (input?.evidence !== undefined && !Array.isArray(input.evidence)) {
    failures.push({ path: "/evidence", reason: "not_array" });
  } else if (input?.evidence !== undefined) {
    for (let i = 0; i < input.evidence.length; i++) {
      const item = input.evidence[i];
      if (item === undefined || typeof item.observationId !== "string" || item.observationId.length === 0) {
        failures.push({ path: `/evidence/${i}/observationId`, reason: "required" });
      }
    }
  }
  return failures;
}

/** Deterministically derive a workload id from the identity tuple. */
function deriveWorkloadId(tenantId: TenantId, subjectKind: WorkloadSubjectKind, name: string): WorkloadId {
  return asWorkloadId(
    `wl_${fnv1a32Hex(canonicalJson({ tenantId: tenantId as string, subjectKind, name }))}`,
  );
}

/** Compute the deterministic content hash of a revision's content. */
function computeProfileContentHash(content: Omit<WorkloadProfile, "contentHash">): string {
  return fnv1a32Hex(
    canonicalJson({
      workloadId: content.workloadId as string,
      tenantId: content.tenantId as string,
      subjectKind: content.subjectKind,
      name: content.name,
      description: content.description,
      revision: content.revision,
      requirements: content.requirements,
      constraints: content.constraints,
      workingHours: content.workingHours,
      evidence: content.evidence,
      createdAt: content.createdAt,
      schemaVersion: content.schemaVersion,
    }),
  );
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

/**
 * Build revision 1 of a workload profile. Pure and deterministic: the
 * same inputs produce the byte-identical frozen profile (including the
 * derived workload id and content hash). The tenant scope comes from the
 * acting context (the store passes it); it is stamped onto the profile.
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param input the creation input
 * @returns the tagged build result
 */
export function buildWorkloadProfile(
  tenantId: TenantId,
  input: CreateWorkloadProfileInput,
): ProfileBuildResult {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    // Context-free violation: the error projection carries the synthetic
    // system tenant (the W012 convention — never a store key), while the
    // provided correlation id, when present, is preserved.
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.profileInvalid,
        "workload profile request is invalid",
        { tenantId: SYNTHETIC_SYSTEM_TENANT_ID, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  if (input?.subjectKind !== "role" && input?.subjectKind !== "process") {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.profileInvalid,
        "workload profile request is invalid",
        { tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/subjectKind", reason: "must_be_role_or_process" }],
      ),
    };
  }
  const failures = validatePayloadFields(input);
  if (input?.workloadId !== undefined && (typeof input.workloadId !== "string" || input.workloadId.length === 0)) {
    failures.push({ path: "/workloadId", reason: "required_non_empty" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.profileInvalid,
        "workload profile request is invalid",
        { tenantId, correlationId: input.correlationId },
        failures,
      ),
    };
  }

  const workloadId = input.workloadId ?? deriveWorkloadId(tenantId, input.subjectKind, input.name);
  const content: Omit<WorkloadProfile, "contentHash"> = frozen({
    workloadId,
    tenantId,
    subjectKind: input.subjectKind,
    name: input.name,
    description: input.description,
    revision: 1,
    requirements: frozen(input.requirements),
    constraints: frozen(input.constraints ?? {}),
    ...(input.workingHours !== undefined ? { workingHours: frozen(input.workingHours) } : {}),
    evidence: frozenArray(input.evidence ?? []),
    createdAt: input.at,
    schemaVersion: WORKLOAD_PROFILE_SCHEMA_VERSION,
  });
  return { ok: true, profile: frozen({ ...content, contentHash: computeProfileContentHash(content) }) };
}

/**
 * Build the NEXT revision of an existing profile (revision = prior + 1).
 * Pure: the prior revision is never modified; the result is a NEW frozen
 * record with a fresh content hash. The workload id, tenant, and subject
 * kind are inherited — `subjectKind` is immutable across revisions (a
 * role that becomes a process is a different workload).
 *
 * @param prior the current (latest) revision
 * @param input the revision input
 * @returns the tagged build result
 */
export function reviseWorkloadProfile(
  prior: WorkloadProfile,
  input: ReviseWorkloadProfileInput,
): ProfileBuildResult {
  const failures = validatePayloadFields({
    subjectKind: prior.subjectKind,
    ...input,
  });
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.profileInvalid,
        "workload profile revision is invalid",
        { tenantId: prior.tenantId, correlationId: input.correlationId },
        failures,
      ),
    };
  }

  const content: Omit<WorkloadProfile, "contentHash"> = frozen({
    workloadId: prior.workloadId,
    tenantId: prior.tenantId,
    subjectKind: prior.subjectKind,
    name: input.name,
    description: input.description,
    revision: prior.revision + 1,
    requirements: frozen(input.requirements),
    constraints: frozen(input.constraints ?? {}),
    ...(input.workingHours !== undefined ? { workingHours: frozen(input.workingHours) } : {}),
    evidence: frozenArray(input.evidence ?? []),
    createdAt: input.at,
    schemaVersion: WORKLOAD_PROFILE_SCHEMA_VERSION,
  });
  return { ok: true, profile: frozen({ ...content, contentHash: computeProfileContentHash(content) }) };
}

/** Sentinel used when an error must be projected without a request context. */
export const WORKLOADS_PIPELINE_CORRELATION_ID: CorrelationId = SYNTHETIC_SYSTEM_CORRELATION_ID;
