/**
 * W070 learning — D3 binding tests: the REAL W050B arena adoption
 * boundary and the learning adoption ledger CONVERGE.
 *
 * The convergence proofs:
 *   1. the REAL arena adapter's `CertifiedCapabilityMetadata` is
 *      structurally assignable to the learning `CertifiedCapabilityFacet`
 *      (the type-level proof) and flows through the learning
 *      fail-closed gate;
 *   2. the learning `LearningAdoptionProposal` is structurally
 *      assignable to the arena `CapabilityAdoptionProposal` (and vice
 *      versa) — the same explicit human grant drives both boundaries;
 *   3. a learning adoption record and an arena adoption record built
 *      from IDENTICAL inputs are BYTE-IDENTICAL (same adoptionId, same
 *      recordId, same contentDigest — the structural twins share the
 *      identity schemes and the digest field list);
 *   4. the records are INTERCHANGEABLE: a learning record appends
 *      idempotently into the REAL arena `CapabilityAdoptionStore`, and
 *      an arena record appends idempotently into the learning ledger —
 *      the two ledgers agree on (tenant, capability) => the same
 *      adoption identity, the same revisions.
 */

import { test, expect } from "bun:test";
import {
  adoptCapability,
  createInMemoryCapabilityAdoptionStore,
  type CapabilityAdoptionProposal,
  type CapabilityAdoptionRecord,
  type CertifiedCapabilityMetadata,
} from "@fleetos/integration-arena";
import {
  capabilityAdoptionId as learningAdoptionId,
  capabilityAdoptionRecordId as learningRecordId,
  capabilityAdoptionContentDigest as learningContentDigest,
  createInMemoryLearningAdoptionStore,
  recordCapabilityAdoption,
  requireCertifiedCapability,
  type CertifiedCapabilityFacet,
  type LearningAdoptionProposal,
  type LearningAdoptionRecord,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  T0,
  T1,
  adoptionProposal,
  certifiedMetadata,
  scopeA,
} from "./helpers";

