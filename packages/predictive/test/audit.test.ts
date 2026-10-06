/**
 * W153 predictive — D4 tests: audit emission through the injected sink,
 * structurally satisfied by @fleetos/audit's REAL sink adapter.
 *
 * The predictive audit seam (`PredictiveAuditSink`) is structurally
 * identical to the W011/W021/W022/W031/W032/W040/W041/W070 seams;
 * W012's `createAuditSinkAdapter` adapts the REAL hash-chained
 * `AuditLog` to any structurally identical seam. This suite proves:
 *   - the adapter satisfies the predictive seam (the type-level
 *     structural proof + the runtime flow);
 *   - extraction runs and provenance rejections flow into the
 *     hash-chained log; the chain VERIFIES;
 *   - per-tenant chains stay SEPARATE;
 *   - the emission policy (successful verification and idempotent
 *     re-appends never audit; unattributable runs never audit).
 */

import { test, expect } from "bun:test";
import {
  PREDICTIVE_AUDIT_ACTIONS,
  createInMemoryFeatureSetStore,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  materializeFeatureSet,
  verifyFeatureSetProvenance,
  type PredictiveAuditSink,
} from "../src/index";
import {
  CORR,
  CORR_2,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  absoluteWindow,
  atHour,
  numericHistory,
  realAuditLog,
  realPredictiveAuditSink,
  scopeA,
  scopeB,
  tenantContext,
} from "./helpers";

/** A genuine extraction input for tenant A. */
function inputA(sink?: PredictiveAuditSink) {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
    ...(sink !== undefined ? { auditSink: sink } : {}),
  };
}

// ---------------------------------------------------------------------------
// The structural binding (the REAL adapter satisfies the seam)
// ---------------------------------------------------------------------------

test("the REAL @fleetos/audit sink adapter satisfies the PredictiveAuditSink seam structurally", () => {
  const log = realAuditLog();
  const sink: PredictiveAuditSink = realPredictiveAuditSink(log);
  expect(typeof sink.append).toBe("function");
  // A hand-made record flows through into the hash-chained log.
  sink.append({
    action: "predictive.probe",
    tenantId: TENANT_A,
    subject: "dev_probe",
    occurredAt: T0,
    correlationId: CORR,
    details: { probe: true },
  });
  expect(log.size(tenantContext(TENANT_A))).toBe(1);
});

test("a full extraction + materialization flow emits into the hash-chained AuditLog; the chain verifies", () => {
  const log = realAuditLog();
  const sink = realPredictiveAuditSink(log);
  const ctxA = tenantContext(TENANT_A);

  // D1: an extraction run.
  const set = extractDeviceHistoryFeatures(inputA(sink));

  // D3: a materialization (a created cache append).
  const store = createInMemoryFeatureSetStore();
  materializeFeatureSet(scopeA(), store, set, { auditSink: sink });

  // D2: a provenance REFUSAL (a tampered set) — the trust anchor holding.
  const tampered = {
    ...set,
    features: set.features.map((f) => (f.id === "observation.count" ? { ...f, value: 42 } : f)),
  };
  const refused = verifyFeatureSetProvenance(tampered, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: numericHistory(),
    correlationId: CORR,
    auditSink: sink,
  });
  expect(refused.ok).toBe(false);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    PREDICTIVE_AUDIT_ACTIONS.featuresExtracted,
    PREDICTIVE_AUDIT_ACTIONS.featureSetMaterialized,
    PREDICTIVE_AUDIT_ACTIONS.provenanceRefused,
  ]);
  // The hash chain verifies end-to-end.
  const verification = log.verify(ctxA);
  expect(verification.ok).toBe(true);
  // The extraction record carries the digest (the W154 trust anchor's trail).
  const extractedRecord = log.records(ctxA).find((r) => r.action === PREDICTIVE_AUDIT_ACTIONS.featuresExtracted);
  expect(extractedRecord).toBeDefined();
  const details = extractedRecord?.details as Record<string, unknown>;
  expect(details["inputDigestValue"]).toBe(set.inputDigest?.value);
  expect(details["statusKind"]).toBe("ok");
});

test("per-tenant chains stay separate: tenant B's emissions never enter tenant A's chain", () => {
  const log = realAuditLog();
  const sink = realPredictiveAuditSink(log);
  const ctxA = tenantContext(TENANT_A);
  const ctxB = tenantContext(TENANT_B, CORR_2);

  // Tenant A: one extraction.
  extractDeviceHistoryFeatures(inputA(sink));

  // Tenant B: an extraction over B's own history.
  extractDeviceHistoryFeatures({
    tenantId: TENANT_B,
    deviceId: DEV_A1,
    observations: numericHistory().map((entry) => ({ ...entry, tenantId: TENANT_B })),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR_2,
    auditSink: sink,
  });

  expect(log.size(ctxA)).toBe(1);
  expect(log.size(ctxB)).toBe(1);
  expect(log.records(ctxA).every((r) => (r.tenantId as string) === (TENANT_A as string))).toBe(true);
  expect(log.records(ctxB).every((r) => (r.tenantId as string) === (TENANT_B as string))).toBe(true);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
  // The chain heads differ (separate chains).
  expect(log.head(ctxA)?.recordHash).not.toBe(log.head(ctxB)?.recordHash);
});

test("the emission policy: pure reads never audit; unattributable runs never audit", () => {
  const log = realAuditLog();
  const sink = realPredictiveAuditSink(log);
  const ctxA = tenantContext(TENANT_A);

  // A SUCCESSFUL verification is a pure read — no audit.
  const set = extractDeviceHistoryFeatures(inputA());
  const accepted = verifyFeatureSetProvenance(set, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: numericHistory(),
    correlationId: CORR,
    auditSink: sink,
  });
  expect(accepted.ok).toBe(true);
  expect(log.size(ctxA)).toBe(0);

  // An idempotent re-materialization mutates nothing and audits nothing.
  const store = createInMemoryFeatureSetStore();
  materializeFeatureSet(scopeA(), store, set, { auditSink: sink });
  materializeFeatureSet(scopeA(), store, set, { auditSink: sink });
  expect(log.size(ctxA)).toBe(1);

  // An unattributable (invalid tenant) extraction never audits.
  extractDeviceHistoryFeatures({
    ...inputA(),
    tenantId: "bad" as typeof TENANT_A,
    auditSink: sink,
  });
  expect(log.size(ctxA)).toBe(1);
});

test("the in-memory sink collects verbatim (the local reference implementation)", () => {
  const sink = createInMemoryPredictiveAuditSink();
  extractDeviceHistoryFeatures(inputA(sink));
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]?.action).toBe(PREDICTIVE_AUDIT_ACTIONS.featuresExtracted);
  expect(sink.records[0]?.tenantId).toBe(TENANT_A);
  void scopeB;
});
