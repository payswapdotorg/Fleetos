/**
 * W040 recovery — D4 tests: warranty-aware replacement escalation.
 *
 * Consumes the REAL W021 health diagnosis engine (`diagnose` with real
 * anomaly records -> versioned hypotheses + treatment recommendations
 * carrying DRAFT `ReplacementIntentPayload`s) and the REAL W032 vendor
 * model (`buildVendor` -> typed quality/SLA/warranty terms). The
 * escalation records are PROPOSALS (append-only ledger, supersession
 * discipline) — never automatic procurement.
 */

import { test, expect } from "bun:test";
import { asObservationId } from "@fleetos/contracts";
import type { AnomalyEvidence, HealthAnomaly, SignalKind } from "@fleetos/health";
import { SIGNAL_KIND_SPECIFICATIONS } from "@fleetos/health";
import { diagnose } from "@fleetos/health";
import { buildVendor } from "@fleetos/vendors";
import {
  escalateReplacement,
  supersedeReplacementEscalation,
  createInMemoryReplacementEscalationLedger,
  createInMemoryRecoveryAuditSink,
  classifyWarrantyStanding,
  MS_PER_DAY,
} from "../src/index";
import type { ReplacementDiagnosisProposal } from "../src/index";
import {
  T0,
  T1,
  T2,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  DEV_B1,
  CORR,
  CORR_2,
  atDay,
  scopeA,
} from "./helpers";

// ---------------------------------------------------------------------------
// REAL health diagnosis (the W021 edge)
// ---------------------------------------------------------------------------

/** A deterministic HealthAnomaly record (the health engine's own shape). */
function anomaly(
  id: string,
  ruleId: "crash.burst" | "boot.slow",
  observationIds: readonly string[],
): HealthAnomaly {
  const signalKind: SignalKind = ruleId === "crash.burst" ? "crash.event" : "boot.time";
  const evidence: AnomalyEvidence[] = observationIds.map((observationId) => ({
    observationId: asObservationId(observationId),
    observedAt: T0,
    observationKind: "device.health",
    role: "window_event" as const,
  }));
  return {
    id,
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    ruleId,
    severity: "CRITICAL",
    signalKind,
    unit: SIGNAL_KIND_SPECIFICATIONS[signalKind].unit,
    value: ruleId === "crash.burst" ? observationIds.length : 90_000,
    observedAt: T0,
    evidence,
    detail: ruleId === "crash.burst" ? { windowMs: 86_400_000, count: observationIds.length } : { thresholdMs: 60_000 },
    anomalyRulesVersion: 1,
    schemaVersion: 1,
  };
}

/** The replacement-arm proposal of the health engine (narrowed from the union). */
type ReplacementArm = Extract<import("@fleetos/health").HealthIntentProposal, { intentKind: "ReplacementIntent" }>;

/** Run the REAL diagnosis engine and extract the replacement recommendation. */
function replacementDiagnosis() {
  const anomalies = [
    anomaly("anom_crash_1", "crash.burst", ["obs_crash_1", "obs_crash_2"]),
    anomaly("anom_boot_1", "boot.slow", ["obs_boot_1"]),
  ];
  const result = diagnose(anomalies, { tenantId: TENANT_A, deviceId: DEV_A1, at: T0, correlationId: CORR });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const candidate = result.recommendations.find((r) => r.proposedIntent.intentKind === "ReplacementIntent");
  if (candidate === undefined) throw new Error("expected a replacement recommendation");
  const proposedIntent = candidate.proposedIntent;
  if (proposedIntent.intentKind !== "ReplacementIntent") throw new Error("unreachable");
  const narrowed: ReplacementArm = proposedIntent;
  const hypothesis = result.hypotheses.find((h) => h.id === candidate.hypothesisId);
  if (hypothesis === undefined) throw new Error("expected the backing hypothesis");
  return { result, replacement: candidate, proposedIntent: narrowed, hypothesis, anomalies };
}

// ---------------------------------------------------------------------------
// REAL vendor terms (the W032 edge)
// ---------------------------------------------------------------------------

