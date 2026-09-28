/**
 * @fleetos/device-adapters — W071: the signature-verified policy cache
 * wrapper.
 *
 * A hardening wrapper AROUND the existing local signed-policy cache
 * (policy-cache.ts — the W010 D5 surface, untouched). Every entry the
 * wrapper serves carries:
 *
 *   - a **deterministic content digest** over the canonical form of
 *     `(policyId, version, signedAt, payload, doc signature,
 *     signatureAlgorithm, fetchedAt)` — canonical JSON with recursively
 *     sorted keys (the lane's established discipline), digested FNV-1a
 *     (deterministic, dependency-free; never for security);
 *   - an **entry signature** — an HMAC-style MAC over that canonical
 *     form, produced by the cache-side caller and verified by an
 *     INJECTED signature verifier seam. The verifier is injected at
 *     construction and is NEVER a global (two caches with different
 *     verifiers never cross-accept — proven by test).
 *
 * Serve-boundary enforcement (the security property): an entry that is
 * UNSIGNED (`unsigned_entry`) or whose recomputed digest / MAC fails
 * (`signature_mismatch`) is refused machine-stably and is NEVER served
 * from the cache — not by `get`, not by `authorizeConsequential`. The
 * entry may sit in the cache (it models data loaded through an
 * unvalidated path, including a document written directly into the
 * wrapped inner cache), but it is never served.
 *
 * Staleness behavior of the existing cache is PRESERVED VERBATIM by
 * delegation: every staleness decision (`staleness`, `isStale`, the
 * `empty` / `stale` / `must_refetch` / `signature_invalid` refusal
 * reasons, the serve-stale-on-get / default-deny-on-authorize split)
 * is computed by the WRAPPED cache, never re-implemented here. The one
 * deliberate hardening: `isStale` — the trust predicate behind
 * policy-cache readiness — additionally reports `true` when the
 * wrapper's entry fails integrity verification (fail-closed; a cache
 * whose entry cannot be trusted is not fresh). The pure time-based
 * `staleness` status remains the inner cache's verbatim answer.
 *
 * ADDITIVE ONLY: the existing `PolicyCache` surface (types, functions,
 * tests) is untouched; this module is new beside it.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
} from "./internal";
import type { ErrorTrace } from "./internal";
import { makeDomainError, makePolicyError } from "./internal";
import type {
  AuthorizeConsequentialResult,
  PolicyCache,
  PolicyCacheStaleness,
  SignedPolicyDocument,
} from "./policy-cache";

// ---------------------------------------------------------------------------
// W071.1 — Machine-stable error codes (module-local, additive)
// ---------------------------------------------------------------------------

/**
 * Stable machine error codes for the signed-policy-cache wrapper.
 * Module-local (the existing `ERROR_CODES` map in internal.ts is not
 * edited — additive-only discipline).
 */
export const SIGNED_POLICY_CACHE_ERROR_CODES = {
  unsignedEntry: "agent.policy_cache.unsigned_entry",
  signatureMismatch: "agent.policy_cache.signature_mismatch",
} as const;

// ---------------------------------------------------------------------------
// W071.2 — The canonical form + content digest
// ---------------------------------------------------------------------------

/**
 * The canonical form of a cache entry: the canonical JSON (recursively
 * sorted keys) of `(policyId, version, signedAt, payload, signature,
 * signatureAlgorithm, fetchedAt)`. Deterministic: two entries that are
 * structurally equal serialize byte-identically regardless of the
 * payload's key order. This is the HMAC-style MAC's message.
 */
export function signedPolicyCacheCanonicalForm(
  doc: SignedPolicyDocument,
  fetchedAt: string,
): string {
  return canonicalJson([
    doc.policyId,
    doc.version,
    doc.signedAt,
    doc.payload,
    doc.signature,
    doc.signatureAlgorithm,
    fetchedAt,
  ]);
}

/**
 * The deterministic content digest of a cache entry: FNV-1a over the
 * canonical form (8 lowercase hex chars; never for security). The digest
 * is recomputed at the serve boundary — a stored digest that disagrees
 * with the recomputed one means the entry's content was tampered with
 * after storage (defense in depth; unreachable through this module's
 * own public API, which always digests what it stores).
 */
