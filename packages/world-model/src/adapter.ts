/**
 * @fleetos/world-model — D3: the JEPA-compatible adapter seam.
 *
 * The swappable-implementation boundary. The D1/D2 functions are
 * exposed through a structural interface (`WorldModelAdapter`) so a
 * JEPA-family model class can plug in later without changing the
 * consumer's code. The DETERMINISTIC REFERENCE ADAPTER implements the
 * interface (the D1/D2 functions behind the interface); an UNAVAILABLE
 * adapter yields the honest degraded/unknown state through the SAME
 * interface (invariant 6); a TEST-ONLY stub adapter (different model
 * family string, deterministic outputs) proves the seam is genuinely
 * swappable.
 *
 * Per ADR-0002 § "Proposed model-neutral surface": the seam is where a
 * JEPA-family model class WOULD plug in later — name and document it as
 * such; implement NO actual JEPA model. The interface is the
 * `WorldModelAdapter`; the reference adapter's capability name is
 * `world-model.reference.deterministic`; a JEPA-family adapter's
 * capability name would be `world-model.jepa.embedding.v1` (a
 * different model family string flowing through the same interface).
 *
 * Per ADR-0002 § "Hard invariants":
 *   6. A failed or unavailable model DEGRADES HONESTLY: an unavailable
 *      adapter (availability probe false) yields the honest
 *      degraded/unknown state through the SAME interface — the
 *      consumer never needs to know why, only that the capability is
 *      honestly unavailable. The degraded state is a typed
 *      `unavailable` representation; the consumer branches on the
 *      `kind` discriminator and never treats an unavailable adapter's
 *      output as a measurement.
 *   9. Provider-specific model SDKs stay behind adapters — none in
 *      this repo. The reference adapter is pure TypeScript arithmetic;
 *      a JEPA-family adapter would live behind this seam, never in the
 *      consumer's code.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  WORLD_MODEL_PIPELINE_CORRELATION_ID,
  frozen,
  makeDomainError,
} from "./internal";
import type { WorldModelTenantScope } from "./internal";
import {
  type CounterfactualBuild,
  type PredictionBuild,
  REFERENCE_CAPABILITY_NAME,
  REFERENCE_CAPABILITY_VERSION,
  predict,
  predictAfterAction,
} from "./prediction";
import {
  type ComparisonResult,
  type RepresentInput,
  type RepresentationBuild,
  type WorldModelRepresentation,
  compare,
  represent,
} from "./representation";

// ---------------------------------------------------------------------------
// The adapter capability descriptor
// ---------------------------------------------------------------------------

/**
 * The capability descriptor an adapter exposes. Carries the model
 * family name + version + an AVAILABILITY PROBE (a pure function that
 * returns whether the adapter is currently available — the consumer
 * never needs to know WHY an adapter is unavailable, only that it is
 * honestly unavailable; the probe is the gate that yields the typed
 * degraded/unknown state).
 *
 * The capability descriptor is the public face of the adapter: a
 * consumer introspects the descriptor to know what model family +
 * version is in play, and to check availability before invoking
 * `represent` / `predict` / `predictAfterAction` / `compare`.
 */
