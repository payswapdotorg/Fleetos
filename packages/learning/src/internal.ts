/**
 * @fleetos/learning — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the learning modules: timestamp sanity,
 * deterministic canonical JSON, content digests, immutability helpers,
 * the tenant-scope guard, and FleetError constructors mapped onto the
 * frozen `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1 rulings and the W011/W021/
 * W031/W040/W041/W050B implementations — this file mirrors the arena
 * lane's internal seam, the same-lane established pattern):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 */

import { asCorrelationId, asTenantId, validateTenantRef } from "@fleetos/contracts";
import type {
  CorrelationId,
  DomainError,
  TenantId,
  ValidationError,
  ValidationFailure,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Timestamp sanity + parsing
// ---------------------------------------------------------------------------

/**
 * Minimal ISO 8601 sanity check — deliberately the SAME laxness as the
 * frozen contracts validators (`validateEnvelope`,
 * `validateObservationBatch`): the string must contain a `T` followed by
 * two digits, a colon, and two more digits. Anything stricter would reject
 * valid ISO 8601 variants the frozen contracts accept.
 */
export function looksLikeIso(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

// ---------------------------------------------------------------------------
// Deterministic canonical JSON + digests
// ---------------------------------------------------------------------------

/**
 * Deterministic (canonical) JSON serialization: object keys sorted
 * recursively, arrays preserved in order. Two JSON-serializable values
 * that are structurally equal produce the same string — the basis for
 * deterministic record ids and content digests in this package (mirrors
 * the device-model/health/policy/actions/recovery/arena canonical JSON
 * seams; never used for security).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return primitive(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => serialize(entry)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => JSON.stringify(key) + ":" + serialize(record[key])).join(",");
  return "{" + body + "}";
}

function primitive(value: unknown): string {
  if (value === undefined) return "null"; // JSON.stringify(array) semantics
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/**
 * FNV-1a 32-bit hash as 8 lowercase hex chars. Deterministic,
 * dependency-free — the same algorithm the frozen contracts testing
 * subpath documents for string-seeded PRNGs. Used for stable, short
 * content digests in deterministic ids (never for security).
 */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/**
 * Freeze a record at construction time. The learning package never
 * mutates a returned structure in place: outcome observations, gated
 * proposals, and adoption records are versioned — a new version is a NEW
 * record, and the old one is never rewritten (`spec/ARCHITECTURE.md`
 * § Canonical model). Freezing is defense in depth.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into learning state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// Reference normalization (deterministic across input permutations)
// ---------------------------------------------------------------------------

/**
 * Normalize a list of opaque refs: drop empties, deduplicate, sort. The
 * SAME multiset of refs in ANY input order produces the SAME frozen
 * output array — the basis for byte-identical records across input
 * permutations (proven by test). Non-string entries are dropped (the
 * seams validate inputs before deriving; this is defense in depth).
 */
export function normalizeRefs(refs: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (typeof ref === "string" && ref.length > 0) {
      seen.add(ref);
    }
  }
  return Object.freeze([...seen].sort());
}

/**
 * Normalize a list of evidence artifacts: deduplicate by object-storage
 * key, sort by key. Deterministic across input permutations (proven by
 * test). Malformed entries are dropped (defense in depth; the seams
 * validate before deriving).
 */
export function normalizeEvidence(
  evidence: readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[],
): readonly {
  readonly key: string;
  readonly sizeBytes: number;
  readonly hash: string;
  readonly hashAlgorithm: string;
}[] {
  const byKey = new Map<string, {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }>();
  for (const entry of evidence) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.key !== "string" || entry.key.length === 0) continue;
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }
  return Object.freeze([...byKey.keys()].sort().map((key) => byKey.get(key) as {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }));
}

// ---------------------------------------------------------------------------
// The tenant-scope guard (D4)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope for every store operation in this package:
 * `{ tenantId, correlationId? }`. Structurally identical to
 * `@fleetos/identity`'s `TenantContext`, `@fleetos/policy`'s
 * `PolicyTenantScope`, `@fleetos/actions`' `ActionTenantScope`,
 * `@fleetos/recovery`'s `RecoveryTenantScope` and the arena lane's
 * `ArenaTenantScope` (same structural-twin discipline — declared LOCALLY
 * because the src/ discipline of this package permits only
 * `@fleetos/contracts` imports; real sibling packages are injected at
 * the binding sites and proven by test). The guard validates the tenant
 * id against the canonical frozen grammar (`validateTenantRef`).
 */
export interface LearningTenantScope {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) tenant-scope check. Tagged union so
 * callers can branch on the failure mode without try/catch.
 */
export type LearningTenantCheck =
  | { readonly ok: true; readonly tenantId: TenantId }
  | {
      readonly ok: false;
      readonly reason: "missing_scope" | "invalid_tenant_id";
      readonly detail: string;
    };

/**
 * Pure, non-throwing tenant-scope check. Accepts `unknown` so callers can
 * validate at runtime boundaries even when the type system is bypassed
 * (`undefined as never` — proven by test). A scope without a tenant id or
 * with a tenant id that fails the canonical frozen grammar is rejected:
 * context-free access to tenant-partitioned state is forbidden by
 * construction (`spec/ARCHITECTURE-LOCK.md` item 17).
 *
 * @param scope the candidate scope
 * @returns the tagged check result
 */
export function checkLearningTenantScope(scope: unknown): LearningTenantCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reason: "missing_scope", detail: "tenant scope is absent" };
  }
  const candidate = scope as { tenantId?: unknown };
  if (typeof candidate.tenantId !== "string" || candidate.tenantId.length === 0) {
    return { ok: false, reason: "missing_scope", detail: "tenant scope carries no tenantId" };
  }
  const ref = validateTenantRef(asTenantId(candidate.tenantId));
  if (!ref.ok) {
    return { ok: false, reason: "invalid_tenant_id", detail: `tenantId ${ref.reason}` };
  }
  return { ok: true, tenantId: ref.tenantId };
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the learning lane. */
export const ERROR_CODES = {
  // D1 outcome-observation errors
  observationInvalid: "learning.observation.invalid_request",
  observationStoreDomain: "learning.observation.store",
  // D2 evaluation-conversion errors
  conversionInvalid: "learning.conversion.invalid_request",
  conversionDomain: "learning.conversion.domain",
  // D3 adoption-ledger errors
  adoptionInvalid: "learning.adoption.invalid_request",
  adoptionStoreDomain: "learning.adoption.store",
  adoptionSupersessionIllegal: "learning.adoption.illegal_supersession",
  certificationRefused: "learning.certification.refused",
  // D4 tenant isolation
  tenantScopeDomain: "learning.tenant.scope",
} as const;

/** Traceability fields every learning error must carry. */
export interface ErrorTrace {
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
}

export function makeDomainError(
  code: string,
  message: string,
  trace: ErrorTrace,
  domain: string,
  invariant: string,
): DomainError {
  return frozen<DomainError>({
    kind: "DomainError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    domain,
    invariant,
  });
}

export function makeValidationError(
  code: string,
  message: string,
  trace: ErrorTrace,
  failures: readonly ValidationFailure[],
): ValidationError {
  return frozen<ValidationError>({
    kind: "ValidationError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    failures: frozenArray(failures),
  });
}

/** Synthetic correlation id stamped on errors when no request context exists. */
export const LEARNING_PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId("cor_learning_pipeline");

/** Synthetic tenant stamped on errors that predate tenant attribution. */
export const SYNTHETIC_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");
