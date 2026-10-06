/**
 * @fleetos/world-context — shared test helpers + fixtures.
 *
 * Builds the test fixtures the lane's tests share: a demo tenant scope,
 * deterministic seed timestamps, a synthetic prediction/counterfactual
 * builder (structurally compatible with the W154
 * `WorldModelPrediction` / `WorldModelCounterfactual` — used by the
 * unit tests where the W154 engine is NOT invoked), a workload-
 * assignment facet builder, a procurement-stage facet builder, and a
 * REAL W154 prediction builder (using the REAL `@fleetos/world-model`
 * `predict` / `predictAfterAction` over the REAL `@fleetos/predictive`
 * feed + REAL `@fleetos/device-model` store — the binding site that
 * injects the REAL W154 engine output into the W155 bridge; the W091
 * demo-fleet composition pattern replicated here).
 *
 * The binding-site composition (the W040-disclosed structural-seam
 * pattern): the W155 bridge consumes the W154 prediction through a
 * LOCAL structural interface (`WorldModelPredictionLike` /
 * `WorldModelCounterfactualLike`); the binding site (tests) injects
 * the REAL `@fleetos/world-model` `predict()` /
 * `predictAfterAction()` output (TypeScript's structural typing means
 * the real W154 records satisfy the local interfaces without a
 * cross-lane src/ import).
 */