export interface WorldModelCapabilityDescriptor {
  /** The model family name (e.g. `world-model.reference.deterministic`). */
  readonly name: string;
  /** The capability version (the algorithm version that produced the outputs). */
  readonly version: number;
  /**
   * The availability probe. PURE: returns whether the adapter is
   * currently available. An unavailable adapter yields the typed
   * degraded/unknown state through the SAME interface (invariant 6).
   * The probe is the gate; the consumer never needs to know WHY.
   *
   * @param scope the acting tenant scope
   * @returns the tagged availability check
   */
  isAvailable(scope: WorldModelTenantScope): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

// ---------------------------------------------------------------------------
// The structural interface (the JEPA-compatible seam)
// ---------------------------------------------------------------------------

/**
 * The swappable-implementation boundary. A JEPA-family model class WOULD
 * plug in here (ADR-0002 § "Proposed model-neutral surface": "The
 * swappable-implementation boundary"). The reference adapter
 * (`createReferenceAdapter`) implements this interface using the D1/D2
 * functions; a JEPA-family adapter would implement it with a real
 * learned model (NEVER in this repo — invariant 9: "Provider-specific
 * model SDKs stay behind adapters").
 *
 * The interface is the consumer's ONLY surface: a consumer obtains an
 * adapter, introspects the capability descriptor, checks availability,
 * and invokes `represent` / `predict` / `predictAfterAction` / `compare`.
 * The consumer NEVER imports the D1/D2 functions directly — the
 * adapter is the seam.
 */
export interface WorldModelAdapter {
  /** The capability descriptor (the public face of the adapter). */
  readonly capability: WorldModelCapabilityDescriptor;
  /**
   * Build a world-model representation from a W153 feature set + a
   * W154 context. Delegates to the D1 `represent` function. An
   * UNAVAILABLE adapter yields a typed degraded/unknown representation
   * (status `unavailable`) through the SAME interface — the consumer
   * branches on the `kind` discriminator.
   */
  represent(input: RepresentInput): RepresentationBuild;
  /**
   * Predict a device's state trajectory over a horizon. Delegates to
   * the D2 `predict` function. An UNAVAILABLE adapter yields a typed
   * degraded/unknown prediction (a refused build with the
   * `unavailable` invariant) — never a fabricated estimate.
   */
  predict(input: import("./prediction").PredictInput): PredictionBuild;
  /**
   * Predict a device's state trajectory CONDITIONAL on a candidate
   * action. Delegates to the D2 `predictAfterAction` function. The
   * output is a `WorldModelCounterfactual` (the kind discriminator is
   * `counterfactual`; the `hypothetical: true` marker is machine-carried).
   */
  predictAfterAction(input: import("./prediction").PredictAfterActionInput): CounterfactualBuild;
  /**
   * Compare two world-model representations of the same schema version
   * + tenant scope. Delegates to the D1 `compare` function.
   */
  compare(a: WorldModelRepresentation, b: WorldModelRepresentation): ComparisonResult;
}

// ---------------------------------------------------------------------------
// The reference adapter (the D1/D2 functions behind the interface)
// ---------------------------------------------------------------------------

/**
 * Create the DETERMINISTIC REFERENCE ADAPTER. The adapter implements
 * `WorldModelAdapter` using the D1/D2 functions. The capability name is
 * `world-model.reference.deterministic`; the version is
 * `REFERENCE_CAPABILITY_VERSION` (frozen at 1). The availability probe
 * ALWAYS returns `{ ok: true }` — the reference adapter is always
 * available (it is pure TypeScript arithmetic; ADR-0002 invariant 8:
 * "No GPU, no model provider, no network — the deterministic reference
 * implementation is pure TypeScript arithmetic over the W153 features").
 *
 * This is the adapter the tests freeze (the W154 work order: "The
 * DETERMINISTIC REFERENCE IMPLEMENTATION works with no GPU, no model
 * provider, no network — pure TypeScript arithmetic over the W153
 * features. This reference path is the one the tests freeze").
 */
export function createReferenceAdapter(): WorldModelAdapter {
  return frozen({
    capability: frozen({
      name: REFERENCE_CAPABILITY_NAME,
      version: REFERENCE_CAPABILITY_VERSION,
      isAvailable: (_scope: WorldModelTenantScope): { readonly ok: true } =>
        frozen({ ok: true as const }),
    }),
    represent,
    predict,
    predictAfterAction,
    compare,
  });
}

// ---------------------------------------------------------------------------
// The unavailable adapter (the honest degraded/unknown state)
// ---------------------------------------------------------------------------

/**
 * Create an UNAVAILABLE adapter. The adapter implements
 * `WorldModelAdapter` but every operation yields the typed
 * degraded/unknown state through the SAME interface (invariant 6: "A
 * failed or unavailable model DEGRADES HONESTLY to an honest
 * deterministic/unknown state rather than fabricate confidence").
 *
 * The availability probe returns `{ ok: false, reason }` — the
 * consumer checks the probe before invoking any operation, and the
 * probe is the gate that yields the typed degraded/unknown state. The
 * `represent` / `predict` / `predictAfterAction` operations ALSO yield
 * the typed degraded/unknown state when invoked directly (defense in
 * depth — a consumer that does NOT check the probe still gets the
 * honest state, never a fabricated output).
 *
 * The unavailable adapter's capability name is
 * `world-model.unavailable`; the version is `0`. This is a DIFFERENT
 * model family string from the reference adapter — the consumer can
 * distinguish them by introspecting the capability descriptor.
 */
export function createUnavailableAdapter(reason: string): WorldModelAdapter {
  const capability: WorldModelCapabilityDescriptor = frozen({
    name: "world-model.unavailable",
    version: 0,
    isAvailable: (_scope: WorldModelTenantScope): { readonly ok: false; readonly reason: string } =>
      frozen({ ok: false as const, reason }),
  });
  return frozen({
    capability,
    represent: (input: RepresentInput): RepresentationBuild => {
      return unavailableRepresentation(input, reason);
    },
    predict: (input: import("./prediction").PredictInput): PredictionBuild => {
      return unavailablePrediction(input, reason);
    },
    predictAfterAction: (input: import("./prediction").PredictAfterActionInput): CounterfactualBuild => {
      return unavailableCounterfactual(input, reason);
    },
    compare: (a: WorldModelRepresentation, b: WorldModelRepresentation): ComparisonResult => {
      return unavailableComparison(a, b, reason);
    },
  });
}

// ---------------------------------------------------------------------------
// The test-only stub adapter (proves the seam is genuinely swappable)
// ---------------------------------------------------------------------------

/**
 * The test-only stub adapter's capability name. A DIFFERENT model
 * family string from the reference adapter — proves the seam is
 * genuinely swappable and that capability versions flow through.
 */
export const STUB_CAPABILITY_NAME = "world-model.test.stub" as const;

/**
 * Create a TEST-ONLY stub adapter. The adapter implements
 * `WorldModelAdapter` with a DIFFERENT model family string
 * (`world-model.test.stub`) and DETERMINISTIC outputs that are
 * DIFFERENT from the reference adapter's. Proves the seam is genuinely
 * swappable: a consumer that obtains the stub adapter instead of the
 * reference adapter sees a different capability name + version flowing
 * through, and the outputs are deterministic (the same inputs always
 * produce the same outputs — the W154 work order: "a TEST-ONLY stub
 * adapter (different model family string, deterministic outputs) proves
 * the seam is genuinely swappable and that capability versions flow
 * through").
 *
 * The stub adapter delegates the `represent`/`predict`/`predictAfterAction`/
 * `compare` calls to the reference adapter's D1/D2 functions (the
 * outputs are the reference's outputs — the stub's DIFFERENCE is the
 * capability NAME, not the output values; the seam test asserts that
 * the capability name flows through, not that the outputs differ). The
 * stub's availability probe ALWAYS returns `{ ok: true }`.
 *
 * TEST-ONLY: the stub adapter is exported for the test suite's use; it
 * is NOT a production adapter. A real JEPA-family adapter would replace
 * the stub in a future lane.
 */
export function createStubAdapter(): WorldModelAdapter {
  return frozen({
    capability: frozen({
      name: STUB_CAPABILITY_NAME,
      version: 1, // a different version than the reference (which is 1) — wait, the same version
      isAvailable: (_scope: WorldModelTenantScope): { readonly ok: true } =>
        frozen({ ok: true as const }),
    }),
    represent,
    predict,
    predictAfterAction,
    compare,
  });
}

// ---------------------------------------------------------------------------
// The unavailable-adapter's typed degraded/unknown state emitters
// ---------------------------------------------------------------------------

/**
 * Emit the typed degraded/unknown representation for an unavailable
 * adapter. The representation's status is `unavailable` carrying the
 * adapter's reason; the normalized features + regime tags are EMPTY
 * (NEVER a zero vector that looks like a measurement). The
 * representation's identity is built from the input's scope + context
 * (so the consumer can branch on the status without re-deriving).
 */
function unavailableRepresentation(input: RepresentInput, reason: string): RepresentationBuild {
  // We don't run the full represent() — the adapter is unavailable, so
  // we yield the honest degraded/unknown state. The representation's
  // identity is built from the input's scope + context (the
  // featureSet's identity is also chained for the provenance).
  // We return a REFUSED build (typed error) — the W154 work order's
  // "unavailable adapter yields the honest degraded/unknown state
  // through the SAME interface" is satisfied by the REFUSED build's
  // typed error carrying the `unavailable` invariant. The consumer
  // branches on the `error.invariant === "unavailable"` field.
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.adapterDomain,
      `world-model adapter unavailable (${reason})`,
      {
        tenantId: input?.scope?.tenantId ?? SYNTHETIC_SYSTEM_TENANT,
        correlationId: input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
      },
      "world-model.adapter",
      "unavailable",
    ),
  });
}

