/**
 * @fleetos/integration-adcos — D1: the canonical connectivity outcome
 * vocabulary.
 *
 * The frozen `ConnectivityIntentPayload` (`@fleetos/contracts`) carries
 * `outcome: string` — an OPEN string. `spec/integration/ADCOS.md` names
 * the four canonical outcomes FleetOS asks ADCOS for:
 *
 *   - low latency local device group;
 *   - secure private connectivity;
 *   - high-throughput transfer;
 *   - resilient connectivity.
 *
 * The adapter recognizes EXACTLY these four (via deterministic token
 * normalization — never a guess, never a silent default). An outcome
 * string that does not normalize to a canonical token is refused with
 * the machine-stable reason `unsupported_outcome`: FleetOS never
 * forwards an intent whose outcome it cannot type
 * (`spec/ARCHITECTURE-LOCK.md` item 7 — provider-neutral contracts only).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen } from "./internal";

// ---------------------------------------------------------------------------
// The canonical outcome vocabulary (spec/integration/ADCOS.md examples)
// ---------------------------------------------------------------------------

export const OUTCOME_LOW_LATENCY_LOCAL_GROUP = "low_latency_local_device_group" as const;
export const OUTCOME_SECURE_PRIVATE_CONNECTIVITY = "secure_private_connectivity" as const;
export const OUTCOME_HIGH_THROUGHPUT_TRANSFER = "high_throughput_transfer" as const;
export const OUTCOME_RESILIENT_CONNECTIVITY = "resilient_connectivity" as const;

/**
 * The canonical connectivity outcome classes — the CLOSED set the adapter
 * translates into typed ADCOS requests. Derived verbatim from the four
 * examples in `spec/integration/ADCOS.md`.
 */
export type CanonicalConnectivityOutcome =
  | typeof OUTCOME_LOW_LATENCY_LOCAL_GROUP
  | typeof OUTCOME_SECURE_PRIVATE_CONNECTIVITY
  | typeof OUTCOME_HIGH_THROUGHPUT_TRANSFER
  | typeof OUTCOME_RESILIENT_CONNECTIVITY;

/** The full canonical outcome set, for validation + iteration. */
export const ALL_CANONICAL_OUTCOMES: readonly CanonicalConnectivityOutcome[] = Object.freeze([
  OUTCOME_LOW_LATENCY_LOCAL_GROUP,
  OUTCOME_SECURE_PRIVATE_CONNECTIVITY,
  OUTCOME_HIGH_THROUGHPUT_TRANSFER,
  OUTCOME_RESILIENT_CONNECTIVITY,
]);

// ---------------------------------------------------------------------------
// Deterministic token normalization
// ---------------------------------------------------------------------------

/**
 * Deterministic outcome-token normalization: lowercase, trim, then fold
 * runs of whitespace and hyphens into single underscores. Pure — the same
 * input always produces the same token. Examples:
 *
 *   "Low-Latency Local Device Group" -> "low_latency_local_device_group"
 *   "  secure   private connectivity " -> "secure_private_connectivity"
 *   "high-throughput transfer"       -> "high_throughput_transfer"
 */
export function normalizeOutcomeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

/** The result of outcome recognition — tagged, machine-stable. */
export type OutcomeRecognition =
  | { readonly ok: true; readonly outcome: CanonicalConnectivityOutcome }
  | { readonly ok: false; readonly reason: "unsupported_outcome"; readonly token: string };

/**
 * Recognize a canonical outcome from the frozen payload's open outcome
 * string. Deterministic: normalize, then match against the closed
 * vocabulary. Unknown tokens are refused with `unsupported_outcome` —
 * never a guess, never a silent default (the caller surfaces the
 * refusal; FleetOS never forwards an untypable outcome to a provider).
 *
 * @param raw the frozen payload's `outcome` string
 * @returns the tagged recognition result
 */
export function recognizeOutcome(raw: string): OutcomeRecognition {
  const token = normalizeOutcomeToken(raw);
  for (const outcome of ALL_CANONICAL_OUTCOMES) {
    if (token === outcome) {
      return { ok: true, outcome };
    }
  }
  return { ok: false, reason: "unsupported_outcome", token };
}

/**
 * The per-outcome REQUIRED property profile — the deterministic facet
 * each outcome class demands (documented, machine-stable; a request
 * missing its outcome's required facet is refused at translation, never
 * defaulted):
 *
 *   - LOW_LATENCY_LOCAL_GROUP    requires `properties.maxLatencyMs` (a
 *     latency bound is what makes the group "low-latency");
 *   - SECURE_PRIVATE_CONNECTIVITY requires `security.encryption` =
 *     "required" AND `properties.isolation` = "private";
 *   - HIGH_THROUGHPUT_TRANSFER   requires `properties.minThroughputMbps`
 *     (a throughput floor is what makes the transfer "high-throughput");
 *   - RESILIENT_CONNECTIVITY     requires `properties.redundancy` =
 *     "path_redundant" or "device_redundant" (resilience is redundancy).
 */
export const OUTCOME_REQUIRED_FACETS: Readonly<Record<CanonicalConnectivityOutcome, readonly string[]>> =
  frozen({
    [OUTCOME_LOW_LATENCY_LOCAL_GROUP]: Object.freeze(["properties.maxLatencyMs"]),
    [OUTCOME_SECURE_PRIVATE_CONNECTIVITY]: Object.freeze([
      "security.encryption=required",
      "properties.isolation=private",
    ]),
    [OUTCOME_HIGH_THROUGHPUT_TRANSFER]: Object.freeze(["properties.minThroughputMbps"]),
    [OUTCOME_RESILIENT_CONNECTIVITY]: Object.freeze(["properties.redundancy!=none"]),
  });
