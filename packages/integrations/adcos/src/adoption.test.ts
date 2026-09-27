/**
 * @fleetos/integration-adcos — D3d: the adoption + termination tests.
 *
 * Coverage: versioned append-only revisions with deterministic content
 * digests, idempotent replay by report content, degradation/termination
 * adoption, the unmet-requirements diff, handle consistency, malformed
 * report refusal.
 */

import { test, expect } from "bun:test";
import {
  adoptConnectivityStatus,
  createInMemoryConnectivityRecordStore,
  syncConnectivityStatus,
  terminateConnectivity,
  unmetRequirements,
  adoptionContentDigest,
} from "./adoption";
import { createInMemorySubmissionStore } from "./submission";
import { submitConnectivityIntent } from "./submission-gate";
import { createInMemoryAdcosAuditSink } from "./audit-seam";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import { translateConnectivityIntent } from "./translation";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  T0,
  T1,
  T2,
  connectivityIntent,
  degradedActiveReport,
  localGuardian,
  ruleset,
  securePrivateRequirements,
} from "./test-support";

/** Submit a canonical ALLOW flow and return the full harness. */
function submittedHarness() {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const intent = connectivityIntent({
    sourceDeviceId: DEV_A1,
    outcome: "secure private connectivity",
  });
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intent,
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport, auditSink },
  );
  if (!result.ok || result.connectivityRecord === null) throw new Error("setup failed");
  return { transport, submissionStore, recordStore, auditSink, intent, result, record: result.connectivityRecord };
}

test("adoption appends versioned revisions with deterministic, hash-linked digests", () => {
  const h = submittedHarness();
  expect(h.record.revisions.length).toBe(1);
  const rev1 = h.record.revisions[0];
  expect(rev1.revision).toBe(1);
  expect(rev1.priorDigest).toBeNull();
  expect(rev1.contentDigest).toMatch(/^[0-9a-f]{8}$/);

  // Push a degraded-ACTIVE provider report and sync it.
  h.transport.pushStatusReport(degradedActiveReport(h.record.connectivityId, h.record.handle, T1));
  const adopted = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR, auditSink: h.auditSink },
  );
  expect(adopted.ok).toBe(true);
  if (!adopted.ok) throw new Error(adopted.error.message);
  expect(adopted.replayed).toBe(false);
  expect(adopted.record.revisions.length).toBe(2);
  const rev2 = adopted.record.revisions[1];
  expect(rev2.revision).toBe(2);
  expect(rev2.priorDigest).toBe(rev1.contentDigest); // hash-linked
  expect(rev2.executionState).toBe("ACTIVE");
  expect(rev2.degradation.kind).toBe("latency_degraded");
  expect(rev2.measurements.length).toBe(1);
  expect(rev2.measurements[0].evidence.key).toBe("evidence/adcos-latency-1");

  // Audits: the degradation adoption records BOTH the status and the degradation.
  expect(h.auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted", // the seed
    "adcos.status.adopted", // revision 2
    "adcos.degradation.recorded",
  ]);
});

test("prior revisions are NEVER rewritten (append-only by construction)", () => {
  const h = submittedHarness();
  h.transport.pushStatusReport(degradedActiveReport(h.record.connectivityId, h.record.handle, T1));
  const adopted = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR },
  );
  if (!adopted.ok) throw new Error(adopted.error.message);
  const rev1Before = JSON.stringify(adopted.record.revisions[0]);
  h.transport.pushStatusReport(degradedActiveReport(h.record.connectivityId, h.record.handle, T2));
  const again = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T2, correlationId: CORR },
  );
  if (!again.ok) throw new Error(again.error.message);
  expect(again.record.revisions.length).toBe(3);
  expect(JSON.stringify(again.record.revisions[0])).toBe(rev1Before);
  expect(again.record.revisions[1].contentDigest).toBe(adopted.record.revisions[1].contentDigest);
});

test("re-adopting identical report content is an idempotent replay (no append, no audit)", () => {
  const h = submittedHarness();
  // The provider state right after submission: sync returns the SAME
  // report content as the seeded revision -> replay.
  const replay = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR, auditSink: h.auditSink },
  );
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw new Error(replay.error.message);
  expect(replay.replayed).toBe(true);
  expect(replay.record.revisions.length).toBe(1);
  // The audit sequence is unchanged (no new consequential mutation).
  expect(h.auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted",
  ]);
});

test("adoption at a DIFFERENT instant with identical content still replays (the digest covers content, not time)", () => {
  const h = submittedHarness();
  const a = adoptionContentDigest(
    (h.transport.fetchStatus(h.record.handle, { at: T0, correlationId: CORR }) as never),
  );
  const b = adoptionContentDigest(
    (h.transport.fetchStatus(h.record.handle, { at: T2, correlationId: CORR }) as never),
  );
  expect(a).toBe(b);
});

test("a malformed report is refused with machine-stable failures (never adopted)", () => {
  const h = submittedHarness();
  const malformed = {
    connectivityId: h.record.connectivityId,
    handle: h.record.handle,
    executionState: "WARPED",
    acceptedRequirements: h.record.revisions[0].acceptedRequirements,
    measurements: [],
    degradation: { kind: "none" },
    failure: { kind: "none" },
    termination: null,
    reportedAt: T1,
  };
  const adopted = adoptConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    malformed,
    { at: T1 },
  );
  expect(adopted.ok).toBe(false);
  if (!adopted.ok) {
    expect(adopted.error.code).toBe("adcos.report.invalid");
  }
  const after = h.recordStore.get({ tenantId: TENANT_A, correlationId: CORR }, h.record.connectivityId);
  if (after.ok) expect(after.value.revisions.length).toBe(1);
});

