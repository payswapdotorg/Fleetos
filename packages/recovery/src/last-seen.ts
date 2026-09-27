/**
 * @fleetos/recovery — D1: last-seen evidence + Find My Device.
 *
 * A deterministic last-seen ledger per device, derived from canonical
 * observation batches (the FROZEN `@fleetos/contracts`
 * `Observation`/`ObservationBatch` shapes — the `recovery -> devices`
 * module-map edge honored via the frozen contracts shapes only; the
 * recovery lane never imports `@fleetos/device-model`, worker-b's lane).
 *
 * Determinism guarantees (proven by test):
 *   - every last-seen record carries source evidence refs (the
 *     observation ids of the latest evidence), an injected timestamp
 *     (`recordedAt`) and a derived staleness classification
 *     (fresh/stale/unknown against INJECTED thresholds — no clock reads);
 *   - records are append-only and versioned: a new derivation appends
 *     revision prior+1 and NEVER rewrites a prior record
 *     (versioned-interpretation discipline, ARCHITECTURE-LOCK item 3);
 *   - record ids and content digests are deterministic (FNV-1a over
 *     canonical JSON — never for security);
 *   - re-derivation from the same observations with the same injected
 *     `at` + thresholds is byte-identical, regardless of observation
 *     input order (evidence sets are sorted by observation id);
 *   - the CURRENT last-seen view (`resolveLastSeen`) is DERIVED, never
 *     stored: the record with the greatest `observedAt` (ties broken by
 *     the greater version) — out-of-order arrivals append records without
 *     ever regressing the derived view;
 *   - the Find-My-Device view derives the latest location-bearing
 *     evidence per device (kind `device.location`, the canonical frozen
 *     observation kind): the last known location with its evidence ref +
 *     timestamp. Absent location evidence is a machine-stable
 *     `no_location_evidence` state — NEVER a guess, never a synthesized
 *     fix (the privacy boundary W030 established for
 *     geolocation-as-evidence).
 *
 * Staleness semantics (documented judgment call): the classification is
 * a two-sided band test against the injected thresholds
 * {freshWithinMs, staleAfterMs} with freshWithinMs <= staleAfterMs:
 *   - `fresh`   — age (injected at minus observedAt) <= freshWithinMs;
 *   - `stale`   — age > staleAfterMs;
 *   - `unknown` — the indeterminate band strictly between the
 *     thresholds (evidence that is neither provably fresh nor provably
 *     stale), no evidence at all, or future-dated evidence (clock skew;
 *     age < 0). `unknown` is a machine-stable refusal to guess.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, declared locally
 * because `@fleetos/identity` is worker-c's lane): every operation takes
 * the acting `RecoveryTenantScope` FIRST; the runtime guard rejects
 * context-free/invalid-tenant access even when types are bypassed;
 * storage is partitioned per tenant then per device; a device that
 * exists only in another tenant's partition is indistinguishable from
 * an unknown one.
 *
 * Audit (D5): a last-seen evidence recording (a consequential evidence
 * mutation — the basis every later recovery case cites) emits
 * `recovery.lastseen.recorded` to the injected sink. Pure reads and the
 * derived views never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { validateObservationBatch } from "@fleetos/contracts";
import type { CorrelationId, CausationId, DeviceId, FleetError, Observation, ObservationBatch, ObservationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK, RECOVERY_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  parseIsoMs,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// Staleness classification (pure, injected thresholds)
// ---------------------------------------------------------------------------

/**
 * The derived staleness classification of last-seen evidence. Machine
 * stable; `unknown` is a refusal to guess (see the module doc for the
 * band semantics).
 */
export type LastSeenStaleness = "fresh" | "stale" | "unknown";

/**
 * The injected staleness thresholds. Both bands are caller-injected
 * policy — the recovery package never reads a clock.
 *
 * Invariants: `freshWithinMs >= 0` and `staleAfterMs >= freshWithinMs`.
 */
export interface StalenessThresholds {
  /** Evidence observed within this many milliseconds of `at` is fresh. */
  readonly freshWithinMs: number;
  /** Evidence older than this many milliseconds from `at` is stale. */
  readonly staleAfterMs: number;
}

