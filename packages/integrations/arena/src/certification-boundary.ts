/**
 * @fleetos/integration-arena — D3: the certification boundary (the
 * ARENA.md invariant).
 *
 * The ARENA.md invariant: "FleetOS never treats an uncertified model
 * output as action permission." This module is the FAIL-CLOSED gate that
 * enforces it.
 *
 * A capability is the unit Arena learns/certifies (per
 * `spec/ARCHITECTURE-LOCK.md` item 9: "Arena owns capability
 * learning/certification; FleetOS owns operational adoption"). Arena's
 * certified capability metadata carries:
 *   - `capabilityId` (a stable capability identifier — e.g.,
 *     "device.health.battery_aging_classifier");
 *   - `capabilityVersion` (the certified version — e.g., "1.2.0");
 *   - `certificationRef` (a typed reference to Arena's certification
 *     record — an opaque, content-addressable string; the control plane
 *     NEVER interprets the contents, only records that it exists);
 *   - `evaluationSuiteRevision` (the evaluation-suite revision the
 *     certification was granted against);
 *   - `fleetOSCompatibilityStatement` (Arena's compatibility statement
 *     — a machine-stable union: `compatible`,
 *     `compatible_with_warnings`, `incompatible`).
 *
 * The gate refuses adoption when:
 *   - the certification reference is absent, empty, or malformed (per the
 *     injected grammar — the canonical FleetOS `acr_` prefix + base32);
 *   - the certification reference fails a content-hash check against the
 *     caller-supplied certification hash (defense in depth: a stale
 *     certificationRef cannot be substituted);
 *   - the fleetOSCompatibilityStatement is `incompatible` (a certified
 *     but explicitly-incompatible capability is refused at the
 *     adoption boundary);
 *   - the capabilityId or capabilityVersion is empty (the metadata is
 *     malformed — these are required fields, never inferred).
 *
 * Fail-closed: ANY refusal reason produces a `Refusal` carrying
 * machine-stable reason codes; no partial adoption, no "best-effort"
 * path. The adoption gate (D2) consumes `requireCertifiedCapability`
 * verbatim; no path exists from raw model output to an adoption record
 * without going through this gate.
 *
 * # The invariant assertion
 *
 * Asserted BY TEST (`packages/integrations/arena/test/certification-boundary.test.ts`):
 *   1. The package exposes NO function that converts raw model output
 *      (an opaque `unknown` payload) into an `AdoptionRecord` (D2) or
 *      an `EvaluationCaseRecord` (D1) without first producing a
 *      `CertifiedCapability` through this gate.
 *   2. `AdoptionRecord`s carry the `certificationRef` verbatim (the
 *      record is the audit evidence that the certification existed at
 *      adoption time).
 *   3. The gate is fail-closed: every refusal path returns a tagged
 *      `Refusal` carrying machine-stable reason codes; NONE returns a
 *      partial/degraded certified-capability record.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";
import {
  ERROR_CODES,
  ARENA_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  makeDomainError,
} from "./internal";

// ---------------------------------------------------------------------------
// The certified capability metadata (Arena-owned, consumed verbatim here)
// ---------------------------------------------------------------------------

/**
 * The fleetOS compatibility statement — a machine-stable union Arena's
 * certification emits. `compatible` means the certified capability may
 * be adopted as-is; `compatible_with_warnings` means the adoption MUST
 * carry the warnings verbatim (audit + record); `incompatible` means
 * adoption is refused at the boundary — the capability is certified but
 * the certification itself says "do not adopt into FleetOS's current
 * shape" (e.g., the capability requires a hardware feature FleetOS's
 * devices do not have).
 */
export type FleetOSCompatibilityStatement =
  | "compatible"
  | "compatible_with_warnings"
  | "incompatible";

/** All compatibility statements (for validation + iteration). */
export const ALL_FLEETOS_COMPATIBILITY_STATEMENTS: readonly FleetOSCompatibilityStatement[] = Object.freeze([
  "compatible",
  "compatible_with_warnings",
  "incompatible",
]);

