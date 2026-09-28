/**
 * W071 tests — the signature-verified policy cache wrapper
 * (@fleetos/device-adapters).
 *
 * Proves:
 *   - entries carry a deterministic content digest over the canonical
 *     form (byte-identical across runs AND across payload key
 *     permutations);
 *   - the HMAC-style verifier is INJECTED, never a global (two caches
 *     with different verifier secrets never cross-accept);
 *   - unsigned entries are refused machine-stably (`unsigned_entry`)
 *     and NEVER served — by `get` AND by `authorizeConsequential`;
 *   - mismatched signatures are refused machine-stably
 *     (`signature_mismatch`) and never served;
 *   - an entry written DIRECTLY into the wrapped inner cache (bypassing
 *     the wrapper's put) is never served (fail-safe unsigned);
 *   - the existing cache's stale-entry behavior is PRESERVED VERBATIM
 *     through delegation (stale docs served by get, default-denied by
 *     authorizeConsequential, must_refetch refusal, empty refusal, the
 *     inner doc-signature refusal, no-overwrite-by-invalid);
 *   - determinism: byte-identical wrapper results across independent
 *     runs and input permutations.
 *
 * Timestamps are FIXED ISO literals (controlled deltas; no clock, no
 * seeded offsets).
 */

import { describe, expect, test } from "bun:test";
import { makePolicyId, makeTenantId } from "@fleetos/contracts/testing";
import {
  ACCEPT_ALL_VERIFIER,
  REJECT_ALL_VERIFIER,
  createPolicyCache,
  createSignedPolicyDocument,
  DEFAULT_STALENESS_RULES,
  type PolicyCache,
  type SignedPolicyDocument,
} from "../src/policy-cache";
import {
  ACCEPT_ALL_ENTRY_VERIFIER,
  computeDeterministicEntrySignature,
  createDeterministicEntryVerifier,
  createSignedPolicyCache,
  signedPolicyCacheCanonicalForm,
  signedPolicyCacheEntryDigest,
  type SignedAuthorizeConsequentialResult,
  type SignedPolicyCache,
  type SignedPolicyCacheGetResult,
  type SignedPolicyCacheOptions,
  type SignedPolicyCacheRefusalReason,
} from "../src/signed-policy-cache";

const TENANT = makeTenantId("w071-spc-tenant");
const POLICY_ID = makePolicyId("w071-spc-policy");
const FETCHED_AT = "2026-01-01T00:00:00Z";
const READ_AT = "2026-01-01T00:00:30Z"; // +30s: fresh under both rule sets
const SECRET = "w071-test-secret";

/** The SHORT staleness rules used to prove delegated stale behavior. */
const SHORT_STALENESS = { maxAgeMs: 60_000, mustRefetchMs: 3_600_000 };

/** Fixed instants for the staleness bands (SHORT rules). */
const AT_STALE = "2026-01-01T00:02:00Z"; // +2min: stale, not must-refetch
const AT_MUST_REFETCH = "2026-01-01T01:00:01Z"; // +1h+1s: must-refetch

function validDoc(seed: string, version = 1): SignedPolicyDocument {
  return createSignedPolicyDocument({
    policyId: POLICY_ID,
    version,
    signedAt: FETCHED_AT,
    payload: { seed, rules: ["r1", "r2"] },
    signature: `docsig-${seed}`,
    signatureAlgorithm: "ed25519-test",
  });
}

function signatureFor(doc: SignedPolicyDocument, fetchedAt: string, secret = SECRET): string {
  return computeDeterministicEntrySignature(secret, signedPolicyCacheCanonicalForm(doc, fetchedAt));
}

function makeCache(staleness = DEFAULT_STALENESS_RULES): SignedPolicyCache {
  return createSignedPolicyCache({
    inner: createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER, staleness }),
    verifier: createDeterministicEntryVerifier(SECRET),
  });
}

/** Narrowing helper: the refusal reason of a get/authorize result (throws on ok). */
function refusalOf(
  result: SignedPolicyCacheGetResult | SignedAuthorizeConsequentialResult,
): SignedPolicyCacheRefusalReason {
  if (result.ok) throw new Error("expected a refusal");
  return result.reason;
}

/** Narrowing helper: the PolicyError of a refused authorization (throws on ok). */
function authorizeErrorOf(result: SignedAuthorizeConsequentialResult): {
  decision: "REQUIRE_APPROVAL" | "BLOCK";
  code: string;
  ruleIds: readonly string[];
} {
  if (result.ok) throw new Error("expected an authorization refusal");
  return result.error;
}