test("the REAL arena metadata is structurally assignable to the learning facet (the type-level proof)", () => {
  const arenaMetadata: CertifiedCapabilityMetadata = certifiedMetadata();
  // This assignment type-checks ONLY if the real arena metadata
  // satisfies the learning facet (the structural twin).
  const facet: CertifiedCapabilityFacet = arenaMetadata;
  expect(facet.capabilityId).toBe(arenaMetadata.capabilityId);
  // The REAL arena metadata flows through the LEARNING fail-closed gate.
  const certified = requireCertifiedCapability(arenaMetadata, { correlationId: CORR });
  expect(certified.ok).toBe(true);
  if (!certified.ok) return;
  expect(certified.certified.capabilityId).toBe(arenaMetadata.capabilityId);
  // A malformed REAL arena shape (empty certification ref) is refused
  // by the LEARNING gate with the machine-stable reasons.
  const refused = requireCertifiedCapability(
    { ...arenaMetadata, certificationRef: "" },
    { correlationId: CORR },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect([...refused.refusal.reasons]).toContain("missing_certification_ref");
});

test("the learning proposal and the arena proposal are structurally interchangeable (the explicit grant twin)", () => {
  const learning: LearningAdoptionProposal = adoptionProposal();
  // The learning proposal IS an arena proposal (structurally).
  const arena: CapabilityAdoptionProposal = learning;
  expect(arena.proposalId).toBe(learning.proposalId);
  expect(arena.approverId).toBe(learning.approverId);
  expect(arena.approvedAt).toBe(learning.approvedAt);
  // And an arena-built proposal flows into the learning boundary.
  const arenaProposal: CapabilityAdoptionProposal = {
    proposalId: "prop/arena-twin-1",
    approverId: learning.approverId,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const twin: LearningAdoptionProposal = arenaProposal;
  expect(twin.proposalId).toBe("prop/arena-twin-1");
});

test("identical inputs produce BYTE-IDENTICAL learning and arena adoption records (the convergence)", () => {
  const metadata = certifiedMetadata();
  const proposal = adoptionProposal();
  // The learning record.
  const learningStore = createInMemoryLearningAdoptionStore();
  const learning = recordCapabilityAdoption(scopeA(), learningStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(learning.ok).toBe(true);
  if (!learning.ok) return;
  // The arena record (the REAL adapter boundary, same inputs, same
  // default rollout policy { kind: "full" }).
  const arenaStore = createInMemoryCapabilityAdoptionStore();
  const arena = adoptCapability(scopeA(), arenaStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(arena.ok).toBe(true);
  if (!arena.ok) return;
  // BYTE-IDENTICAL: every field agrees, including the deterministic
  // identity schemes and the content digests.
  expect(learning.record.adoptionId).toBe(arena.record.adoptionId);
  expect(learning.record.recordId).toBe(arena.record.recordId);
  expect(learning.record.contentDigest).toBe(arena.record.contentDigest);
  expect(JSON.stringify(learning.record)).toBe(JSON.stringify(arena.record));
  // The identity helpers agree across the packages.
  expect(learning.record.adoptionId).toBe(learningAdoptionId(TENANT_A, metadata.capabilityId));
  expect(learning.record.recordId).toBe(learningRecordId(learning.record.adoptionId, 1));
});

test("a learning adoption record appends IDEMPOTENTLY into the REAL arena store (interchangeable ledgers)", () => {
  const metadata = certifiedMetadata();
  const proposal = adoptionProposal();
  const arenaStore = createInMemoryCapabilityAdoptionStore();
  const arena = adoptCapability(scopeA(), arenaStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(arena.ok).toBe(true);
  if (!arena.ok) return;

  const learningStore = createInMemoryLearningAdoptionStore();
  const learning = recordCapabilityAdoption(scopeA(), learningStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(learning.ok).toBe(true);
  if (!learning.ok) return;

  // The learning record IS an arena record (structurally). A fresh v1
  // append into a partition that already holds the arena v1 is the
  // twin discipline's structural refusal (supersedes required) — the
  // append-only discipline holds across BOTH ledgers.
  const arenaRecord: CapabilityAdoptionRecord = learning.record;
  const fresh = arenaStore.appendAdoption(scopeA(), arenaRecord);
  expect(fresh.ok).toBe(false);
  if (fresh.ok) return;

  // The idempotent path: BOTH ledgers supersede to v2 with identical
  // inputs, producing byte-identical v2 records; the learning v2
  // record re-appends into the arena store IDEMPOTENTLY (the same
  // version + the same digest -> the arena's own record returns).
  const arenaV2 = adoptCapability(
    scopeA(),
    arenaStore,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({
      proposalId: "prop/test-2",
      supersedes: arena.record.recordId,
      rollbackVersion: "1.2.0",
    }),
    { at: T1, correlationId: CORR },
  );
  const learningV2 = recordCapabilityAdoption(
    scopeA(),
    learningStore,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({
      proposalId: "prop/test-2",
      supersedes: learning.record.recordId,
      rollbackVersion: "1.2.0",
    }),
    { at: T1, correlationId: CORR },
  );
  expect(arenaV2.ok).toBe(true);
  expect(learningV2.ok).toBe(true);
  if (!arenaV2.ok || !learningV2.ok) return;
  expect(JSON.stringify(learningV2.record)).toBe(JSON.stringify(arenaV2.record));
  const reappend = arenaStore.appendAdoption(scopeA(), learningV2.record);
  expect(reappend.ok).toBe(true);
  if (!reappend.ok) return;
  expect(reappend.record).toBe(arenaV2.record);
  expect(arenaStore.size(scopeA())).toBe(1);
  expect(arenaStore.listAdoptionRevisions(scopeA(), arena.record.adoptionId)).toHaveLength(2);
});

test("an arena adoption record appends IDEMPOTENTLY into the learning ledger (bidirectional convergence)", () => {
  const metadata = certifiedMetadata();
  const proposal = adoptionProposal();
  const arenaStore = createInMemoryCapabilityAdoptionStore();
  const arena = adoptCapability(scopeA(), arenaStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
  });
  expect(arena.ok).toBe(true);
  if (!arena.ok) return;

  const learningStore = createInMemoryLearningAdoptionStore();
  // The arena record IS a learning record (structurally).
  const learningRecord: LearningAdoptionRecord = arena.record;
  const appended = learningStore.appendAdoption(scopeA(), learningRecord);
  expect(appended.ok).toBe(true);
  if (!appended.ok) return;
  expect(appended.created).toBe(true);
  expect(appended.record.contentDigest).toBe(arena.record.contentDigest);

  // A supersession converges too: supersede in the arena ledger, then
  // mirror the revision into the learning ledger (same recordId, same
  // digest — the append is idempotent).
  const superseded = adoptCapability(
    scopeA(),
    arenaStore,
    certifiedMetadata({ capabilityVersion: "1.3.0" }),
    adoptionProposal({
      proposalId: "prop/test-2",
      supersedes: arena.record.recordId,
      rollbackVersion: "1.2.0",
    }),
    { at: T1, correlationId: CORR },
  );
  expect(superseded.ok).toBe(true);
  if (!superseded.ok) return;
  const mirrored: LearningAdoptionRecord = superseded.record;
  const mirroredAppend = learningStore.appendAdoption(scopeA(), mirrored);
  expect(mirroredAppend.ok).toBe(true);
  if (!mirroredAppend.ok) return;
  expect(mirroredAppend.created).toBe(true);
  expect(learningStore.listAdoptionRevisions(scopeA(), mirrored.adoptionId)).toHaveLength(2);
  // The learning digest helper agrees with the arena record's digest.
  const { adoptionId: _a, recordId: _r, contentDigest: _d, ...content } = superseded.record;
  void _a;
  void _r;
  void _d;
  expect(superseded.record.contentDigest).toBe(learningContentDigest(content));
});

test("the closed loop end-to-end: a refused arena adoption is refused identically by the learning boundary", () => {
  const malformed = { ...certifiedMetadata(), certificationRef: "bad-ref" };
  const arenaStore = createInMemoryCapabilityAdoptionStore();
  const learningStore = createInMemoryLearningAdoptionStore();
  const arena = adoptCapability(scopeA(), arenaStore, malformed, adoptionProposal(), {
    at: T1,
    correlationId: CORR,
  });
  const learning = recordCapabilityAdoption(scopeA(), learningStore, malformed, adoptionProposal(), {
    at: T1,
    correlationId: CORR,
  });
  expect(arena.ok).toBe(false);
  expect(learning.ok).toBe(false);
  if (arena.ok || learning.ok) return;
  // Both boundaries refuse with the SAME machine-stable reasons (the
  // structural twins share the refusal taxonomy).
  expect(arena.refusal?.reasons).toEqual(learning.refusal?.reasons);
  expect([...(learning.refusal?.reasons ?? [])]).toContain("malformed_certification_ref");
  expect(arenaStore.size(scopeA())).toBe(0);
  expect(learningStore.size(scopeA())).toBe(0);
});