import {
  asCorrelationId,
  asDeviceId,
  asObservationId,
  asTenantId,
  asWorkloadId,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  Observation,
  TenantId,
  WorkloadId,
} from "@fleetos/contracts";
import { makeGuardianDecision } from "@fleetos/contracts";
import {
  extractDeviceHistoryFeatures,
} from "@fleetos/predictive";
import type { DeviceHistoryFeatureSet } from "@fleetos/predictive";
import {
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import type {
  WorldModelContext,
  WorldModelCounterfactual,
  WorldModelPrediction,
} from "@fleetos/world-model";
import {
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  predict,
  predictAfterAction,
  represent,
} from "@fleetos/world-model";
import type {
  WorkloadAssignmentFacet,
  ProcurementStageFacet,
  WorldModelCounterfactualLike,
  WorldModelPredictionLike,
} from "../src/index";

// ---------------------------------------------------------------------------
// The demo tenant scope + deterministic seed timestamps
// ---------------------------------------------------------------------------

/** The dedicated demo tenant (mirrors apps/web/src/runtime/demo-fleet.ts). */
export const TENANT_ID: TenantId = asTenantId("tnt_w155demo000001");
/** A second tenant for tenant-isolation tests. */
export const TENANT_B: TenantId = asTenantId("tnt_w155tenant0002");

/** The acting tenant scope. */
export const SCOPE = Object.freeze({ tenantId: TENANT_ID } as const);
/** A foreign tenant scope (for tenant-isolation tests). */
export const FOREIGN_SCOPE = Object.freeze({ tenantId: TENANT_B } as const);

/** Deterministic seed timestamps (no clock reads). */
export const T0 = "2026-01-06T09:00:00Z" as const;
export const T1 = "2026-01-06T10:00:00Z" as const;
export const T2 = "2026-01-06T11:00:00Z" as const;
export const T3 = "2026-01-06T12:00:00Z" as const;
export const T4 = "2026-01-06T13:00:00Z" as const;
export const T5 = "2026-01-06T14:00:00Z" as const;
export const T6 = "2026-01-06T15:00:00Z" as const;
export const T7 = "2026-01-06T16:00:00Z" as const;
export const NOW = "2026-01-06T17:00:00Z" as const;

/** The extraction instant (injected — never a clock read). */
export const EXTRACTED_AT = T7;
/** The representation derivation instant (the context's asOf). */
export const AS_OF = T7;
/** The prediction production instant. */
export const PRODUCED_AT = T7;
/** The horizon: 24h (the prediction's temporal scope). */
export const HORIZON_MS = 24 * 60 * 60 * 1000;
/** The observed-at instant: T7 + 24h = T8 (the horizon's end). */
export const OBSERVED_AT = "2026-01-07T16:00:00Z" as const;
/** An observed-at BEFORE the horizon's end (for the horizon-mismatch test). */
export const OBSERVED_AT_TOO_EARLY = "2026-01-06T18:00:00Z" as const;

/** Demo devices. */
export const DEV_1: DeviceId = asDeviceId("dev_w155demo000001");
export const DEV_2: DeviceId = asDeviceId("dev_w155demo000002");

/** Demo correlation ids. */
export const CORR_1: CorrelationId = asCorrelationId("cor_w155demo000001");
export const CORR_2: CorrelationId = asCorrelationId("cor_w155demo000002");
export const CORR_3: CorrelationId = asCorrelationId("cor_w155demo000003");

/** Demo workload ids. */
export const WORKLOAD_1: WorkloadId = asWorkloadId("wl_w155demo000001");
export const WORKLOAD_2: WorkloadId = asWorkloadId("wl_w155demo000002");

// ---------------------------------------------------------------------------
// The synthetic prediction builder (structurally compatible with the W154
// WorldModelPrediction — used by the unit tests where the W154 engine is
// NOT invoked; the binding site injects the REAL W154 prediction in
// test/binding.test.ts)
// ---------------------------------------------------------------------------

let syntheticCounter = 0;

/**
 * Build a SYNTHETIC W154-shaped prediction (structurally compatible with
 * the W154 `WorldModelPrediction` — the LOCAL `WorldModelPredictionLike`
 * interface; the binding-site test in test/binding.test.ts injects the
 * REAL W154 `predict()` output instead). Deterministic — the same counter
 * sequence yields byte-identical records across runs (tests reset the
 * counter via `resetSyntheticCounter`).
 */
export function makeSyntheticPrediction(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly producedAt: string;
  readonly estimate?: number;
  readonly capabilityName?: string;
  readonly capabilityVersion?: number;
  readonly correlationId?: CorrelationId;
}): WorldModelPredictionLike {
  syntheticCounter += 1;
  const predictionDigest = `synth-pred-${syntheticCounter.toString().padStart(5, "0")}-${input.deviceId as string}`;
  const representationDigest = `synth-rep-${syntheticCounter.toString().padStart(5, "0")}`;
  const featureSetInputDigest = `synth-fs-${syntheticCounter.toString().padStart(5, "0")}`;
  const contextDigest = `synth-ctx-${syntheticCounter.toString().padStart(5, "0")}`;
  const obsRef = `synth-obs-${syntheticCounter.toString().padStart(5, "0")}`;
  const prediction: WorldModelPredictionLike = Object.freeze({
    schemaVersion: 1,
    kind: "prediction",
    capability: Object.freeze({
      name: input.capabilityName ?? "world-model.reference.deterministic",
      version: input.capabilityVersion ?? 1,
    }),
    target: Object.freeze({
      deviceId: input.deviceId,
      horizon: Object.freeze({ horizonMs: HORIZON_MS }),
    }),
    estimateKind: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    estimate: input.estimate ?? 0.65,
    uncertainty: Object.freeze({
      lower: 0.45,
      upper: 0.85,
      spread: 0.2,
      confidence: 0.7,
      observationCount: 4,
      recencyWeight: 0.9,
    }),
    provenance: Object.freeze({
      capabilityName: input.capabilityName ?? "world-model.reference.deterministic",
      capabilityVersion: input.capabilityVersion ?? 1,
      representationDigest,
      featureSetInputDigest,
      contextDigest,
      evidenceRefs: Object.freeze([
        { kind: "representation" as const, ref: representationDigest },
        { kind: "featureSet" as const, ref: featureSetInputDigest },
        { kind: "observation" as const, ref: obsRef },
      ]),
    }),
    tenantId: input.tenantId,
    correlationId: input.correlationId ?? CORR_1,
    producedAt: input.producedAt,
    provenanceChainDigest: predictionDigest,
  });
  return prediction;
}

