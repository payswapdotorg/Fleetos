/**
 * @fleetos/contracts — Observation batch / check-in contract.
 *
 * Device agents are untrusted inputs to the control plane
 * (`spec/ARCHITECTURE-LOCK.md` item 5). Observations are immutable events
 * from the device; the control plane ingests them in batches on each
 * check-in (`spec/ARCHITECTURE.md` § Device lifecycle and § Control plane).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, ObservationId, TenantId } from "./ids";
import type { TenantScoped } from "./tenant";

/**
 * The kind of observation. Implemented as an open string union: the
 * canonical FleetOS observation kinds are listed below, but adapters may
 * introduce additional kinds (per `spec/ARCHITECTURE.md` § Device
 * adapters: "Initial adapter families" + future families). The string
 * prefix convention is `<family>.<subject>` — for example,
 * `windows.process.list` or `macos.disk.health`.
 *
 * Modules consuming observations MUST tolerate unknown kinds (forward
 * compatibility). Unknown kinds are NOT errors — they are stored as-is
 * and surfaced for learning (`@fleetos/learning`).
 */
export type ObservationKind =
  | "device.identity"
  | "device.health"
  | "device.security"
  | "device.software"
  | "device.workload"
  | "device.connectivity"
  | "device.location"
  | "device.power"
  | "device.storage"
  | "device.network"
  | "device.peripheral"
  | (string & {}); // open union — additional kinds are valid

/**
 * A single observation record. Immutable. Carries the kind, the
 * observed-at timestamp (ISO 8601), and the JSON-serializable payload.
 */
export interface Observation {
  /** Unique observation identifier (immutable). */
  readonly id: ObservationId;
  /** Observation kind (open union). */
  readonly kind: ObservationKind;
  /** ISO 8601 timestamp of when the observation was made on the device. */
  readonly observedAt: string;
  /** Schema version of the payload (>= 1). */
  readonly schemaVersion: number;
  /** The observation payload (kind-specific; JSON-serializable). */
  readonly payload: unknown;
}

/**
 * A batch of observations, sent by a device agent on check-in. The batch
 * is the atomic unit of ingestion: either the entire batch is durably
 * recorded (with audit evidence) or none of it is.
 *
 * Invariants:
 *   1. `deviceId` is present and non-empty.
 *   2. `observedAt` is an ISO 8601 timestamp.
 *   3. `batches` is a non-empty array.
 *   4. Every observation in `batches` has a non-empty `id`, non-empty
 *      `kind`, valid `observedAt`, and `schemaVersion >= 1`.
 */
export interface ObservationBatch extends TenantScoped {
  /** The device that produced this batch. */
  readonly deviceId: DeviceId;
  /** ISO 8601 timestamp of when the batch was assembled on the device. */
  readonly observedAt: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The observations in this batch. */
  readonly observations: readonly Observation[];
}

// ---------------------------------------------------------------------------
// Invariant validation
// ---------------------------------------------------------------------------

/**
 * The result of an observation-batch invariant check.
 */
export type ObservationBatchValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_device_id"
        | "missing_observed_at"
        | "missing_tenant_id"
        | "empty_batch"
        | "bad_observation"
        | "observed_at_not_iso";
      /** When reason === "bad_observation", the index of the offending observation. */
      index?: number;
    };

/**
 * Pure invariant validator for `ObservationBatch`. Returns a tagged result;
 * does NOT throw.
 *
 * @param batch the batch to validate
 * @returns the validation result
 */
export function validateObservationBatch(batch: ObservationBatch): ObservationBatchValidation {
  if (typeof batch.deviceId !== "string" || batch.deviceId.length === 0) {
    return { ok: false, reason: "missing_device_id" };
  }
  if (typeof batch.observedAt !== "string" || batch.observedAt.length === 0) {
    return { ok: false, reason: "missing_observed_at" };
  }
  if (!/T\d{2}:\d{2}/.test(batch.observedAt)) {
    return { ok: false, reason: "observed_at_not_iso" };
  }
  if (typeof batch.tenantId !== "string" || batch.tenantId.length === 0) {
    return { ok: false, reason: "missing_tenant_id" };
  }
  if (!Array.isArray(batch.observations) || batch.observations.length === 0) {
    return { ok: false, reason: "empty_batch" };
  }
  for (let i = 0; i < batch.observations.length; i++) {
    const obs = batch.observations[i];
    if (
      !obs ||
      typeof obs.id !== "string" ||
      obs.id.length === 0 ||
      typeof obs.kind !== "string" ||
      obs.kind.length === 0 ||
      typeof obs.observedAt !== "string" ||
      obs.observedAt.length === 0 ||
      typeof obs.schemaVersion !== "number" ||
      obs.schemaVersion < 1
    ) {
      return { ok: false, reason: "bad_observation", index: i };
    }
  }
  return { ok: true };
}
