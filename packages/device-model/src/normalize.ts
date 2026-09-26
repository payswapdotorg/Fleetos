/**
 * @fleetos/device-model — D3: Observation normalization pipeline.
 *
 * Device agents are untrusted inputs to the control plane
 * (`spec/ARCHITECTURE-LOCK.md` item 5). Raw adapter observation payloads
 * enter this pipeline and are normalized into CANONICAL observations —
 * the frozen `Observation` shape from `@fleetos/contracts`:
 *
 *   raw adapter batch ──► validate ──► unit seam ──► (deviceId, seq) dedup
 *                     ──► deterministic ids ──► ordering guarantees ──►
 *                     canonical ObservationBatch (contracts shape)
 *
 * Pipeline properties:
 *   - Unit normalization seams: an injectable `UnitNormalizationSeam`
 *     transforms kind-specific payloads (e.g. storage metrics to bytes).
 *     The default seam is the identity; adapters/waves may inject richer
 *     tables without touching this package.
 *   - Duplicate suppression by (deviceId, seq): an injectable
 *     `SequenceTracker` records every admitted (deviceId, seq) pair; a
 *     pair seen twice (within one batch or across batches) is suppressed
 *     and reported, never admitted twice.
 *   - Ordering guarantees: output entries are sorted by (deviceId, seq)
 *     ascending — a deterministic total order regardless of arrival order.
 *     The adapter's `seq` is the ordering authority (not `observedAt`).
 *   - Atomic batch semantics: if ANY raw observation is malformed (or the
 *     unit seam produces a non-serializable payload), the ENTIRE batch is
 *     rejected with a ValidationError mapped onto the FleetError taxonomy
 *     and NOTHING is admitted — the sequence tracker is left untouched
 *     (mirroring the frozen contracts batch invariant: "either the entire
 *     batch is durably recorded or none of it is").
 *   - Determinism: the same raw batch + the same tracker state always
 *     produce the same canonical output, byte for byte.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: observedAt values are data, never generated.
 */

import { asCorrelationId, asDeviceId, asObservationId, asTenantId, validateTenantRef } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  FleetError,
  Observation,
  ObservationBatch,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  isJsonSerializable,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Raw adapter input shapes (device-model lane boundary types)
// ---------------------------------------------------------------------------

/**
 * A raw observation as delivered by a device adapter. Unlike the canonical
 * `Observation` (contracts), the raw form carries the adapter's per-device
 * monotonic `seq` (the dedup + ordering authority) and unbranded
 * identifiers — adapters are untrusted, so nothing is branded until the
 * pipeline has validated it.
 */
export interface RawAdapterObservation {
  /** Unbranded device id (validated against the batch's deviceId). */
  readonly deviceId: string;
  /** Per-device monotonic sequence number (>= 0, integer). */
  readonly seq: number;
  /** Optional explicit observation id; derived from (deviceId, seq) if absent. */
  readonly id?: string;
  /** Observation kind (non-empty; the contracts open string union). */
  readonly kind: string;
  /** ISO 8601 timestamp of when the observation was made on the device. */
  readonly observedAt: string;
  /** Schema version of the payload; defaults to 1. Must be >= 1 if present. */
  readonly schemaVersion?: number;
  /** Raw kind-specific payload; must be JSON-serializable after unit normalization. */
  readonly payload: unknown;
}

/** A raw batch as assembled by the device agent before check-in. */
export interface RawObservationBatch {
  /** Unbranded tenant id; validated against the canonical tenant grammar. */
  readonly tenantId: string;
  /** Unbranded device id. */
  readonly deviceId: string;
  /** ISO 8601 timestamp of when the batch was assembled on the device. */
  readonly observedAt: string;
  /** The raw observations (non-empty). */
  readonly observations: readonly RawAdapterObservation[];
}

// ---------------------------------------------------------------------------
// Synthetic error context (the pipeline has no request context of its own)
// ---------------------------------------------------------------------------

/**
 * Correlation id stamped on pipeline errors when the caller does not
 * supply one. The FleetError contract requires a correlation id on every
 * error; the pipeline is a pure library component with no request
 * context, so a stable synthetic value is used (documented, deterministic).
 */
export const PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId("cor_device_model_pipeline");

/**
 * Tenant id stamped on pipeline errors when the raw batch's tenant id is
 * itself missing/malformed. Mirrors the contracts convention of a
 * synthetic `tnt_system` tenant for system-level errors.
 */