// ---------------------------------------------------------------------------
// The canonical form + digest (deterministic, permutation-invariant)
// ---------------------------------------------------------------------------

describe("W071: signed-policy cache — canonical form + digest determinism", () => {
  test("the content digest is byte-identical across independent computations", () => {
    const doc = validDoc("digest-determinism");
    expect(signedPolicyCacheEntryDigest(doc, FETCHED_AT)).toBe(
      signedPolicyCacheEntryDigest(doc, FETCHED_AT),
    );
  });

  test("the canonical form is invariant to payload key order (permutation)", () => {
    const a = createSignedPolicyDocument({
      policyId: POLICY_ID,
      version: 2,
      signedAt: FETCHED_AT,
      payload: { alpha: 1, beta: 2, gamma: { x: 1, y: 2 } },
      signature: "sig-perm",
      signatureAlgorithm: "ed25519-test",
    });
    const b = createSignedPolicyDocument({
      policyId: POLICY_ID,
      version: 2,
      signedAt: FETCHED_AT,
      payload: { gamma: { y: 2, x: 1 }, beta: 2, alpha: 1 },
      signature: "sig-perm",
      signatureAlgorithm: "ed25519-test",
    });
    expect(signedPolicyCacheCanonicalForm(a, FETCHED_AT)).toBe(
      signedPolicyCacheCanonicalForm(b, FETCHED_AT),
    );
    expect(signedPolicyCacheEntryDigest(a, FETCHED_AT)).toBe(
      signedPolicyCacheEntryDigest(b, FETCHED_AT),
    );
  });

  test("any identity-field difference changes the digest", () => {
    const doc = validDoc("digest-sensitivity");
    const otherVersion = validDoc("digest-sensitivity", 2);
    expect(signedPolicyCacheEntryDigest(doc, FETCHED_AT)).not.toBe(
      signedPolicyCacheEntryDigest(otherVersion, FETCHED_AT),
    );
    expect(signedPolicyCacheEntryDigest(doc, FETCHED_AT)).not.toBe(
      signedPolicyCacheEntryDigest(doc, "2026-02-01T00:00:00Z"),
    );
  });

  test("the injected verifier is never a global: different secrets never cross-accept", () => {
    const canonical = signedPolicyCacheCanonicalForm(validDoc("verifier-scope"), FETCHED_AT);
    const good = computeDeterministicEntrySignature(SECRET, canonical);
    const other = computeDeterministicEntrySignature("another-secret", canonical);
    const verifierA = createDeterministicEntryVerifier(SECRET);
    const verifierB = createDeterministicEntryVerifier("another-secret");
    expect(verifierA.verify(canonical, good)).toBe(true);
    expect(verifierA.verify(canonical, other)).toBe(false);
    expect(verifierB.verify(canonical, other)).toBe(true);
    expect(verifierB.verify(canonical, good)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The happy path: signed entries serve
// ---------------------------------------------------------------------------

describe("W071: signed-policy cache — signed entries serve", () => {
  test("a validly signed entry is served by get with its digest", async () => {
    const cache = makeCache();
    const doc = validDoc("serve-basics");
    const put = await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    expect(put.ok).toBe(true);
    const got = cache.get(READ_AT);
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("expected a served entry");
    expect(got.doc).toBe(doc);
    expect(got.staleness).toBe("fresh");
    expect(got.fetchedAt).toBe(FETCHED_AT);
    expect(got.contentDigest).toBe(signedPolicyCacheEntryDigest(doc, FETCHED_AT));
  });

  test("a validly signed entry authorizes consequential actions (fresh)", async () => {
    const cache = makeCache();
    const doc = validDoc("authorize-basics");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    const authorized = cache.authorizeConsequential(READ_AT);
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) throw new Error("expected authorization");
    expect(authorized.doc).toBe(doc);
    expect(authorized.contentDigest).toBe(signedPolicyCacheEntryDigest(doc, FETCHED_AT));
  });

  test("the wrapped inner cache is exposed unchanged (structural pass-through)", async () => {
    const inner: PolicyCache = createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER });
    const cache = createSignedPolicyCache({ inner, verifier: createDeterministicEntryVerifier(SECRET) });
    expect((cache.inner as PolicyCache).tenantId).toBe(TENANT);
    expect(cache.tenantId).toBe(TENANT);
  });
});

// ---------------------------------------------------------------------------
// The hardening: unsigned + mismatched entries never serve
// ---------------------------------------------------------------------------

describe("W071: signed-policy cache — unsigned entries never serve", () => {
  test("an unsigned entry is refused by get with reason unsigned_entry (never served)", async () => {
    const cache = makeCache();
    const doc = validDoc("unsigned-entry");
    const put = await cache.put(doc, FETCHED_AT); // no entry signature
    expect(put.ok).toBe(true);
    if (!put.ok) throw new Error("expected a stored (unsigned) entry");
    expect(put.entry.entrySignature).toBeUndefined();
    const got = cache.get(READ_AT);
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("an unsigned entry must never serve");
    expect(got.reason).toBe("unsigned_entry");
    expect(got.staleness).toBe("fresh"); // time says fresh; integrity says no
  });

  test("an unsigned entry default-denies consequential authorization (PolicyError BLOCK)", async () => {
    const cache = makeCache();
    const doc = validDoc("unsigned-authorize");
    await cache.put(doc, FETCHED_AT);
    const authorized = cache.authorizeConsequential(READ_AT);
    expect(authorized.ok).toBe(false);
    if (authorized.ok) throw new Error("an unsigned entry must never authorize");
    expect(authorized.reason).toBe("unsigned_entry");
    expect(authorized.error.decision).toBe("BLOCK");
    expect(authorized.error.ruleIds).toEqual(["policy.cache.unsigned_entry"]);
    expect(authorized.error.code).toBe("agent.policy_cache.unsigned_entry");
  });

  test("an entry written DIRECTLY into the inner cache is never served by the wrapper (fail-safe)", async () => {
    const inner = createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER });
    const cache = createSignedPolicyCache({ inner, verifier: createDeterministicEntryVerifier(SECRET) });
    // Bypass the wrapper: the document enters the wrapped cache without
    // passing the wrapper's put (models an unvalidated load path).
    const direct = await inner.put(validDoc("direct-inner-write"), FETCHED_AT);
    expect(direct.ok).toBe(true);
    expect(cache.get(READ_AT).ok).toBe(false);
    expect(refusalOf(cache.get(READ_AT))).toBe("unsigned_entry");
    expect(refusalOf(cache.authorizeConsequential(READ_AT))).toBe("unsigned_entry");
    expect(cache.isStale(READ_AT)).toBe(true); // fail-closed trust predicate
  });

  test("an empty-string signature is unsigned (never served)", async () => {
    const cache = makeCache();
    const doc = validDoc("empty-signature");
    await cache.put(doc, FETCHED_AT, "");
    expect(cache.get(READ_AT).ok).toBe(false);
    expect(refusalOf(cache.get(READ_AT))).toBe("unsigned_entry");
  });

  test("an ACCEPT-ALL entry verifier still refuses unsigned entries (unsigned_entry precedes the verifier)", async () => {
    // The digest check itself is internal defense-in-depth (unreachable
    // through the public API, which always digests what it stores). The
    // observable contract pinned here: the unsigned-entry refusal fires
    // BEFORE the injected verifier is ever consulted — even a verifier
    // that accepts everything cannot rescue an unsigned entry.
    const cache = createSignedPolicyCache({
      inner: createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER }),
      verifier: ACCEPT_ALL_ENTRY_VERIFIER,
    });
    const doc = validDoc("accept-all-unsigned");
    await cache.put(doc, FETCHED_AT); // unsigned
    expect(refusalOf(cache.get(READ_AT))).toBe("unsigned_entry");
    expect(refusalOf(cache.authorizeConsequential(READ_AT))).toBe("unsigned_entry");
    // The accept-all verifier IS the injected decision point for MAC
    // verification: garbage signatures pass when it is injected.
    await cache.put(validDoc("accept-all-garbage"), FETCHED_AT, "garbage");
    expect(cache.get(READ_AT).ok).toBe(true);
  });
});