/**
 * Build a SYNTHETIC W154-shaped counterfactual (structurally compatible
 * with the W154 `WorldModelCounterfactual` — the LOCAL
 * `WorldModelCounterfactualLike` interface; the binding-site test in
 * test/binding.test.ts injects the REAL W154 `predictAfterAction()`
 * output instead). The `hypothetical: true` marker is machine-carried.
 */
export function makeSyntheticCounterfactual(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly producedAt: string;
  readonly candidateActionRef?: string;
  readonly candidateActionDescription?: string;
  readonly estimate?: number;
  readonly correlationId?: CorrelationId;
}): WorldModelCounterfactualLike {
  syntheticCounter += 1;
  const predictionDigest = `synth-cf-${syntheticCounter.toString().padStart(5, "0")}-${input.deviceId as string}`;
  const representationDigest = `synth-rep-${syntheticCounter.toString().padStart(5, "0")}`;
  const featureSetInputDigest = `synth-fs-${syntheticCounter.toString().padStart(5, "0")}`;
  const contextDigest = `synth-ctx-${syntheticCounter.toString().padStart(5, "0")}`;
  const obsRef = `synth-obs-${syntheticCounter.toString().padStart(5, "0")}`;
  const candidateActionRef = input.candidateActionRef ?? "action:restart-device";
  const counterfactual: WorldModelCounterfactualLike = Object.freeze({
    schemaVersion: 1,
    kind: "counterfactual",
    hypothetical: true,
    candidateAction: Object.freeze({
      ref: candidateActionRef,
      description: input.candidateActionDescription ?? "Restart the device to clear the degraded state",
    }),
    capability: Object.freeze({
      name: "world-model.reference.deterministic",
      version: 1,
    }),
    target: Object.freeze({
      deviceId: input.deviceId,
      horizon: Object.freeze({ horizonMs: HORIZON_MS }),
    }),
    estimateKind: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    estimate: input.estimate ?? 0.75,
    uncertainty: Object.freeze({
      lower: 0.4,
      upper: 0.95,
      spread: 0.275,
      confidence: 0.56,
      observationCount: 4,
      recencyWeight: 0.9,
    }),
    provenance: Object.freeze({
      capabilityName: "world-model.reference.deterministic",
      capabilityVersion: 1,
      representationDigest,
      featureSetInputDigest,
      contextDigest,
      evidenceRefs: Object.freeze([
        { kind: "representation" as const, ref: representationDigest },
        { kind: "featureSet" as const, ref: featureSetInputDigest },
        { kind: "observation" as const, ref: obsRef },
        { kind: "candidateAction" as const, ref: candidateActionRef },
      ]),
    }),
    tenantId: input.tenantId,
    correlationId: input.correlationId ?? CORR_1,
    producedAt: input.producedAt,
    provenanceChainDigest: predictionDigest,
  });
  return counterfactual;
}

/** Reset the synthetic prediction/counterfactual counter (for golden-test stability). */
export function resetSyntheticCounter(): void {
  syntheticCounter = 0;
}

// ---------------------------------------------------------------------------
// The synthetic prediction LACKING the provenance chain (the trust-anchor
// refusal test — the W155 work order: "a prediction lacking the provenance
// chain REFUSES")
// ---------------------------------------------------------------------------

/**
 * Build a SYNTHETIC W154-shaped prediction with an EMPTY provenance
 * evidenceRefs array (the trust-anchor violation — the W155 bridge
 * REFUSES the conversion when the prediction lacks the provenance chain).
 */
