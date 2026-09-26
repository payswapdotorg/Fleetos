/**
 * @fleetos/device-model — D2: The Device Twin aggregate.
 *
 * "The canonical durable object is the Fleet Device Twin. It joins
 * identity/ownership, hardware capabilities, telemetry, software/security
 * posture, workload assignment, connectivity capabilities, maintenance
 * history/predictions, policy scope, current actions/recovery state, and
 * evidence/provenance." — `spec/ARCHITECTURE.md` § Canonical model.
 *
 * Every section is a composable, tenant-scoped sub-record. Every mutation
 * produces a NEW aggregate with a new `TwinRevision` and the mutation's
 * correlation id appended to the revision log — history is append-only and
 * NEVER rewritten in place (`spec/ARCHITECTURE-LOCK.md` item 3:
 * observations/events are immutable; item 2: the Device Twin is the
 * canonical durable representation).
 *
 * Sections whose semantics belong to later work items (security posture ->
 * W031, software -> W032, actions -> W041, recovery -> W040) are present
 * as minimal, explicitly-documented seams so the aggregate is complete on
 * day one; their owning waves refine the contents through
 * `updateTwinSection`.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import { LEARN } from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CausationId,
  CorrelationId,
  DeviceLifecycleState,
  DeviceId,
  EvidenceRef,
  FleetError,
  Observation,
  PolicyId,
  TenantId,
  WorkloadId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type {
  ActorRef,
  DeviceEnrollmentRecord,
  DeviceIdentity,
  MutationContext,
  OwnershipAssignment,
  OwnershipAssignmentInput,
  StoredProvenance,
} from "./identity";
import { assignDeviceOwnership, transitionDeviceLifecycle } from "./identity";

// ---------------------------------------------------------------------------
// Section keys + revision log
// ---------------------------------------------------------------------------

/** The ten joined sections of the Device Twin. */
export type TwinSectionKey =
  | "identity"
  | "capabilities"
  | "telemetry"
  | "securityPosture"
  | "software"
  | "workload"
  | "connectivity"
  | "maintenance"
  | "policy"
  | "actions";

/**
 * One entry in the append-only revision log. Every mutation of the twin
 * appends exactly one revision; revision numbers are 1-based and increase
 * by exactly 1 per mutation (no gaps, no rewrites).
 */
export interface TwinRevision {
  /** 1-based, monotonically increasing; increments by exactly 1. */
  readonly revision: number;
  /** ISO 8601 mutation timestamp (injected). */
  readonly at: string;
  /** The section that was mutated. */
  readonly section: TwinSectionKey;
  /** Stable machine name of the mutation (e.g. "lifecycle.transition"). */
  readonly mutation: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly actor: ActorRef;
  readonly reason?: string;
  readonly evidence: readonly EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Section record types
// ---------------------------------------------------------------------------

/** Identity/ownership section (D1 aggregate embedded in the twin). */
export interface TwinIdentitySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly lifecycleState: DeviceLifecycleState;
  readonly enrolledAt: string;
  readonly enrollment: DeviceEnrollmentRecord;
  readonly ownership: OwnershipAssignment;
}

/**
 * Hardware capabilities (`spec/data/DEVICE-TWIN.md` § Capability:
 * CPU/GPU/RAM/storage, ports/peripherals, network interfaces and supported
 * management/security capabilities).
 */
export interface HardwareCapabilities {
  readonly cpu?: string;
  readonly gpu?: string;
  readonly ramBytes?: number;
  readonly storageBytes?: number;
  readonly ports?: readonly string[];
  readonly peripherals?: readonly string[];
  readonly networkInterfaces?: readonly string[];
}

/** Hardware capabilities section, joined with the adapter capability set. */
export interface TwinCapabilitySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** Adapter family (mirrors the enrollment record). */
  readonly adapterFamily: string;
  /** The frozen contracts adapter capability set (explicit support only). */
  readonly adapterCapabilities: AdapterCapabilities;
  readonly hardware: HardwareCapabilities;
}

/**
 * Telemetry section: the bounded latest-observation window plus counters.
 * Telemetry is minimized (`spec/ARCHITECTURE-LOCK.md` item 15): the twin
 * keeps a bounded window of the latest canonical observations, not the
 * full history (the full history is the observation log, owned by the
 * ingestion boundary).
 */
export interface TwinTelemetrySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** ISO 8601 timestamp of the latest admitted observation, if any. */
  readonly lastObservedAt: string | null;
  /** Total number of admitted canonical observations. */
  readonly observationCount: number;
  /** Bounded window of the latest canonical observations. */
  readonly latest: readonly Observation[];
}