/** Validate staleness thresholds (returns null on success; failure list otherwise). */
export function validateStalenessThresholds(
  thresholds: unknown,
): { path: string; reason: string }[] | null {
  const failures: { path: string; reason: string }[] = [];
  if (thresholds === null || typeof thresholds !== "object") {
    return [{ path: "/thresholds", reason: "object_required" }];
  }
  const candidate = thresholds as { freshWithinMs?: unknown; staleAfterMs?: unknown };
  if (
    typeof candidate.freshWithinMs !== "number" ||
    !Number.isFinite(candidate.freshWithinMs) ||
    candidate.freshWithinMs < 0
  ) {
    failures.push({ path: "/thresholds/freshWithinMs", reason: "non_negative_finite_number_required" });
  }
  if (
    typeof candidate.staleAfterMs !== "number" ||
    !Number.isFinite(candidate.staleAfterMs) ||
    candidate.staleAfterMs < 0
  ) {
    failures.push({ path: "/thresholds/staleAfterMs", reason: "non_negative_finite_number_required" });
  }
  if (failures.length === 0 && (candidate.staleAfterMs as number) < (candidate.freshWithinMs as number)) {
    failures.push({ path: "/thresholds/staleAfterMs", reason: "must_not_precede_freshWithinMs" });
  }
  return failures.length === 0 ? null : failures;
}

/**
 * Classify the staleness of evidence observed at `observedAt` against
 * the injected `at` + thresholds. PURE. Future-dated evidence
 * (observedAt after `at` — clock skew) classifies as `unknown`: a
 * refusal to guess, never a clamp.
 *
 * @param at the injected reference instant (ISO 8601)
 * @param observedAt the evidence timestamp (ISO 8601)
 * @param thresholds the injected threshold bands
 * @returns the machine-stable classification
 */
export function classifyStaleness(at: string, observedAt: string, thresholds: StalenessThresholds): LastSeenStaleness {
  const atMs = parseIsoMs(at);
  const observedMs = parseIsoMs(observedAt);
  if (Number.isNaN(atMs) || Number.isNaN(observedMs)) return "unknown";
  const age = atMs - observedMs;
  if (age < 0) return "unknown"; // future-dated evidence — never a guess
  if (age <= thresholds.freshWithinMs) return "fresh";
  if (age > thresholds.staleAfterMs) return "stale";
  return "unknown"; // the indeterminate band
}

// ---------------------------------------------------------------------------
// Location-bearing evidence (Find My Device basis)
// ---------------------------------------------------------------------------

/** The canonical frozen observation kind that carries location evidence. */
export const LOCATION_OBSERVATION_KIND = "device.location" as const;

/**
 * One location-bearing observation captured into a last-seen record: the
 * evidence ref (observation id), its timestamp, its kind and its payload
 * VERBATIM (opaque `unknown` — the recovery package never interprets a
 * location payload; it is evidence, per the W030
 * geolocation-as-evidence privacy boundary).
 */
export interface LocationEvidenceFact {
  /** The evidence ref: the immutable observation's id. */
  readonly observationId: ObservationId;
  /** ISO 8601 timestamp carried on the source observation. */
  readonly observedAt: string;
  /** The observation kind (always `device.location` when captured). */
  readonly kind: string;
  /** The observation payload, verbatim and opaque. */
  readonly payload: unknown;
}

/** Is this observation location-bearing? (kind `device.location`, frozen canonical kind.) */
export function isLocationBearing(observation: Observation): boolean {
  return observation.kind === LOCATION_OBSERVATION_KIND;
}

// ---------------------------------------------------------------------------
// The versioned last-seen record
// ---------------------------------------------------------------------------

/**
 * A versioned last-seen record for one device. Append-only: a new
 * derivation appends `version = prior + 1`; a prior record is never
 * rewritten. The record carries the source evidence refs (observation
 * ids), the injected recording timestamp, the derived staleness
 * classification, and — when the input batches carried location
 * evidence — the latest location-bearing observation captured verbatim.
 */