export function makeSyntheticPredictionMissingProvenance(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly producedAt: string;
}): WorldModelPredictionLike {
  return Object.freeze({
    schemaVersion: 1,
    kind: "prediction",
    capability: Object.freeze({ name: "world-model.reference.deterministic", version: 1 }),
    target: Object.freeze({
      deviceId: input.deviceId,
      horizon: Object.freeze({ horizonMs: HORIZON_MS }),
    }),
    estimateKind: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    estimate: 0.5,
    uncertainty: Object.freeze({
      lower: 0.3,
      upper: 0.7,
      spread: 0.2,
      confidence: 0.5,
      observationCount: 4,
      recencyWeight: 0.9,
    }),
    provenance: Object.freeze({
      capabilityName: "world-model.reference.deterministic",
      capabilityVersion: 1,
      representationDigest: `missing-prov-rep`,
      featureSetInputDigest: `missing-prov-fs`,
      contextDigest: `missing-prov-ctx`,
      evidenceRefs: Object.freeze([]), // EMPTY — the trust-anchor violation
    }),
    tenantId: input.tenantId,
    correlationId: CORR_1,
    producedAt: input.producedAt,
    provenanceChainDigest: `missing-prov-pred-${input.deviceId as string}`,
  });
}

// ---------------------------------------------------------------------------
// The workload-assignment facet builder (structurally compatible with the
// W022 WorkloadRecommendation — used by the unit tests; the binding site
// in test/binding.test.ts injects the REAL @fleetos/workloads
// resolveActiveRecommendations output)
// ---------------------------------------------------------------------------

/**
 * Build a SYNTHETIC workload-assignment facet (structurally compatible
 * with the W022 `WorkloadRecommendation` projection the W155 lane
 * consumes). Deterministic — the same workload id + revision yields
 * byte-identical facets across runs.
 */
export function makeWorkloadAssignment(input: {
  readonly workloadId: WorkloadId;
  readonly profileRevision?: number;
  readonly recommendationId?: string;
  readonly candidateId?: string;
  readonly stage?: "ACTIVE" | "SUPERSEDED" | "DISMISSED" | "unknown";
  readonly kind?: "device-class" | "procurement";
  readonly confidence?: number;
  readonly evidenceRefs?: readonly string[];
  readonly recommendedAt?: string;
}): WorkloadAssignmentFacet {
  const idx = (input.workloadId as string).slice(-3) || "001";
  return Object.freeze({
    workloadId: input.workloadId as string,
    profileRevision: input.profileRevision ?? 1,
    recommendationId: input.recommendationId ?? `rec_w155_${idx}`,
    candidateId: input.candidateId ?? `device-class:thinkpad-t14`,
    stage: input.stage ?? "ACTIVE",
    kind: input.kind ?? "device-class",
    confidence: input.confidence ?? 0.85,
    evidenceRefs: Object.freeze(input.evidenceRefs ?? [`obs:workload-profile-${idx}`]),
    recommendedAt: input.recommendedAt ?? T5,
  });
}

// ---------------------------------------------------------------------------
// The procurement-stage facet builder (structurally compatible with the
// procurement ProcurementDemand + QuoteLedger projection the W155 lane
// consumes)
// ---------------------------------------------------------------------------

/**
 * Build a SYNTHETIC procurement-stage facet (structurally compatible
 * with the procurement `ProcurementDemand` + `quoteStatus(ledger, id)`
 * projection the W155 lane consumes). Deterministic.
 */
export function makeProcurementStage(input: {
  readonly demandId: WorkloadId;
  readonly workloadId?: WorkloadId;
  readonly quantity?: number;
  readonly activeQuoteId?: string;
  readonly stage?: "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED" | "unknown";
  readonly createdAt?: string;
  readonly deadline?: string;
}): ProcurementStageFacet {
  const idx = (input.demandId as string).slice(-3) || "001";
  return Object.freeze({
    demandId: input.demandId as string,
    workloadId: (input.workloadId ?? WORKLOAD_1) as string,
    quantity: input.quantity ?? 1,
    activeQuoteId: input.activeQuoteId ?? `qt_w155_${idx}`,
    stage: input.stage ?? "ISSUED",
    createdAt: input.createdAt ?? T3,
    deadline: input.deadline ?? "2026-02-06T17:00:00Z",
  });
}

// ---------------------------------------------------------------------------
// The Guardian decision builder (uses the REAL @fleetos/contracts
// makeGuardianDecision — the W070 evaluation-conversion's pattern)
// ---------------------------------------------------------------------------