export function signedPolicyCacheEntryDigest(
  doc: SignedPolicyDocument,
  fetchedAt: string,
): string {
  return fnv1a32Hex(signedPolicyCacheCanonicalForm(doc, fetchedAt));
}

// ---------------------------------------------------------------------------
// W071.3 — The injected signature verifier seam
// ---------------------------------------------------------------------------

/**
 * The entry-signature verifier seam — HMAC-style over the canonical
 * form. INJECTED at construction; never a global. The implementation
 * knows the MAC scheme and key; it returns `true` when `signature` is a
 * valid MAC over `canonicalForm`, `false` otherwise. The verifier MUST
 * NOT throw — internal errors surface as `false` (default-deny, the
 * same discipline as the W010 D5 `PolicySignatureVerifier`).
 */
export interface SignedPolicyEntryVerifier {
  /** Verify an entry signature over the canonical form. Never throws. */
  verify(canonicalForm: string, signature: string): boolean;
}

/**
 * The deterministic reference verifier — a keyed FNV-1a digest
 * (`fnv1a32(secret + ":" + canonicalForm + ":" + secret)`), exposed for
 * tests and in-memory deployments. Production MUST inject a real
 * HMAC (or equivalent) — this reference is dependency-free and carries
 * no cryptographic strength (the lane's digest convention: never for
 * security). Two different secrets never cross-accept (proven by test).
 */
export function createDeterministicEntryVerifier(secret: string): SignedPolicyEntryVerifier {
  return frozen({
    verify(canonicalForm: string, signature: string): boolean {
      return signature === computeDeterministicEntrySignature(secret, canonicalForm);
    },
  });
}

/**
 * Compute the reference entry signature (the matching signer for
 * `createDeterministicEntryVerifier`). Deterministic, dependency-free;
 * never for security.
 */
export function computeDeterministicEntrySignature(
  secret: string,
  canonicalForm: string,
): string {
  return `mac_${fnv1a32Hex(`${secret}:${canonicalForm}:${secret}`)}`;
}

// ---------------------------------------------------------------------------
// W071.4 — The signed cache entry
// ---------------------------------------------------------------------------

/**
 * A cache entry as the wrapper stores it: the signed policy document,
 * the fetch instant, the deterministic content digest, and the
 * HMAC-style entry signature (ABSENT when the entry entered the cache
 * unsigned — such entries are stored but never served).
 */
export interface SignedPolicyCacheEntry extends TenantScoped {
  /** The signed policy document (opaque payload — the agent never interprets it). */
  readonly doc: SignedPolicyDocument;
  /** ISO 8601 timestamp of when the agent fetched the document (injected). */
  readonly fetchedAt: string;
  /** The deterministic content digest over the canonical form. */
  readonly contentDigest: string;
  /** The HMAC-style entry signature over the canonical form; absent = unsigned. */
  readonly entrySignature?: string;
}

// ---------------------------------------------------------------------------
// W071.5 — Results (additive result types; the existing ones untouched)
// ---------------------------------------------------------------------------

/**
 * The refusal reasons at the wrapper's serve boundary: the existing
 * cache's verbatim reasons (`empty` / `must_refetch` /
 * `signature_invalid`, plus the authorize-only `stale`) PLUS the
 * hardening reasons `unsigned_entry` and `signature_mismatch`.
 */
export type SignedPolicyCacheRefusalReason =
  | "empty"
  | "stale"
  | "must_refetch"
  | "signature_invalid"
  | "unsigned_entry"
  | "signature_mismatch";

/** The result of the wrapper's `get`. */
export type SignedPolicyCacheGetResult =
  | {
      readonly ok: true;
      readonly doc: SignedPolicyDocument;
      readonly staleness: PolicyCacheStaleness;
      readonly fetchedAt: string;
      readonly contentDigest: string;
    }
  | {
      readonly ok: false;
      readonly reason: SignedPolicyCacheRefusalReason;
      readonly staleness: PolicyCacheStaleness;
    };

