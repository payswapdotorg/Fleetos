/**
 * @fleetos/device-model — D1: Device identity, ownership, and the device
 * lifecycle state machine.
 *
 * The canonical durable object is the Fleet Device Twin
 * (`spec/ARCHITECTURE.md` § Canonical model). This module owns the twin's
 * IDENTITY section: the enrollment record, the tenant-scoped device
 * identity (DeviceId from @fleetos/contracts), the ownership assignment
 * with provenance (`spec/data/DEVICE-TWIN.md` § Identity: device ID,
 * tenant ID, ownership type, assigned person/team, manufacturer, model and
 * asset/serial references), and the device lifecycle state machine
 * (ENROLL -> OBSERVE -> ASSESS -> DIAGNOSE -> PLAN -> AUTHORIZE -> EXECUTE
 * -> VERIFY -> LEARN) as a PURE transition function with
 * illegal-transition rejection.
 *
 * The transition table itself is FROZEN in `@fleetos/contracts`
 * (`DEVICE_LIFECYCLE_TRANSITIONS`); this module wraps it with FleetError
 * taxonomy mapping so callers get a typed rejection, never a throw.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  ENROLL,
  LEARN,
  OBSERVE,
  canTransitionDevice,
  validateTenantRef,
} from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  DeviceLifecycleState,
  DeviceId,
  DomainError,
  EvidenceRef,
  TenantId,
  UserId,
  ValidationError,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Ownership (spec/ARCHITECTURE.md § Mission: "A device may be
// customer-owned, leased, purchased through Fleet, or supplied by a third
// party.")
// ---------------------------------------------------------------------------

export const OWNERSHIP_TYPE_CUSTOMER_OWNED = "CUSTOMER_OWNED" as const;
export const OWNERSHIP_TYPE_LEASED = "LEASED" as const;
export const OWNERSHIP_TYPE_FLEET_PURCHASED = "FLEET_PURCHASED" as const;
export const OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED = "THIRD_PARTY_SUPPLIED" as const;

/**
 * How the device entered the fleet. The four types are verbatim from
 * `spec/ARCHITECTURE.md` § Mission. BYOD devices enter as
 * CUSTOMER_OWNED (per `spec/ARCHITECTURE-LOCK.md` item 15, BYOD and
 * corporate-owned scopes are distinct — the privacy/policy refinement is
 * owned by later waves).
 */
export type OwnershipType =
  | typeof OWNERSHIP_TYPE_CUSTOMER_OWNED
  | typeof OWNERSHIP_TYPE_LEASED
  | typeof OWNERSHIP_TYPE_FLEET_PURCHASED
  | typeof OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED;

const ALL_OWNERSHIP_TYPES: readonly OwnershipType[] = Object.freeze([
  OWNERSHIP_TYPE_CUSTOMER_OWNED,
  OWNERSHIP_TYPE_LEASED,
  OWNERSHIP_TYPE_FLEET_PURCHASED,
  OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED,
]);

