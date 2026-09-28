/**
 * @fleetos/web-device — the STRUCTURAL seams over the Device Twin domain.
 *
 * The W040-disclosed pattern: domain surfaces are injected at binding
 * sites as STRUCTURAL shapes, never imported as cross-lane modules. The
 * ownership gate (`tools/check-ownership.mjs`) allows `@fleetos/contracts`
 * as the only cross-lane src/ import; the Device Twin itself lives in
 * `@fleetos/device-model` (worker-b) and the health engine in
 * `@fleetos/health` (worker-b). This package therefore declares the
 * structural subset of those domain surfaces its view-models consume,
 * and the BINDING SITE (the W061 shell in production; the test suite in
 * this wave) injects the real packages — proven by test:
 *
 *   - `@fleetos/device-model`'s REAL `DeviceTwin` satisfies
 *     `DeviceTwinLike` structurally (every consumed field has the same
 *     name and a compatible type), and its REAL `TwinStore` satisfies
 *     `DeviceTwinSource` (the source only declares `list`/`get`, which
 *     the store implements with stricter tenant partitioning).
 *   - `@fleetos/health`'s REAL `HealthSignal`/`SignalBaseline`/
 *     `HealthAnomaly`/`DiagnosisHypothesis`/`TreatmentRecommendation`
 *     satisfy the doctor seam shapes structurally (with the ledger-
 *     derived `status` attached at the binding site via the REAL
 *     `hypothesisStatus`/`resolveActiveInterpretations`).
 *
 * Open unions (posture summaries, ownership types, recovery states,
 * staleness bands) are consumed as `string` — the surface is
 * provider-neutral: it displays what the domain asserted, verbatim, and
 * never re-derives domain truth.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type {
  DeviceLifecycleState,
  DeviceId,
  TenantId,
  UserId,
  WorkloadId,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The Device Twin structural seam (the canonical durable object)
// ---------------------------------------------------------------------------

/**
 * The structural subset of the Fleet Device Twin the device UI surfaces
 * consume (`spec/ARCHITECTURE-LOCK.md` item 2: the Device Twin is the
 * canonical durable representation of a managed device).
 *
 * Satisfied structurally by `@fleetos/device-model`'s REAL `DeviceTwin`
 * (extra twin sections — capabilities, software, maintenance, policy —
 * are simply not consumed by this surface; TypeScript structural
 * typing accepts the richer record unchanged). The nested section
 * shapes mirror the twin's frozen section records field-for-field for
 * every consumed field.
 */
export interface DeviceTwinLike {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** Current revision number of the twin. */
  readonly revision: number;
  readonly identity: {
    readonly lifecycleState: DeviceLifecycleState;
    readonly enrolledAt: string;
    readonly enrollment: {
      readonly adapterFamily: string;
      readonly hardware: {
        readonly manufacturer: string;
        readonly model: string;
        readonly serialNumber?: string;
        readonly assetTag?: string;
      };
    };
    readonly ownership: {
      readonly ownerType: string;
      readonly assignedUserId?: UserId;
      readonly assignedTeam?: string;
      readonly assignedAt: string;
    };
  };
  readonly telemetry: {
    readonly lastObservedAt: string | null;
    readonly observationCount: number;
  };
  readonly securityPosture: {
    readonly postureSummary: string;
    readonly findingCount: number;
  };
  readonly workload: {
    readonly assignedWorkloadIds: readonly WorkloadId[];
  };
  readonly actions: {
    readonly activeActionIds: readonly string[];
    readonly recoveryState: string;
  };
  /** The append-only revision log, when the source exposes it. */
  readonly revisions?: readonly DeviceTwinRevisionLike[];
}

/** One entry of the twin's append-only revision log (consumed subset). */
export interface DeviceTwinRevisionLike {
  readonly revision: number;
  readonly at: string;
  readonly section: string;
  readonly mutation: string;
}

/**
 * The tenant-partitioned source of device twins the roster and detail
 * surfaces read. INJECTED at the binding site — this package never
 * constructs a source and never performs I/O.
 *
 * Contract (mirrors `@fleetos/device-model`'s `TwinStore`, which
 * satisfies this interface structurally):
 *   - `list` returns ONLY the acting tenant's twins, deterministically
 *     ordered (sorted by deviceId);
 *   - `get` returns `undefined` for foreign/unknown devices — there is
 *     no existence side channel across tenants.
 */
export interface DeviceTwinSource {
  list(tenantId: TenantId): readonly DeviceTwinLike[];
  get(tenantId: TenantId, deviceId: DeviceId): DeviceTwinLike | undefined;
}