/** Maximum number of observations retained in the telemetry window. */
export const MAX_LATEST_OBSERVATIONS = 10;

/**
 * Security posture section. The real posture semantics are owned by
 * `@fleetos/security` (W031, Security Doctor); the twin stores the summary
 * seam. `UNKNOWN` is the pre-assessment value.
 */
export type SecurityPostureSummary = "UNKNOWN" | "HEALTHY" | "AT_RISK" | "COMPROMISED";

export interface TwinSecuritySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly postureSummary: SecurityPostureSummary;
  readonly findingCount: number;
  readonly updatedAt: string | null;
}

/**
 * Software section. Catalog/subscription semantics are owned by
 * `@fleetos/software` (W032); the twin stores the inventory summary seam.
 */
export interface TwinSoftwareSection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly installedCount: number;
  readonly updatedAt: string | null;
}

/** Workload assignment section (`WorkloadId` from contracts). */
export interface TwinWorkloadSection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly assignedWorkloadIds: readonly WorkloadId[];
}

/** Connectivity capabilities section (evidence-derived). */
export interface TwinConnectivitySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly capabilities: readonly string[];
  readonly lastCheckInAt: string | null;
}

/** A maintenance history entry with provenance. */
export interface MaintenanceHistoryEntry {
  readonly summary: string;
  readonly at: string;
  readonly provenance: StoredProvenance;
}

/**
 * A versioned interpretation attached to the twin: diagnoses, predictions,
 * recommendations, risks (`spec/data/DEVICE-TWIN.md` § Interpretation:
 * "versioned with capability version, evidence references, confidence,
 * generated time and supersession"). Reality is represented by
 * observations; interpretations are versioned and supersede explicitly.
 */
export interface TwinInterpretation {
  /** Stable interpretation identifier. */
  readonly id: string;
  /** Producing module (e.g. "@fleetos/health"). */
  readonly source: string;
  /** Interpretation kind (e.g. "diagnosis", "prediction", "recommendation", "risk"). */
  readonly kind: string;
  /** Schema version of `data` (>= 1). */
  readonly schemaVersion: number;
  /** Kind-specific, JSON-serializable interpretation data. */
  readonly data: unknown;
  /** Confidence in [0, 1], if the source expresses one. */
  readonly confidence?: number;
  /** ISO 8601 generation timestamp. */
  readonly generatedAt: string;
  /** Evidence artifacts the interpretation is derived from. */
  readonly evidence: readonly EvidenceRef[];
  /** Id of the interpretation that supersedes this one, if any. */
  readonly supersededBy?: string;
}

/** Maintenance history/predictions section. */
export interface TwinMaintenanceSection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly history: readonly MaintenanceHistoryEntry[];
  readonly predictions: readonly TwinInterpretation[];
}

/** Policy scope section: Contract Guardian rules in scope for this device. */
export interface TwinPolicySection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly policyIds: readonly PolicyId[];
}

/**
 * Current actions/recovery state. Fleet Actions semantics are owned by
 * `@fleetos/actions` (W041); recovery by `@fleetos/recovery` (W040). The
 * twin stores the active-action references and the recovery state seam.
 */
export type RecoveryState = "NONE" | "ACTIVE";

export interface TwinActionSection {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly activeActionIds: readonly string[];
  readonly recoveryState: RecoveryState;
}

// ---------------------------------------------------------------------------
// The aggregate
// ---------------------------------------------------------------------------

/**
 * The Fleet Device Twin: the canonical durable representation of a managed
 * device. Frozen and immutable — every mutation returns a new aggregate
 * with a new revision (see the mutation functions below).
 */