/**
 * The certified capability metadata Arena's certification produces. This
 * is the EXACT shape `requireCertifiedCapability` consumes. Arena owns
 * capability learning/certification; the control plane only reads this
 * metadata — never re-derives it.
 *
 * Required fields:
 *   - `capabilityId` — the stable capability identifier (machine-stable string).
 *   - `capabilityVersion` — the certified version (machine-stable string).
 *   - `certificationRef` — a typed reference to Arena's certification
 *     record (opaque, content-addressable; the canonical `acr_` prefix +
 *     base32 — see `CERTIFICATION_REF_PATTERN`).
 *   - `evaluationSuiteRevision` — the evaluation-suite revision the
 *     certification was granted against.
 *   - `fleetOSCompatibilityStatement` — Arena's compatibility statement.
 *
 * Optional fields:
 *   - `certificationHash` — the cryptographic hash of the certification
 *     record (defense-in-depth: a caller may supply a content-hash to
 *     re-assert against the certificationRef).
 *   - `warnings` — when `fleetOSCompatibilityStatement` is
 *     `compatible_with_warnings`, the machine-stable warnings list the
 *     adoption MUST carry verbatim.
 *   - `capabilityClass` — the open-union class identifier (e.g.,
 *     "device.health.battery_aging") for grouping in the adoption ledger.
 */
export interface CertifiedCapabilityMetadata extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The stable capability identifier (machine-stable string). */
  readonly capabilityId: string;
  /** The certified version (machine-stable string). */
  readonly capabilityVersion: string;
  /** A typed reference to Arena's certification record (canonical `acr_` prefix + base32). */
  readonly certificationRef: string;
  /** The evaluation-suite revision the certification was granted against. */
  readonly evaluationSuiteRevision: string;
  /** Arena's compatibility statement. */
  readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatement;
  /** Optional: the cryptographic hash of the certification record (defense in depth). */
  readonly certificationHash?: string;
  /** Optional: machine-stable warnings when the compatibility statement is `compatible_with_warnings`. */
  readonly warnings?: readonly string[];
  /** Optional: the capability class (open union, for grouping in the adoption ledger). */
  readonly capabilityClass?: string;
}

// ---------------------------------------------------------------------------
// The certification-reference grammar (the fail-closed entry point)
// ---------------------------------------------------------------------------

/**
 * The canonical certification-reference grammar: `acr_` prefix followed
 * by 16+ URL-safe base32 chars (lowercase a-z plus 0-9). The grammar is
 * deliberately the same flavor as the frozen tenant-id grammar — safe
 * for use in URLs, log lines, SQL identifiers, and object-storage
 * prefixes. The control plane never interprets the contents of the
 * reference; it only records that the reference exists and matches the
 * grammar.
 */
export const CERTIFICATION_REF_PATTERN = /^acr_[a-z0-9]{16,}$/;

/** The minimum length of a certification-reference string (after the prefix). */
export const CERTIFICATION_REF_MIN_LENGTH = 16;
/** The maximum length of a certification-reference string (after the prefix). */
export const CERTIFICATION_REF_MAX_LENGTH = 256;

/**
 * Pure (non-throwing) check: does the candidate reference match the
 * canonical certification-reference grammar?
 */
export function isValidCertificationRef(ref: string): boolean {
  if (typeof ref !== "string") return false;
  if (ref.length < `acr_`.length + CERTIFICATION_REF_MIN_LENGTH) return false;
  if (ref.length > `acr_`.length + CERTIFICATION_REF_MAX_LENGTH) return false;
  return CERTIFICATION_REF_PATTERN.test(ref);
}

// ---------------------------------------------------------------------------
// The fail-closed gate
// ---------------------------------------------------------------------------

/**
 * Machine-stable refusal reason codes. The set is enumerable so the
 * caller (a reviewer, an audit consumer, a future UI surface) can branch
 * on the failure mode without parsing human messages.
 */
export type CertificationRefusalReason =
  | "missing_metadata"
  | "missing_capability_id"
  | "missing_capability_version"
  | "missing_certification_ref"
  | "malformed_certification_ref"
  | "incompatible_capability"
  | "certification_hash_mismatch";

/** All refusal reason codes (for validation + iteration). */
export const ALL_CERTIFICATION_REFUSAL_REASONS: readonly CertificationRefusalReason[] = Object.freeze([
  "missing_metadata",
  "missing_capability_id",
  "missing_capability_version",
  "missing_certification_ref",
  "malformed_certification_ref",
  "incompatible_capability",
  "certification_hash_mismatch",
]);