describe("W071: signed-policy cache — mismatched signatures never serve", () => {
  test("a signature computed over a different form is refused (signature_mismatch)", async () => {
    const cache = makeCache();
    const doc = validDoc("mismatched-swap");
    const other = validDoc("mismatched-other");
    // A signature valid for ANOTHER document's canonical form.
    const wrongSignature = signatureFor(other, FETCHED_AT);
    await cache.put(doc, FETCHED_AT, wrongSignature);
    const got = cache.get(READ_AT);
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("a mismatched signature must never serve");
    expect(got.reason).toBe("signature_mismatch");
  });

  test("a signature from the wrong secret is refused (verifier injected — never global)", async () => {
    const cache = makeCache();
    const doc = validDoc("wrong-secret");
    const foreign = computeDeterministicEntrySignature(
      "not-the-secret",
      signedPolicyCacheCanonicalForm(doc, FETCHED_AT),
    );
    await cache.put(doc, FETCHED_AT, foreign);
    expect(refusalOf(cache.get(READ_AT))).toBe("signature_mismatch");
    const refused = cache.authorizeConsequential(READ_AT);
    expect(refusalOf(refused)).toBe("signature_mismatch");
    expect(authorizeErrorOf(refused).decision).toBe("BLOCK");
    expect(authorizeErrorOf(refused).code).toBe("agent.policy_cache.signature_mismatch");
  });

  test("a signature over a different fetchedAt is refused (the form covers the fetch instant)", async () => {
    const cache = makeCache();
    const doc = validDoc("fetched-at-binding");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, "2026-01-01T00:05:00Z"));
    expect(refusalOf(cache.get(READ_AT))).toBe("signature_mismatch");
  });

  test("a throwing verifier is defended in depth (verify failure => signature_mismatch)", async () => {
    const cache = createSignedPolicyCache({
      inner: createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER }),
      verifier: {
        verify: (): boolean => {
          throw new Error("verifier exploded");
        },
      },
    });
    const doc = validDoc("throwing-verifier");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    expect(refusalOf(cache.get(READ_AT))).toBe("signature_mismatch");
    expect(refusalOf(cache.authorizeConsequential(READ_AT))).toBe("signature_mismatch");
  });

  test("an integrity-failed entry is fail-closed for the isStale trust predicate", async () => {
    const cache = makeCache();
    const doc = validDoc("isstale-failclosed");
    await cache.put(doc, FETCHED_AT, "wrong-signature");
    // Time says fresh (30s) — the trust predicate still says stale.
    expect(cache.staleness(READ_AT)).toBe("fresh"); // the pure time status, verbatim
    expect(cache.isStale(READ_AT)).toBe(true); // the trust predicate, fail-closed
  });
});