export interface DeviceTwin {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** Current revision number (mirrors `revisions[revisions.length - 1].revision`). */
  readonly revision: number;
  readonly identity: TwinIdentitySection;
  readonly capabilities: TwinCapabilitySection;
  readonly telemetry: TwinTelemetrySection;
  readonly securityPosture: TwinSecuritySection;
  readonly software: TwinSoftwareSection;
  readonly workload: TwinWorkloadSection;
  readonly connectivity: TwinConnectivitySection;
  readonly maintenance: TwinMaintenanceSection;
  readonly policy: TwinPolicySection;
  readonly actions: TwinActionSection;
  /** Append-only revision log; never rewritten. */
  readonly revisions: readonly TwinRevision[];
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Inputs to `createTwin`. */
export interface CreateTwinInput {
  /** The D1 identity aggregate (from `enrollDevice`). */
  readonly identity: DeviceIdentity;
  /** Initial adapter capabilities (default: none declared). */
  readonly adapterCapabilities?: AdapterCapabilities;
  /** Initial hardware capabilities. */
  readonly hardwareCapabilities?: HardwareCapabilities;
  /** Initial connectivity capabilities. */
  readonly connectivityCapabilities?: readonly string[];
  /** Initial policy scope. */
  readonly policyIds?: readonly PolicyId[];
  /** Creation mutation context (timestamp + provenance). */
  readonly ctx: MutationContext;
}

export type CreateTwinResult =
  | { ok: true; twin: DeviceTwin }
  | { ok: false; error: FleetError };

/**
 * Create a Device Twin from an enrolled device identity. The twin is born
 * at revision 1 with a `twin.created` revision entry. All ten sections are
 * materialized; sections owned by later waves start at their documented
 * default seams. Pure and deterministic.
 */
export function createTwin(input: CreateTwinInput): CreateTwinResult {
  const ctxCheck = validateMutationContext(input?.ctx);
  if (!ctxCheck.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.twinInvalid,
        "twin creation context is invalid",
        { tenantId: input.identity.tenantId, correlationId: input.ctx?.correlationId ?? ("" as CorrelationId) },
        ctxCheck.failures,
      ),
    };
  }

  const identity = input.identity;
  const revision: TwinRevision = frozen({
    revision: 1,
    at: input.ctx.at,
    section: "identity",
    mutation: "twin.created",
    correlationId: input.ctx.correlationId,
    causationId: input.ctx.causationId,
    actor: input.ctx.actor ?? { kind: "system" },
    reason: input.ctx.reason,
    evidence: frozenArray(input.ctx.evidence ?? []),
  });

  const twin: DeviceTwin = frozen({
    tenantId: identity.tenantId,
    deviceId: identity.deviceId,
    revision: 1,
    identity: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      lifecycleState: identity.lifecycleState,
      enrolledAt: identity.enrolledAt,
      enrollment: identity.enrollment,
      ownership: identity.ownership,
    }),
    capabilities: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      adapterFamily: identity.enrollment.adapterFamily,
      adapterCapabilities: frozen({ ...(input.adapterCapabilities ?? {}) }) as AdapterCapabilities,
      hardware: frozen({
        cpu: input.hardwareCapabilities?.cpu,
        gpu: input.hardwareCapabilities?.gpu,
        ramBytes: input.hardwareCapabilities?.ramBytes,
        storageBytes: input.hardwareCapabilities?.storageBytes,
        ports: input.hardwareCapabilities?.ports ? frozenArray(input.hardwareCapabilities.ports) : [],
        peripherals: input.hardwareCapabilities?.peripherals ? frozenArray(input.hardwareCapabilities.peripherals) : [],
        networkInterfaces: input.hardwareCapabilities?.networkInterfaces
          ? frozenArray(input.hardwareCapabilities.networkInterfaces)
          : [],
      }),
    }),
    telemetry: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      lastObservedAt: null,
      observationCount: 0,
      latest: frozenArray([]),
    }),
    securityPosture: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      postureSummary: "UNKNOWN",
      findingCount: 0,
      updatedAt: null,
    }),
    software: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      installedCount: 0,
      updatedAt: null,
    }),
    workload: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      assignedWorkloadIds: frozenArray([]),
    }),
    connectivity: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      capabilities: input.connectivityCapabilities ? frozenArray(input.connectivityCapabilities) : [],
      lastCheckInAt: null,
    }),
    maintenance: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      history: frozenArray([]),
      predictions: frozenArray([]),
    }),
    policy: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      policyIds: input.policyIds ? frozenArray(input.policyIds) : [],
    }),
    actions: frozen({
      tenantId: identity.tenantId,
      deviceId: identity.deviceId,
      activeActionIds: frozenArray([]),
      recoveryState: "NONE",
    }),
    revisions: frozenArray([revision]),
  });

  return { ok: true, twin };
}

// ---------------------------------------------------------------------------
// Mutations (pure: new aggregate + appended revision)
// ---------------------------------------------------------------------------

export type TwinMutationResult =
  | { ok: true; twin: DeviceTwin; revision: TwinRevision }
  | { ok: false; error: FleetError };