/**
 * The result of a fail-closed certification check. Tagged union so
 * callers branch on the failure mode without try/catch. A `Certified`
 * outcome carries the metadata VERBATIM (the certification reference,
 * the capability id, the capability version, the compatibility
 * statement, the warnings); a `Refused` outcome carries the
 * machine-stable reason codes — never a partial/degraded record.
 *
 * The widened certification: the metadata fields that an adoption record
 * (D2) consumes VERBATIM. The widening is explicit so the adoption
 * boundary cannot accidentally ingest raw `unknown` — it must receive a
 * `CertifiedCapability` from this gate.
 */
export interface CertifiedCapability extends TenantScoped {
  readonly tenantId: TenantId;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly certificationRef: string;
  readonly evaluationSuiteRevision: string;
  readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatement;
  readonly warnings: readonly string[];
  readonly capabilityClass?: string;
}

/**
 * The tagged result of `requireCertifiedCapability`. Tagged union so
 * callers branch on the failure mode without try/catch.
 */
export type CertificationResult =
  | { readonly ok: true; readonly certified: CertifiedCapability }
  | { readonly ok: false; readonly refusal: CertificationRefusal };

/**
 * A machine-stable certification refusal. The `reasons` array is the
 * machine-readable failure set; the `metadata` carries the input fields
 * that survived validation (for audit evidence — the refusal is
 * auditable so a reviewer can prove the boundary held).
 */
export interface CertificationRefusal {
  readonly tenantId: TenantId;
  readonly reasons: readonly CertificationRefusalReason[];
  /** The surviving metadata fields (for audit evidence). */
  readonly metadata: {
    readonly capabilityId: string | null;
    readonly capabilityVersion: string | null;
    readonly certificationRef: string | null;
    readonly evaluationSuiteRevision: string | null;
    readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatement | null;
  };
}

/**
 * Optional caller-injected assertion: a content-hash check against the
 * certification reference. Defense in depth: a stale or substituted
 * certificationRef (e.g., a record that was valid at one point but has
 * since been rotated) fails this check. The check is opt-in (the caller
 * supplies the expected hash); when absent, the gate skips it.
 */
export interface CertificationHashCheck {
  /** The expected hash (the hash of the certification record at submission time). */
  readonly expectedHash: string;
  /** The hash algorithm used (e.g., "sha256"). */
  readonly hashAlgorithm: string;
}

/** Options for `requireCertifiedCapability`. */
export interface RequireCertifiedCapabilityOptions {
  /** The correlation id of the adoption request (for the audit trail). */
  readonly correlationId: CorrelationId;
  /** Optional: the content-hash check (defense in depth). */
  readonly hashCheck?: CertificationHashCheck;
}

/**
 * The fail-closed certification gate. Pure: every input is caller-
 * supplied; the gate reads no clock and no entropy. Returns a tagged
 * `CertificationResult` — never a partial/degraded certified-capability
 * record, never throws.
 *
 * The gate refuses in order:
 *   1. `missing_metadata` — the input is null/absent.
 *   2. `missing_capability_id` / `missing_capability_version` /
 *      `missing_certification_ref` — required fields are absent/empty.
 *   3. `malformed_certification_ref` — the reference fails the canonical
 *      grammar (`CERTIFICATION_REF_PATTERN`).
 *   4. `certification_hash_mismatch` — the caller-supplied hash check
 *      failed (defense in depth; only fires when `hashCheck` is supplied).
 *   5. `incompatible_capability` — the compatibility statement is
 *      `incompatible` (certified but explicitly refused for FleetOS
 *      adoption).
 *
 * The order matters: structural failures are reported before content
 * failures, so a reviewer can see the most fundamental problem first.
 * Multiple reasons MAY be returned (the gate accumulates them — every
 * problem the metadata has is exposed at once, never silently).
 *
 * @param metadata the certified-capability metadata from Arena
 * @param options the gate options (correlation id + optional hash check)
 * @returns the tagged certification result
 */