export interface LastSeenRecord extends TenantScoped {
  /** Deterministic record id: `ls_` + fnv1a32(tenantId, deviceId, version). */
  readonly recordId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device the evidence concerns. */
  readonly deviceId: DeviceId;
  /** The append-only revision number (>= 1; prior + 1). */
  readonly version: number;
  /** The last-seen instant: max observation `observedAt` across the input batches. */
  readonly observedAt: string;
  /** The injected recording timestamp (ISO 8601 — no clock reads). */
  readonly recordedAt: string;
  /** The derived staleness classification against the injected thresholds. */
  readonly staleness: LastSeenStaleness;
  /** Source evidence refs: the observation ids at the last-seen instant, sorted by id. */
  readonly evidence: readonly ObservationId[];
  /** The latest location-bearing observation in the input, when present. */
  readonly locationEvidence?: LocationEvidenceFact;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic record id: digest of (tenantId, deviceId, version). */
export function lastSeenRecordId(tenantId: TenantId, deviceId: DeviceId, version: number): string {
  return `ls_${fnv1a32Hex(canonicalJson([tenantId, deviceId, version]))}`;
}

/** The canonical content digest of a last-seen record's content fields. */
export function lastSeenContentDigest(record: Omit<LastSeenRecord, "recordId" | "contentDigest">): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.deviceId,
      record.version,
      record.observedAt,
      record.recordedAt,
      record.staleness,
      record.evidence,
      record.locationEvidence ?? null,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The last-seen ledger (tenant-partitioned, append-only)
// ---------------------------------------------------------------------------

/** The tagged result of a ledger write. */
export type LastSeenLedgerWrite =
  | { readonly ok: true; readonly record: LastSeenRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only last-seen ledger. Every operation takes
 * the acting `RecoveryTenantScope` as its FIRST parameter and touches
 * only the acting tenant's partition. Records are append-only per device
 * (revision `version` slots are never overwritten; out-of-sequence
 * versions are rejected).
 */
export interface LastSeenLedger {
  /** Append a record revision into the ACTING tenant's partition (tenant must match). */
  appendLastSeen(scope: RecoveryTenantScope, record: LastSeenRecord): LastSeenLedgerWrite;
  /** The CURRENT last-seen record for a device (derived: max observedAt, tie -> max version). */
  resolveLastSeen(scope: RecoveryTenantScope, deviceId: DeviceId): LastSeenRecord | undefined;
  /** Every revision for a device, version order (own partition only). */
  listLastSeenRevisions(scope: RecoveryTenantScope, deviceId: DeviceId): readonly LastSeenRecord[];
  /** All device ids with evidence in the acting partition (sorted). */
  listDeviceIds(scope: RecoveryTenantScope): readonly DeviceId[];
  /** The number of devices with evidence in the acting partition. */
  size(scope: RecoveryTenantScope): number;
}

/**
 * Create the in-memory reference `LastSeenLedger`. Storage is partitioned
 * by tenant id then by device id; record revisions are append-only per
 * device (the prior is never rewritten).
 *
 * The ledger audits NOTHING: the consequential evidence-recording audit
 * is emitted by the domain boundary function
 * (`recordLastSeenObservations`) through ITS injected sink.
 */
export function createInMemoryLastSeenLedger(): LastSeenLedger {
  /** tenantId -> (deviceId -> LastSeenRecord[]). */
  const partitions = new Map<string, Map<string, LastSeenRecord[]>>();

  function partitionOf(tenantId: string): Map<string, LastSeenRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, LastSeenRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: RecoveryTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkRecoveryTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.lastSeenStoreDomain,
          `last-seen ledger refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
          "recovery.lastseen.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: RecoveryTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendLastSeen(scope: RecoveryTenantScope, record: LastSeenRecord): LastSeenLedgerWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.lastSeenStoreDomain,
            "last-seen record tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "recovery.lastseen.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const key = record.deviceId as string;
      let revisions = partition.get(key);
      if (revisions === undefined) {
        revisions = [];
        partition.set(key, revisions);
      }
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          // Idempotent append of identical content: a no-op.
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.lastSeenStoreDomain,
            "last-seen version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "recovery.lastseen.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.lastSeenStoreDomain,
            `last-seen revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "recovery.lastseen.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    resolveLastSeen(scope: RecoveryTenantScope, deviceId: DeviceId): LastSeenRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(deviceId as string);
      if (revisions === undefined || revisions.length === 0) return undefined;
      // DERIVED current view: greatest observedAt (parsed), ties -> greatest version.
      let current = revisions[0];
      const currentMs = parseIsoMs(current.observedAt);
      for (const candidate of revisions.slice(1)) {
        const candidateMs = parseIsoMs(candidate.observedAt);
        if (
          candidateMs > currentMs ||
          (candidateMs === currentMs && candidate.version > current.version)
        ) {
          current = candidate;
        }
      }
      return current;
    },
    listLastSeenRevisions(scope: RecoveryTenantScope, deviceId: DeviceId): readonly LastSeenRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(deviceId as string);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listDeviceIds(scope: RecoveryTenantScope): readonly DeviceId[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort()) as readonly DeviceId[];
    },
    size(scope: RecoveryTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Derivation from canonical observation batches
// ---------------------------------------------------------------------------

/** Options for `recordLastSeenObservations`. */
export interface RecordLastSeenOptions {
  /** The injected recording instant (ISO 8601) — becomes `recordedAt`. */
  readonly at: string;
  /** The injected staleness thresholds (band policy — no clock reads). */
  readonly thresholds: StalenessThresholds;
  /** The correlation id of the recording request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the recording is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the evidence recording emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** The internal derivation candidate: the latest evidence in the input. */
interface LastSeenCandidate {
  readonly observedAt: string;
  readonly evidence: readonly ObservationId[];
  readonly locationEvidence: LocationEvidenceFact | undefined;
}

/**
 * Derive the last-seen candidate from one device's observation batches.
 * PURE and deterministic:
 *   - `observedAt` is the max observation `observedAt` (epoch ms) across
 *     every batch — the strongest evidence instant;
 *   - `evidence` is the sorted list of observation ids whose `observedAt`
 *     parses to that max instant (input order never matters);
 *   - `locationEvidence` is the latest location-bearing observation
 *     (kind `device.location`), ordered by (observedAt epoch ms, then
 *     observation id) — the last known location with its evidence ref.
 */
function deriveCandidate(batches: readonly ObservationBatch[]): LastSeenCandidate {
  let maxMs = Number.NEGATIVE_INFINITY;
  const atMax: Observation[] = [];
  let location: Observation | undefined;
  let locationMs = Number.NEGATIVE_INFINITY;
  for (const batch of batches) {
    for (const observation of batch.observations) {
      const ms = parseIsoMs(observation.observedAt);
      if (ms > maxMs) {
        maxMs = ms;
        atMax.length = 0;
        atMax.push(observation);
      } else if (ms === maxMs) {
        atMax.push(observation);
      }
      if (isLocationBearing(observation)) {
        if (ms > locationMs || (ms === locationMs && observation.id > (location?.id ?? ""))) {
          locationMs = ms;
          location = observation;
        }
      }
    }
  }
  const observedAt = atMax.length > 0 ? atMax[0].observedAt : batches[0].observedAt;
  const evidence = frozenArray(atMax.map((o) => o.id).sort(compareById));
  const locationEvidence =
    location === undefined
      ? undefined
      : frozen<LocationEvidenceFact>({
          observationId: location.id,
          observedAt: location.observedAt,
          kind: location.kind,
          payload: location.payload,
        });
  return { observedAt, evidence, locationEvidence };
}

function compareById(a: ObservationId, b: ObservationId): number {
  return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
}

/**
 * Record last-seen evidence for one device from canonical observation
 * batches (the FROZEN `ObservationBatch` shape — validated with the
 * frozen `validateObservationBatch`). DETERMINISTIC: the same batches +
 * the same injected `at` + thresholds produce a byte-identical record
 * (pure derivation; evidence sets sorted; no clock reads, no entropy).
 *
 * The derivation appends revision `prior.version + 1` (or 1 when the
 * device has no evidence yet); a prior record is never rewritten.
 * Out-of-order arrivals (older evidence than the current derived view)
 * still append — the DERIVED view (`resolveLastSeen`) keeps pointing at
 * the strongest evidence.
 *
 * Audit: the recording emits `recovery.lastseen.recorded` to the
 * injected sink (a consequential evidence mutation — the basis every
 * later recovery case cites).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param ledger the last-seen ledger to append into
 * @param deviceId the device the evidence concerns
 * @param batches the canonical observation batches (all for this device + tenant)
 * @param options the injected options
 * @returns the tagged write result
 */
export function recordLastSeenObservations(
  scope: RecoveryTenantScope,
  ledger: LastSeenLedger,
  deviceId: DeviceId,
  batches: readonly ObservationBatch[],
  options: RecordLastSeenOptions,
): LastSeenLedgerWrite {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.lastSeenStoreDomain,
        `last-seen ledger refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.lastseen.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (!Array.isArray(batches) || batches.length === 0) {
    failures.push({ path: "/batches", reason: "non_empty_array_required" });
  }
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  const thresholdFailures = validateStalenessThresholds(options?.thresholds);
  if (thresholdFailures !== null) failures.push(...thresholdFailures);
  if (Array.isArray(batches)) {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const validation = validateObservationBatch(batch);
      if (!validation.ok) {
        failures.push({
          path: `/batches/${i}`,
          reason: validation.reason,
        });
        continue;
      }
      if (batch.tenantId !== guard.tenantId) {
        failures.push({ path: `/batches/${i}/tenantId`, reason: "tenant_mismatch" });
      }
      if (batch.deviceId !== deviceId) {
        failures.push({ path: `/batches/${i}/deviceId`, reason: "device_mismatch" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.lastSeenInvalid,
        "last-seen recording request is invalid",
        trace,
        failures,
      ),
    };
  }

  const prior = ledger.resolveLastSeen(scope, deviceId);
  const candidate = deriveCandidate(batches);
  const version = (prior?.version ?? 0) + 1;
  const content: Omit<LastSeenRecord, "recordId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    deviceId,
    version,
    observedAt: candidate.observedAt,
    recordedAt: options.at,
    staleness: classifyStaleness(options.at, candidate.observedAt, options.thresholds),
    evidence: candidate.evidence,
    ...(candidate.locationEvidence !== undefined ? { locationEvidence: candidate.locationEvidence } : {}),
  });
  const record: LastSeenRecord = frozen({
    ...content,
    recordId: lastSeenRecordId(guard.tenantId, deviceId, version),
    contentDigest: lastSeenContentDigest(content),
  });
  const write = ledger.appendLastSeen(scope, record);
  if (!write.ok) return write;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.lastSeenRecorded,
      tenantId: guard.tenantId,
      subject: deviceId as string,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        deviceId: deviceId as string,
        recordId: record.recordId,
        version: record.version,
        observedAt: record.observedAt,
        staleness: record.staleness,
        evidenceCount: record.evidence.length,
        evidence: record.evidence.map((id) => id as string),
        locationBearing: record.locationEvidence !== undefined,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// Find My Device (the derived view)
// ---------------------------------------------------------------------------

/** The machine-stable Find-My-Device location states. */
export const NO_LOCATION_EVIDENCE = "no_location_evidence" as const;
export const LOCATED = "located" as const;

/**
 * The derived last-known-location state of a device. Absent location
 * evidence is machine-stable `no_location_evidence` — NEVER a guess, a
 * default fix, or an interpolation.
 */
export type FindMyDeviceLocation =
  | { readonly status: typeof NO_LOCATION_EVIDENCE }
  | {
      readonly status: typeof LOCATED;
      /** The evidence ref: the immutable location observation's id. */
      readonly observationId: ObservationId;
      /** ISO 8601 timestamp carried on the location observation. */
      readonly observedAt: string;
      /** The observation kind (always `device.location`). */
      readonly kind: string;
      /** The observation payload, VERBATIM and opaque (never interpreted). */
      readonly payload: unknown;
      /** The staleness of the location evidence, re-derived at view time. */
      readonly staleness: LastSeenStaleness;
      /** The last-seen record the location evidence was captured in. */
      readonly fromRecordId: string;
    };

/** The derived current last-seen summary of a device. */
export interface FindMyDeviceLastSeen {
  /** The record the view resolved to. */
  readonly recordId: string;
  /** The last-seen instant (max evidence observedAt). */
  readonly observedAt: string;
  /** When that record was recorded (injected upstream). */
  readonly recordedAt: string;
  /** Staleness re-derived against the VIEW's injected at + thresholds. */
  readonly staleness: LastSeenStaleness;
  /** The source evidence refs (observation ids), sorted. */
  readonly evidence: readonly ObservationId[];
}

/** Options for `findMyDevice`. */
export interface FindMyDeviceOptions {
  /** The injected view instant (ISO 8601) — the staleness reference. */
  readonly at: string;
  /** The injected staleness thresholds (band policy). */
  readonly thresholds: StalenessThresholds;
}

/**
 * The Find-My-Device view of one device: the current last-seen summary
 * (absent when the device has no evidence at all) plus the derived
 * last-known-location state (machine-stable `no_location_evidence`
 * absent location evidence — never a guess).
 */
export interface FindMyDeviceView extends TenantScoped {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The current last-seen summary, or undefined when no evidence exists. */
  readonly lastSeen: FindMyDeviceLastSeen | undefined;
  /** The derived last-known-location state. */
  readonly location: FindMyDeviceLocation;
}

/**
 * Derive the Find-My-Device view of one device from the ledger. PURE
 * read + derivation: no mutation, no audit. The location is the latest
 * location-bearing evidence across EVERY record revision for the device
 * (ordered by observedAt epoch ms, then by record version — a later
 * recording of the same instant wins); the last-seen summary is the
 * derived current record with staleness re-derived against the VIEW's
 * injected instant + thresholds (the record's own frozen classification
 * reflects ITS recording instant).
 *
 * A device that exists only in another tenant's partition is
 * indistinguishable from an unknown one: the view reports no evidence +
 * `no_location_evidence`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param ledger the last-seen ledger
 * @param deviceId the device to locate
 * @param options the injected view options
 * @returns the derived view
 */
export function findMyDevice(
  scope: RecoveryTenantScope,
  ledger: LastSeenLedger,
  deviceId: DeviceId,
  options: FindMyDeviceOptions,
): FindMyDeviceView {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return frozen({
      tenantId: SYNTHETIC_SYSTEM_TENANT,
      deviceId,
      lastSeen: undefined,
      location: frozen({ status: NO_LOCATION_EVIDENCE }),
    });
  }
  const revisions = ledger.listLastSeenRevisions(scope, deviceId);
  const current = ledger.resolveLastSeen(scope, deviceId);
  const lastSeen: FindMyDeviceLastSeen | undefined =
    current === undefined
      ? undefined
      : frozen({
          recordId: current.recordId,
          observedAt: current.observedAt,
          recordedAt: current.recordedAt,
          staleness: classifyStaleness(options.at, current.observedAt, options.thresholds),
          evidence: current.evidence,
        });
  // The latest location-bearing evidence across all revisions.
  let best: { record: LastSeenRecord; fact: LocationEvidenceFact } | undefined;
  for (const record of revisions) {
    const fact = record.locationEvidence;
    if (fact === undefined) continue;
    const factMs = parseIsoMs(fact.observedAt);
    const bestMs = best === undefined ? Number.NEGATIVE_INFINITY : parseIsoMs(best.fact.observedAt);
    if (
      best === undefined ||
      factMs > bestMs ||
      (factMs === bestMs && record.version > best.record.version)
    ) {
      best = { record, fact };
    }
  }
  const location: FindMyDeviceLocation =
    best === undefined
      ? frozen({ status: NO_LOCATION_EVIDENCE })
      : frozen({
          status: LOCATED,
          observationId: best.fact.observationId,
          observedAt: best.fact.observedAt,
          kind: best.fact.kind,
          payload: best.fact.payload,
          staleness: classifyStaleness(options.at, best.fact.observedAt, options.thresholds),
          fromRecordId: best.record.recordId,
        });
  return frozen({
    tenantId: guard.tenantId,
    deviceId,
    lastSeen,
    location,
  });
}
