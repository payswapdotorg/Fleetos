/**
 * W051 convergence — D4: integration-evidence ledger tests.
 *
 *   - appends assign gapless per-tenant sequences with genesis-anchored
 *     hash chaining;
 *   - recorderFor/readerFor are ISOLATED BY CONSTRUCTION: a tenant-B
 *     recorder starts its OWN chain at 1 and can never see tenant-A
 *     records (there is no foreign-tenant API at all);
 *   - the REAL identity TenantContext flows through the ledger scopes
 *     (the structural-scope proof, same as the D1 binding);
 *   - verifyEvidenceChain passes on an untampered chain and DETECTS
 *     tampering (mutated details → payload_digest_mismatch) with the
 *     sequence it was detected at;
 *   - the digest is byte-compatible with the REAL @fleetos/audit FNV-1a
 *     reference (cross-package digest compatibility);
 *   - non-serializable details refuse with a machine-stable reason.
 */

import { test, expect } from "bun:test";
import { TENANT_A, TENANT_B, CORR, CORR_2, realAuditFnv1a32Hex, convergenceFnv1a32Hex, realCtx } from "./helpers";
import {
  EVIDENCE_GENESIS_HASH,
  canonicalJson,
  createIntegrationEvidenceLedger,
  verifyEvidenceChain,
} from "../src/index";
import type { IntegrationEvidenceRecord } from "../src/index";

const AT = "2026-01-01T00:00:00Z";

function appendInput(action: string, adapter = "aurum") {
  return {
    adapter,
    action,
    occurredAt: AT,
    correlationId: CORR,
    details: { sequenceNote: action, count: 1 },
  };
}

test("D4: appends assign gapless per-tenant sequences with genesis-anchored chaining", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const r1 = recorder.append(appendInput("aurum.message.emitted"));
  const r2 = recorder.append(appendInput("aurum.message.emitted"));
  const r3 = recorder.append(appendInput("aurum.message.emitted"));
  expect([r1.ok, r2.ok, r3.ok]).toEqual([true, true, true]);
  if (!r1.ok || !r2.ok || !r3.ok) throw new Error("appends failed");
  expect(r1.record.sequence).toBe(1);
  expect(r2.record.sequence).toBe(2);
  expect(r3.record.sequence).toBe(3);
  expect(r1.record.priorHash).toBe(EVIDENCE_GENESIS_HASH);
  expect(r2.record.priorHash).toBe(r1.record.recordHash);
  expect(r3.record.priorHash).toBe(r2.record.recordHash);
  expect(recorder.size()).toBe(3);
});

test("D4: recorderFor/readerFor are isolated by construction (no foreign-tenant API)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorderA = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const readerA = ledger.readerFor(realCtx(TENANT_A, CORR));
  const recorderB = ledger.recorderFor(realCtx(TENANT_B, CORR_2));
  const readerB = ledger.readerFor(realCtx(TENANT_B, CORR_2));
  const a = recorderA.append(appendInput("aurum.message.emitted"));
  expect(a.ok).toBe(true);
  // Tenant B has its OWN chain starting at 1 — never tenant A's records.
  const b = recorderB.append(appendInput("arena.case.submitted", "arena"));
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) throw new Error("appends failed");
  expect(b.record.sequence).toBe(1);
  expect(b.record.priorHash).toBe(EVIDENCE_GENESIS_HASH);
  expect(readerA.size()).toBe(1);
  expect(readerB.size()).toBe(1);
  expect(readerA.records()[0]?.tenantId).toBe(TENANT_A);
  expect(readerB.records()[0]?.tenantId).toBe(TENANT_B);
  expect(readerA.at(2)).toBeUndefined();
  expect(readerB.at(2)).toBeUndefined();
});

test("D4: the REAL identity TenantContext flows through the ledger scopes", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const r = recorder.append(appendInput("adcos.submission.created", "adcos"));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.reason);
  expect(r.record.tenantId).toBe(TENANT_A);
});

test("D4: verifyEvidenceChain passes on an untampered chain", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const reader = ledger.readerFor(realCtx(TENANT_A, CORR));
  recorder.append(appendInput("aurum.message.emitted"));
  recorder.append(appendInput("adcos.submission.created", "adcos"));
  recorder.append(appendInput("arena.case.submitted", "arena"));
  const v = verifyEvidenceChain(reader);
  expect(v.ok).toBe(true);
  if (!v.ok) throw new Error(v.reason);
  expect(v.size).toBe(3);
});

test("D4: verifyEvidenceChain DETECTS a mutated details payload (payload_digest_mismatch)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  recorder.append(appendInput("aurum.message.emitted"));
  const second = recorder.append(appendInput("aurum.message.emitted"));
  expect(second.ok).toBe(true);
  recorder.append(appendInput("aurum.message.emitted"));

  // Tamper with record #2's details WITHOUT updating the digest.
  const reader = ledger.readerFor(realCtx(TENANT_A, CORR));
  const original = reader.records()[1] as IntegrationEvidenceRecord;
  const tampered: IntegrationEvidenceRecord = {
    ...original,
    details: { ...original.details, sequenceNote: "FORGED" },
  };
  const spliced = {
    records: () => [reader.records()[0] as IntegrationEvidenceRecord, tampered, reader.records()[2] as IntegrationEvidenceRecord],
    tenantId: reader.tenantId,
    at: reader.at,
    size: () => 3,
  };
  const v = verifyEvidenceChain(spliced as never);
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected tamper detection");
  expect(v.atSequence).toBe(2);
  expect(v.reason).toBe("payload_digest_mismatch");
});

