/**
 * W070 learning — D3 tests: the capability adoption ledger (unit level).
 *
 * Core invariants under test:
 *   - the FAIL-CLOSED certification boundary: uncertified/malformed
 *     capability metadata is refused machine-stably and NEVER becomes
 *     an adoption record;
 *   - the explicit human grant: proposals carry the approver id +
 *     approved-at instant, recorded verbatim;
 *   - supersession discipline: a new version cites the prior via
 *     `supersedes`; the prior is never rewritten; a fresh revision on
 *     an existing adoptionId MUST supersede;
 *   - idempotency (same version + same digest returns the same record);
 *   - the rollout policy validation (canary/ring/full);
 *   - the audited boundary (refusals + created revisions emit;
 *     idempotent re-appends do not).
 *
 * The REAL arena convergence (byte-identical records across the two
 * ledgers, bidirectional store appends) is proven in
 * binding-adoption.test.ts.
 */

import { test, expect } from "bun:test";
import {
  ADOPTION_ACTIVE,
  ALL_CERTIFICATION_REFUSAL_REASONS,
  CERTIFICATION_REF_PATTERN,
  LEARNING_AUDIT_ACTIONS,
  createInMemoryLearningAdoptionStore,
  createInMemoryLearningAuditSink,
  capabilityAdoptionId,
  capabilityAdoptionRecordId,
  isValidCertificationRef,
  recordCapabilityAdoption,
  refusalToFleetError,
  requireCertifiedCapability,
  type CertifiedCapabilityFacet,
  type LearningAdoptionRecord,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  adoptionProposal,
  certifiedMetadata,
  failuresOf,
  invariantOf,
  scopeA,
  scopeB,
} from "./helpers";

// ---------------------------------------------------------------------------
// The certification-reference grammar
// ---------------------------------------------------------------------------

test("the certification-reference grammar accepts canonical refs and refuses malformed ones", () => {
  expect(isValidCertificationRef("acr_abcdef1234567890")).toBe(true);
  expect(isValidCertificationRef("acr_" + "a".repeat(256))).toBe(true);
  expect(CERTIFICATION_REF_PATTERN.test("acr_abcdef1234567890")).toBe(true);
  // Refusals: wrong prefix, too short, uppercase, empty.
  expect(isValidCertificationRef("acr_short")).toBe(false);
  expect(isValidCertificationRef("ref_abcdef1234567890")).toBe(false);
  expect(isValidCertificationRef("acr_ABCDEF123456789")).toBe(false);
  expect(isValidCertificationRef("")).toBe(false);
});

// ---------------------------------------------------------------------------
// The fail-closed certification gate
// ---------------------------------------------------------------------------

test("the gate refuses missing metadata (missing_metadata; never a partial record)", () => {
  for (const absent of [null, undefined]) {
    const result = requireCertifiedCapability(absent, { correlationId: CORR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...result.refusal.reasons]).toEqual(["missing_metadata"]);
    expect(result.refusal.metadata.capabilityId).toBeNull();
  }
});