/** The result of the wrapper's `authorizeConsequential` (default-deny). */
export type SignedAuthorizeConsequentialResult =
  | {
      readonly ok: true;
      readonly doc: SignedPolicyDocument;
      readonly fetchedAt: string;
      readonly contentDigest: string;
    }
  | {
      readonly ok: false;
      readonly reason: SignedPolicyCacheRefusalReason;
      readonly error: ReturnType<typeof makePolicyError>;
    };

/** The result of the wrapper's `put` (delegates the doc verification to the inner cache). */
export type SignedPolicyCachePutResult =
  | { readonly ok: true; readonly entry: SignedPolicyCacheEntry }
  | { readonly ok: false; readonly error: ReturnType<typeof makeDomainError> };

// ---------------------------------------------------------------------------
// W071.6 — The wrapper
// ---------------------------------------------------------------------------

/** Options for `createSignedPolicyCache`. */
export interface SignedPolicyCacheOptions {
  /** The existing policy cache being wrapped (staleness delegated verbatim). */
  readonly inner: PolicyCache;
  /**
   * The INJECTED entry-signature verifier (HMAC-style over the canonical
   * form; REQUIRED — never a global, never defaulted).
   */
  readonly verifier: SignedPolicyEntryVerifier;
}

/**
 * The signature-verified policy cache: a hardening wrapper around the
 * existing `PolicyCache`. Entries carry a deterministic content digest
 * and an HMAC-style entry signature verified at the serve boundary;
 * unsigned or mismatched entries are refused machine-stably and NEVER
 * served. Staleness behavior is the wrapped cache's, verbatim.
 */
export interface SignedPolicyCache {
  /** The tenant scope (structural tenant isolation — same as the wrapped cache). */
  readonly tenantId: TenantId;
  /** The wrapped cache (exposed for composition; its surface is unchanged). */
  readonly inner: PolicyCache;
  /**
   * Store a signed policy document. Delegates the DOCUMENT-level
   * signature verification and staleness bookkeeping to the wrapped
   * cache verbatim (a document the inner cache refuses is refused
   * here, nothing cached). The wrapper additionally records the
   * deterministic content digest and the caller-supplied entry
   * signature — which MAY be absent (the entry is then stored but
   * never served: `unsigned_entry`).
   */
  put(
    doc: SignedPolicyDocument,
    fetchedAt: string,
    entrySignature?: string,
  ): Promise<SignedPolicyCachePutResult> | SignedPolicyCachePutResult;
  /**
   * Read the cached document. The wrapped cache's staleness refusal
   * reasons surface verbatim; a servable (fresh or stale) entry is
   * served ONLY after integrity verification — unsigned or mismatched
   * entries are refused machine-stably and never served.
   */
  get(at: string): SignedPolicyCacheGetResult;
  /**
   * Authorize a consequential (destructive) action. Default-deny: the
   * entry must pass integrity verification AND the wrapped cache must
   * report it fresh + signature-valid. Hardening refusals
   * (`unsigned_entry`, `signature_mismatch`) carry a `PolicyError`
   * with `decision: "BLOCK"` (ARCHITECTURE-LOCK item 16 — an
   * untrusted cache can never grant a destructive action).
   */
  authorizeConsequential(
    at: string,
    correlationId?: CorrelationId,
  ): SignedAuthorizeConsequentialResult;
  /**
   * The trust predicate: true when the entry fails integrity
   * verification (fail-closed) OR the wrapped cache reports any
   * non-fresh status.
   */
  isStale(at: string): boolean;
  /** The pure time-based staleness status — the wrapped cache's answer, verbatim. */
  staleness(at: string): PolicyCacheStaleness;
  /** Drop the cached document (both the wrapper's entry and the wrapped cache's). */
  clear(): void;
}

/**
 * Create the signature-verified policy cache wrapper.
 *
 * @throws Error when construction options are invalid (missing inner
 *   cache or missing/invalid verifier).
 */