function validateMutationContext(
  ctx: MutationContext,
): { ok: true } | { ok: false; failures: { path: string; reason: string }[] } {
  const failures: { path: string; reason: string }[] = [];
  if (typeof ctx?.at !== "string" || !looksLikeIso(ctx.at)) {
    failures.push({ path: "/ctx/at", reason: "not_iso" });
  }
  if (typeof ctx?.correlationId !== "string" || ctx.correlationId.length === 0) {
    failures.push({ path: "/ctx/correlationId", reason: "required" });
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true };
}

/**
 * The mutation core: validates the context, applies the patch to produce
 * the next aggregate, and appends exactly one revision. The input twin is
 * never modified — `next` is a fresh frozen object and the revision log is
 * a new array with the new entry appended.
 */
function applyMutation(
  twin: DeviceTwin,
  section: TwinSectionKey,
  mutation: string,
  ctx: MutationContext,
  patch: (twin: DeviceTwin) => DeviceTwin,
): TwinMutationResult {
  const ctxCheck = validateMutationContext(ctx);
  if (!ctxCheck.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.twinInvalid,
        `mutation context for ${mutation} is invalid`,
        { tenantId: twin.tenantId, correlationId: ctx?.correlationId ?? ("" as CorrelationId) },
        ctxCheck.failures,
      ),
    };
  }

  const revision: TwinRevision = frozen({
    revision: twin.revision + 1,
    at: ctx.at,
    section,
    mutation,
    correlationId: ctx.correlationId,
    causationId: ctx.causationId,
    actor: ctx.actor ?? { kind: "system" },
    reason: ctx.reason,
    evidence: frozenArray(ctx.evidence ?? []),
  });

  const patched = patch(twin);
  const next: DeviceTwin = frozen({
    ...patched,
    tenantId: twin.tenantId,
    deviceId: twin.deviceId,
    revision: revision.revision,
    revisions: frozenArray([...twin.revisions, revision]),
  });
  return { ok: true, twin: next, revision };
}

/**
 * Advance the twin's lifecycle state via the frozen contracts transition
 * table. Illegal transitions (skipping states, going backwards, leaving
 * the terminal LEARN state via the table) are rejected with a DomainError
 * carrying the stable code `device.lifecycle.illegal_transition`.
 *
 * The LEARN -> OBSERVE observation-cycle re-entry is NOT a table
 * transition — use `reenterTwinObservationCycle` (invoked by the
 * observation ingestion boundary).
 */