/** Type guard: is the string one of the four canonical ownership types? */
export function isOwnershipType(value: string): value is OwnershipType {
  return (ALL_OWNERSHIP_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Provenance primitives (shared by D1 records and D2 revisions)
// ---------------------------------------------------------------------------

/**
 * Who or what caused a device-model mutation, and the evidence supporting
 * it. Every mutation of a Device Twin carries provenance
 * (`spec/ARCHITECTURE.md` § Canonical model: "evidence/provenance").
 */
export type ActorRef =
  | { readonly kind: "system" }
  | { readonly kind: "user"; readonly userId: UserId };

/** The system actor (used when a mutation has no human principal). */
export const SYSTEM_ACTOR: ActorRef = frozen({ kind: "system" }) as ActorRef;

/**
 * Provenance for a mutation: correlation/causation ids threading the
 * mutation into the causal graph, the acting principal, and evidence
 * references.
 */
export interface MutationProvenance {
  /** Correlation id of the causal graph this mutation belongs to. */
  readonly correlationId: CorrelationId;
  /** Immediate cause (a command or event id), if any. */
  readonly causationId?: CausationId;
  /** The acting principal. Defaults to the system actor. */
  readonly actor?: ActorRef;
  /** Human-readable reason for the mutation. */
  readonly reason?: string;
  /** Evidence artifacts supporting the mutation. */
  readonly evidence?: readonly EvidenceRef[];
}

/**
 * Provenance plus the injected mutation timestamp. `at` is supplied by the
 * caller — the device-model never reads the clock (determinism contract).
 */
export interface MutationContext extends MutationProvenance {
  /** ISO 8601 timestamp of the mutation (injected, never clock-read). */
  readonly at: string;
}

/** Materialize the actor (default: system) for storage in a record. */
function actorOf(provenance: MutationProvenance): ActorRef {
  return provenance.actor ?? SYSTEM_ACTOR;
}

// ---------------------------------------------------------------------------
// Enrollment + hardware identity
// ---------------------------------------------------------------------------

/**
 * Hardware identity claims recorded at enrollment
 * (`spec/data/DEVICE-TWIN.md` § Identity: manufacturer, model and
 * asset/serial references).
 */
export interface DeviceHardwareIdentity {
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber?: string;
  readonly assetTag?: string;
}

/**
 * The enrollment record: the durable proof that a device was enrolled
 * into a tenant's fleet, with full provenance. Immutable once recorded.
 */
export interface DeviceEnrollmentRecord {
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The enrolled device. */
  readonly deviceId: DeviceId;
  /** ISO 8601 enrollment timestamp (injected at enrollment time). */
  readonly enrolledAt: string;
  /** Adapter family that performed enrollment (e.g. "windows", "macos"). */
  readonly adapterFamily: string;
  /** Hardware identity claims. */
  readonly hardware: DeviceHardwareIdentity;
  /** Provenance of the enrollment action. */
  readonly provenance: StoredProvenance;
}

/**
 * Provenance as stored on a durable record: the optional actor is
 * materialized to the system actor so every record is explicit.
 */
export interface StoredProvenance {
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly actor: ActorRef;
  readonly reason?: string;
  readonly evidence: readonly EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Ownership assignment
// ---------------------------------------------------------------------------

/** Input for an ownership assignment (validated before storage). */
export interface OwnershipAssignmentInput {
  readonly ownerType: OwnershipType;
  /** Assigned person (optional — shared pool devices have none). */
  readonly assignedUserId?: UserId;
  /** Assigned team label (optional, free-form). */
  readonly assignedTeam?: string;
}

/**
 * The ownership assignment sub-record: ownership type, assignee, and the
 * provenance of the assignment.
 */
export interface OwnershipAssignment {
  readonly ownerType: OwnershipType;
  readonly assignedUserId?: UserId;
  readonly assignedTeam?: string;
  /** ISO 8601 assignment timestamp (injected). */
  readonly assignedAt: string;
  /** Provenance of the assignment. */
  readonly provenance: StoredProvenance;
}

// ---------------------------------------------------------------------------
// Device identity aggregate (the twin's identity section)
// ---------------------------------------------------------------------------

/**
 * The tenant-scoped device identity: enrollment + current ownership +
 * current lifecycle state. This is the D1 aggregate; the Device Twin
 * (D2) embeds it as its identity section.
 */
export interface DeviceIdentity {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** Current lifecycle state (starts at ENROLL). */
  readonly lifecycleState: DeviceLifecycleState;
  readonly enrolledAt: string;
  readonly enrollment: DeviceEnrollmentRecord;
  readonly ownership: OwnershipAssignment;
}

/** Inputs to `enrollDevice`. */
export interface EnrollDeviceInput {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily: string;
  readonly hardware: DeviceHardwareIdentity;
  /** Initial ownership assignment. */
  readonly ownership: OwnershipAssignmentInput;
  /** Injected enrollment timestamp (ISO 8601). */
  readonly at: string;
  /** Provenance of the enrollment. */
  readonly provenance: MutationProvenance;
}

export type EnrollDeviceResult =
  | { ok: true; identity: DeviceIdentity }
  | { ok: false; error: ValidationError };

/**
 * Enroll a device into a tenant's fleet. Pure: validates the input and
 * returns a frozen `DeviceIdentity` in the ENROLL lifecycle state, or a
 * `ValidationError` mapped onto the FleetError taxonomy. The same input
 * always produces the same identity (determinism contract).
 */
export function enrollDevice(input: EnrollDeviceInput): EnrollDeviceResult {
  const failures: { path: string; reason: string }[] = [];

  const tenantCheck = validateTenantRef(input.tenantId);
  if (!tenantCheck.ok) {
    failures.push({ path: "/tenantId", reason: tenantCheck.reason });
  }
  if (typeof input.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof input.adapterFamily !== "string" || input.adapterFamily.length === 0) {
    failures.push({ path: "/adapterFamily", reason: "required" });
  }
  if (!input.hardware || typeof input.hardware.manufacturer !== "string" || input.hardware.manufacturer.length === 0) {
    failures.push({ path: "/hardware/manufacturer", reason: "required" });
  }
  if (!input.hardware || typeof input.hardware.model !== "string" || input.hardware.model.length === 0) {
    failures.push({ path: "/hardware/model", reason: "required" });
  }
  if (typeof input.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input.provenance?.correlationId !== "string" || input.provenance.correlationId.length === 0) {
    failures.push({ path: "/provenance/correlationId", reason: "required" });
  }
  if (!isOwnershipType(input.ownership?.ownerType ?? "")) {
    failures.push({ path: "/ownership/ownerType", reason: "unknown_ownership_type" });
  }

  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.identityInvalid,
        "device enrollment input is invalid",
        {
          tenantId: input.tenantId,
          correlationId: input.provenance?.correlationId ?? ("" as CorrelationId),
        },
        failures,
      ),
    };
  }

  const stored: StoredProvenance = frozen({
    correlationId: input.provenance.correlationId,
    causationId: input.provenance.causationId,
    actor: actorOf(input.provenance),
    reason: input.provenance.reason,
    evidence: frozenArray(input.provenance.evidence ?? []),
  });

  const enrollment: DeviceEnrollmentRecord = frozen({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    enrolledAt: input.at,
    adapterFamily: input.adapterFamily,
    hardware: frozen({
      manufacturer: input.hardware.manufacturer,
      model: input.hardware.model,
      serialNumber: input.hardware.serialNumber,
      assetTag: input.hardware.assetTag,
    }),
    provenance: stored,
  });

  const ownership: OwnershipAssignment = frozen({
    ownerType: input.ownership.ownerType,
    assignedUserId: input.ownership.assignedUserId,
    assignedTeam: input.ownership.assignedTeam,
    assignedAt: input.at,
    provenance: stored,
  });

  const identity: DeviceIdentity = frozen({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    lifecycleState: ENROLL,
    enrolledAt: input.at,
    enrollment,
    ownership,
  });

  return { ok: true, identity };
}