/** Build a REAL vendor and return its typed warranty terms. */
function realVendorTerms(warrantyDays: number) {
  const built = buildVendor(TENANT_A, {
    name: `acme-${warrantyDays}`,
    description: "test vendor",
    terms: { quality: { score: 0.9 }, sla: { coverage: 0.8 }, warranty: { days: warrantyDays } },
    at: T0,
    correlationId: CORR,
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error.message);
  return { vendor: built.vendor, terms: built.vendor.terms };
}

// ---------------------------------------------------------------------------
// Warranty classification
// ---------------------------------------------------------------------------

test("classifyWarrantyStanding: in_warranty, out_of_warranty, no_warranty_terms", () => {
  const { terms } = realVendorTerms(365);
  const inWarranty = classifyWarrantyStanding(atDay(10), {
    vendorId: "vnd_1",
    terms,
    warrantyStartAt: T0,
  });
  expect(inWarranty).toBe("in_warranty");
  const outOfWarranty = classifyWarrantyStanding(atDay(400), {
    vendorId: "vnd_1",
    terms,
    warrantyStartAt: T0,
  });
  expect(outOfWarranty).toBe("out_of_warranty");
  expect(classifyWarrantyStanding(atDay(10), undefined)).toBe("no_warranty_terms");
  // Future-dated coverage start: machine-stable, never a clamp.
  expect(classifyWarrantyStanding(T0, { vendorId: "vnd_1", terms, warrantyStartAt: atDay(1) })).toBe(
    "out_of_warranty",
  );
  expect(MS_PER_DAY).toBe(86_400_000);
});

test("the boundary day itself is in warranty (age <= days)", () => {
  const { terms } = realVendorTerms(30);
  expect(classifyWarrantyStanding(atDay(30), { vendorId: "vnd_1", terms, warrantyStartAt: T0 })).toBe(
    "in_warranty",
  );
  expect(classifyWarrantyStanding(atDay(31), { vendorId: "vnd_1", terms, warrantyStartAt: T0 })).toBe(
    "out_of_warranty",
  );
});

// ---------------------------------------------------------------------------
// Escalation records (PROPOSALS — never procurement)
// ---------------------------------------------------------------------------

test("escalateReplacement consumes the REAL health diagnosis + REAL vendor terms (in_warranty)", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const { vendor, terms } = realVendorTerms(365);
  const ledger = createInMemoryReplacementEscalationLedger();
  const result = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      caseId: "rc_warranty_case",
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent, // the REAL health proposal (narrowed to the replacement arm)
        observationIds: hypothesis.evidence.flatMap((e) => e.observationIds as readonly string[]),
      },
      warranty: { vendorId: vendor.vendorId as string, vendorName: vendor.name, terms, warrantyStartAt: T0 },
    },
    { at: atDay(10), correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const record = result.record;
  expect(record.version).toBe(1);
  expect(record.warrantyStanding).toBe("in_warranty");
  expect(record.caseId).toBe("rc_warranty_case");
  expect(record.diagnosis.hypothesisId).toBe(hypothesis.id);
  expect(record.diagnosis.proposedIntent.intentKind).toBe("ReplacementIntent");
  expect(record.diagnosis.proposedIntent.payload).toEqual(proposedIntent.payload); // frozen shape, verbatim
  expect(record.escalationId).toMatch(/^re_/);
  expect(record.contentDigest).toMatch(/^[0-9a-f]{8}$/);
});

test("the same diagnosis + old warranty start classifies out_of_warranty", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const { terms } = realVendorTerms(90);
  const ledger = createInMemoryReplacementEscalationLedger();
  const result = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent,
        observationIds: hypothesis.evidence.flatMap((e) => e.observationIds as readonly string[]),
      },
      warranty: { vendorId: "vnd_old", terms, warrantyStartAt: T0 },
    },
    { at: atDay(400), correlationId: CORR },
  );
  expect(result.ok && result.record.warrantyStanding).toBe("out_of_warranty");
});

test("no vendor terms supplied -> no_warranty_terms (machine-stable, not an error)", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const ledger = createInMemoryReplacementEscalationLedger();
  const result = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent,
        observationIds: [],
      },
    },
    { at: atDay(1), correlationId: CORR },
  );
  expect(result.ok && result.record.warrantyStanding).toBe("no_warranty_terms");
  expect(result.ok ? result.record.warranty : undefined).toBeUndefined();
});

test("escalations are PROPOSALS: the record carries no procurement surface (never automatic)", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const ledger = createInMemoryReplacementEscalationLedger();
  const result = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent,
        observationIds: ["obs_1"],
      },
    },
    { at: atDay(1), correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const serialized = JSON.stringify(result.record);
  // A proposal cites evidence + warranty standing; it never orders, quotes, or demands.
  for (const forbidden of ["quote", "order", "demand", "procurement", "purchaseOrder"]) {
    expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
});