const SYNTHETIC_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");

// ---------------------------------------------------------------------------
// Unit normalization seam
// ---------------------------------------------------------------------------

/**
 * The unit normalization seam: a pure, injectable transform applied to
 * each admitted observation's payload. The seam is invoked with the
 * observation kind so implementations can be kind-specific. The device-
 * model itself ships only the identity implementation plus one reference
 * implementation (storage bytes); richer unit tables belong to the
 * adapter lane / later waves and are injected here.
 */
export interface UnitNormalizationSeam {
  /** Normalize a payload. MUST be pure (same input -> same output). */
  normalizePayload(kind: string, payload: unknown): unknown;
}

/** The default seam: payloads pass through unchanged. */
export const IDENTITY_UNIT_NORMALIZER: UnitNormalizationSeam = frozen({
  normalizePayload: (_kind: string, payload: unknown): unknown => payload,
});

const BYTES_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
});

/**
 * Reference seam implementation: for observation kinds ending in
 * `.storage`, payloads of the shape `{ value: number, unit: "B" | "KB" |
 * "MB" | "GB" | "TB" }` are normalized to the canonical
 * `{ valueBytes: number }` form. All other kinds and payload shapes pass
 * through unchanged. Deterministic; demonstrates the seam contract.
 */
export function createStorageBytesNormalizer(): UnitNormalizationSeam {
  return frozen({
    normalizePayload(kind: string, payload: unknown): unknown {
      if (!kind.endsWith(".storage")) return payload;
      if (payload === null || typeof payload !== "object") return payload;
      const record = payload as Record<string, unknown>;
      const value = record.value;
      const unit = record.unit;
      if (typeof value !== "number" || typeof unit !== "string") return payload;
      const multiplier = BYTES_PER_UNIT[unit];
      if (multiplier === undefined) return payload;
      return frozen({ valueBytes: value * multiplier });
    },
  });
}

// ---------------------------------------------------------------------------
// Duplicate suppression state ((deviceId, seq) tracker)
// ---------------------------------------------------------------------------

/**
 * The duplicate-suppression state: records every admitted (deviceId, seq)
 * pair. `observe` returns true when the pair was ALREADY seen — the
 * pipeline then suppresses the duplicate.
 */
export interface SequenceTracker {
  /** Returns true if (deviceId, seq) was already seen; records it otherwise. */
  observe(deviceId: DeviceId, seq: number): boolean;
}

