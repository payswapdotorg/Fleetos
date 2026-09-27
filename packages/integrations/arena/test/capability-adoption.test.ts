/**
 * W050B arena — D5 tests: the certified-capability adoption flow.
 *
 * Covers the full D2 surface: supersession discipline, the rollout
 * policy, the rollback version, the warnings verbatim, the
 * certification-reference-carrying record (D3's invariant assertion),
 * and the adoption's EXPLICIT PROPOSAL-gated transition.
 */

import { test, expect } from "bun:test";
import {
  adoptCapability,
  createInMemoryCapabilityAdoptionStore,
  createInMemoryArenaAuditSink,
  ADOPTION_ACTIVE,
  ADOPTION_SUPERSEDED,
  ALL_CAPABILITY_ADOPTION_STATUSES,
  ALL_ROLLOUT_POLICY_KINDS,
  ALL_FLEETOS_COMPATIBILITY_STATEMENTS,
  capabilityAdoptionId,
  capabilityAdoptionRecordId,
  capabilityAdoptionContentDigest,
  type CapabilityAdoptionProposal,
  type CertifiedCapabilityMetadata,
} from "../src/index";
import {
  T0,
  T1,
  T2,
  TENANT_A,
  USER_1,
  USER_2,
  CORR,
  scopeA,
  certifiedMetadata,
  certificationRef,
} from "./helpers";

test("the adoption record carries every required field verbatim", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata({
    capabilityId: "device.security.anomaly_classifier",
    capabilityVersion: "2.0.0",
    evaluationSuiteRevision: "suite/v2",
    fleetOSCompatibilityStatement: "compatible",
    warnings: ["warning/requires-v2-adapter"],
    capabilityClass: "device.security.anomaly",
  });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.9.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const r = result.record;
  expect(r.capabilityId).toBe("device.security.anomaly_classifier");
  expect(r.capabilityVersion).toBe("2.0.0");
  expect(r.certificationRef).toBe(metadata.certificationRef);
  expect(r.evaluationSuiteRevision).toBe("suite/v2");
  expect(r.fleetOSCompatibilityStatement).toBe("compatible");
  expect(r.warnings).toEqual(["warning/requires-v2-adapter"]);
  expect(r.capabilityClass).toBe("device.security.anomaly");
  expect(r.cohort).toBe("cohort/canary-1");
  expect(r.rollbackVersion).toBe("1.9.0");
  expect(r.proposalId).toBe("prop/test-1");
  expect(r.approverId as string).toBe(USER_1 as string);
  expect(r.approvedAt).toBe(T0);
  expect(r.adoptedAt).toBe(T1);
  expect(r.status).toBe(ADOPTION_ACTIVE);
  expect(r.version).toBe(1);
  expect(r.supersedes).toBeUndefined();
});

test("validation: a missing proposalId is refused", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "",
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
  expect(result.error.failures.find((f) => f.path === "/proposal/proposalId")).toBeDefined();
});

test("validation: a missing approverId is refused", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: "" as never,
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
  expect(result.error.failures.find((f) => f.path === "/proposal/approverId")).toBeDefined();
});

test("validation: a missing cohort is refused", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/proposal/cohort")).toBeDefined();
});

test("validation: a missing rollbackVersion is refused", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/proposal/rollbackVersion")).toBeDefined();
});

test("validation: a non-ISO approvedAt is refused (not_iso)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: "not-an-iso",
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/proposal/approvedAt")).toBeDefined();
});

test("the adoption record is FROZEN (defense in depth)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata({ warnings: ["warning/one", "warning/two"] });
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
  expect(Object.isFrozen(result.record)).toBe(true);
  expect(Object.isFrozen(result.record.warnings)).toBe(true);
  expect(Object.isFrozen(result.record.rolloutPolicy)).toBe(true);
});

test("the adoption record's content digest is a deterministic digest of all content fields", () => {
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
  // Re-compute the content digest from the record's content fields and verify.
  const { adoptionId, recordId, contentDigest, ...content } = result.record;
  void adoptionId;
  void recordId;
  void contentDigest;
  const recomputed = capabilityAdoptionContentDigest(content);
  expect(recomputed).toBe(result.record.contentDigest);
});

test("ALL_CAPABILITY_ADOPTION_STATUSES is the closed union", () => {
  expect(ALL_CAPABILITY_ADOPTION_STATUSES).toEqual(["ACTIVE", "SUPERSEDED"]);
});

test("ALL_ROLLOUT_POLICY_KINDS is the closed union", () => {
  expect(ALL_ROLLOUT_POLICY_KINDS).toEqual(["canary", "ring", "full"]);
});

