/**
 * @fleetos/integration-adcos — D1: the forward intent translation.
 *
 * Translates a FROZEN `ConnectivityIntent` envelope
 * (`IntentEnvelope<ConnectivityIntentPayload & {kind}>` from
 * `@fleetos/contracts` — consumed VERBATIM, never re-declared, never
 * widened) plus a caller-supplied typed requirement profile into the
 * typed, provider-neutral `AdcosConnectivityRequest`.
 *
 * The translation is PURE and DETERMINISTIC: the same inputs produce the
 * byte-identical request (and therefore the same `requestDigest`) every
 * run. Malformed or unsupported intents are refused with machine-stable
 * reasons — never a guess, never a silent default:
 *
 *   - wrong intent kind              -> `wrong_intent_kind`
 *   - invalid tenant (frozen grammar) -> `invalid_tenant`
 *   - invalid envelope version       -> `invalid_version`
 *   - non-ISO createdAt              -> `not_iso`
 *   - empty device refs              -> `empty`
 *   - no target refs at all          -> `no_target_ref`
 *   - unrecognized outcome           -> `unsupported_outcome`
 *   - malformed requirement facets   -> the `RequirementFailure` set
 *   - outcome-inconsistent profile   -> `outcome_requires_*`
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  CONNECTIVITY_INTENT_KIND,
  validateTenantRef,
  asTenantId,
} from "@fleetos/contracts";
import type {
  ConnectivityIntentPayload,
  CorrelationId,
  FleetError,
  IntentId,
  TenantId,
} from "@fleetos/contracts";
import { recognizeOutcome } from "./outcomes";
import type { CanonicalConnectivityOutcome } from "./outcomes";
import type {
  AdcosConnectivityRequest,
  ConnectivityIntentRef,
  ConnectivityIntentRequirements,
  RequirementFailure,
} from "./request-model";
import { validateConnectivityRequirements } from "./request-model";
import {
  ADCOS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  compact,
  contentDigest,
  frozen,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// The frozen intent envelope shape (structural, consumed verbatim)
// ---------------------------------------------------------------------------

/**
 * The frozen ConnectivityIntent envelope — the exact arm of the frozen
 * `FleetIntent` discriminated union this adapter consumes. Declared as a
 * structural type against the frozen contracts shapes (the payload and
 * the `kind` discriminant are the frozen contracts' own types).
 */
export type ConnectivityIntentEnvelope = {
  readonly intentId: IntentId;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly createdAt: string;
  readonly payload: ConnectivityIntentPayload & { readonly kind: typeof CONNECTIVITY_INTENT_KIND };
};

// ---------------------------------------------------------------------------
// The translation result (tagged, machine-stable refusals)
// ---------------------------------------------------------------------------

/** The tagged translation result. */
export type TranslationResult =
  | { readonly ok: true; readonly request: AdcosConnectivityRequest }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The translation
// ---------------------------------------------------------------------------

/**
 * Translate a frozen ConnectivityIntent envelope + a caller-supplied
 * requirement profile into the typed, provider-neutral ADCOS request.
 *
 * Pure and deterministic: no clock reads, no entropy, no I/O. The same
 * inputs produce a byte-identical request (asserted by the determinism
 * tests). Malformed or unsupported inputs are refused with a
 * machine-stable `ValidationError` carrying the complete failure set
 * (paths + reasons) — the caller surfaces the refusal; nothing is
 * guessed, defaulted or forwarded.
 *
 * @param intent the frozen ConnectivityIntent envelope (unknown at runtime boundaries)
 * @param requirements the caller-supplied typed requirement profile
 * @param correlationId the correlation id stamped on refusals (optional)
 * @returns the tagged translation result
 */