// ---------------------------------------------------------------------------
// The existing cache's stale-entry behavior preserved VERBATIM
// ---------------------------------------------------------------------------

describe("W071: signed-policy cache — stale behavior preserved verbatim", () => {
  test("a stale signed entry is SERVED by get with staleness stale (existing behavior)", async () => {
    const cache = makeCache(SHORT_STALENESS);
    const doc = validDoc("stale-serve");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    const got = cache.get(AT_STALE);
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("stale entries serve on get (existing behavior)");
    expect(got.staleness).toBe("stale");
  });

  test("a stale signed entry default-denies consequential authorization (reason stale)", async () => {
    const cache = makeCache(SHORT_STALENESS);
    const doc = validDoc("stale-authorize");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    const authorized = cache.authorizeConsequential(AT_STALE);
    expect(authorized.ok).toBe(false);
    if (authorized.ok) throw new Error("stale entries never authorize");
    expect(authorized.reason).toBe("stale");
    expect(authorized.error.decision).toBe("BLOCK");
  });

  test("a must-refetch entry is refused by get with reason must_refetch (existing behavior)", async () => {
    const cache = makeCache(SHORT_STALENESS);
    const doc = validDoc("must-refetch");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    const got = cache.get(AT_MUST_REFETCH);
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("must-refetch entries never serve");
    expect(got.reason).toBe("must_refetch");
  });

  test("an empty cache refuses get with reason empty and authorize with reason empty (existing behavior)", () => {
    const cache = makeCache();
    expect(cache.get(READ_AT).ok).toBe(false);
    expect(refusalOf(cache.get(READ_AT))).toBe("empty");
    expect(refusalOf(cache.authorizeConsequential(READ_AT))).toBe("empty");
    expect(cache.staleness(READ_AT)).toBe("empty");
  });

  test("the wrapped cache's doc-signature verification still applies verbatim (REJECT_ALL inner)", async () => {
    const cache = createSignedPolicyCache({
      inner: createPolicyCache({ tenantId: TENANT, verifier: REJECT_ALL_VERIFIER }),
      verifier: createDeterministicEntryVerifier(SECRET),
    });
    const doc = validDoc("inner-rejects");
    const put = await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    expect(put.ok).toBe(false);
    if (put.ok) throw new Error("the inner cache's refusal must surface");
    expect((put.error as { code?: string }).code).toBe("agent.policy_cache.signature_invalid");
    expect(refusalOf(cache.get(READ_AT))).toBe("empty"); // nothing was cached
  });

  test("clear() drops both the wrapper's entry and the wrapped cache's", async () => {
    const cache = makeCache();
    const doc = validDoc("clear-both");
    await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
    expect(cache.get(READ_AT).ok).toBe(true);
    cache.clear();
    expect(refusalOf(cache.get(READ_AT))).toBe("empty");
    expect(cache.inner.get(READ_AT).ok).toBe(false);
  });

  test("a refused invalid doc NEVER overwrites a valid signed entry (inner discipline preserved)", async () => {
    const cache = createSignedPolicyCache({
      inner: createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER }),
      verifier: createDeterministicEntryVerifier(SECRET),
    });
    const good = validDoc("good-entry");
    await cache.put(good, FETCHED_AT, signatureFor(good, FETCHED_AT));
    expect(cache.get(READ_AT).ok).toBe(true);
    const bad = createSignedPolicyDocument({
      policyId: POLICY_ID,
      version: 0, // invalid — the inner cache refuses
      signedAt: FETCHED_AT,
      payload: {},
      signature: "x",
      signatureAlgorithm: "ed25519-test",
    });
    const putBad = await cache.put(bad, FETCHED_AT, signatureFor(bad, FETCHED_AT));
    expect(putBad.ok).toBe(false);
    expect(cache.get(READ_AT).ok).toBe(true); // the valid entry survived
  });
});

