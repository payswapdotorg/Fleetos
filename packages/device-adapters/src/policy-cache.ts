/**
 * @fleetos/device-adapters — D5: Local signed-policy cache.
 *
 * The agent holds a local copy of the Contract Guardian's policy document
 * so it can make consequential-action decisions when offline or under
 * back-pressure. The cache is:
 *
 *   - **Versioned.** The policy document carries a `version` (>= 1) and a
 *     `policyId`. The agent refuses documents with versions below 1.
 *   - **Signature-verified.** The verify function is INJECTED — the lane
 *     has no crypto runtime dependency. The caller wires a verify
 *     function that knows the control plane's signing scheme (e.g.
 *     ed25519). The cache refuses to load a document whose signature
 *     fails verification.
 *   - **Staleness-aware.** The cache tracks `maxAgeMs` from the
 *     `fetchedAt` timestamp. When the cache is older than `maxAgeMs`, it
 *     is STALE and the agent MUST refetch before relying on it for
 *     consequential actions.
 *   - **Default-deny when stale/offline.** `authorizeConsequential`
 *     returns `ok: false` when the cache is empty, stale, or
 *     signature-invalid. The agent NEVER executes a destructive action
 *     on a stale or unverified policy. (ARCHITECTURE-LOCK.md item 16:
 *     "Destructive actions require an explicit policy grant and evidence
 *     trail".)
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type { PolicyId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  looksLikeIso,
  makeDomainError,
  makePolicyError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D5.1 — Signed policy document
// ---------------------------------------------------------------------------

/**
 * A versioned, signed policy document. The `payload` is OPAQUE to the
 * agent — the agent does not interpret policy content; it only enforces
 * the staleness and signature rules. The control plane is the sole
 * authority on policy interpretation.
 *
 * The `signature` is a detached signature over the canonical encoding of
 * `(version, policyId, signedAt, payload)`. The signature algorithm is
 * named by `signatureAlgorithm` (e.g. "ed25519"). The verify function is
 * injected by the caller (D5.3).
 */
export interface SignedPolicyDocument {
  /** The policy identifier (branded `PolicyId` from contracts). */
  readonly policyId: PolicyId;
  /** The policy document version (>= 1). */
  readonly version: number;
  /** ISO 8601 timestamp of when the control plane signed the document. */
  readonly signedAt: string;
  /** The opaque policy payload (JSON-serializable). */
  readonly payload: unknown;
  /** The detached signature (encoded per `signatureAlgorithm`). */
  readonly signature: string;
  /** The signature algorithm name (e.g. "ed25519"). */
  readonly signatureAlgorithm: string;
}

/**
 * Inputs needed to construct a `SignedPolicyDocument`. The lane does not
 * construct documents itself — the control plane does. This helper is
 * exposed for tests and for control-plane-side adapters that need to
 * produce documents.
 */
export interface SignedPolicyDocumentInputs {
  readonly policyId: PolicyId;
  readonly version: number;
  readonly signedAt: string;
  readonly payload: unknown;
  readonly signature: string;
  readonly signatureAlgorithm: string;
}

/**
 * Construct a `SignedPolicyDocument` from inputs. Pure, deterministic,
 * frozen. The lane does NOT verify the signature here — verification is
 * the cache's responsibility at `put` time.
 */
export function createSignedPolicyDocument(
  inputs: SignedPolicyDocumentInputs,
): SignedPolicyDocument {
  return frozen({
    policyId: inputs.policyId,
    version: inputs.version,
    signedAt: inputs.signedAt,
    payload: inputs.payload,
    signature: inputs.signature,
    signatureAlgorithm: inputs.signatureAlgorithm,
  });
}

// ---------------------------------------------------------------------------
// D5.2 — Cache entry
// ---------------------------------------------------------------------------

/**
 * A cached policy document plus the timestamp it was fetched. The
 * `fetchedAt` timestamp is the agent's local clock at the time the
 * document was stored — it is the basis for staleness comparison.
 */
export interface PolicyCacheEntry extends TenantScoped {
  /** The signed policy document. */
  readonly doc: SignedPolicyDocument;
  /** ISO 8601 timestamp of when the agent fetched the document (injected). */
  readonly fetchedAt: string;
}

// ---------------------------------------------------------------------------
// D5.3 — Signature verifier (injected)
// ---------------------------------------------------------------------------