// ---------------------------------------------------------------------------
// Supersession discipline (append-only)
// ---------------------------------------------------------------------------

test("supersession appends a new revision citing the prior; the prior revision is never rewritten", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const { vendor, terms } = realVendorTerms(30);
  const diagnosis = {
    hypothesisId: hypothesis.id,
    recommendationId: replacement.id,
    causeId: hypothesis.causeId,
    confidence: replacement.confidence,
    proposedIntent,
    observationIds: hypothesis.evidence.flatMap((e) => e.observationIds as readonly string[]),
  };
  const ledger = createInMemoryReplacementEscalationLedger();
  const first = escalateReplacement(
    scopeA(),
    ledger,
    { deviceId: DEV_A1, diagnosis, warranty: { vendorId: vendor.vendorId as string, terms, warrantyStartAt: T0 } },
    { at: atDay(1), correlationId: CORR },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  const second = supersedeReplacementEscalation(scopeA(), ledger, first.record, {
    at: atDay(100),
    correlationId: CORR_2,
    warranty: { vendorId: vendor.vendorId as string, terms, warrantyStartAt: T0 },
  });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.record.version).toBe(2);
  expect(second.record.supersedes).toBe(first.record.escalationId);
  expect(second.record.warrantyStanding).toBe("out_of_warranty"); // re-classified at the new instant
  const revisions = ledger.listEscalationRevisions(scopeA(), first.record.escalationId);
  expect(revisions).toHaveLength(2);
  expect(revisions[0]).toBe(first.record); // untouched
  expect(revisions[0].warrantyStanding).toBe("in_warranty");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("escalation determinism: the same inputs produce byte-identical records", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const { vendor, terms } = realVendorTerms(365);
  const diagnosis = {
    hypothesisId: hypothesis.id,
    recommendationId: replacement.id,
    causeId: hypothesis.causeId,
    confidence: replacement.confidence,
    proposedIntent,
    observationIds: hypothesis.evidence.flatMap((e) => e.observationIds as readonly string[]),
  };
  const build = () =>
    escalateReplacement(
      scopeA(),
      createInMemoryReplacementEscalationLedger(),
      {
        deviceId: DEV_A1,
        diagnosis,
        warranty: { vendorId: vendor.vendorId as string, terms, warrantyStartAt: T0 },
      },
      { at: atDay(10), correlationId: CORR },
    );
  const one = build();
  const two = build();
  expect(one.ok && two.ok).toBe(true);
  expect(JSON.stringify(one.ok ? one.record : null)).toBe(JSON.stringify(two.ok ? two.record : null));
});

test("observation evidence refs are order-insensitive (sorted at construction)", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const { vendor, terms } = realVendorTerms(365);
  const base = {
    hypothesisId: hypothesis.id,
    recommendationId: replacement.id,
    causeId: hypothesis.causeId,
    confidence: replacement.confidence,
    proposedIntent,
  };
  const one = escalateReplacement(
    scopeA(),
    createInMemoryReplacementEscalationLedger(),
    { deviceId: DEV_A1, diagnosis: { ...base, observationIds: ["obs_b", "obs_a"] }, warranty: { vendorId: vendor.vendorId as string, terms, warrantyStartAt: T0 } },
    { at: atDay(1), correlationId: CORR },
  );
  const two = escalateReplacement(
    scopeA(),
    createInMemoryReplacementEscalationLedger(),
    { deviceId: DEV_A1, diagnosis: { ...base, observationIds: ["obs_a", "obs_b"] }, warranty: { vendorId: vendor.vendorId as string, terms, warrantyStartAt: T0 } },
    { at: atDay(1), correlationId: CORR },
  );
  expect(JSON.stringify(one.ok ? one.record : null)).toBe(JSON.stringify(two.ok ? two.record : null));
  expect(one.ok ? one.record.diagnosis.observationIds : []).toEqual(["obs_a", "obs_b"]);
});

// ---------------------------------------------------------------------------
// Validation + audit
// ---------------------------------------------------------------------------

