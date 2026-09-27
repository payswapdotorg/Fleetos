/**
 * @fleetos/integration-adcos — D5: byte-identical determinism tests.
 *
 * The same inputs produce byte-identical outputs across runs and across
 * input permutations: translations, submission identities, revision
 * digests, and the FULL FLOW replay (audit action sequence + revision
 * chain digests).
 */

import { test, expect } from "bun:test";
import { translateConnectivityIntent } from "./translation";
import { validateStatusReport } from "./status-model";
import { createInMemorySubmissionStore, submissionIdOf } from "./submission";
import {
  adoptionContentDigest,
  createInMemoryConnectivityRecordStore,
  syncConnectivityStatus,
  terminateConnectivity,
} from "./adoption";
import { submitConnectivityIntent } from "./submission-gate";
import { createInMemoryAdcosAuditSink } from "./audit-seam";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import type { AdcosStatusReport } from "./status-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { asAdcosProviderHandle } from "./provider-boundary";
import {
  CORR,
  CORR_2,
  DEV_A1,
  TENANT_A,
  T0,
  T1,
  connectivityIntent,
  degradedActiveReport,
  localGuardian,
  ruleset,
  securePrivateRequirements,
} from "./test-support";

// ---------------------------------------------------------------------------
// Translation determinism
// ---------------------------------------------------------------------------

test("byte-identical translation across runs (fresh calls, same inputs)", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const runs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const result = translateConnectivityIntent(intent, securePrivateRequirements(), CORR);
    if (!result.ok) throw new Error(result.error.message);
    runs.push(JSON.stringify(result.request));
  }
  expect(new Set(runs).size).toBe(1);
});

test("requirement input permutations (zones/policy/compliance order) produce the identical request", () => {
  const base = securePrivateRequirements();
  const permuted: typeof base = {
    ...base,
    constraints: {
      requiredZones: [...base.constraints.requiredZones].reverse(),
      forbiddenZones: [...base.constraints.forbiddenZones].reverse(),
      egressAllowed: base.constraints.egressAllowed,
    },
    budget: {
      budgetRef: base.budget?.budgetRef,
      policyRefs: [...(base.budget?.policyRefs ?? [])].reverse(),
    },
    security: {
      ...base.security,
      complianceRefs: [...base.security.complianceRefs].reverse(),
    },
  };
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const a = translateConnectivityIntent(intent, base, CORR);
  const b = translateConnectivityIntent(intent, permuted, CORR);
  if (!a.ok || !b.ok) throw new Error("translation failed");
  expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
  expect(a.request.requestDigest).toBe(b.request.requestDigest);
});

// ---------------------------------------------------------------------------
// Full-flow replay determinism
// ---------------------------------------------------------------------------

/** The canonical full lifecycle: submit -> sync(degraded) -> sync(active) -> terminate. */
function runFullFlow(): {
  submissionId: string;
  auditActions: string[];
  revisionDigests: string[];
  submissionRevisionDigests: string[];
  connectivityId: string;
} {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const intent = connectivityIntent({
    sourceDeviceId: DEV_A1,
    outcome: "secure private connectivity",
  });

  const submitted = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intent,
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport, auditSink },
  );
  if (!submitted.ok || submitted.connectivityRecord === null) throw new Error("submit failed");
  const connectivityId = submitted.connectivityRecord.connectivityId;
  const handle = submitted.connectivityRecord.handle;

  // Degraded ACTIVE report.
  transport.pushStatusReport(degradedActiveReport(connectivityId, handle, T1));
  const degraded = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR, auditSink },
  );
  if (!degraded.ok) throw new Error(degraded.error.message);

  // Recovered ACTIVE report (measurements only).
  const recovered: AdcosStatusReport = {
    ...degradedActiveReport(connectivityId, handle, T1),
    degradation: { kind: "none" },
  };
  transport.pushStatusReport(recovered);
  const recoveredSync = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR_2, auditSink },
  );
  if (!recoveredSync.ok) throw new Error(recoveredSync.error.message);

  // Terminate.
  const terminated = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR_2, auditSink },
  );
  if (!terminated.ok) throw new Error(terminated.error.message);

  const record = recordStore.get({ tenantId: TENANT_A, correlationId: CORR }, connectivityId);
  if (!record.ok) throw new Error("record vanished");
  return {
    submissionId: submitted.record.submissionId,
    auditActions: auditSink.records.map((r) => r.action),
    revisionDigests: record.value.revisions.map((r) => r.contentDigest),
    submissionRevisionDigests: submitted.record.revisions.map((r) => r.contentDigest),
    connectivityId,
  };
}

test("the full lifecycle replays byte-identically from scratch (identical ids, digests, audit sequence)", () => {
  const first = runFullFlow();
  const second = runFullFlow();
  expect(first.submissionId).toBe(second.submissionId);
  expect(first.connectivityId).toBe(second.connectivityId);
  expect(first.auditActions).toEqual(second.auditActions);
  expect(first.revisionDigests).toEqual(second.revisionDigests);
  expect(first.submissionRevisionDigests).toEqual(second.submissionRevisionDigests);
  // The audit action sequence is exactly the consequential set.
  expect(first.auditActions).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted", // seed (PROVISIONING)
    "adcos.status.adopted", // degraded ACTIVE
    "adcos.degradation.recorded",
    "adcos.status.adopted", // recovered ACTIVE
    "adcos.termination.requested",
    "adcos.status.adopted", // TERMINATED
    "adcos.termination.adopted",
  ]);
  // The revision chain is hash-linked and has 4 revisions.
  expect(first.revisionDigests.length).toBe(4);
  expect(new Set(first.revisionDigests).size).toBe(4);
});

test("the deterministic identity is stable across independent runs (submission id + connectivity id)", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const a = translateConnectivityIntent(intent, securePrivateRequirements(), CORR);
  const b = translateConnectivityIntent(intent, securePrivateRequirements(), CORR_2);
  if (!a.ok || !b.ok) throw new Error("translation failed");
  // The digest is over content, not correlation ids.
  expect(a.request.requestDigest).toBe(b.request.requestDigest);
  expect(submissionIdOf(a.request)).toBe(submissionIdOf(b.request));
});

test("measurement permutation in reports yields identical adoption digests", () => {
  const handle: AdcosProviderHandle = asAdcosProviderHandle("adcos-h-permute01");
  const base = degradedActiveReport("adcos-c-permute01", handle, T1);
  const permuted: AdcosStatusReport = {
    ...base,
    measurements: [
      {
        kind: "throughput_mbps",
        value: 900,
        measuredAt: T1,
        evidence: { key: "evidence/adcos-thr-1", sizeBytes: 64, hash: "abc", hashAlgorithm: "sha256" },
      },
      ...base.measurements,
    ],
  };
  const a = validateStatusReport(base);
  const b = validateStatusReport(permuted);
  if (!a.ok || !b.ok) throw new Error("validation failed");
  // The degraded fixture has one latency measurement; the permuted report
  // adds a throughput one first — after normalization both sort to the
  // same order ONLY if the content matches. Here the content DIFFERS (an
  // extra measurement), so this asserts the sort, not equality:
  expect(b.report.measurements[0].kind).toBe("latency_ms");
  expect(b.report.measurements[1].kind).toBe("throughput_mbps");
  // Identical content in permuted order digests identically:
  const c = validateStatusReport({ ...permuted, measurements: [...permuted.measurements].reverse() });
  if (!c.ok) throw new Error("validation failed");
  expect(adoptionContentDigest(b.report)).toBe(adoptionContentDigest(c.report));
  void a;
});
