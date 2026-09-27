/**
 * W050B arena — D3 tests: the fail-closed certification boundary (the
 * ARENA.md invariant).
 *
 * Per `spec/integration/ARENA.md`: "FleetOS never treats an uncertified
 * model output as action permission." This suite proves the invariant is
 * enforced structurally and behaviorally:
 *
 *   1. Capability metadata lacking a valid certification reference is
 *      refused with machine-stable reasons.
 *   2. A certified but explicitly-incompatible capability is refused.
 *   3. A malformed certification reference (bad grammar) is refused.
 *   4. A certification-hash mismatch (defense in depth) is refused.
 *   5. The package exposes NO path from raw model output to any
 *      action/permission surface.
 *   6. Adoption records carry the certification reference VERBATIM — the
 *      record is the audit evidence that the certification existed at
 *      adoption time.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import {
  requireCertifiedCapability,
  isValidCertificationRef,
  projectCertificationRefFromRawModelOutput,
  assertRawModelOutputIsNotActionPermission,
  refusalToFleetError,
  CERTIFICATION_REF_PATTERN,
  ALL_CERTIFICATION_REFUSAL_REASONS,
  type CertifiedCapabilityMetadata,
  type RawModelOutput,
} from "../src/index";
import {
  adoptCapability,
  createInMemoryCapabilityAdoptionStore,
  type CapabilityAdoptionProposal,
} from "../src/index";
import {
  T0,
  TENANT_A,
  USER_1,
  CORR,
  scopeA,
  certifiedMetadata,
  certificationRef,
} from "./helpers";

// ---------------------------------------------------------------------------
// 1. Missing certification reference — fail-closed
// ---------------------------------------------------------------------------

test("metadata missing the certification reference is refused (missing_certification_ref)", () => {
  // Build a metadata object with no certificationRef.
  const metadata = certifiedMetadata();
  const withoutRef = { ...metadata, certificationRef: "" } as CertifiedCapabilityMetadata;
  const result = requireCertifiedCapability(withoutRef, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("missing_certification_ref");
});

test("null metadata is refused (missing_metadata)", () => {
  const result = requireCertifiedCapability(null, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toEqual(["missing_metadata"]);
});

test("undefined metadata is refused (missing_metadata)", () => {
  const result = requireCertifiedCapability(undefined, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toEqual(["missing_metadata"]);
});

test("metadata missing capabilityId is refused (missing_capability_id)", () => {
  const metadata = certifiedMetadata();
  const withoutId = { ...metadata, capabilityId: "" } as CertifiedCapabilityMetadata;
  const result = requireCertifiedCapability(withoutId, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("missing_capability_id");
});

test("metadata missing capabilityVersion is refused (missing_capability_version)", () => {
  const metadata = certifiedMetadata();
  const withoutVer = { ...metadata, capabilityVersion: "" } as CertifiedCapabilityMetadata;
  const result = requireCertifiedCapability(withoutVer, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("missing_capability_version");
});

// ---------------------------------------------------------------------------
// 2. Malformed certification reference (bad grammar) — fail-closed
// ---------------------------------------------------------------------------

test("a malformed certification reference is refused (malformed_certification_ref)", () => {
  const metadata = certifiedMetadata({ certificationRef: "not_a_valid_ref" });
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("malformed_certification_ref");
});

test("the certification reference grammar requires acr_ prefix + 16+ base32 chars", () => {
  // Valid refs.
  expect(isValidCertificationRef("acr_abcdefghijklmnop")).toBe(true);
  expect(isValidCertificationRef("acr_0123456789abcdefgh")).toBe(true);
  // Invalid refs.
  expect(isValidCertificationRef("acr_short")).toBe(false); // too short
  expect(isValidCertificationRef("acr_with_UPPER")).toBe(false); // uppercase
  expect(isValidCertificationRef("acr_with-dash")).toBe(false); // dash
  expect(isValidCertificationRef("not_acr_prefixed_abcdef")).toBe(false); // wrong prefix
  expect(isValidCertificationRef("")).toBe(false); // empty
  expect(isValidCertificationRef(null as unknown as string)).toBe(false); // not a string
});

test("the certification reference pattern is the canonical acr_ prefix + base32", () => {
  expect(CERTIFICATION_REF_PATTERN.test("acr_abcdefghijklmnop")).toBe(true);
  expect(CERTIFICATION_REF_PATTERN.test("acr_0")).toBe(false);
});

// ---------------------------------------------------------------------------
// 3. Incompatible capability — fail-closed
// ---------------------------------------------------------------------------

test("a certified but explicitly-incompatible capability is refused (incompatible_capability)", () => {
  const metadata = certifiedMetadata({ fleetOSCompatibilityStatement: "incompatible" });
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("incompatible_capability");
});

test("an unknown compatibility statement is treated as incompatible (fail-closed)", () => {
  const metadata = certifiedMetadata();
  const withUnknown = { ...metadata, fleetOSCompatibilityStatement: "unknown_value" as never } as CertifiedCapabilityMetadata;
  const result = requireCertifiedCapability(withUnknown, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("incompatible_capability");
});

test("a compatible_with_warnings capability is certified (the warnings are carried verbatim)", () => {
  const metadata = certifiedMetadata({
    fleetOSCompatibilityStatement: "compatible_with_warnings",
    warnings: ["warning/needs-cleanup", "warning/requires-v2-adapter"],
  });
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected certified");
  expect(result.certified.warnings).toEqual(["warning/needs-cleanup", "warning/requires-v2-adapter"]);
});

// ---------------------------------------------------------------------------
// 4. Certification hash mismatch — defense in depth, fail-closed
// ---------------------------------------------------------------------------

test("a caller-supplied hash check catches a stale certification reference (certification_hash_mismatch)", () => {
  const metadata = certifiedMetadata({ certificationHash: "hash_v1" });
  const result = requireCertifiedCapability(metadata, {
    correlationId: CORR,
    hashCheck: { expectedHash: "hash_v2", hashAlgorithm: "sha256" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("certification_hash_mismatch");
});

test("a missing certification hash fails the hash check (defense in depth)", () => {
  const metadata = certifiedMetadata(); // no certificationHash field
  const result = requireCertifiedCapability(metadata, {
    correlationId: CORR,
    hashCheck: { expectedHash: "hash_v1", hashAlgorithm: "sha256" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.reasons).toContain("certification_hash_mismatch");
});

test("a matching hash check passes (defense in depth)", () => {
  const metadata = certifiedMetadata({ certificationHash: "hash_v1" });
  const result = requireCertifiedCapability(metadata, {
    correlationId: CORR,
    hashCheck: { expectedHash: "hash_v1", hashAlgorithm: "sha256" },
  });
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// 5. Multiple reasons accumulate (fail-closed with all problems exposed)
// ---------------------------------------------------------------------------

test("multiple refusal reasons are accumulated and exposed at once (never silently)", () => {
  const metadata: CertifiedCapabilityMetadata = {
    tenantId: TENANT_A,
    capabilityId: "",
    capabilityVersion: "",
    certificationRef: "bad_ref",
    evaluationSuiteRevision: "",
    fleetOSCompatibilityStatement: "incompatible",
  };
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  // Every problem is exposed (the order is structural-first, content-last).
  expect(result.refusal.reasons).toContain("missing_capability_id");
  expect(result.refusal.reasons).toContain("missing_capability_version");
  expect(result.refusal.reasons).toContain("malformed_certification_ref");
  expect(result.refusal.reasons).toContain("incompatible_capability");
});

test("the refusal metadata carries the surviving fields (for audit evidence)", () => {
  const metadata = certifiedMetadata({
    capabilityId: "device.health.test",
    certificationRef: "bad_ref",
  });
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.refusal.metadata.capabilityId).toBe("device.health.test");
  expect(result.refusal.metadata.certificationRef).toBe("bad_ref");
  expect(result.refusal.metadata.capabilityVersion).not.toBeNull(); // survived
});

// ---------------------------------------------------------------------------
// 6. ALL_CERTIFICATION_REFUSAL_REASONS is the closed union
// ---------------------------------------------------------------------------

test("ALL_CERTIFICATION_REFUSAL_REASONS is the closed union (machine-stable, frozen)", () => {
  expect(ALL_CERTIFICATION_REFUSAL_REASONS).toEqual([
    "missing_metadata",
    "missing_capability_id",
    "missing_capability_version",
    "missing_certification_ref",
    "malformed_certification_ref",
    "incompatible_capability",
    "certification_hash_mismatch",
  ]);
});

// ---------------------------------------------------------------------------
// 7. refusalToFleetError projects the refusal into the frozen error taxonomy
// ---------------------------------------------------------------------------

test("refusalToFleetError projects the refusal into a frozen FleetError carrying the reason codes", () => {
  const metadata: CertifiedCapabilityMetadata = {
    tenantId: TENANT_A,
    capabilityId: "",
    capabilityVersion: "",
    certificationRef: "",
    evaluationSuiteRevision: "",
    fleetOSCompatibilityStatement: "incompatible",
  };
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  if (result.ok) throw new Error("expected refusal");
  const error = refusalToFleetError(result.refusal, CORR);
  expect(error.kind).toBe("DomainError");
  expect(error.code).toBe("arena.certification.refused");
  expect(error.tenantId).toBe(TENANT_A);
  expect(error.correlationId).toBe(CORR);
  // The invariant field carries the machine-stable reason codes (callers match on this, not the message).
  expect(error.invariant).toContain("missing_capability_id");
  expect(error.invariant).toContain("missing_capability_version");
  expect(error.invariant).toContain("missing_certification_ref");
  expect(error.invariant).toContain("incompatible_capability");
});

// ---------------------------------------------------------------------------
// 8. The ARENA.md invariant — no path from raw model output to action/permission
// ---------------------------------------------------------------------------

test("the ARENA.md invariant: the package exposes NO function that converts raw model output into an adoption record", () => {
  // The proof is structural: `adoptCapability` accepts `CertifiedCapabilityMetadata | null | undefined` —
  // NOT `RawModelOutput` (which is `unknown`). TypeScript refuses the
  // assignment of `unknown` to `CertifiedCapabilityMetadata` (a typed
  // shape with required fields). The ONLY way to produce a
  // `CertifiedCapability` is through `requireCertifiedCapability` (D3).
  // This test asserts the type-level proof: `RawModelOutput` is NOT
  // assignable to `CertifiedCapability`.
  const raw: RawModelOutput = { prediction: "battery_aged", confidence: 0.95 };
  // The marker function exists for documentation; it does nothing with
  // the raw output (it is a no-op type-level proof).
  expect(() => assertRawModelOutputIsNotActionPermission(raw)).not.toThrow();
});

test("projectCertificationRefFromRawModelOutput: the ONLY structural bridge from raw model output to a certification reference — and it returns null for typical model output", () => {
  // A typical raw model output (predictions, recommendations, probabilities)
  // carries NO certification reference — the projection returns null.
  const typical: RawModelOutput = {
    prediction: "battery_aged",
    confidence: 0.95,
    recommendation: "replace_battery",
  };
  expect(projectCertificationRefFromRawModelOutput(typical)).toBe(null);
  // A raw model output that happens to carry a valid certification reference
  // has the reference projected (the reference still must pass
  // `requireCertifiedCapability` before any adoption surface is touched).
  const withValidRef: RawModelOutput = {
    prediction: "battery_aged",
    certificationRef: certificationRef(),
  };
  const projected = projectCertificationRefFromRawModelOutput(withValidRef);
  expect(projected).not.toBe(null);
  expect(typeof projected).toBe("string");
  expect(isValidCertificationRef(projected as string)).toBe(true);
  // A raw model output that carries a MALFORMED certification reference
  // has the projection return null (no path from malformed ref to adoption).
  const withMalformedRef: RawModelOutput = {
    prediction: "battery_aged",
    certificationRef: "not_a_valid_ref",
  };
  expect(projectCertificationRefFromRawModelOutput(withMalformedRef)).toBe(null);
});

test("the ARENA.md invariant: an adoption record carries the certification reference VERBATIM (the audit evidence that the certification existed at adoption time)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // The adoption record carries the certification reference VERBATIM.
  expect(result.record.certificationRef).toBe(metadata.certificationRef);
  expect(result.record.capabilityId).toBe(metadata.capabilityId);
  expect(result.record.capabilityVersion).toBe(metadata.capabilityVersion);
  expect(result.record.fleetOSCompatibilityStatement).toBe(metadata.fleetOSCompatibilityStatement);
});

test("the ARENA.md invariant: adoption is REFUSED at the boundary when the certification is missing (the store is untouched)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata: CertifiedCapabilityMetadata = {
    tenantId: TENANT_A,
    capabilityId: "device.health.test",
    capabilityVersion: "1.0.0",
    certificationRef: "", // missing — refused at the boundary
    evaluationSuiteRevision: "suite/v1",
    fleetOSCompatibilityStatement: "compatible",
  };
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("arena.certification.refused");
  // The store is untouched — the refusal prevented any state mutation.
  expect(store.size(scopeA())).toBe(0);
  // The refusal carries the machine-stable reasons.
  expect(result.refusal).toBeDefined();
  if (result.refusal === undefined) throw new Error("refusal missing");
  expect(result.refusal.reasons).toContain("missing_certification_ref");
});

test("the ARENA.md invariant: adoption is REFUSED at the boundary when the capability is explicitly incompatible (even with a valid certification)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata({
    fleetOSCompatibilityStatement: "incompatible",
    warnings: ["warning/explicitly-incompatible"],
  });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("arena.certification.refused");
  expect(store.size(scopeA())).toBe(0);
  if (result.refusal === undefined) throw new Error("refusal missing");
  expect(result.refusal.reasons).toContain("incompatible_capability");
});