test("invalid escalation inputs are refused with tagged ValidationErrors", () => {
  const ledger = createInMemoryReplacementEscalationLedger();
  const badIntent = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: "hyp_1",
        recommendationId: "tr_1",
        causeId: "health.hardware_failing",
        confidence: 0.8,
        proposedIntent: {
          intentKind: "MaintainDeviceIntent",
          payload: { description: "x" },
        } as unknown as ReplacementDiagnosisProposal,
        observationIds: [],
      },
    },
    { at: T1, correlationId: CORR },
  );
  expect(badIntent.ok).toBe(false);
  if (badIntent.ok) throw new Error("expected failure");
  expect(badIntent.error.kind).toBe("ValidationError");
  if (badIntent.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(badIntent.error.failures.map((f) => f.reason)).toContain("replacement_intent_kind_required");
  const badWarranty = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: "hyp_1",
        recommendationId: "tr_1",
        causeId: "health.hardware_failing",
        confidence: 0.8,
        proposedIntent: { intentKind: "ReplacementIntent", payload: { deviceId: DEV_A1 as string, reason: "failing" } },
        observationIds: [],
      },
      warranty: { vendorId: "vnd_1", terms: { warranty: { days: -5 } }, warrantyStartAt: T0 },
    },
    { at: T1, correlationId: CORR },
  );
  expect(badWarranty.ok).toBe(false);
  if (badWarranty.ok) throw new Error("expected failure");
  expect(badWarranty.error.kind).toBe("ValidationError");
  if (badWarranty.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(badWarranty.error.failures.map((f) => f.reason)).toContain("non_negative_number_required");
});

test("escalation + supersession emit recovery.replacement.* audit records", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const sink = createInMemoryRecoveryAuditSink();
  const ledger = createInMemoryReplacementEscalationLedger();
  const first = escalateReplacement(
    scopeA(),
    ledger,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent,
        observationIds: ["obs_1"],
      },
    },
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  const second = supersedeReplacementEscalation(scopeA(), ledger, first.record, {
    at: T2,
    correlationId: CORR_2,
    auditSink: sink,
  });
  expect(second.ok).toBe(true);
  expect(sink.records.map((r) => r.action)).toEqual([
    "recovery.replacement.escalated",
    "recovery.replacement.superseded",
  ]);
  const escalatedDetails = sink.records[0].details as Record<string, unknown>;
  expect(escalatedDetails["hypothesisId"]).toBe(hypothesis.id);
  expect(escalatedDetails["warrantyStanding"]).toBe("no_warranty_terms");
});

// ---------------------------------------------------------------------------
// Tenant isolation basics (exhaustive suite in tenant-isolation.test.ts)
// ---------------------------------------------------------------------------

test("a foreign tenant's escalation is indistinguishable from an unknown one", () => {
  const { replacement, hypothesis, proposedIntent } = replacementDiagnosis();
  const ledgerA = createInMemoryReplacementEscalationLedger();
  const first = escalateReplacement(
    scopeA(),
    ledgerA,
    {
      deviceId: DEV_A1,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: replacement.id,
        causeId: hypothesis.causeId,
        confidence: replacement.confidence,
        proposedIntent,
        observationIds: [],
      },
    },
    { at: T1, correlationId: CORR },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  // Tenant B's scope sees nothing in ITS partition.
  expect(ledgerA.getLatestEscalation({ tenantId: TENANT_B, correlationId: CORR }, first.record.escalationId)).toBeUndefined();
  expect(ledgerA.listEscalationIds({ tenantId: TENANT_B, correlationId: CORR })).toEqual([]);
  // Cross-tenant supersession is refused.
  const cross = supersedeReplacementEscalation({ tenantId: TENANT_B, correlationId: CORR }, ledgerA, first.record, {
    at: T2,
    correlationId: CORR_2,
  });
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected failure");
  expect(cross.error.kind).toBe("DomainError");
  if (cross.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(cross.error.invariant).toBe("tenant_mismatch");
});

test("a tenant-B device escalates independently in tenant-B's partition", () => {
  const ledger = createInMemoryReplacementEscalationLedger();
  const result = escalateReplacement(
    { tenantId: TENANT_B, correlationId: CORR },
    ledger,
    {
      deviceId: DEV_B1,
      diagnosis: {
        hypothesisId: "hyp_tenant_b",
        recommendationId: "tr_tenant_b",
        causeId: "health.hardware_failing",
        confidence: 0.7,
        proposedIntent: { intentKind: "ReplacementIntent", payload: { deviceId: DEV_B1 as string, reason: "failing" } },
        observationIds: ["obs_b_1"],
      },
    },
    { at: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.tenantId).toBe(TENANT_B);
  expect(ledger.size(scopeA())).toBe(0);
  expect(ledger.size({ tenantId: TENANT_B, correlationId: CORR })).toBe(1);
});