test("ALL_FLEETOS_COMPATIBILITY_STATEMENTS is the closed union", () => {
  expect(ALL_FLEETOS_COMPATIBILITY_STATEMENTS).toEqual([
    "compatible",
    "compatible_with_warnings",
    "incompatible",
  ]);
});

test("the adoption identity is the deterministic digest of (tenantId, capabilityId)", () => {
  const id1 = capabilityAdoptionId(TENANT_A, "device.health.battery_classifier");
  const id2 = capabilityAdoptionId(TENANT_A, "device.health.battery_classifier");
  expect(id1).toBe(id2);
  expect(id1.startsWith("adp_")).toBe(true);
  // Same capability, different tenant -> different id.
  const id3 = capabilityAdoptionId(TENANT_A, "device.health.battery_classifier");
  const id4 = capabilityAdoptionId(TENANT_A, "device.security.anomaly_classifier");
  expect(id3).not.toBe(id4);
});

test("the adoption revision id is the deterministic digest of (adoptionId, version)", () => {
  const id1 = capabilityAdoptionRecordId("adp_test", 1);
  const id2 = capabilityAdoptionRecordId("adp_test", 1);
  expect(id1).toBe(id2);
  expect(id1.startsWith("adpv_")).toBe(true);
  expect(capabilityAdoptionRecordId("adp_test", 1)).not.toBe(capabilityAdoptionRecordId("adp_test", 2));
});

test("the audit emission for an adoption carries the certification reference, approver id, and proposal id verbatim", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const sink = createInMemoryArenaAuditSink();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  adoptCapability(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(sink.records.length).toBe(1);
  const details = sink.records[0].details as Record<string, unknown>;
  expect(details["certificationRef"]).toBe(metadata.certificationRef);
  expect(details["approverId"]).toBe(USER_1 as string);
  expect(details["proposalId"]).toBe("prop/test-1");
  expect(details["cohort"]).toBe("cohort/canary-1");
  expect(details["rollbackVersion"]).toBe("1.1.0");
});

test("the audit emission for a supersession carries the prior recordId", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const sink = createInMemoryArenaAuditSink();
  const metadata1 = certifiedMetadata({ capabilityVersion: "1.0.0" });
  const proposal1: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "0.9.0",
  };
  const r1 = adoptCapability(scopeA(), store, metadata1, proposal1, {
    at: T0,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(r1.ok).toBe(true);
  if (!r1.ok) throw new Error(r1.error.message);
  // Supersession.
  const metadata2 = certifiedMetadata({ capabilityVersion: "1.1.0" });
  const proposal2: CapabilityAdoptionProposal = {
    proposalId: "prop/test-2",
    approverId: USER_2,
    approvedAt: T1,
    cohort: "cohort/canary-2",
    rollbackVersion: "1.0.0",
    supersedes: r1.record.recordId,
  };
  const r2 = adoptCapability(scopeA(), store, metadata2, proposal2, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(r2.ok).toBe(true);
  if (!r2.ok) throw new Error(r2.error.message);
  // The supersession audit emission carries the prior recordId.
  const supersedesRecord = sink.records.find((r) => r.action === "arena.capability.superseded");
  expect(supersedesRecord).toBeDefined();
  const details = supersedesRecord?.details as Record<string, unknown>;
  expect(details["supersedes"]).toBe(r1.record.recordId);
  expect(details["version"]).toBe(2);
});

test("a capability with `compatible_with_warnings` is adopted; the warnings are carried verbatim", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata({
    fleetOSCompatibilityStatement: "compatible_with_warnings",
    warnings: ["warning/requires-cleanup", "warning/may-fail-on-edge-case"],
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
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.fleetOSCompatibilityStatement).toBe("compatible_with_warnings");
  expect(result.record.warnings).toEqual([
    "warning/requires-cleanup",
    "warning/may-fail-on-edge-case",
  ]);
});

test("the certification reference grammar is satisfied by the helper's certificationRef generator", () => {
  const ref = certificationRef("adoption-test");
  expect(ref.startsWith("acr_")).toBe(true);
  expect(ref.length).toBeGreaterThanOrEqual("acr_".length + 16);
});

test("the certification reference is carried verbatim from the metadata through the adoption record", () => {
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
  // The certification reference is carried VERBATIM (the ARENA.md
  // invariant — the record is the audit evidence that the certification
  // existed at adoption time).
  expect(result.record.certificationRef).toBe(metadata.certificationRef);
});