/** In-memory reference tracker (Map of device -> seen seq set). */
export function createInMemorySequenceTracker(): SequenceTracker {
  const seen = new Map<string, Set<number>>();
  return {
    observe(deviceId: DeviceId, seq: number): boolean {
      const key = deviceId as string;
      let set = seen.get(key);
      if (set === undefined) {
        set = new Set<number>();
        seen.set(key, set);
      }
      if (set.has(seq)) return true;
      set.add(seq);
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline results
// ---------------------------------------------------------------------------

/** A canonical observation plus the raw provenance the pipeline tracked. */
export interface NormalizedObservationEntry {
  /** The canonical contracts observation. */
  readonly observation: Observation;
  readonly deviceId: DeviceId;
  readonly seq: number;
}

/** A suppressed duplicate: the (deviceId, seq) pair already admitted. */
export interface SuppressedDuplicate {
  readonly deviceId: DeviceId;
  readonly seq: number;
}

export type NormalizeBatchResult =
  | {
      ok: true;
      /** Canonical entries, sorted by (deviceId, seq) ascending. */
      readonly entries: readonly NormalizedObservationEntry[];
      /** Duplicates suppressed by (deviceId, seq), sorted by (deviceId, seq). */
      readonly duplicates: readonly SuppressedDuplicate[];
    }
  | { ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Validation (atomic batch rejection)
// ---------------------------------------------------------------------------

function rawTenantForErrors(batch: RawObservationBatch): TenantId {
  return typeof batch?.tenantId === "string" && batch.tenantId.length > 0
    ? asTenantId(batch.tenantId)
    : SYNTHETIC_SYSTEM_TENANT;
}

function validateRawBatch(batch: RawObservationBatch): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];

  const tenantCheck = validateTenantRef(asTenantId(typeof batch?.tenantId === "string" ? batch.tenantId : ""));
  if (!tenantCheck.ok) {
    failures.push({ path: "/tenantId", reason: tenantCheck.reason });
  }
  if (typeof batch?.deviceId !== "string" || batch.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof batch?.observedAt !== "string" || batch.observedAt.length === 0) {
    failures.push({ path: "/observedAt", reason: "required" });
  } else if (!looksLikeIso(batch.observedAt)) {
    failures.push({ path: "/observedAt", reason: "not_iso" });
  }
  if (!Array.isArray(batch?.observations) || batch.observations.length === 0) {
    failures.push({ path: "/observations", reason: "empty" });
    return failures;
  }

  for (let i = 0; i < batch.observations.length; i++) {
    const obs = batch.observations[i];
    if (!obs || typeof obs.deviceId !== "string" || obs.deviceId.length === 0) {
      failures.push({ path: `/observations/${i}/deviceId`, reason: "required" });
    } else if (obs.deviceId !== batch.deviceId) {
      failures.push({ path: `/observations/${i}/deviceId`, reason: "must_match_batch" });
    }
    if (!obs || typeof obs.seq !== "number" || !Number.isInteger(obs.seq) || obs.seq < 0) {
      failures.push({ path: `/observations/${i}/seq`, reason: "must_be_non_negative_integer" });
    }
    if (!obs || typeof obs.kind !== "string" || obs.kind.length === 0) {
      failures.push({ path: `/observations/${i}/kind`, reason: "required" });
    }
    if (!obs || typeof obs.observedAt !== "string" || obs.observedAt.length === 0) {
      failures.push({ path: `/observations/${i}/observedAt`, reason: "required" });
    } else if (!looksLikeIso(obs.observedAt)) {
      failures.push({ path: `/observations/${i}/observedAt`, reason: "not_iso" });
    }
    if (obs && obs.schemaVersion !== undefined) {
      if (typeof obs.schemaVersion !== "number" || !Number.isInteger(obs.schemaVersion) || obs.schemaVersion < 1) {
        failures.push({ path: `/observations/${i}/schemaVersion`, reason: "must_be_at_least_one" });
      }
    }
    if (obs && obs.id !== undefined && (typeof obs.id !== "string" || obs.id.length === 0)) {
      failures.push({ path: `/observations/${i}/id`, reason: "must_be_non_empty" });
    }
    if (!obs || !isJsonSerializable(obs.payload)) {
      failures.push({ path: `/observations/${i}/payload`, reason: "must_be_json_serializable" });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Options for the pipeline / stateful wrapper. */
export interface NormalizePipelineOptions {
  /** Unit normalization seam (default: identity). */
  readonly unitNormalizer?: UnitNormalizationSeam;
  /** Duplicate-suppression state (default: fresh in-memory tracker). */
  readonly sequenceTracker?: SequenceTracker;
  /**
   * Correlation id stamped on pipeline errors (default: the synthetic
   * `PIPELINE_CORRELATION_ID`). Supply the request's correlation id when
   * the pipeline runs inside a traced flow (e.g. the D4 boundary).
   */
  readonly correlationId?: Parameters<typeof asCorrelationId>[0];
}

/**
 * Normalize a raw adapter batch into canonical observations. Deterministic
 * with respect to its inputs and the injected tracker state: the same raw
 * batch + the same tracker state always produce the same result.
 *
 * On ANY malformed raw observation — or a unit-seam output that is not
 * JSON-serializable — the whole batch is rejected with a ValidationError
 * (code `device.observations.malformed`) listing every failure, and the
 * sequence tracker is left untouched (atomic admission: a corrected retry
 * is never masked by partially-recorded sequences).
 */
export function normalizeRawObservationBatch(
  batch: RawObservationBatch,
  options?: NormalizePipelineOptions,
): NormalizeBatchResult {
  const unitNormalizer = options?.unitNormalizer ?? IDENTITY_UNIT_NORMALIZER;
  const tracker = options?.sequenceTracker ?? createInMemorySequenceTracker();
  const errorTenant = rawTenantForErrors(batch);
  const errorCorrelation = options?.correlationId !== undefined ? asCorrelationId(options.correlationId) : PIPELINE_CORRELATION_ID;

  const failures = validateRawBatch(batch);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationsMalformed,
        "raw observation batch is malformed",
        { tenantId: errorTenant, correlationId: errorCorrelation },
        failures,
      ),
    };
  }

  // Pass 1 — unit normalization for EVERY observation. The sequence
  // tracker is deliberately not touched yet: a seam failure must reject
  // the whole batch without recording any sequence (atomicity).
  const normalizedPayloads: unknown[] = [];
  for (let i = 0; i < batch.observations.length; i++) {
    const raw = batch.observations[i];
    const payload = unitNormalizer.normalizePayload(raw.kind, raw.payload);
    if (!isJsonSerializable(payload)) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.observationsMalformed,
          "unit normalization produced a non-serializable payload",
          { tenantId: errorTenant, correlationId: errorCorrelation },
          [{ path: `/observations/${i}/payload`, reason: "must_be_json_serializable" }],
        ),
      };
    }
    normalizedPayloads.push(payload);
  }

  // Pass 2 — duplicate suppression + deterministic id derivation.
  const deviceId = asDeviceId(batch.deviceId);
  const entries: NormalizedObservationEntry[] = [];
  const duplicates: SuppressedDuplicate[] = [];
  for (let i = 0; i < batch.observations.length; i++) {
    const raw = batch.observations[i];
    if (tracker.observe(deviceId, raw.seq)) {
      duplicates.push(frozen({ deviceId, seq: raw.seq }));
      continue;
    }
    const id: ObservationId =
      raw.id !== undefined ? asObservationId(raw.id) : asObservationId(`obs_${batch.deviceId}_${raw.seq}`);
    entries.push(
      frozen({
        observation: frozen({
          id,
          kind: raw.kind,
          observedAt: raw.observedAt,
          schemaVersion: raw.schemaVersion ?? 1,
          payload: normalizedPayloads[i],
        }) as Observation,
        deviceId,
        seq: raw.seq,
      }),
    );
  }

  // Ordering guarantee: deterministic total order by (deviceId, seq).
  const sortedEntries = entries.sort((a, b) =>
    a.deviceId === b.deviceId ? a.seq - b.seq : (a.deviceId as string) < (b.deviceId as string) ? -1 : 1,
  );
  const sortedDuplicates = duplicates.sort((a, b) =>
    a.deviceId === b.deviceId ? a.seq - b.seq : (a.deviceId as string) < (b.deviceId as string) ? -1 : 1,
  );

  return {
    ok: true,
    entries: Object.freeze(sortedEntries),
    duplicates: Object.freeze(sortedDuplicates),
  };
}