export function requireCertifiedCapability(
  metadata: CertifiedCapabilityMetadata | null | undefined,
  options: RequireCertifiedCapabilityOptions,
): CertificationResult {
  const correlationId = options?.correlationId ?? ARENA_PIPELINE_CORRELATION_ID;
  // 1. missing_metadata — the input is null/absent.
  if (metadata === null || metadata === undefined || typeof metadata !== "object") {
    return refused(
      SYNTHETIC_SYSTEM_TENANT,
      ["missing_metadata"],
      {
        capabilityId: null,
        capabilityVersion: null,
        certificationRef: null,
        evaluationSuiteRevision: null,
        fleetOSCompatibilityStatement: null,
      },
      correlationId,
    );
  }
  const tenantId: TenantId =
    typeof metadata.tenantId === "string" && metadata.tenantId.length > 0
      ? metadata.tenantId
      : SYNTHETIC_SYSTEM_TENANT;
  const reasons: CertificationRefusalReason[] = [];
  // 2. missing required fields.
  if (typeof metadata.capabilityId !== "string" || metadata.capabilityId.length === 0) {
    reasons.push("missing_capability_id");
  }
  if (typeof metadata.capabilityVersion !== "string" || metadata.capabilityVersion.length === 0) {
    reasons.push("missing_capability_version");
  }
  if (typeof metadata.certificationRef !== "string" || metadata.certificationRef.length === 0) {
    reasons.push("missing_certification_ref");
  }
  // 3. malformed certification reference (only checked when present).
  if (
    typeof metadata.certificationRef === "string" &&
    metadata.certificationRef.length > 0 &&
    !isValidCertificationRef(metadata.certificationRef)
  ) {
    reasons.push("malformed_certification_ref");
  }
  // 4. certification hash mismatch (defense in depth; opt-in).
  if (options.hashCheck !== undefined) {
    if (typeof metadata.certificationHash !== "string" || metadata.certificationHash.length === 0) {
      reasons.push("certification_hash_mismatch");
    } else if (metadata.certificationHash !== options.hashCheck.expectedHash) {
      reasons.push("certification_hash_mismatch");
    }
  }
  // 5. incompatible capability.
  if (
    typeof metadata.fleetOSCompatibilityStatement === "string" &&
    metadata.fleetOSCompatibilityStatement === "incompatible"
  ) {
    reasons.push("incompatible_capability");
  } else if (
    typeof metadata.fleetOSCompatibilityStatement !== "string" ||
    !(ALL_FLEETOS_COMPATIBILITY_STATEMENTS as readonly string[]).includes(
      metadata.fleetOSCompatibilityStatement,
    )
  ) {
    // An unknown compatibility statement is treated as incompatible
    // (fail-closed: never adopt a capability whose compatibility the
    // control plane does not understand).
    reasons.push("incompatible_capability");
  }
  if (reasons.length > 0) {
    return refused(
      tenantId,
      reasons,
      {
        capabilityId: typeof metadata.capabilityId === "string" ? metadata.capabilityId : null,
        capabilityVersion:
          typeof metadata.capabilityVersion === "string" ? metadata.capabilityVersion : null,
        certificationRef:
          typeof metadata.certificationRef === "string" ? metadata.certificationRef : null,
        evaluationSuiteRevision:
          typeof metadata.evaluationSuiteRevision === "string"
            ? metadata.evaluationSuiteRevision
            : null,
        fleetOSCompatibilityStatement:
          typeof metadata.fleetOSCompatibilityStatement === "string" &&
          (ALL_FLEETOS_COMPATIBILITY_STATEMENTS as readonly string[]).includes(
            metadata.fleetOSCompatibilityStatement,
          )
            ? metadata.fleetOSCompatibilityStatement
            : null,
      },
      correlationId,
    );
  }
  // All checks passed: produce the certified-capability record (the
  // narrowed, widenable shape the adoption gate consumes).
  const certified: CertifiedCapability = frozen({
    tenantId,
    capabilityId: metadata.capabilityId as string,
    capabilityVersion: metadata.capabilityVersion as string,
    certificationRef: metadata.certificationRef as string,
    evaluationSuiteRevision: metadata.evaluationSuiteRevision as string,
    fleetOSCompatibilityStatement: metadata.fleetOSCompatibilityStatement as FleetOSCompatibilityStatement,
    warnings: Object.freeze([...(metadata.warnings ?? [])]),
    ...(metadata.capabilityClass !== undefined ? { capabilityClass: metadata.capabilityClass } : {}),
  });
  return { ok: true, certified };
}

/**
 * Internal: build a refused result carrying the surviving metadata.
 * Pure.
 */
function refused(
  tenantId: TenantId,
  reasons: readonly CertificationRefusalReason[],
  metadata: CertificationRefusal["metadata"],
  _correlationId: CorrelationId,
): CertificationResult {
  // The _correlationId is reserved for the audit emission (the caller
  // attaches the audit record at the boundary function; this gate is
  // pure and emits no audit itself).
  void _correlationId;
  return {
    ok: false,
    refusal: frozen({
      tenantId,
      reasons: Object.freeze([...reasons]),
      metadata: frozen(metadata),
    }),
  };
}