/**
 * Build a FROZEN GuardianDecision of the given type. Uses the REAL
 * `@fleetos/contracts` `makeGuardianDecision` (the same factory the W070
 * evaluation-conversion's tests use — the binding site injects the REAL
 * W031 engine's decision via this factory).
 */
export function makeDecision(
  decision: "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK",
  tenantId: TenantId = TENANT_ID,
  decidedAt: string = NOW,
): GuardianDecision {
  return makeGuardianDecision({
    tenantId,
    decision,
    rules: [],
    evidence: [],
    decidedAt,
    schemaVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// The observed-outcome builder (the GROUND TRUTH — injected by the caller)
// ---------------------------------------------------------------------------

/**
 * Build an observed-outcome input (the GROUND TRUTH — the actual device
 * health/cadence at the horizon's end, INJECTED by the caller). Used by
 * the outcome-binding tests.
 */
export function makeObservedOutcome(input: {
  readonly label?: string;
  readonly value?: string;
  readonly observedAt?: string;
  readonly evidenceRefs?: readonly EvidenceRef[];
}): {
  readonly groundTruth: { readonly label: string; readonly value: string };
  readonly observedAt: string;
  readonly evidenceRefs: readonly EvidenceRef[];
} {
  return Object.freeze({
    groundTruth: Object.freeze({
      label: input.label ?? "device_health_observed",
      value: input.value ?? "healthy",
    }),
    observedAt: input.observedAt ?? OBSERVED_AT,
    evidenceRefs: Object.freeze(
      input.evidenceRefs ?? [
        { key: "obs-evidence-1", sizeBytes: 256, hash: "abc123", hashAlgorithm: "sha256" },
      ],
    ),
  });
}

// ---------------------------------------------------------------------------
// The REAL W154 prediction builder (the binding site that injects the
// REAL @fleetos/world-model predict() output into the W155 bridge)
// ---------------------------------------------------------------------------

/**
 * Build a REAL W154 prediction using the REAL `@fleetos/world-model`
 * `represent` + `predict` over the REAL `@fleetos/predictive`
 * `extractDeviceHistoryFeatures` output. This is the BINDING SITE that
 * injects the REAL W154 prediction into the W155 bridge — TypeScript
 * structural typing means the real W154 `WorldModelPrediction` satisfies
 * the W155 bridge's local `WorldModelPredictionLike` interface.
 */
export function buildRealPrediction(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly observations: readonly Observation[];
  readonly window: { readonly from: string; readonly to: string };
  readonly asOf: string;
  readonly producedAt: string;
}): { prediction: WorldModelPrediction; context: WorldModelContext } {
  // Extract features over the observations using the REAL W153 feed.
  const extraction = extractDeviceHistoryFeatures({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    observations: input.observations,
    window: input.window,
    extractedAt: input.asOf,
  });
  if (!extraction.ok) {
    throw new Error(`extractDeviceHistoryFeatures failed: ${extraction.error.message}`);
  }
  // Build a W154 representation.
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    asOf: input.asOf,
  };
  const rep = represent({
    scope: { tenantId: input.tenantId },
    featureSet: extraction.featureSet,
    context,
  });
  if (!rep.ok) {
    throw new Error(`represent failed: ${rep.error.message}`);
  }
  // Predict over the representation.
  const pred = predict({
    scope: { tenantId: input.tenantId },
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon: { horizonMs: HORIZON_MS },
    producedAt: input.producedAt,
    correlationId: CORR_1,
  });
  if (!pred.ok) {
    throw new Error(`predict failed: ${pred.error.message}`);
  }
  return { prediction: pred.prediction, context };
}

/**
 * Build a REAL W154 counterfactual using the REAL `@fleetos/world-model`
 * `predictAfterAction` over the REAL `@fleetos/predictive`
 * `extractDeviceHistoryFeatures` output. The output carries the
 * `hypothetical: true` marker (the W154 invariant 4 — the bridge
 * propagates it through the conversion on THREE surfaces).
 */
export function buildRealCounterfactual(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly observations: readonly Observation[];
  readonly window: { readonly from: string; readonly to: string };
  readonly asOf: string;
  readonly producedAt: string;
  readonly candidateAction: { readonly ref: string; readonly description: string };
}): { counterfactual: WorldModelCounterfactual; context: WorldModelContext } {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    observations: input.observations,
    window: input.window,
    extractedAt: input.asOf,
  });
  if (!extraction.ok) {
    throw new Error(`extractDeviceHistoryFeatures failed: ${extraction.error.message}`);
  }
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    asOf: input.asOf,
  };
  const rep = represent({
    scope: { tenantId: input.tenantId },
    featureSet: extraction.featureSet,
    context,
  });
  if (!rep.ok) {
    throw new Error(`represent failed: ${rep.error.message}`);
  }
  const cf = predictAfterAction({
    scope: { tenantId: input.tenantId },
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon: { horizonMs: HORIZON_MS },
    candidateAction: input.candidateAction,
    producedAt: input.producedAt,
    correlationId: CORR_1,
  });
  if (!cf.ok) {
    throw new Error(`predictAfterAction failed: ${cf.error.message}`);
  }
  return { counterfactual: cf.counterfactual, context };
}