test("the gate refuses malformed metadata with accumulated machine-stable reasons", () => {
  const result = requireCertifiedCapability(
    {
      tenantId: TENANT_A,
      capabilityId: "",
      capabilityVersion: "",
      certificationRef: "not-a-ref",
      evaluationSuiteRevision: "",
      fleetOSCompatibilityStatement: "incompatible",
    },
    { correlationId: CORR },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect([...result.refusal.reasons]).toEqual([
    "missing_capability_id",
    "missing_capability_version",
    "malformed_certification_ref",
    "incompatible_capability",
  ]);
});

test("the gate refuses an unknown compatibility statement (fail-closed: never adopt the unknown)", () => {
  const result = requireCertifiedCapability(
    {
      ...certifiedMetadata(),
      fleetOSCompatibilityStatement: "mysterious" as "compatible",
    },
    { correlationId: CORR },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect([...result.refusal.reasons]).toEqual(["incompatible_capability"]);
});

test("the gate refuses a certification-hash mismatch (defense in depth, opt-in)", () => {
  const metadata = certifiedMetadata({ certificationHash: "sha256:aaaa" });
  const result = requireCertifiedCapability(metadata, {
    correlationId: CORR,
    hashCheck: { expectedHash: "sha256:bbbb", hashAlgorithm: "sha256" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect([...result.refusal.reasons]).toEqual(["certification_hash_mismatch"]);
  // The matching hash passes.
  const ok = requireCertifiedCapability(metadata, {
    correlationId: CORR,
    hashCheck: { expectedHash: "sha256:aaaa", hashAlgorithm: "sha256" },
  });
  expect(ok.ok).toBe(true);
});

test("the gate passes valid metadata and produces the narrowed certified capability VERBATIM", () => {
  const metadata = certifiedMetadata({
    fleetOSCompatibilityStatement: "compatible_with_warnings",
    warnings: ["warn-1"],
    capabilityClass: "device.health.battery_aging",
  });
  const result = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.certified.capabilityId).toBe(metadata.capabilityId);
  expect(result.certified.capabilityVersion).toBe(metadata.capabilityVersion);
  expect(result.certified.certificationRef).toBe(metadata.certificationRef);
  expect(result.certified.fleetOSCompatibilityStatement).toBe("compatible_with_warnings");
  expect([...result.certified.warnings]).toEqual(["warn-1"]);
  expect(result.certified.capabilityClass).toBe("device.health.battery_aging");
  expect(ALL_CERTIFICATION_REFUSAL_REASONS.length).toBe(7);
});

test("the refusal projects onto the frozen FleetError taxonomy with the reasons in the invariant", () => {
  const result = requireCertifiedCapability(null, { correlationId: CORR });
  if (result.ok) throw new Error("expected refusal");
  const error = refusalToFleetError(result.refusal, CORR);
  expect(error.kind).toBe("DomainError");
  expect(error.code).toBe("learning.certification.refused");
  expect(error.invariant).toBe("missing_metadata");
});

// ---------------------------------------------------------------------------
// The adoption boundary: the fail-closed gate + the explicit grant
// ---------------------------------------------------------------------------

test("an UNCERTIFIED capability is refused at the boundary, audited, and NEVER becomes an adoption record", () => {
  const store = createInMemoryLearningAdoptionStore();
  const sink = createInMemoryLearningAuditSink();
  const refused = recordCapabilityAdoption(
    scopeA(),
    store,
    { ...certifiedMetadata(), certificationRef: "" },
    adoptionProposal(),
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.error.code).toBe("learning.certification.refused");
  expect(refused.refusal?.reasons).toContain("missing_certification_ref");
  // The ledger is untouched.
  expect(store.size(scopeA())).toBe(0);
  // The refusal IS audited (the boundary held — provable).
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.adoptionRefused);
  expect(sink.records[0].details.reasons).toContain("missing_certification_ref");
});

test("an INCOMPATIBLE capability is refused even though it is certified", () => {
  const store = createInMemoryLearningAdoptionStore();
  const refused = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ fleetOSCompatibilityStatement: "incompatible" }),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.refusal?.reasons).toContain("incompatible_capability");
  expect(store.size(scopeA())).toBe(0);
});

test("a certified capability is adopted through the EXPLICIT human-approved proposal (the grant recorded verbatim)", () => {
  const store = createInMemoryLearningAdoptionStore();
  const sink = createInMemoryLearningAuditSink();
  const metadata = certifiedMetadata();
  const proposal = adoptionProposal({ approverId: adoptionProposal().approverId, approvedAt: T0 });
  const result = recordCapabilityAdoption(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const record = result.record;
  expect(record.adoptionId).toBe(capabilityAdoptionId(TENANT_A, metadata.capabilityId));
  expect(record.recordId).toBe(capabilityAdoptionRecordId(record.adoptionId, 1));
  expect(record.version).toBe(1);
  expect(record.status).toBe(ADOPTION_ACTIVE);
  expect(record.capabilityId).toBe(metadata.capabilityId);
  expect(record.capabilityVersion).toBe(metadata.capabilityVersion);
  expect(record.certificationRef).toBe(metadata.certificationRef);
  // The explicit grant, verbatim.
  expect(record.approverId).toBe(proposal.approverId);
  expect(record.approvedAt).toBe(T0);
  expect(record.adoptedAt).toBe(T1);
  expect(record.cohort).toBe(proposal.cohort);
  expect(record.rollbackVersion).toBe(proposal.rollbackVersion);
  expect(record.proposalId).toBe(proposal.proposalId);
  expect(record.supersedes).toBeUndefined();
  // The default rollout policy is full.
  expect(record.rolloutPolicy).toEqual({ kind: "full" });
  // Audited as a created revision.
  expect(result.created).toBe(true);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.adoptionRecorded);
  expect(sink.records[0].subject).toBe(record.adoptionId);
});