export type OwnershipAssignmentResult =
  | { ok: true; identity: DeviceIdentity }
  | { ok: false; error: ValidationError };

/**
 * Assign (or reassign) ownership of a device. Pure: returns a NEW
 * `DeviceIdentity` with the updated ownership sub-record; the input
 * identity is never modified. The ownership assignment carries its own
 * provenance and timestamp.
 */
export function assignDeviceOwnership(
  identity: DeviceIdentity,
  assignment: OwnershipAssignmentInput,
  ctx: MutationContext,
): OwnershipAssignmentResult {
  const failures: { path: string; reason: string }[] = [];
  if (!isOwnershipType(assignment?.ownerType ?? "")) {
    failures.push({ path: "/assignment/ownerType", reason: "unknown_ownership_type" });
  }
  if (typeof ctx?.at !== "string" || !looksLikeIso(ctx.at)) {
    failures.push({ path: "/ctx/at", reason: "not_iso" });
  }
  if (typeof ctx?.correlationId !== "string" || ctx.correlationId.length === 0) {
    failures.push({ path: "/ctx/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.identityInvalid,
        "ownership assignment input is invalid",
        { tenantId: identity.tenantId, correlationId: ctx?.correlationId ?? ("" as CorrelationId) },
        failures,
      ),
    };
  }

  const stored: StoredProvenance = frozen({
    correlationId: ctx.correlationId,
    causationId: ctx.causationId,
    actor: actorOf(ctx),
    reason: ctx.reason,
    evidence: frozenArray(ctx.evidence ?? []),
  });

  const next: DeviceIdentity = frozen({
    ...identity,
    ownership: frozen({
      ownerType: assignment.ownerType,
      assignedUserId: assignment.assignedUserId,
      assignedTeam: assignment.assignedTeam,
      assignedAt: ctx.at,
      provenance: stored,
    }),
  });
  return { ok: true, identity: next };
}

// ---------------------------------------------------------------------------
// Lifecycle state machine (pure transition function)
// ---------------------------------------------------------------------------

/** Traceability needed to reject an illegal transition with a FleetError. */
export interface LifecycleTrace {
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
}

export type LifecycleTransitionResult =
  | { ok: true; from: DeviceLifecycleState; to: DeviceLifecycleState }
  | { ok: false; error: DomainError };

/**
 * The device lifecycle state machine as a pure transition function.
 *
 * The transition table is the FROZEN `DEVICE_LIFECYCLE_TRANSITIONS` from
 * `@fleetos/contracts` (strict linear progression: each non-terminal state
 * transitions only to its successor; LEARN is terminal). This function
 * wraps the frozen predicate with illegal-transition rejection mapped onto
 * the FleetError taxonomy: a `DomainError` with the stable machine code
 * `device.lifecycle.illegal_transition`, domain `device.lifecycle`, and an
 * `invariant` of the form `"<from>-><to>"`.
 *
 * NOTE: the LEARN -> OBSERVE re-entry that closes the control loop is NOT
 * a table transition — per the frozen contracts documentation, "the loop
 * is closed via observation ingestion". See `reenterObservationCycle`.
 */
export function transitionDeviceLifecycle(
  current: DeviceLifecycleState,
  to: DeviceLifecycleState,
  trace: LifecycleTrace,
): LifecycleTransitionResult {
  if (canTransitionDevice(current, to)) {
    return { ok: true, from: current, to };
  }
  return {
    ok: false,
    error: makeDomainError(
      ERROR_CODES.lifecycleIllegalTransition,
      `illegal device lifecycle transition: ${current} -> ${to}`,
      trace,
      "device.lifecycle",
      `transition:${current}->${to}`,
    ),
  };
}

/**
 * The observation-cycle re-entry: a device that has LEARNED re-enters
 * OBSERVE when the next observation cycle is ingested. This is the
 * documented loop-closure of the frozen contracts lifecycle table (LEARN
 * has no outgoing table transitions; the loop is closed via observation
 * ingestion, per the `DEVICE_LIFECYCLE_TRANSITIONS` doc comment in
 * `@fleetos/contracts`). For every non-LEARN state this is the identity
 * function.
 */
export function reenterObservationCycle(state: DeviceLifecycleState): DeviceLifecycleState {
  return state === LEARN ? OBSERVE : state;
}