// ---------------------------------------------------------------------------
// The deterministic observation builder (used by the REAL W154 prediction
// builder — the W091 demo-fleet pattern)
// ---------------------------------------------------------------------------

let observationCounter = 0;

/**
 * Build a deterministic observation. The id is `obs_w155nnnnn` (zero-padded
 * counter — deterministic across runs because tests reset the counter via
 * `resetObservationCounter`).
 */
export function makeObservation(
  kind: string,
  observedAt: string,
  payload: unknown,
): Observation {
  observationCounter += 1;
  const id = asObservationId(`obs_w155${observationCounter.toString().padStart(5, "0")}`);
  return Object.freeze({
    id,
    kind,
    observedAt,
    schemaVersion: 1,
    payload: Object.freeze(payload),
  });
}

/** Reset the deterministic observation counter (for golden-test stability). */
export function resetObservationCounter(): void {
  observationCounter = 0;
}

// ---------------------------------------------------------------------------
// The seeded demo fleet (a single device — used by the binding site that
// injects the REAL W154 prediction)
// ---------------------------------------------------------------------------

/** A window covering the demo device's observation span [T1, T7). */
export const DEMO_WINDOW = Object.freeze({ from: T1, to: T7 } as const);

/**
 * Seed a single demo device with 4 device.security observations across
 * [T1, T4] with mixed numeric telemetry payloads (battery level, disk
 * free bytes). Uses the REAL @fleetos/device-model APIs — the SAME APIs
 * the demo-fleet.ts runtime uses.
 */
export function seedDemoDevice(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
}): readonly Observation[] {
  const observations: Observation[] = [
    makeObservation("device.security", T1, { diskEncryption: true, batteryLevel: 92, diskFreeBytes: 256_000_000_000 }),
    makeObservation("device.security", T2, { diskEncryption: true, batteryLevel: 88, diskFreeBytes: 240_000_000_000 }),
    makeObservation("device.security", T3, { diskEncryption: false, batteryLevel: 75, diskFreeBytes: 220_000_000_000 }),
    makeObservation("device.security", T4, { diskEncryption: false, batteryLevel: 61, diskFreeBytes: 200_000_000_000 }),
  ];
  // The observations are the binding-site input — we don't actually need
  // to enroll the device for the W154 prediction builder (the W154 engine
  // accepts the observations directly via the W153 feed). The enrollment
  // is here for completeness — the W091 demo-fleet pattern.
  const enrolled = enrollDevice({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: `W155-DEMO-${input.deviceId as string}` },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR_1 } });
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);
  const observed = recordTwinObservations(created.twin, observations, { at: T1, correlationId: CORR_1 });
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);
  return observations;
}