export function translateConnectivityIntent(
  intent: unknown,
  requirements: unknown,
  correlationId: CorrelationId | undefined = ADCOS_PIPELINE_CORRELATION_ID,
): TranslationResult {
  const failures: RequirementFailure[] = [];
  const envelope = (intent ?? {}) as Partial<ConnectivityIntentEnvelope> & {
    payload?: Partial<ConnectivityIntentPayload> & { kind?: unknown };
  };

  // --- envelope facets ------------------------------------------------------
  const errorTenant: TenantId =
    typeof envelope.tenantId === "string" && envelope.tenantId.length > 0
      ? asTenantId(envelope.tenantId)
      : SYNTHETIC_SYSTEM_TENANT;

  if (envelope.payload === undefined || envelope.payload === null) {
    failures.push({ path: "/payload", reason: "required" });
  } else {
    if (envelope.payload.kind !== CONNECTIVITY_INTENT_KIND) {
      failures.push({ path: "/payload/kind", reason: "wrong_intent_kind" });
    }
  }
  if (typeof envelope.tenantId !== "string" || envelope.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  } else if (!validateTenantRef(asTenantId(envelope.tenantId)).ok) {
    failures.push({ path: "/tenantId", reason: "invalid_tenant" });
  }
  if (typeof envelope.version !== "number" || !Number.isInteger(envelope.version) || envelope.version < 1) {
    failures.push({ path: "/version", reason: "invalid_version" });
  }
  if (typeof envelope.createdAt !== "string" || !looksLikeIso(envelope.createdAt)) {
    failures.push({ path: "/createdAt", reason: "not_iso" });
  }
  if (typeof envelope.intentId !== "string" || envelope.intentId.length === 0) {
    failures.push({ path: "/intentId", reason: "required" });
  }

  // --- payload facets (the frozen shape, verbatim) ----------------------------
  const payload = (envelope.payload ?? {}) as Partial<ConnectivityIntentPayload>;
  if (payload.sourceDeviceId !== undefined && !isNonEmptyString(payload.sourceDeviceId)) {
    failures.push({ path: "/payload/sourceDeviceId", reason: "empty" });
  }
  if (payload.targetDeviceId !== undefined && !isNonEmptyString(payload.targetDeviceId)) {
    failures.push({ path: "/payload/targetDeviceId", reason: "empty" });
  }
  if (typeof payload.outcome !== "string" || payload.outcome.trim().length === 0) {
    failures.push({ path: "/payload/outcome", reason: "required" });
  }

  // --- requirement facets ------------------------------------------------------
  const requirementCheck = validateConnectivityRequirements(requirements);
  if (!requirementCheck.ok) {
    failures.push(...requirementCheck.failures);
  }

  // Cross-facet: at least one target ref.
  const hasSource = isNonEmptyString(payload.sourceDeviceId);
  const hasTarget = isNonEmptyString(payload.targetDeviceId);
  const hasWorkload =
    requirementCheck.ok && isNonEmptyString(requirementCheck.requirements.workloadId);
  if (!hasSource && !hasTarget && !hasWorkload) {
    failures.push({ path: "/payload", reason: "no_target_ref" });
  }

  // --- outcome recognition ------------------------------------------------------
  let canonical: CanonicalConnectivityOutcome | undefined;
  if (typeof payload.outcome === "string" && payload.outcome.trim().length > 0) {
    const recognition = recognizeOutcome(payload.outcome);
    if (!recognition.ok) {
      failures.push({ path: "/payload/outcome", reason: "unsupported_outcome" });
    } else {
      canonical = recognition.outcome;
    }
  }

  // --- outcome-consistency of the requirement profile -----------------------------
  if (canonical !== undefined && requirementCheck.ok) {
    const profile = requirementCheck.requirements;
    switch (canonical) {
      case "low_latency_local_device_group": {
        if (profile.properties.maxLatencyMs === undefined) {
          failures.push({ path: "/properties/maxLatencyMs", reason: "outcome_requires_max_latency" });
        }
        break;
      }
      case "secure_private_connectivity": {
        if (profile.security.encryption !== "required") {
          failures.push({ path: "/security/encryption", reason: "outcome_requires_encryption" });
        }
        if (profile.properties.isolation !== "private") {
          failures.push({ path: "/properties/isolation", reason: "outcome_requires_private_isolation" });
        }
        break;
      }
      case "high_throughput_transfer": {
        if (profile.properties.minThroughputMbps === undefined) {
          failures.push({ path: "/properties/minThroughputMbps", reason: "outcome_requires_min_throughput" });
        }
        break;
      }
      case "resilient_connectivity": {
        if (profile.properties.redundancy === "none") {
          failures.push({ path: "/properties/redundancy", reason: "outcome_requires_redundancy" });
        }
        break;
      }
      default: {
        // Exhaustive: the four canonical outcomes are covered above.
        const _exhaustive: never = canonical;
        return _exhaustive;
      }
    }
  }

  if (failures.length > 0 || canonical === undefined || !requirementCheck.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.translationRefused,
        "connectivity intent translation refused",
        { tenantId: errorTenant, correlationId: correlationId ?? ADCOS_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }

  // --- the typed request (deterministic digest over canonical JSON) ---------------
  const profile = requirementCheck.requirements;
  const intentRef: ConnectivityIntentRef = frozen({
    intentId: envelope.intentId as IntentId,
    version: envelope.version as number,
    createdAt: envelope.createdAt as string,
  });
  const targets = frozen({
    sourceDeviceId: payload.sourceDeviceId,
    targetDeviceId: payload.targetDeviceId,
    workloadId: profile.workloadId,
  });
  const body = compact({
    tenantId: envelope.tenantId as TenantId,
    intentRef,
    outcome: frozen({ canonical, raw: payload.outcome as string }),
    targets,
    properties: profile.properties,
    constraints: profile.constraints,
    duration: profile.duration,
    // The normalized profile ALWAYS materializes the budget facet (an
    // absent caller budget becomes `{ policyRefs: [] }` inside
    // validateConnectivityRequirements — an explicit absence, never a
    // silent default); the `??` below is a type-level totalization of
    // that always-present runtime value.
    budget: profile.budget ?? frozen({ policyRefs: [] as readonly string[] }),
    security: profile.security,
  });
  const request: AdcosConnectivityRequest = frozen({
    ...body,
    requestDigest: contentDigest(body),
  });
  return { ok: true, request };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