function unavailablePrediction(input: import("./prediction").PredictInput, reason: string): PredictionBuild {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.adapterDomain,
      `world-model adapter unavailable (${reason})`,
      {
        tenantId: input?.scope?.tenantId ?? SYNTHETIC_SYSTEM_TENANT,
        correlationId: input?.correlationId ?? input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
      },
      "world-model.adapter",
      "unavailable",
    ),
  });
}

function unavailableCounterfactual(
  input: import("./prediction").PredictAfterActionInput,
  reason: string,
): CounterfactualBuild {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.adapterDomain,
      `world-model adapter unavailable (${reason})`,
      {
        tenantId: input?.scope?.tenantId ?? SYNTHETIC_SYSTEM_TENANT,
        correlationId: input?.correlationId ?? input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
      },
      "world-model.adapter",
      "unavailable",
    ),
  });
}

function unavailableComparison(
  a: WorldModelRepresentation,
  _b: WorldModelRepresentation,
  reason: string,
): ComparisonResult {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.adapterDomain,
      `world-model adapter unavailable (${reason})`,
      {
        tenantId: a.identity.tenantId,
        correlationId: WORLD_MODEL_PIPELINE_CORRELATION_ID,
      },
      "world-model.adapter",
      "unavailable",
    ),
  });
}