/**
 * The signature verifier seam. The caller injects an implementation that
 * knows the control plane's signing scheme. The lane has NO crypto
 * runtime dependency — the verifier is the single point of pluggability.
 *
 * The verifier may be synchronous or asynchronous; the cache awaits it
 * at `put` time. The verifier returns `true` when the signature is valid
 * for the document, `false` otherwise. The verifier MUST NOT throw —
 * internal errors are surfaced as `false` (default-deny).
 */
export interface PolicySignatureVerifier {
  /**
   * Verify the signature on a signed policy document. Returns `true`
   * when the signature is valid; `false` otherwise (including on
   * internal errors — never throw).
   *
   * @param doc the signed policy document
   * @returns true when the signature is valid
   */
  verify(doc: SignedPolicyDocument): Promise<boolean> | boolean;
}

/**
 * A trivially-accepting verifier for tests. NEVER use in production — it
 * accepts any signature. Exposed for unit tests that need to focus on
 * staleness behaviour without setting up a real verifier.
 */
export const ACCEPT_ALL_VERIFIER: PolicySignatureVerifier = frozen({
  verify: () => true,
}) as PolicySignatureVerifier;

/**
 * A trivially-rejecting verifier for tests. NEVER use in production — it
 * rejects any signature, simulating a control plane whose signing key
 * has rotated.
 */
export const REJECT_ALL_VERIFIER: PolicySignatureVerifier = frozen({
  verify: () => false,
}) as PolicySignatureVerifier;

// ---------------------------------------------------------------------------
// D5.4 — Staleness rules
// ---------------------------------------------------------------------------

/**
 * The staleness rules for the cache. The cache is STALE when the
 * elapsed time since `fetchedAt` exceeds `maxAgeMs`. When stale, the
 * agent MUST refetch before relying on the cache for consequential
 * actions (`authorizeConsequential` returns `ok: false`).
 *
 * `mustRefetch` is a hard deadline: when the elapsed time exceeds
 * `mustRefetchMs`, the cache is treated as if empty (the agent MUST
 * refetch before ANY use, including non-consequential queries). When
 * `mustRefetchMs` is null, only `maxAgeMs` applies.
 *
 * Defaults: `maxAgeMs` 5 minutes (300_000); `mustRefetchMs` 1 hour
 * (3_600_000). These are conservative defaults; the caller may override.
 */
export interface PolicyStalenessRules {
  /** Maximum age in milliseconds before the cache is stale. */
  readonly maxAgeMs: number;
  /** Hard deadline in milliseconds before the cache is treated as empty. */
  readonly mustRefetchMs: number | null;
}

/** Default staleness rules: max-age 5 minutes, must-refetch 1 hour. */
export const DEFAULT_STALENESS_RULES: PolicyStalenessRules = frozen({
  maxAgeMs: 5 * 60 * 1000,
  mustRefetchMs: 60 * 60 * 1000,
} as const);

/**
 * The staleness status of the cache at a given time.
 *
 *   - `fresh` — within `maxAgeMs`; safe to use for consequential actions.
 *   - `stale` — past `maxAgeMs` but within `mustRefetchMs`; safe for
 *     non-consequential queries, default-deny for consequential.
 *   - `must_refetch` — past `mustRefetchMs` (or `maxAgeMs` when
 *     `mustRefetchMs` is null); treat as empty.
 *   - `empty` — no document loaded.
 */
export type PolicyCacheStaleness =
  | "fresh"
  | "stale"
  | "must_refetch"
  | "empty"
  | "signature_invalid";

// ---------------------------------------------------------------------------
// D5.5 — Cache options
// ---------------------------------------------------------------------------

/**
 * Options for `createPolicyCache`.
 */
export interface PolicyCacheOptions extends TenantScoped {
  /** The signature verifier (REQUIRED — no default). */
  readonly verifier: PolicySignatureVerifier;
  /** Staleness rules (default: `DEFAULT_STALENESS_RULES`). */
  readonly staleness?: PolicyStalenessRules;
}

// ---------------------------------------------------------------------------
// D5.6 — Cache interface
// ---------------------------------------------------------------------------

/**
 * The result of a `put` operation. Either the document was stored
 * (signature valid) or an error mapped onto the FleetError taxonomy.
 */
export type PolicyCachePutResult =
  | { ok: true; entry: PolicyCacheEntry }
  | { ok: false; error: ReturnType<typeof makeDomainError> };

/**
 * The result of a `get` operation. Either the cached document is
 * returned (with its staleness status) or a refusal reason.
 */