/**
 * Convert a raw adapter batch into a canonical contracts `ObservationBatch`
 * (the shape the D4 ingestion boundary accepts). Runs the full pipeline —
 * validation, unit seam, dedup, ordering, deterministic ids — and wraps
 * the canonical observations into the batch shape. The canonical batch
 * contains only NON-duplicate observations; suppressed duplicates are
 * reported alongside.
 */
export function rawBatchToCanonicalBatch(
  batch: RawObservationBatch,
  options?: NormalizePipelineOptions,
):
  | { ok: true; batch: ObservationBatch; duplicates: readonly SuppressedDuplicate[] }
  | { ok: false; error: FleetError } {
  const result = normalizeRawObservationBatch(batch, options);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const canonical: ObservationBatch = frozen({
    deviceId: asDeviceId(batch.deviceId),
    tenantId: asTenantId(batch.tenantId),
    observedAt: batch.observedAt,
    observations: Object.freeze(result.entries.map((entry) => entry.observation)),
  });
  return { ok: true, batch: canonical, duplicates: result.duplicates };
}

// ---------------------------------------------------------------------------
// Stateful pipeline wrapper
// ---------------------------------------------------------------------------

/**
 * A stateful normalization pipeline: holds the sequence tracker (and the
 * unit seam) across batches, so duplicate suppression works ACROSS
 * check-ins — the same (deviceId, seq) posted twice is admitted exactly
 * once.
 */
export interface ObservationNormalizationPipeline {
  /** Normalize one raw batch against the pipeline's tracked state. */
  normalize(batch: RawObservationBatch): NormalizeBatchResult;
}

export function createNormalizationPipeline(options?: NormalizePipelineOptions): ObservationNormalizationPipeline {
  const tracker = options?.sequenceTracker ?? createInMemorySequenceTracker();
  const unitNormalizer = options?.unitNormalizer ?? IDENTITY_UNIT_NORMALIZER;
  return frozen({
    normalize(batch: RawObservationBatch): NormalizeBatchResult {
      return normalizeRawObservationBatch(batch, { sequenceTracker: tracker, unitNormalizer });
    },
  });
}