// ---------------------------------------------------------------------------
// The raw-model-output assertion (the ARENA.md invariant)
// ---------------------------------------------------------------------------

/**
 * A raw model output — the opaque `unknown` payload a model evaluation
 * produces. The control plane NEVER treats this as action permission.
 * The ONLY valid path from a raw model output to an adoption record is:
 *
 *   raw model output -> Arena's certification process -> CertifiedCapabilityMetadata
 *                                                          |
 *                                                          v
 *                                          requireCertifiedCapability (D3)
 *                                                          |
 *                                                          v
 *                                              CertifiedCapability (or Refusal)
 *                                                          |
 *                                                          v
 *                                              adoptCapability (D2) — PROPOSAL-gated
 *
 * This package exposes NO shortcut from a raw model output to an
 * adoption record. The proof is structural:
 *   - `adoptCapability` (D2) accepts a `CertifiedCapability` (this module's
 *     output) — NOT a `RawModelOutput`, NOT an `unknown`.
 *   - `requireCertifiedCapability` (D3) accepts a `CertifiedCapabilityMetadata`
 *     — a typed shape with the certification reference as a required
 *     field. There is no overload that accepts `unknown`.
 *   - `submitEvaluationCase` (D1) accepts typed evaluation-case inputs —
 *     NOT a raw model output. The case carries evaluation LABELS (the
 *     labels are the human-readable ground-truth annotations, never the
 *     model's own output).
 *
 * The `RawModelOutput` type is exported for documentation only — it is
 * the type this package REFUSES to ingest directly. Tests assert that
 * no public function in this package accepts a `RawModelOutput` and
 * returns an `AdoptionRecord` or `EvaluationCaseRecord`.
 */
export type RawModelOutput = unknown;

/**
 * Assert (compile-time) that a `RawModelOutput` is NOT assignable to a
 * `CertifiedCapability`. This is a type-level proof: the raw model output
 * is opaque `unknown`, and a `CertifiedCapability` is a typed record
 * with the certification reference as a required field. The assignment
 * is forbidden by construction.
 *
 * Exported for the test that asserts the ARENA.md invariant at the type
 * level. The function is a no-op at runtime; its only purpose is the
 * type-level check.
 */
export function assertRawModelOutputIsNotActionPermission(output: RawModelOutput): void {
  // The raw model output is opaque — this function intentionally does
  // NOTHING with it. It is a type-level marker for the test suite.
  void output;
}

/**
 * Project a raw model output's certification reference (if the model
 * output happens to carry one) — the ONLY structural bridge from raw
 * model output to a certification reference. Returns `null` when the
 * output carries no valid certification reference (the typical case —
 * raw model output is NOT certified; Arena's certification process
 * produces the certification reference, not the model). NEVER returns
 * the raw model output itself; ONLY the certification reference (a
 * typed string matching the canonical grammar) — which still must pass
 * `requireCertifiedCapability` before any adoption surface is touched.
 *
 * The projection is intentionally restrictive: it looks ONLY for a
 * `certificationRef` field of type `string` matching the canonical
 * grammar. Anything else is `null` — there is no path from a raw model
 * output's other fields (predictions, recommendations, probabilities)
 * to a `CertifiedCapability` through this projection.
 */
export function projectCertificationRefFromRawModelOutput(
  output: RawModelOutput,
): string | null {
  if (output === null || typeof output !== "object") return null;
  const candidate = output as { certificationRef?: unknown };
  if (typeof candidate.certificationRef !== "string") return null;
  if (!isValidCertificationRef(candidate.certificationRef)) return null;
  return candidate.certificationRef;
}

// ---------------------------------------------------------------------------
// FleetError projection (for the adoption-gate caller to surface)
// ---------------------------------------------------------------------------

/**
 * Project a `CertificationRefusal` into a `FleetError` so the adoption
 * gate's caller can surface it through the frozen error taxonomy. The
 * error is a `DomainError` carrying the refusal reason codes in the
 * `invariant` field (a stable, machine-readable string — callers do
 * NOT parse the human message).
 */
export function refusalToFleetError(
  refusal: CertificationRefusal,
  correlationId: CorrelationId,
): FleetError {
  return makeDomainError(
    ERROR_CODES.certificationRefused,
    `arena certification boundary refused capability adoption (reasons: ${refusal.reasons.join(", ")})`,
    { tenantId: refusal.tenantId, correlationId },
    "arena.certification.boundary",
    refusal.reasons.join(","),
  );
}