export type PolicyCacheGetResult =
  | { ok: true; doc: SignedPolicyDocument; staleness: PolicyCacheStaleness; fetchedAt: string }
  | { ok: false; reason: "empty" | "must_refetch" | "signature_invalid"; staleness: PolicyCacheStaleness };

/**
 * The result of an `authorizeConsequential` operation. Either the
 * action is authorized (cache fresh + signature valid) or refused
 * (default-deny). The refusal carries a `PolicyError` with
 * `decision: "BLOCK"`.
 */
export type AuthorizeConsequentialResult =
  | { ok: true; doc: SignedPolicyDocument; fetchedAt: string }
  | { ok: false; reason: "empty" | "stale" | "must_refetch" | "signature_invalid"; error: ReturnType<typeof makePolicyError> };

/**
 * The local signed-policy cache. The agent holds ONE entry per tenant
 * (the cache is tenant-scoped). The cache is in-memory; persistence
 * across agent restarts is the runtime's responsibility.
 */
export interface PolicyCache {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /**
   * Store a signed policy document. The verifier is consulted; if the
   * signature is invalid, the document is refused and the existing
   * entry (if any) is preserved.
   *
   * @param doc the signed policy document
   * @param fetchedAt ISO 8601 timestamp of when the agent fetched the document (injected)
   */
  put(doc: SignedPolicyDocument, fetchedAt: string): Promise<PolicyCachePutResult> | PolicyCachePutResult;
  /**
   * Read the cached document. Returns the staleness status alongside the
   * document. Returns `{ ok: false, reason: "empty" }` when no document
   * is loaded.
   *
   * @param at ISO 8601 timestamp of the read (injected; never the system clock)
   */
  get(at: string): PolicyCacheGetResult;
  /**
   * Authorize a consequential (destructive) action. Returns `ok: true`
   * only when the cache is fresh and signature-valid. Returns `ok: false`
   * with a `PolicyError` (`decision: "BLOCK"`) otherwise — default-deny.
   *
   * @param at ISO 8601 timestamp of the authorization decision (injected)
   * @param correlationId optional correlation id for traceability
   */
  authorizeConsequential(at: string, correlationId?: import("@fleetos/contracts").CorrelationId): AuthorizeConsequentialResult;
  /**
   * Pure predicate: is the cache stale at the given time?
   *
   * @param at ISO 8601 timestamp (injected)
   */
  isStale(at: string): boolean;
  /**
   * The staleness status at the given time.
   *
   * @param at ISO 8601 timestamp (injected)
   */
  staleness(at: string): PolicyCacheStaleness;
  /** Drop the cached document (treat as empty). Used on explicit revocation. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// D5.7 — Factory
// ---------------------------------------------------------------------------

/**
 * Create a local signed-policy cache.
 *
 * The cache is tenant-scoped (one entry per tenant). The signature
 * verifier is injected; the lane has no crypto runtime dependency.
 *
 * @throws Error when construction options are invalid: missing verifier,
 *   maxAgeMs < 1, mustRefetchMs < 1 (when present).
 */
export function createPolicyCache(options: PolicyCacheOptions): PolicyCache {
  if (!options.verifier || typeof options.verifier.verify !== "function") {
    throw new Error("createPolicyCache: verifier is required (must implement verify())");
  }
  const staleness = options.staleness ?? DEFAULT_STALENESS_RULES;
  if (!Number.isInteger(staleness.maxAgeMs) || staleness.maxAgeMs < 1) {
    throw new Error("createPolicyCache: staleness.maxAgeMs must be an integer >= 1");
  }
  if (staleness.mustRefetchMs !== null && (!Number.isInteger(staleness.mustRefetchMs) || staleness.mustRefetchMs < 1)) {
    throw new Error("createPolicyCache: staleness.mustRefetchMs must be an integer >= 1 or null");
  }

  let entry: PolicyCacheEntry | undefined;
  let signatureInvalid: boolean = false;

  function parseMs(iso: string): number | null {
    if (typeof iso !== "string" || !looksLikeIso(iso)) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }

  function stalenessAt(at: string): PolicyCacheStaleness {
    if (signatureInvalid) return "signature_invalid";
    if (entry === undefined) return "empty";
    const fetchedMs = parseMs(entry.fetchedAt);
    const atMs = parseMs(at);
    if (fetchedMs === null || atMs === null) return "must_refetch"; // bad timestamps => fail safe
    const elapsed = atMs - fetchedMs;
    if (elapsed < 0) return "must_refetch"; // clock skew => fail safe
    if (elapsed > staleness.maxAgeMs) {
      if (staleness.mustRefetchMs !== null && elapsed > staleness.mustRefetchMs) {
        return "must_refetch";
      }
      return "stale";
    }
    return "fresh";
  }

  async function put(doc: SignedPolicyDocument, fetchedAt: string): Promise<PolicyCachePutResult> {
    const trace: ErrorTrace = {
      tenantId: options.tenantId,
      correlationId: "" as import("@fleetos/contracts").CorrelationId,
    };
    if (typeof doc.version !== "number" || doc.version < 1) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.policyCacheSignatureInvalid,
          `policy document version is invalid: ${doc.version}`,
          trace,
          "device-adapters.policy-cache",
          "version_below_one",
        ),
      };
    }
    if (typeof fetchedAt !== "string" || !looksLikeIso(fetchedAt)) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.policyCacheSignatureInvalid,
          "fetchedAt is not ISO 8601",
          trace,
          "device-adapters.policy-cache",
          "fetched_at_not_iso",
        ),
      };
    }
    let verified: boolean;
    try {
      verified = await options.verifier.verify(doc);
    } catch {
      verified = false; // verifier MUST NOT throw; defend in depth
    }
    if (!verified) {
      // Do NOT overwrite a valid existing entry with an invalid one.
      signatureInvalid = true;
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.policyCacheSignatureInvalid,
          "policy document signature verification failed",
          trace,
          "device-adapters.policy-cache",
          "signature_invalid",
        ),
      };
    }
    signatureInvalid = false;
    // The document is already frozen by `createSignedPolicyDocument`; we
    // store it by reference. The cache entry itself is frozen below.
    entry = frozen({
      tenantId: options.tenantId,
      doc,
      fetchedAt,
    });
    return { ok: true, entry };
  }

  function get(at: string): PolicyCacheGetResult {
    const status = stalenessAt(at);
    if (entry === undefined || status === "empty") {
      return { ok: false, reason: "empty", staleness: "empty" };
    }
    if (status === "must_refetch") {
      return { ok: false, reason: "must_refetch", staleness: status };
    }
    if (status === "signature_invalid") {
      return { ok: false, reason: "signature_invalid", staleness: status };
    }
    return { ok: true, doc: entry.doc, staleness: status, fetchedAt: entry.fetchedAt };
  }

  function authorizeConsequential(
    at: string,
    correlationId?: import("@fleetos/contracts").CorrelationId,
  ): AuthorizeConsequentialResult {
    const trace: ErrorTrace = {
      tenantId: options.tenantId,
      correlationId: (correlationId ?? "") as import("@fleetos/contracts").CorrelationId,
    };
    const status = stalenessAt(at);
    if (status !== "fresh") {
      // Default-deny for ANY non-fresh status: empty, stale, must_refetch,
      // signature_invalid. ARCHITECTURE-LOCK.md item 16: "Destructive
      // actions require an explicit policy grant and evidence trail" —
      // the grant cannot be trusted when the cache is not fresh.
      const reasonMap: Record<PolicyCacheStaleness, "empty" | "stale" | "must_refetch" | "signature_invalid"> = {
        fresh: "fresh" as never, // unreachable: status !== "fresh"
        empty: "empty",
        stale: "stale",
        must_refetch: "must_refetch",
        signature_invalid: "signature_invalid",
      };
      return {
        ok: false,
        reason: reasonMap[status],
        error: makePolicyError(
          ERROR_CODES.policyCacheDefaultDeny,
          `consequential action default-denied: policy cache is ${status}`,
          trace,
          "BLOCK",
          [`policy.cache.${status}`],
        ),
      };
    }
    // status === "fresh" && entry !== undefined (stalenessAt guarantees this)
    return { ok: true, doc: entry!.doc, fetchedAt: entry!.fetchedAt };
  }

  return frozen({
    tenantId: options.tenantId,
    put,
    get,
    authorizeConsequential,
    isStale: (at: string) => {
      const status = stalenessAt(at);
      // `isStale` returns true for any non-fresh status, including
      // `empty` (the cache has no document — treat as offline) and
      // `signature_invalid` (the cache cannot be trusted). This is
      // the basis for default-deny at the consequential-action seam.
      return status !== "fresh";
    },
    staleness: stalenessAt,
    clear: () => {
      entry = undefined;
      signatureInvalid = false;
    },
  }) as PolicyCache;
}
