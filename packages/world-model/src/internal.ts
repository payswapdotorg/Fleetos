/**
 * @fleetos/world-model — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the world-model engine (W154 lane B): timestamp
 * sanity, deterministic canonical JSON, content digests (FNV-1a 32-bit
 * for short stable ids, SHA-256 for provenance-grade digests that must
 * be cryptographically collision-resistant across tenant scopes),
 * immutability helpers, ref normalization, the tenant-scope guard,
 * and FleetError constructors mapped onto the frozen
 * `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1 rulings and the W011/W021/
 * W031/W040/W041/W070/W153 implementations — this file mirrors
 * `@fleetos/predictive`'s internal seam, the same-lane established
 * pattern; the SHA-256 seam mirrors `apps/web/src/runtime/sha256.ts`,
 * accessed structurally so the world-model package stays pure):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 *
 * The src/ discipline permits only `@fleetos/contracts` AND
 * `@fleetos/predictive` imports (the W154 work order: "It CONSUMES
 * `@fleetos/predictive` through its public surface ONLY"). Every other
 * domain surface is consumed through STRUCTURAL seams injected at the
 * binding site (the W040-disclosed pattern).
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
 * the device-model/health/policy/actions/recovery/learning/arena/predictive
 * canonical JSON seams; never used for security).
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
 * subpath documents for string-seeded PRNGs, and the same seam used by
 * `@fleetos/device-model`/`@fleetos/learning`/`@fleetos/predictive` for
 * stable short content digests in deterministic ids (never for security).
 */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Pure SHA-256 (FIPS 180-4) over a UTF-8 string, hex output. Mirrors
 * `apps/web/src/runtime/sha256.ts`'s `sha256Hex` implementation verbatim
 * (the W144 deploy-convergence seam; the W153 predictive feed's
 * `internal.ts` ships the same verbatim seam). The reference
 * implementation is pure TypeScript arithmetic — the world-model package
 * stays dependency-free (ADR-0002 invariant 8: "No GPU, no model
 * provider, no network — the deterministic reference implementation is
 * pure TypeScript arithmetic over the W153 features").
 *
 * Used for provenance-chain digests that need to be cryptographically
 * collision-resistant across tenant scopes (an attacker cannot choose a
 * second feature set + context that hashes to the same provenance-chain
 * digest). The FNV-1a 32-bit hash is fine for short deterministic ids
 * where the input domain is bounded (e.g. tenant-scoped prediction ids);
 * it is NOT acceptable for provenance-chain digests that span the full
 * representation+prediction multispace, which is why SHA-256 is used there.
 */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  // padded to a 64-byte multiple: message || 0x80 || zeros || 64-bit bit length
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** Rotate a 32-bit word right by `n` bits. */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** The SHA-256 round constants (FIPS 180-4). */
const SHA256_K: readonly number[] = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/**
 * Freeze a record at construction time. The world-model package never
 * mutates a returned structure in place: representations and predictions
 * are versioned interpretations — a new version is a NEW record, and
 * the old one is never rewritten (`spec/ARCHITECTURE.md` § Canonical
 * model, `spec/ARCHITECTURE-LOCK.md` item 3: observations/events are
 * immutable; interpretations are versioned). Freezing is defense in
 * depth.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into world-model state).
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
 * output array — the basis for byte-identical representations across
 * input permutations (proven by test). Non-string entries are dropped
 * (the engine validates inputs before deriving; this is defense in
 * depth).
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

// ---------------------------------------------------------------------------
// The tenant-scope guard (D4)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope for every world-model operation:
 * `{ tenantId, correlationId? }`. Structurally identical to
 * `@fleetos/identity`'s `TenantContext`, `@fleetos/policy`'s
 * `PolicyTenantScope`, `@fleetos/actions`' `ActionTenantScope`,
 * `@fleetos/recovery`'s `RecoveryTenantScope`, `@fleetos/learning`'s
 * `LearningTenantScope`, the arena lane's `ArenaTenantScope`, AND
 * `@fleetos/predictive`'s `PredictiveTenantScope` (same
 * structural-twin discipline — declared LOCALLY because the src/
 * discipline of this package permits only `@fleetos/contracts` +
 * `@fleetos/predictive` imports; real sibling packages are injected at
 * the binding sites and proven by test). The guard validates the
 * tenant id against the canonical frozen grammar (`validateTenantRef`).
 */
export interface WorldModelTenantScope {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) tenant-scope check. Tagged union so
 * callers can branch on the failure mode without try/catch.
 */
export type WorldModelTenantCheck =
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
 * construction (`spec/ARCHITECTURE-LOCK.md` item 17: "Tenant isolation is
 * enforced at persistence and action boundaries").
 *
 * @param scope the candidate scope
 * @returns the tagged check result
 */
export function checkWorldModelTenantScope(scope: unknown): WorldModelTenantCheck {
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

/** Stable machine error codes used across the world-model lane. */
export const ERROR_CODES = {
  // D1 representation errors
  representationInvalid: "world-model.representation.invalid_request",
  representationDomain: "world-model.representation.domain",
  representationComparison: "world-model.representation.comparison",
  // D2 prediction errors
  predictionInvalid: "world-model.prediction.invalid_request",
  predictionDomain: "world-model.prediction.domain",
  // D3 adapter errors
  adapterDomain: "world-model.adapter.domain",
  // D4 tenant isolation
  tenantScopeDomain: "world-model.tenant.scope",
} as const;

/** Traceability fields every world-model error must carry. */
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
export const WORLD_MODEL_PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId("cor_world_model_pipeline");

/** Synthetic tenant stamped on errors that predate tenant attribution. */
export const SYNTHETIC_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");