export function transitionTwinLifecycle(
  twin: DeviceTwin,
  to: DeviceLifecycleState,
  ctx: MutationContext,
): TwinMutationResult {
  const result = transitionDeviceLifecycle(twin.identity.lifecycleState, to, {
    tenantId: twin.tenantId,
    correlationId: ctx?.correlationId ?? ("" as CorrelationId),
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return applyMutation(twin, "identity", "lifecycle.transition", ctx, (current) =>
    frozen({
      ...current,
      identity: frozen({
        ...current.identity,
        lifecycleState: to,
      }),
    }),
  );
}

/**
 * Assign (or reassign) ownership on the twin. Delegates the sub-record
 * semantics to D1's `assignDeviceOwnership` and appends an
 * `ownership.assigned` revision.
 */
export function assignTwinOwnership(
  twin: DeviceTwin,
  assignment: OwnershipAssignmentInput,
  ctx: MutationContext,
): TwinMutationResult {
  const result = assignDeviceOwnership(
    {
      tenantId: twin.tenantId,
      deviceId: twin.deviceId,
      lifecycleState: twin.identity.lifecycleState,
      enrolledAt: twin.identity.enrolledAt,
      enrollment: twin.identity.enrollment,
      ownership: twin.identity.ownership,
    },
    assignment,
    ctx,
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return applyMutation(twin, "identity", "ownership.assigned", ctx, (current) =>
    frozen({
      ...current,
      identity: frozen({
        ...current.identity,
        ownership: result.identity.ownership,
      }),
    }),
  );
}

/**
 * Record canonical observations into the twin's telemetry section:
 * increments the observation counter, advances `lastObservedAt` to the
 * maximum observedAt in the batch, and appends to the bounded latest-
 * observation window (telemetry minimization). Malformed observations are
 * rejected with a ValidationError and the twin is left untouched.
 */
export function recordTwinObservations(
  twin: DeviceTwin,
  observations: readonly Observation[],
  ctx: MutationContext,
): TwinMutationResult {
  const failures: { path: string; reason: string }[] = [];
  if (!Array.isArray(observations) || observations.length === 0) {
    failures.push({ path: "/observations", reason: "empty" });
  } else {
    for (let i = 0; i < observations.length; i++) {
      const obs = observations[i];
      if (!obs || typeof obs.id !== "string" || obs.id.length === 0) {
        failures.push({ path: `/observations/${i}/id`, reason: "required" });
      }
      if (!obs || typeof obs.kind !== "string" || obs.kind.length === 0) {
        failures.push({ path: `/observations/${i}/kind`, reason: "required" });
      }
      if (!obs || typeof obs.observedAt !== "string" || !looksLikeIso(obs.observedAt)) {
        failures.push({ path: `/observations/${i}/observedAt`, reason: "not_iso" });
      }
      if (!obs || typeof obs.schemaVersion !== "number" || obs.schemaVersion < 1) {
        failures.push({ path: `/observations/${i}/schemaVersion`, reason: "must_be_at_least_one" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationsMalformed,
        "observations to record are malformed",
        { tenantId: twin.tenantId, correlationId: ctx?.correlationId ?? ("" as CorrelationId) },
        failures,
      ),
    };
  }

  const maxObservedAt = observations.reduce(
    (max, obs) => (obs.observedAt > max ? obs.observedAt : max),
    twin.telemetry.lastObservedAt ?? "",
  );

  return applyMutation(twin, "telemetry", "observations.recorded", ctx, (current) => {
    const window = [...current.telemetry.latest, ...observations].slice(-MAX_LATEST_OBSERVATIONS);
    return frozen({
      ...current,
      telemetry: frozen({
        ...current.telemetry,
        lastObservedAt: maxObservedAt.length > 0 ? maxObservedAt : null,
        observationCount: current.telemetry.observationCount + observations.length,
        latest: frozenArray(window),
      }),
    });
  });
}

/**
 * The observation-cycle re-entry on the twin: a device that has LEARNED
 * re-enters OBSERVE. Rejected with a DomainError
 * (`device.lifecycle.not_in_learn`) when the twin is not in LEARN — the
 * ingestion boundary only invokes this after admitting observations for a
 * LEARN-state twin.
 */
export function reenterTwinObservationCycle(
  twin: DeviceTwin,
  ctx: MutationContext,
): TwinMutationResult {
  if (twin.identity.lifecycleState !== LEARN) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.lifecycleNotInLearn,
        "observation-cycle re-entry requires lifecycle state LEARN",
        { tenantId: twin.tenantId, correlationId: ctx?.correlationId ?? ("" as CorrelationId) },
        "device.lifecycle",
        "state_is_learn",
      ),
    };
  }
  return applyMutation(twin, "identity", "lifecycle.observation-cycle-reentry", ctx, (current) =>
    frozen({
      ...current,
      identity: frozen({
        ...current.identity,
        lifecycleState: "OBSERVE" as DeviceLifecycleState,
      }),
    }),
  );
}

/**
 * Generic section-update seam for later waves (health W021 writes posture
 * summaries, actions W041 writes the action section, ...). The next
 * section must carry the SAME tenantId and deviceId as the twin —
 * cross-tenant or cross-device sections are rejected with a ValidationError.
 */
export function updateTwinSection<S extends TwinSectionKey>(
  twin: DeviceTwin,
  key: S,
  nextSection: DeviceTwin[S],
  ctx: MutationContext & { readonly mutation: string },
): TwinMutationResult {
  const section = nextSection as unknown as Record<string, unknown> | null;
  const failures: { path: string; reason: string }[] = [];
  if (!section || (section.tenantId as TenantId) !== twin.tenantId) {
    failures.push({ path: `/${key}/tenantId`, reason: "tenant_mismatch" });
  }
  if (!section || (section.deviceId as DeviceId) !== twin.deviceId) {
    failures.push({ path: `/${key}/deviceId`, reason: "device_mismatch" });
  }
  if (typeof ctx?.mutation !== "string" || ctx.mutation.length === 0) {
    failures.push({ path: "/ctx/mutation", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.twinInvalid,
        `section update for ${key} is invalid`,
        { tenantId: twin.tenantId, correlationId: ctx?.correlationId ?? ("" as CorrelationId) },
        failures,
      ),
    };
  }

  return applyMutation(twin, key, ctx.mutation, ctx, (current) =>
    frozen({ ...current, [key]: nextSection } as DeviceTwin),
  );
}

/**
 * Pure read helper: the revision entry with the given number, or undefined.
 * Revisions are 1-based; `revisionAt(twin, 1)` is always the creation entry.
 */
export function revisionAt(twin: DeviceTwin, revision: number): TwinRevision | undefined {
  return twin.revisions.find((entry) => entry.revision === revision);
}
