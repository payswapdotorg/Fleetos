/**
 * @fleetos/predictive — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the predictive modules: timestamp sanity + pure
 * epoch arithmetic, deterministic canonical JSON, content digests
 * (FNV-1a 32 for short stable ids; a pure FIPS 180-4 SHA-256 for the
 * provenance-grade input/content digests), immutability helpers, the
 * tenant-scope guard, and FleetError constructors mapped onto the
 * frozen `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1 rulings and the W011/W021/
 * W031/W040/W041/W070 implementations — this file mirrors the learning
 * lane's internal seam, the same-lane established pattern):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 *   - `Date.parse` is used ONLY over caller-supplied fixed ISO strings
 *     (deterministic per ECMAScript for ISO 8601); the wall-clock and
 *     Date-constructor APIs never appear (machine-asserted by the
 *     contract conformance suite).
 *   - The SHA-256 implementation is pure TypeScript arithmetic with a
 *     manual UTF-8 encoder (no platform-encoder dependency — the package
 *     typechecks under the ES2022-only lib config). It follows the
 *     same FIPS 180-4 approach as `apps/web/src/runtime/sha256.ts`
 *     (W144); byte-compatibility with that implementation is PROVEN by
 *     the binding-site test (the real web module satisfies this
 *     package's `FeatureDigestFn` seam and produces identical hex).
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

/**
 * Parse a fixed ISO 8601 string to epoch milliseconds. Deterministic per
 * ECMAScript for ISO 8601 inputs (no clock read: the input is always a
 * caller-supplied fixed string). Returns `null` when the string is not
 * parseable — callers turn that into an explicit machine-stable refusal
 * (never a silent zero, which could be mistaken for a measurement).
 */
export function epochMs(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Format epoch milliseconds as a canonical UTC ISO 8601 instant
 * (`YYYY-MM-DDTHH:MM:SS.mmmZ`) — the SAME shape `Date#toISOString`
 * produces, implemented with pure civil-calendar arithmetic so the
 * package never constructs a `Date` (the no-clock discipline stays
 * mechanically checkable). Deterministic: the same epoch always
 * serializes to the same string.
 */
export function epochToIsoUtc(ms: number): string {
  const totalDays = Math.floor(ms / MS_PER_DAY);
  const timeOfDay = ms - totalDays * MS_PER_DAY; // [0, 86400000)
  const hours = Math.floor(timeOfDay / 3_600_000);
  const minutes = Math.floor((timeOfDay % 3_600_000) / 60_000);
  const seconds = Math.floor((timeOfDay % 60_000) / 1000);
  const millis = timeOfDay % 1000;

  // Howard Hinnant's civil_from_days: days since 1970-01-01 -> (y, m, d).
  const z = totalDays + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  const civilYear = month <= 2 ? year + 1 : year;

  const pad = (value: number, width: number): string => value.toString().padStart(width, "0");
  return (
    `${pad(civilYear, 4)}-${pad(month, 2)}-${pad(day, 2)}` +
    `T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`
  );
}

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Deterministic canonical JSON + digests
// ---------------------------------------------------------------------------

/**
 * Deterministic (canonical) JSON serialization: object keys sorted
 * recursively, arrays preserved in order. Two JSON-serializable values
 * that are structurally equal produce the same string — the basis for
 * byte-identical feature sets and content digests in this package
 * (mirrors the device-model/health/policy/actions/recovery/arena/
 * learning canonical JSON seams; never used for security).
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
// Pure SHA-256 (FIPS 180-4) — the provenance-grade digest
// ---------------------------------------------------------------------------

/**
 * The SHA-256 round constants (FIPS 180-4) — the same table
 * `apps/web/src/runtime/sha256.ts` (W144) carries.
 */
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

/** Rotate a 32-bit word right by `n` bits. */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Manual UTF-8 encoding (pure arithmetic — no platform-encoder API, so
 * the package typechecks under the ES2022-only lib config). Handles
 * surrogate pairs; the output is byte-identical to the platform encoder
 * for every well-formed string (proven by the binding-site test).
 */
function utf8Bytes(message: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    let code = message.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < message.length) {
      const next = message.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return new Uint8Array(bytes);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>> 0
  );
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Pure SHA-256 (FIPS 180-4) over a UTF-8 string, lowercase hex output —
 * the provenance-grade digest behind the feature feed's input digest and
 * the feature-set content digest (W153: bit-reproducibility checks).
 * Same algorithm as `apps/web/src/runtime/sha256.ts` (W144); the
 * binding-site test proves the two implementations agree byte-for-byte
 * (and against the standard FIPS test vectors).
 */
export function sha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;
  // padded to a 64-byte multiple: message || 0x80 || zeros || 64-bit bit length
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  writeUint32BE(padded, paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  writeUint32BE(padded, paddedLength - 4, bitLength >>> 0);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = readUint32BE(padded, offset + i * 4);
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

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/**
 * Freeze a record at construction time. The predictive package never
 * mutates a returned structure in place: feature sets, provenance
 * records and store entries are derived values — a new derivation is a
 * NEW record, and the immutable observation inputs are never rewritten
 * (`spec/ARCHITECTURE-LOCK.md` item 3). Freezing is defense in depth.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into predictive state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// The tenant-scope guard (D4 tenant isolation)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope for every store operation and every boundary
 * check in this package: `{ tenantId, correlationId? }`. Structurally
 * identical to `@fleetos/identity`'s `TenantContext`, `@fleetos/learning`'s
 * `LearningTenantScope`, `@fleetos/actions`' `ActionTenantScope` and the
 * other lanes' scope seams (same structural-twin discipline — declared
 * LOCALLY because the src/ discipline of this package permits only
 * `@fleetos/contracts` imports; real sibling packages are injected at
 * the binding sites and proven by test). The guard validates the tenant
 * id against the canonical frozen grammar (`validateTenantRef`).
 */
export interface PredictiveTenantScope {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) tenant-scope check. Tagged union so
 * callers can branch on the failure mode without try/catch.
 */
export type PredictiveTenantCheck =
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
export function checkPredictiveTenantScope(scope: unknown): PredictiveTenantCheck {
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

/** Stable machine error codes used across the predictive lane. */
export const ERROR_CODES = {
  // D1 device-history feature extraction errors
  featuresInvalid: "predictive.features.invalid_request",
  // D2 provenance verification errors
  provenanceInvalid: "predictive.provenance.invalid_request",
  provenanceRefused: "predictive.provenance.refused",
  // D3 feature-store errors
  storeDomain: "predictive.store.domain",
  // D4 tenant isolation
  tenantScopeDomain: "predictive.tenant.scope",
} as const;

/** Traceability fields every predictive error must carry. */
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

/** Synthetic correlation id stamped on errors/audit when no request context exists. */
export const PREDICTIVE_PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId(
  "cor_predictive_pipeline",
);

/** Synthetic tenant stamped on errors that predate tenant attribution. */
export const SYNTHETIC_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");