// ---------------------------------------------------------------------------
// Construction discipline + determinism
// ---------------------------------------------------------------------------

describe("W071: signed-policy cache — construction + determinism", () => {
  test("construction requires an inner cache and a verifier (never a global default)", () => {
    expect(() =>
      createSignedPolicyCache({
        verifier: createDeterministicEntryVerifier(SECRET),
      } as unknown as SignedPolicyCacheOptions),
    ).toThrow(/inner cache is required/);
    expect(() =>
      createSignedPolicyCache({
        inner: createPolicyCache({ tenantId: TENANT, verifier: ACCEPT_ALL_VERIFIER }),
      } as unknown as SignedPolicyCacheOptions),
    ).toThrow(/verifier is required/);
  });

  test("byte-identical wrapper behavior across independent runs and input permutations", async () => {
    async function run(payloadKeyOrder: "forward" | "reverse"): Promise<string> {
      const cache = makeCache();
      const doc =
        payloadKeyOrder === "forward"
          ? createSignedPolicyDocument({
              policyId: POLICY_ID,
              version: 3,
              signedAt: FETCHED_AT,
              payload: { a: 1, b: 2, c: 3 },
              signature: "sig-det",
              signatureAlgorithm: "ed25519-test",
            })
          : createSignedPolicyDocument({
              policyId: POLICY_ID,
              version: 3,
              signedAt: FETCHED_AT,
              payload: { c: 3, b: 2, a: 1 },
              signature: "sig-det",
              signatureAlgorithm: "ed25519-test",
            });
      await cache.put(doc, FETCHED_AT, signatureFor(doc, FETCHED_AT));
      const got = cache.get(READ_AT);
      const authorized = cache.authorizeConsequential(READ_AT);
      // The canonical projection: the wrapper's DERIVED outputs (the
      // digest is permutation-invariant by construction; the doc object
      // itself carries its original key order by reference).
      const projection = {
        get: got.ok
          ? { ok: true, staleness: got.staleness, fetchedAt: got.fetchedAt, contentDigest: got.contentDigest }
          : { ok: false, reason: got.reason, staleness: got.staleness },
        authorize: authorized.ok
          ? { ok: true, fetchedAt: authorized.fetchedAt, contentDigest: authorized.contentDigest }
          : { ok: false, reason: authorized.reason, code: authorized.error.code },
      };
      return JSON.stringify(projection);
    }
    const forward = await run("forward");
    const reverse = await run("reverse");
    expect(forward).toBe(reverse); // permutation invariance
    expect(forward).toBe(await run("forward")); // run determinism
  });
});