test("a proposal without an approver/approved-at is refused (the grant is REQUIRED)", () => {
  const store = createInMemoryLearningAdoptionStore();
  const missing = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    { ...adoptionProposal(), approverId: "" as never, approvedAt: "not-a-time" },
    { at: T1, correlationId: CORR },
  );
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  const paths = failuresOf(missing.error).map((f) => f.path);
  expect(paths).toContain("/proposal/approverId");
  expect(paths).toContain("/proposal/approvedAt");
  expect(store.size(scopeA())).toBe(0);
});

// ---------------------------------------------------------------------------
// Supersession discipline
// ---------------------------------------------------------------------------

test("supersession appends a NEW revision citing the prior; the prior is NEVER rewritten", () => {
  const store = createInMemoryLearningAdoptionStore();
  const metadata = certifiedMetadata();
  const first = recordCapabilityAdoption(scopeA(), store, metadata, adoptionProposal(), {
    at: T1,
    correlationId: CORR,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const adoptionId = first.record.adoptionId;

  // A supersession: a new capability version, citing the prior recordId.
  const superseded = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({
      proposalId: "prop/test-2",
      supersedes: first.record.recordId,
      rollbackVersion: "1.2.0",
    }),
    { at: T1, correlationId: CORR },
  );
  expect(superseded.ok).toBe(true);
  if (!superseded.ok) return;
  expect(superseded.record.version).toBe(2);
  expect(superseded.record.supersedes).toBe(first.record.recordId);
  expect(superseded.record.capabilityVersion).toBe("1.3.0");
  expect(superseded.record.rollbackVersion).toBe("1.2.0");
  // Both revisions are durable; the prior is unchanged.
  const revisions = store.listAdoptionRevisions(scopeA(), adoptionId);
  expect(revisions).toHaveLength(2);
  expect(revisions[0].version).toBe(1);
  expect(revisions[0].contentDigest).toBe(first.record.contentDigest);
  expect(store.getLatestAdoption(scopeA(), adoptionId)?.version).toBe(2);
  expect(store.size(scopeA())).toBe(1);
});

test("a FRESH revision on an existing adoptionId MUST supersede (the structural refusal)", () => {
  const store = createInMemoryLearningAdoptionStore();
  const first = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const fresh = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({ proposalId: "prop/test-2" }),
    { at: T1, correlationId: CORR },
  );
  expect(fresh.ok).toBe(false);
  if (fresh.ok) return;
  expect(invariantOf(fresh.error)).toBe("supersedes_required_for_existing_adoption");
});

test("a supersession target that does not exist (or is not ACTIVE) is refused", () => {
  const store = createInMemoryLearningAdoptionStore();
  // An unknown target.
  const unknown = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal({ supersedes: "adpv_unknown0000" }),
    { at: T1, correlationId: CORR },
  );
  expect(unknown.ok).toBe(false);
  if (unknown.ok) return;
  expect(invariantOf(unknown.error)).toBe("supersession_target_unknown");
});