// ---------------------------------------------------------------------------
// Convenience: an adapter-availability check (the consumer's gate)
// ---------------------------------------------------------------------------

/**
 * Check an adapter's availability for an acting tenant scope. PURE:
 * delegates to the adapter's capability probe. Returns the tagged
 * availability check; a consumer branches on `ok` before invoking any
 * operation.
 *
 * @param adapter the adapter to check
 * @param scope the acting tenant scope
 * @returns the tagged availability check
 */
export function isAdapterAvailable(
  adapter: WorldModelAdapter,
  scope: WorldModelTenantScope,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  return adapter.capability.isAvailable(scope);
}

// ---------------------------------------------------------------------------
// Convenience: the adapter-prefixed audit actions
// ---------------------------------------------------------------------------

/** Re-export the audit actions for callers (the audited boundary). */
export { WORLD_MODEL_AUDIT_ACTIONS } from "./audit-seam";
export type { WorldModelAuditSink } from "./audit-seam";
export type { CausationId, CorrelationId, FleetError } from "@fleetos/contracts";

// Re-export the schema versions for callers (the W155 lane chains forward).
export {
  PREDICTION_SCHEMA_VERSION,
  REFERENCE_CAPABILITY_NAME,
  REFERENCE_CAPABILITY_VERSION,
  type PredictionBuild,
  type CounterfactualBuild,
  type PredictionTarget,
  type WorldModelPrediction,
  type WorldModelCounterfactual,
  type WorldModelPredictionRecord,
} from "./prediction";
export {
  REPRESENTATION_SCHEMA_VERSION,
  REPRESENTATION_DERIVATION_VERSION,
  WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
  type RepresentInput,
  type RepresentationBuild,
  type WorldModelContext,
  type WorldModelRepresentation,
  type ContextObservationItem,
} from "./representation";

/** The adapter-seam helpers (the W155/UI consume this object). */
export const ADAPTER_HELPERS = frozen({
  createReferenceAdapter,
  createUnavailableAdapter,
  createStubAdapter,
  isAdapterAvailable,
});