// ---------------------------------------------------------------------------
// The Device Doctor structural seams (W021 health/diagnosis surfaces)
// ---------------------------------------------------------------------------

/**
 * A health signal sample — the structural twin of `@fleetos/health`'s
 * `HealthSignal` (the consumed subset; `detail` is not interpreted).
 */
export interface HealthSignalLike {
  readonly kind: string;
  readonly unit: string;
  readonly value: number;
  readonly observedAt: string;
  readonly sourceObservationId: string;
  readonly confidence: number;
  readonly signalModelVersion: number;
}

/**
 * A statistical baseline — the structural twin of `@fleetos/health`'s
 * `SignalBaseline` (the consumed subset).
 */
export interface BaselineLike {
  readonly scope: { readonly kind: string };
  readonly signalKind: string;
  readonly unit: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly sampleCount: number;
  readonly deviceCount: number;
  readonly summary: {
    readonly count: number;
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
    readonly p90: number;
    readonly p95: number;
    readonly p99: number;
    readonly stddev: number;
  };
  readonly baselineModelVersion: number;
}

/**
 * A detected anomaly — the structural twin of `@fleetos/health`'s
 * `HealthAnomaly` (the consumed subset; `detail` is not interpreted).
 */
export interface AnomalyLike {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly signalKind: string;
  readonly unit: string;
  readonly value: number;
  readonly observedAt: string;
  readonly evidence: readonly {
    readonly observationId: string;
    readonly observedAt: string;
    readonly observationKind: string;
    readonly role: string;
  }[];
  readonly anomalyRulesVersion: number;
}

/** The ledger-derived lifecycle status of an interpretation record. */
export type InterpretationStatusLike = "ACTIVE" | "SUPERSEDED" | "DISMISSED";

/**
 * A versioned diagnosis hypothesis — the structural twin of
 * `@fleetos/health`'s `DiagnosisHypothesis` plus the ledger-derived
 * `status` (the binding site derives it with the REAL
 * `hypothesisStatus`; the surface never re-derives ledger state).
 */
export interface DiagnosisLike {
  readonly id: string;
  readonly causeId: string;
  readonly label: string;
  readonly confidence: number;
  readonly evidence: readonly {
    readonly anomalyId: string;
    readonly ruleId: string;
    readonly severity: string;
    readonly observationIds: readonly string[];
  }[];
  readonly interpretationVersion: number;
  readonly supersedes?: string;
  readonly proposedAt: string;
  readonly status: InterpretationStatusLike;
}

/**
 * A versioned treatment recommendation — the structural twin of
 * `@fleetos/health`'s `TreatmentRecommendation` (the `proposedIntent`
 * is consumed as its intent KIND only — a proposal, never an action;
 * the payload stays the domain's business) plus the binding-site
 * derived `status`.
 */
export interface TreatmentLike {
  readonly id: string;
  readonly hypothesisId: string;
  readonly actionId: string;
  readonly proposedIntentKind: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly recommendationVersion: number;
  readonly supersedes?: string;
  readonly proposedAt: string;
  readonly status: InterpretationStatusLike;
}

/**
 * The tenant-partitioned Device Doctor source — the health/diagnosis
 * surfaces (signals, baselines, anomalies, versioned diagnoses and
 * treatment recommendations) injected at the binding site.
 *
 * Every method takes the ACTING tenant first (the tenant rides every
 * query). The binding site in this wave binds the REAL `@fleetos/health`
 * pipeline outputs (deriveSignals -> buildDeviceBaseline ->
 * detectAnomalies -> diagnose + the append-only ledger with derived
 * statuses); the W061 shell binds live stores the same way.
 */
export interface DoctorSources {
  signals(tenantId: TenantId, deviceId: DeviceId): readonly HealthSignalLike[];
  baselines(tenantId: TenantId, deviceId: DeviceId): readonly BaselineLike[];
  anomalies(tenantId: TenantId, deviceId: DeviceId): readonly AnomalyLike[];
  diagnoses(tenantId: TenantId, deviceId: DeviceId): readonly DiagnosisLike[];
  treatments(tenantId: TenantId, deviceId: DeviceId): readonly TreatmentLike[];
  /**
   * The content-addressable evidence artifacts backing the device's
   * diagnosis surfaces. Surfaced OPAQUE: the view-model never interprets
   * a key's structure, never re-hashes, never fetches (`EvidenceRef`
   * from the frozen contracts, verbatim).
   */
  evidenceRefs(tenantId: TenantId, deviceId: DeviceId): readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[];
}