test("a report with a mismatched handle is refused with handle_mismatch", () => {
  const h = submittedHarness();
  const mismatched = degradedActiveReport(h.record.connectivityId, "adcos-h-foreign000" as never, T1);
  const adopted = adoptConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    mismatched,
    { at: T1 },
  );
  expect(adopted.ok).toBe(false);
  if (!adopted.ok) {
    expect(adopted.error.kind).toBe("DomainError");
    expect((adopted.error as { invariant?: string }).invariant).toBe("handle_mismatch");
  }
});

test("an unknown connectivity id is refused with not_found", () => {
  const h = submittedHarness();
  const adopted = adoptConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    degradedActiveReport("adcos-c-unknown000", h.record.handle, T1),
    { at: T1 },
  );
  expect(adopted.ok).toBe(false);
  if (!adopted.ok) {
    expect((adopted.error as { invariant?: string }).invariant).toBe("not_found");
  }
});

test("termination: the tenant request flows through the transport and adopts the TERMINATED revision", () => {
  const h = submittedHarness();
  const terminated = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR, auditSink: h.auditSink },
  );
  expect(terminated.ok).toBe(true);
  if (!terminated.ok) throw new Error(terminated.error.message);
  expect(terminated.record.executionState).toBe("TERMINATED");
  const head = terminated.record.revisions[terminated.record.revisions.length - 1];
  expect(head.termination).not.toBeNull();
  expect(head.termination?.reason).toBe("tenant_requested");
  expect(head.termination?.terminatedAt).toBe(T1);
  expect(h.transport.terminations.length).toBe(1);

  expect(h.auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted", // the seed
    "adcos.termination.requested",
    "adcos.status.adopted", // the TERMINATED revision
    "adcos.termination.adopted",
  ]);
});

test("terminating a terminated connectivity is idempotent at the adoption level", () => {
  const h = submittedHarness();
  const first = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR },
  );
  if (!first.ok) throw new Error(first.error.message);
  const second = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T2, correlationId: CORR },
  );
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.replayed).toBe(true); // the final report content is unchanged
  expect(second.record.revisions.length).toBe(2); // no new revision
});

test("syncing an unknown handle is refused with unknown_handle", () => {
  const h = submittedHarness();
  // A record whose handle the provider does not know.
  const orphan = { ...h.record, handle: "adcos-h-unknown000" as never };
  h.recordStore.store({ tenantId: TENANT_A, correlationId: CORR }, orphan);
  const synced = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    h.recordStore,
    h.transport,
    h.record.connectivityId,
    { at: T1, correlationId: CORR },
  );
  expect(synced.ok).toBe(false);
  if (!synced.ok) {
    expect((synced.error as { invariant?: string }).invariant).toBe("unknown_handle");
  }
});

// ---------------------------------------------------------------------------
// The unmet-requirements diff
// ---------------------------------------------------------------------------

test("the unmet-requirements diff lists every facet the acceptance fails to cover", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const translated = translateConnectivityIntent(intent, securePrivateRequirements(), CORR);
  if (!translated.ok) throw new Error(translated.error.message);
  const request = translated.request;

  const weaker = {
    outcome: "secure_private_connectivity" as const,
    properties: { isolation: "public" as const, redundancy: "none" as const },
    constraints: {
      requiredZones: [] as string[],
      forbiddenZones: [] as string[],
      egressAllowed: true,
    },
    duration: { startAt: T2, indefinite: true },
    security: { encryption: "not_required" as const, privateRouting: false, complianceRefs: [] as string[] },
  };
  const unmet = unmetRequirements(request, weaker);
  expect(unmet).toEqual([
    "/constraints/egressAllowed",
    "/constraints/forbiddenZones/public",
    "/constraints/requiredZones/corporate",
    "/duration/endAt",
    "/duration/startAt",
    "/properties/availabilityTarget",
    "/properties/isolation",
    "/properties/redundancy",
    "/security/complianceRefs/soc2",
    "/security/encryption",
    "/security/privateRouting",
  ]);
});

test("an acceptance equal to the request yields an empty diff", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const translated = translateConnectivityIntent(intent, securePrivateRequirements(), CORR);
  if (!translated.ok) throw new Error(translated.error.message);
  const request = translated.request;
  const equal = {
    outcome: request.outcome.canonical,
    properties: request.properties,
    constraints: request.constraints,
    duration: request.duration,
    security: request.security,
  };
  expect(unmetRequirements(request, equal)).toEqual([]);
});

test("a stronger acceptance (better latency, more redundancy) yields an empty diff", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const translated = translateConnectivityIntent(intent, securePrivateRequirements(), CORR);
  if (!translated.ok) throw new Error(translated.error.message);
  const request = translated.request;
  const stronger = {
    outcome: request.outcome.canonical,
    properties: { ...request.properties, redundancy: "device_redundant" as const },
    constraints: request.constraints,
    duration: request.duration,
    security: request.security,
  };
  expect(unmetRequirements(request, stronger)).toEqual([]);
});