test("D4: verifyEvidenceChain DETECTS a record-hash tamper (record_hash_mismatch)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  recorder.append(appendInput("aurum.message.emitted"));
  recorder.append(appendInput("aurum.message.emitted"));
  const reader = ledger.readerFor(realCtx(TENANT_A, CORR));
  const original = reader.records()[1] as IntegrationEvidenceRecord;
  // Tamper with the action AND carry a consistent-looking payload digest
  // recomputed for the new content — the record hash still mismatches.
  const tampered: IntegrationEvidenceRecord = {
    ...original,
    action: "aurum.message.forbidden",
  };
  const spliced = {
    records: () => [reader.records()[0] as IntegrationEvidenceRecord, tampered],
    tenantId: reader.tenantId,
    at: reader.at,
    size: () => 2,
  };
  const v = verifyEvidenceChain(spliced as never);
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected tamper detection");
  expect(v.reason).toBe("record_hash_mismatch");
});

test("D4: verifyEvidenceChain DETECTS a dropped record (sequence_gap at the splice point)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  recorder.append(appendInput("aurum.message.emitted"));
  recorder.append(appendInput("aurum.message.emitted"));
  recorder.append(appendInput("aurum.message.emitted"));
  const reader = ledger.readerFor(realCtx(TENANT_A, CORR));
  // Drop record #2: the next record's sequence (3) no longer matches its
  // position (2) — the FIRST violation the walk reports.
  const spliced = {
    records: () => [reader.records()[0] as IntegrationEvidenceRecord, reader.records()[2] as IntegrationEvidenceRecord],
    tenantId: reader.tenantId,
    at: reader.at,
    size: () => 2,
  };
  const v = verifyEvidenceChain(spliced as never);
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected splice detection");
  expect(v.atSequence).toBe(2);
  expect(v.reason).toBe("sequence_gap");
});

test("D4: verifyEvidenceChain DETECTS a forged prior-hash link (prior_hash_mismatch)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  recorder.append(appendInput("aurum.message.emitted"));
  recorder.append(appendInput("aurum.message.emitted"));
  const reader = ledger.readerFor(realCtx(TENANT_A, CORR));
  // Forge record #2's priorHash (claim a different predecessor) while
  // keeping its sequence position valid — the linkage check fires.
  const original = reader.records()[1] as IntegrationEvidenceRecord;
  const forged: IntegrationEvidenceRecord = {
    ...original,
    priorHash: "0000ffff",
  };
  const spliced = {
    records: () => [reader.records()[0] as IntegrationEvidenceRecord, forged],
    tenantId: reader.tenantId,
    at: reader.at,
    size: () => 2,
  };
  const v = verifyEvidenceChain(spliced as never);
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected link detection");
  expect(v.atSequence).toBe(2);
  expect(v.reason).toBe("prior_hash_mismatch");
});

test("D4: the convergence FNV-1a is byte-compatible with the REAL @fleetos/audit reference", () => {
  const sample = canonicalJson({ action: "aurum.message.emitted", adapter: "aurum" });
  expect(convergenceFnv1a32Hex(sample)).toBe(realAuditFnv1a32Hex(sample));
  // And on plain strings too (the audit reference's native input).
  expect(convergenceFnv1a32Hex("fleetos")).toBe(realAuditFnv1a32Hex("fleetos"));
});

test("D4: non-serializable details refuse with a machine-stable reason", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const bad = recorder.append({
    adapter: "aurum",
    action: "aurum.message.emitted",
    occurredAt: AT,
    correlationId: CORR,
    details: { whoops: (() => "function") as unknown as number },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(bad.reason).toBe("details_not_serializable");
});

test("D4: an empty input refusal is machine-stable (adapter_required)", () => {
  const ledger = createIntegrationEvidenceLedger();
  const recorder = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const bad = recorder.append({
    adapter: "",
    action: "aurum.message.emitted",
    occurredAt: AT,
    correlationId: CORR,
    details: {},
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(bad.reason).toBe("adapter_required");
});

test("D4: the ledger's per-tenant partitions stay independent under interleaved appends", () => {
  const ledger = createIntegrationEvidenceLedger();
  const ra = ledger.recorderFor(realCtx(TENANT_A, CORR));
  const rb = ledger.recorderFor(realCtx(TENANT_B, CORR_2));
  const seqs: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = ra.append(appendInput(`aurum.message.emitted.${i}`));
    const b = rb.append(appendInput(`arena.case.submitted.${i}`, "arena"));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok) seqs.push(a.record.sequence);
    if (b.ok) seqs.push(b.record.sequence);
  }
  // Each tenant's chain counts its OWN appends only.
  expect(seqs).toEqual([1, 1, 2, 2, 3, 3]);
});