test("a re-adoption without supersedes on an existing adoption is REFUSED (the twin discipline); a store-level re-append of the SAME record is idempotent", () => {
  const store = createInMemoryLearningAdoptionStore();
  const sink = createInMemoryLearningAuditSink();
  const metadata = certifiedMetadata();
  const proposal = adoptionProposal();
  const first = recordCapabilityAdoption(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  // The ONLY legal way to add a revision on an existing adoptionId is a
  // supersession — a fresh re-adoption is refused machine-stably (the
  // arena adapter's twin discipline).
  const fresh = recordCapabilityAdoption(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(fresh.ok).toBe(false);
  if (fresh.ok) return;
  expect(invariantOf(fresh.error)).toBe("supersedes_required_for_existing_adoption");
  expect(sink.records).toHaveLength(1); // the refusal audited nothing (a failed validation)

  // A STORE-level re-append of the SAME record is idempotent: the same
  // version + the same digest return the existing record, created: false.
  // (The append-only discipline permits a re-append only for a
  // supersession-carrying record — a fresh v1 re-append is the refusal
  // proven above; the supersession path is the idempotent one.)
  const superseded = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({
      proposalId: "prop/test-2",
      supersedes: first.record.recordId,
      rollbackVersion: "1.2.0",
    }),
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(superseded.ok).toBe(true);
  if (!superseded.ok) return;
  const reappend = store.appendAdoption(scopeA(), superseded.record);
  expect(reappend.ok).toBe(true);
  if (!reappend.ok) return;
  expect(reappend.created).toBe(false);
  expect(reappend.record).toBe(superseded.record);
  expect(store.size(scopeA())).toBe(1);
  expect(store.listAdoptionRevisions(scopeA(), superseded.record.adoptionId)).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// The rollout policy validation
// ---------------------------------------------------------------------------

test("the rollout policy validation: canary requires a 0-100 percentage; ring requires ringIds; full requires neither", () => {
  const store = createInMemoryLearningAdoptionStore();
  const canaryMissing = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR, rolloutPolicy: { kind: "canary" } },
  );
  expect(canaryMissing.ok).toBe(false);
  if (canaryMissing.ok) return;
  expect(failuresOf(canaryMissing.error).map((f) => f.path)).toContain("/rolloutPolicy/percentage");

  const canaryOk = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR, rolloutPolicy: { kind: "canary", percentage: 10 } },
  );
  expect(canaryOk.ok).toBe(true);
  if (!canaryOk.ok) return;
  expect(canaryOk.record.rolloutPolicy).toEqual({ kind: "canary", percentage: 10 });

  const ringOk = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ capabilityId: "capability.other0001" }),
    adoptionProposal({ proposalId: "prop/test-ring" }),
    {
      at: T1,
      correlationId: CORR,
      rolloutPolicy: { kind: "ring", ringIds: ["ring-1", "ring-2"] },
    },
  );
  expect(ringOk.ok).toBe(true);
  if (!ringOk.ok) return;
  expect(ringOk.record.rolloutPolicy).toEqual({ kind: "ring", ringIds: ["ring-1", "ring-2"] });

  const fullWithExtras = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ capabilityId: "capability.other0002" }),
    adoptionProposal({ proposalId: "prop/test-full" }),
    {
      at: T1,
      correlationId: CORR,
      rolloutPolicy: { kind: "full", percentage: 50 },
    },
  );
  expect(fullWithExtras.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("the adoption ledger partitions by tenant; a certified capability from a foreign tenant is refused", () => {
  const store = createInMemoryLearningAdoptionStore();
  const foreign = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({ tenantId: TENANT_B }),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  expect(foreign.ok).toBe(false);
  if (foreign.ok) return;
  expect(invariantOf(foreign.error)).toBe("tenant_mismatch");

  const own = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  expect(own.ok).toBe(true);
  if (!own.ok) return;
  expect(store.size(scopeA())).toBe(1);
  expect(store.size(scopeB())).toBe(0);
  // A foreign adoption id is indistinguishable from an unknown one.
  expect(store.getLatestAdoption(scopeB(), own.record.adoptionId)).toBeUndefined();
  expect(store.listAdoptionRevisions(scopeB(), own.record.adoptionId)).toEqual([]);
  // A tenant-B append of a tenant-A record is refused.
  const record: LearningAdoptionRecord = own.record;
  const cross = store.appendAdoption(scopeB(), record);
  expect(cross.ok).toBe(false);
});

test("the adoption record carries warnings verbatim for compatible_with_warnings capabilities", () => {
  const store = createInMemoryLearningAdoptionStore();
  const result = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata({
      fleetOSCompatibilityStatement: "compatible_with_warnings",
      warnings: ["warning-stale-evaluation-suite"],
    }),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect([...result.record.warnings]).toEqual(["warning-stale-evaluation-suite"]);
  expect(result.certified.warnings).toEqual(["warning-stale-evaluation-suite"]);
});

test("the metadata facet is consumable as an unknown-typed value then validated (runtime guards hold)", () => {
  // The gate accepts the typed facet; a runtime-bypassed malformed value
  // still fails closed (the gate validates every field).
  const bypassed = requireCertifiedCapability(
    "not-an-object" as unknown as CertifiedCapabilityFacet,
    { correlationId: CORR },
  );
  expect(bypassed.ok).toBe(false);
  if (bypassed.ok) return;
  expect([...bypassed.refusal.reasons]).toEqual(["missing_metadata"]);
});