export function createSignedPolicyCache(options: SignedPolicyCacheOptions): SignedPolicyCache {
  if (!options.inner || typeof options.inner !== "object") {
    throw new Error("createSignedPolicyCache: inner cache is required");
  }
  if (!options.verifier || typeof options.verifier.verify !== "function") {
    throw new Error("createSignedPolicyCache: verifier is required (must implement verify())");
  }
  const inner = options.inner;
  const verifier = options.verifier;

  let entry: SignedPolicyCacheEntry | undefined;

  function trace(correlationId?: CorrelationId): ErrorTrace {
    return {
      tenantId: inner.tenantId,
      correlationId: (correlationId ?? "") as CorrelationId,
    };
  }

  /**
   * The integrity verification of the wrapper's entry. Returns the
   * machine-stable refusal reason when the entry must never be served
   * (`unsigned_entry` / `signature_mismatch`), or `null` when the
   * entry is verified. A missing entry is `unsigned_entry` (an entry
   * that cannot be proven signed is unsigned — fail-safe; reachable
   * when a document was written directly into the wrapped cache,
   * bypassing this wrapper's put).
   */
  function integrityFailure(): "unsigned_entry" | "signature_mismatch" | null {
    if (entry === undefined) return "unsigned_entry";
    if (typeof entry.entrySignature !== "string" || entry.entrySignature.length === 0) {
      return "unsigned_entry";
    }
    const canonical = signedPolicyCacheCanonicalForm(entry.doc, entry.fetchedAt);
    // Defense in depth: the stored digest must agree with the digest
    // recomputed from the content actually stored.
    if (entry.contentDigest !== fnv1a32Hex(canonical)) {
      return "signature_mismatch";
    }
    let verified: boolean;
    try {
      verified = verifier.verify(canonical, entry.entrySignature);
    } catch {
      verified = false; // the verifier MUST NOT throw; defend in depth
    }
    if (!verified) return "signature_mismatch";
    return null;
  }

  async function put(
    doc: SignedPolicyDocument,
    fetchedAt: string,
    entrySignature?: string,
  ): Promise<SignedPolicyCachePutResult> {
    // Delegate the document-level verification + staleness bookkeeping to
    // the wrapped cache VERBATIM. A document the inner cache refuses is
    // refused here (its error verbatim) and nothing is cached.
    const innerPut = await inner.put(doc, fetchedAt);
    if (!innerPut.ok) {
      return { ok: false, error: innerPut.error as ReturnType<typeof makeDomainError> };
    }
    if (typeof fetchedAt !== "string" || !looksLikeIso(fetchedAt)) {
      // Unreachable via the inner cache's own validation; kept fail-safe.
      return {
        ok: false,
        error: makeDomainError(
          SIGNED_POLICY_CACHE_ERROR_CODES.signatureMismatch,
          "fetchedAt is not ISO 8601",
          trace(),
          "device-adapters.signed-policy-cache",
          "fetched_at_not_iso",
        ),
      };
    }
    // The wrapper's entry: digest of what is stored, plus the
    // caller-supplied entry signature (absent = stored unsigned —
    // never served).
    entry = frozen({
      tenantId: inner.tenantId,
      doc,
      fetchedAt,
      contentDigest: signedPolicyCacheEntryDigest(doc, fetchedAt),
      ...(typeof entrySignature === "string" && entrySignature.length > 0
        ? { entrySignature }
        : {}),
    });
    return { ok: true, entry };
  }

  function get(at: string): SignedPolicyCacheGetResult {
    // 1. The wrapped cache's refusal reasons surface VERBATIM (empty /
    //    must_refetch / signature_invalid — staleness behavior preserved).
    const innerGet = inner.get(at);
    if (!innerGet.ok) {
      return { ok: false, reason: innerGet.reason, staleness: innerGet.staleness };
    }
    // 2. The wrapped cache would serve (fresh or stale — the existing
    //    get serves stale documents by design). NOW the hardening layer
    //    verifies entry integrity: unsigned/mismatched entries are
    //    NEVER served.
    const failure = integrityFailure();
    if (failure !== null) {
      return { ok: false, reason: failure, staleness: innerGet.staleness };
    }
    const verified = entry as SignedPolicyCacheEntry;
    return {
      ok: true,
      doc: verified.doc,
      staleness: innerGet.staleness,
      fetchedAt: verified.fetchedAt,
      contentDigest: verified.contentDigest,
    };
  }

  function authorizeConsequential(
    at: string,
    correlationId?: CorrelationId,
  ): SignedAuthorizeConsequentialResult {
    // 0. The EMPTY-cache refusal is the wrapped cache's verbatim answer
    //    (staleness behavior preserved exactly). A NON-empty inner cache
    //    without a wrapper entry means the entry bypassed the wrapper's
    //    put — fail-safe unsigned.
    if (entry === undefined && inner.staleness(at) === "empty") {
      const innerAuthorize = inner.authorizeConsequential(at, correlationId);
      if (!innerAuthorize.ok) {
        return {
          ok: false,
          reason: innerAuthorize.reason,
          error: innerAuthorize.error as ReturnType<typeof makePolicyError>,
        };
      }
      // Unreachable (staleness "empty" never authorizes); fail-safe:
      return {
        ok: false,
        reason: "unsigned_entry",
        error: makePolicyError(
          SIGNED_POLICY_CACHE_ERROR_CODES.unsignedEntry,
          "consequential action default-denied: policy cache entry is unsigned_entry",
          trace(correlationId),
          "BLOCK",
          ["policy.cache.unsigned_entry"],
        ),
      };
    }
    // 1. Hardening first: an untrusted entry can never grant a
    //    consequential action (default-deny, PolicyError BLOCK).
    const failure = integrityFailure();
    if (failure !== null) {
      return {
        ok: false,
        reason: failure,
        error: makePolicyError(
          failure === "unsigned_entry"
            ? SIGNED_POLICY_CACHE_ERROR_CODES.unsignedEntry
            : SIGNED_POLICY_CACHE_ERROR_CODES.signatureMismatch,
          `consequential action default-denied: policy cache entry is ${failure}`,
          trace(correlationId),
          "BLOCK",
          [`policy.cache.${failure}`],
        ),
      };
    }
    // 2. Delegate the fresh/stale/empty/signature_invalid default-deny
    //    decision to the wrapped cache VERBATIM, attaching the entry's
    //    content digest on grant.
    const innerAuthorize: AuthorizeConsequentialResult = inner.authorizeConsequential(
      at,
      correlationId,
    );
    if (!innerAuthorize.ok) {
      return {
        ok: false,
        reason: innerAuthorize.reason,
        error: innerAuthorize.error as ReturnType<typeof makePolicyError>,
      };
    }
    const verified = entry as SignedPolicyCacheEntry;
    return {
      ok: true,
      doc: innerAuthorize.doc,
      fetchedAt: innerAuthorize.fetchedAt,
      contentDigest: verified.contentDigest,
    };
  }

  return frozen({
    tenantId: inner.tenantId,
    inner,
    put,
    get,
    authorizeConsequential,
    isStale(at: string): boolean {
      // Fail-closed trust predicate: an entry that fails integrity
      // verification is NOT fresh, whatever the clock says.
      if (integrityFailure() !== null) return true;
      return inner.isStale(at);
    },
    staleness(at: string): PolicyCacheStaleness {
      // The pure time-based status: the wrapped cache's verbatim answer.
      return inner.staleness(at);
    },
    clear(): void {
      entry = undefined;
      inner.clear();
    },
  }) as SignedPolicyCache;
}

/**
 * A trivially-accepting entry verifier for tests. NEVER use in
 * production — it accepts any signature (the mirror of the W010
 * `ACCEPT_ALL_VERIFIER` discipline).
 */
export const ACCEPT_ALL_ENTRY_VERIFIER: SignedPolicyEntryVerifier = frozen({
  verify: () => true,
});

/**
 * A trivially-rejecting entry verifier for tests. NEVER use in
 * production — it rejects any signature.
 */
export const REJECT_ALL_ENTRY_VERIFIER: SignedPolicyEntryVerifier = frozen({
  verify: () => false,
});
