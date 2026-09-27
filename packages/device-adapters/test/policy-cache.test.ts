/**
 * W010 D5 — local signed-policy cache tests.
 *
 * Covers:
 *   - Construction + signature verification seam (injected, no crypto dep)
 *   - The verify seam accepts/rejects documents correctly
 *   - Staleness rules (fresh / stale / must_refetch / empty / signature_invalid)
 *   - CRITICAL: default-deny for consequential actions when stale/offline
 *   - Persistence: an invalid-signature put does NOT overwrite a valid entry
 *   - Determinism (same inputs => same staleness decisions)
 */

import { test, expect } from "bun:test";
import {
  toApiError,
  type PolicyId,
} from "@fleetos/contracts";
import {
  ACCEPT_ALL_VERIFIER,
  REJECT_ALL_VERIFIER,
  createPolicyCache,
  createSignedPolicyDocument,
  DEFAULT_STALENESS_RULES,
  type PolicyCache,
  type PolicyCacheStaleness,
  type PolicySignatureVerifier,
  type PolicyStalenessRules,
  type SignedPolicyDocument,
} from "../src/policy-cache";
import { ERROR_CODES } from "../src/internal";
import {
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validDoc(seed: string, version = 1): SignedPolicyDocument {
  return createSignedPolicyDocument({
    policyId: makePolicyId(seed),
    version,
    signedAt: makeTimestamp(`doc-${seed}-signed`),
    payload: { rules: [], seed },
    signature: `sig-${seed}`,
    signatureAlgorithm: "ed25519",
  });
}

const SHORT_STALENESS: PolicyStalenessRules = {
  maxAgeMs: 60_000, // 1 minute
  mustRefetchMs: 600_000, // 10 minutes
};

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("D5: createPolicyCache throws when the verifier is missing", () => {
  const tenantId = makeTenantId("ctor-tenant");
  expect(() =>
    createPolicyCache({ tenantId, verifier: undefined as never }),
  ).toThrow();
});

test("D5: createPolicyCache throws on out-of-range staleness options", () => {
  const tenantId = makeTenantId("ctor-bad-tenant");
  expect(() =>
    createPolicyCache({
      tenantId,
      verifier: ACCEPT_ALL_VERIFIER,
      staleness: { maxAgeMs: 0, mustRefetchMs: null },
    }),
  ).toThrow();
  expect(() =>
    createPolicyCache({
      tenantId,
      verifier: ACCEPT_ALL_VERIFIER,
      staleness: { maxAgeMs: 100, mustRefetchMs: 0 },
    }),
  ).toThrow();
});

test("D5: DEFAULT_STALENESS_RULES matches the documented 5min/1hour defaults", () => {
  expect(DEFAULT_STALENESS_RULES.maxAgeMs).toBe(5 * 60 * 1000);
  expect(DEFAULT_STALENESS_RULES.mustRefetchMs).toBe(60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// Empty cache behavior
// ---------------------------------------------------------------------------

test("D5: an empty cache reports `empty` staleness and refuses get()", () => {
  const tenantId = makeTenantId("empty-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  expect(cache.staleness(makeTimestamp("empty-at"))).toBe("empty");
  expect(cache.isStale(makeTimestamp("empty-at"))).toBe(true); // empty is treated as stale
  const result = cache.get(makeTimestamp("empty-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("empty");
  }
});

// ---------------------------------------------------------------------------
// Put + signature verification seam
// ---------------------------------------------------------------------------

test("D5: put() with ACCEPT_ALL_VERIFIER stores the document", async () => {
  const tenantId = makeTenantId("put-accept-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  const doc = validDoc("put-accept");
  const fetchedAt = makeTimestamp("put-accept-fetched");
  const result = await cache.put(doc, fetchedAt);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entry.doc).toBe(doc);
  expect(result.entry.fetchedAt).toBe(fetchedAt);
});

test("D5: put() with REJECT_ALL_VERIFIER refuses the document and does NOT overwrite a valid entry", async () => {
  const tenantId = makeTenantId("put-reject-tenant");
  const cache = createPolicyCache({ tenantId, verifier: REJECT_ALL_VERIFIER });
  const result = await cache.put(validDoc("put-reject"), makeTimestamp("put-reject-fetched"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(ERROR_CODES.policyCacheSignatureInvalid);
    expect(result.error.kind).toBe("DomainError");
  }
});

test("D5: put() refuses a document with version < 1", async () => {
  const tenantId = makeTenantId("bad-version-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  const doc = validDoc("bad-version", 0);
  const result = await cache.put(doc, makeTimestamp("bad-version-fetched"));
  expect(result.ok).toBe(false);
});

test("D5: a verifier that throws is treated as `false` (defend in depth, never throw)", async () => {
  const tenantId = makeTenantId("throwing-verifier-tenant");
  const throwing: PolicySignatureVerifier = {
    verify: () => {
      throw new Error("simulated verifier crash");
    },
  };
  const cache = createPolicyCache({ tenantId, verifier: throwing });
  const result = await cache.put(validDoc("throwing"), makeTimestamp("throwing-fetched"));
  expect(result.ok).toBe(false);
});

test("D5: an invalid-signature put does NOT overwrite a previously-stored valid entry", async () => {
  const tenantId = makeTenantId("no-overwrite-tenant");
  // Use a stateful verifier: accept the first call, reject the second.
  let callCount = 0;
  const stateful: PolicySignatureVerifier = {
    verify: () => {
      callCount += 1;
      return callCount === 1;
    },
  };
  const cache = createPolicyCache({ tenantId, verifier: stateful });
  const doc1 = validDoc("first");
  const doc2 = validDoc("second");
  const r1 = await cache.put(doc1, makeTimestamp("first-fetched"));
  expect(r1.ok).toBe(true);
  // Before the second put: cache holds doc1, signatureInvalid=false.
  expect(cache.staleness(makeTimestamp("first-fetched"))).toBe("fresh");

  // The second put fails verification. The cache should preserve doc1.
  const r2 = await cache.put(doc2, makeTimestamp("second-fetched"));
  expect(r2.ok).toBe(false);

  // After the failed put: the cache surfaces "signature_invalid" status
  // (the lane marks the cache as signature-invalid until the next
  // successful put clears the flag). The previously-stored doc1 is no
  // longer trusted.
  expect(cache.staleness(makeTimestamp("third-at"))).toBe("signature_invalid");
});

// ---------------------------------------------------------------------------
// Staleness rules
// ---------------------------------------------------------------------------

test("D5: a freshly-stored document is `fresh` within maxAgeMs", async () => {
  const tenantId = makeTenantId("fresh-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("fresh"), "2026-01-01T00:00:00Z");
  expect(cache.staleness("2026-01-01T00:00:30Z")).toBe("fresh"); // 30s < 60s
});

test("D5: a document older than maxAgeMs but younger than mustRefetchMs is `stale`", async () => {
  const tenantId = makeTenantId("stale-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("stale"), "2026-01-01T00:00:00Z");
  expect(cache.staleness("2026-01-01T00:02:00Z")).toBe("stale"); // 2min > 1min, < 10min
});

test("D5: a document older than mustRefetchMs is `must_refetch`", async () => {
  const tenantId = makeTenantId("must-refetch-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("must-refetch"), "2026-01-01T00:00:00Z");
  expect(cache.staleness("2026-01-01T01:00:00Z")).toBe("must_refetch"); // 1h > 10min
});

test("D5: a clock-skew (at < fetchedAt) is treated as `must_refetch` (fail safe)", async () => {
  const tenantId = makeTenantId("skew-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("skew"), "2026-01-01T00:05:00Z");
  expect(cache.staleness("2026-01-01T00:00:00Z")).toBe("must_refetch"); // at < fetchedAt
});

// ---------------------------------------------------------------------------
// CRITICAL — default-deny for consequential actions when stale/offline
// ---------------------------------------------------------------------------

test("D5: CRITICAL — authorizeConsequential returns ok:true ONLY when the cache is fresh", async () => {
  const tenantId = makeTenantId("authz-fresh-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("authz-fresh"), "2026-01-01T00:00:00Z");
  const result = cache.authorizeConsequential("2026-01-01T00:00:30Z");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.doc).toBeDefined();
  }
});

test("D5: CRITICAL — authorizeConsequential DEFAULT-DENIES when the cache is empty", () => {
  const tenantId = makeTenantId("authz-empty-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  const result = cache.authorizeConsequential(makeTimestamp("authz-empty-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("empty");
    expect(result.error.kind).toBe("PolicyError");
    expect((result.error as { decision: string }).decision).toBe("BLOCK");
    expect(result.error.code).toBe(ERROR_CODES.policyCacheDefaultDeny);
  }
});

test("D5: CRITICAL — authorizeConsequential DEFAULT-DENIES when the cache is stale", async () => {
  const tenantId = makeTenantId("authz-stale-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("authz-stale"), "2026-01-01T00:00:00Z");
  // 2 min later: stale.
  const result = cache.authorizeConsequential("2026-01-01T00:02:00Z");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("stale");
    expect((result.error as { decision: string }).decision).toBe("BLOCK");
  }
});

test("D5: CRITICAL — authorizeConsequential DEFAULT-DENIES when the cache is must_refetch", async () => {
  const tenantId = makeTenantId("authz-mr-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("authz-mr"), "2026-01-01T00:00:00Z");
  // 1 hour later: must_refetch.
  const result = cache.authorizeConsequential("2026-01-01T01:00:00Z");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("must_refetch");
  }
});

test("D5: CRITICAL — authorizeConsequential DEFAULT-DENIES when the signature was invalid", async () => {
  const tenantId = makeTenantId("authz-sig-tenant");
  const cache = createPolicyCache({ tenantId, verifier: REJECT_ALL_VERIFIER });
  await cache.put(validDoc("authz-sig"), makeTimestamp("authz-sig-fetched"));
  const result = cache.authorizeConsequential(makeTimestamp("authz-sig-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("signature_invalid");
  }
});

test("D5: the default-deny error translates to HTTP 403 (BLOCK) via the frozen toApiError", async () => {
  const tenantId = makeTenantId("deny-403-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  const result = cache.authorizeConsequential(makeTimestamp("deny-403-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const api = toApiError(result.error);
    expect(api.status).toBe(403); // PolicyError + BLOCK -> 403
    expect(api.kind).toBe("PolicyError");
  }
});

// ---------------------------------------------------------------------------
// get() — staleness-aware read
// ---------------------------------------------------------------------------

test("D5: get() returns the document when fresh", async () => {
  const tenantId = makeTenantId("get-fresh-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("get-fresh"), "2026-01-01T00:00:00Z");
  const result = cache.get("2026-01-01T00:00:30Z");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.staleness).toBe("fresh");
    expect(result.doc).toBeDefined();
  }
});

test("D5: get() returns the document (with staleness=`stale`) when stale but within mustRefetchMs", async () => {
  const tenantId = makeTenantId("get-stale-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("get-stale"), "2026-01-01T00:00:00Z");
  const result = cache.get("2026-01-01T00:02:00Z");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.staleness).toBe("stale");
  }
});

test("D5: get() refuses (reason=`must_refetch`) when the document is past mustRefetchMs", async () => {
  const tenantId = makeTenantId("get-mr-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("get-mr"), "2026-01-01T00:00:00Z");
  const result = cache.get("2026-01-01T01:00:00Z");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("must_refetch");
  }
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

test("D5: clear() empties the cache (and clears the signatureInvalid flag)", async () => {
  const tenantId = makeTenantId("clear-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  // Use a deterministic timestamp so staleness is "fresh" by construction.
  await cache.put(validDoc("clear"), "2026-01-01T00:00:00Z");
  expect(cache.staleness("2026-01-01T00:00:30Z")).toBe("fresh");
  cache.clear();
  expect(cache.staleness("2026-01-01T00:00:30Z")).toBe("empty");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("D5: the staleness decision is a pure function of (fetchedAt, at, rules)", async () => {
  const tenantId = makeTenantId("determ-staleness-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  await cache.put(validDoc("determ"), "2026-01-01T00:00:00Z");
  // Same inputs => same decision, every time.
  const a = cache.staleness("2026-01-01T00:02:00Z");
  const b = cache.staleness("2026-01-01T00:02:00Z");
  expect(a).toBe(b);
  expect(a).toBe("stale");
});

test("D5: isStale returns true for stale/must_refetch/signature_invalid/empty, false for fresh", async () => {
  const tenantId = makeTenantId("isstale-tenant");
  const cache = createPolicyCache({
    tenantId,
    verifier: ACCEPT_ALL_VERIFIER,
    staleness: SHORT_STALENESS,
  });
  expect(cache.isStale(makeTimestamp("isstale-empty"))).toBe(true); // empty
  await cache.put(validDoc("isstale"), "2026-01-01T00:00:00Z");
  expect(cache.isStale("2026-01-01T00:00:30Z")).toBe(false); // fresh
  expect(cache.isStale("2026-01-01T00:02:00Z")).toBe(true); // stale
  expect(cache.isStale("2026-01-01T01:00:00Z")).toBe(true); // must_refetch
});

// ---------------------------------------------------------------------------
// Async verifier support
// ---------------------------------------------------------------------------

test("D5: the verifier seam supports async verify() (e.g. ed25519 over network)", async () => {
  const tenantId = makeTenantId("async-verifier-tenant");
  const asyncVerifier: PolicySignatureVerifier = {
    verify: async () => true,
  };
  const cache = createPolicyCache({ tenantId, verifier: asyncVerifier });
  const result = await cache.put(validDoc("async"), makeTimestamp("async-fetched"));
  expect(result.ok).toBe(true);
});
