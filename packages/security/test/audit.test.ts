/**
 * W031 D4 tests — the security audit seam: emission policy
 * (posture-finding mutations audit; pure derivations and failures never
 * do) and the structural compatibility with W012's audit primitives —
 * `createAuditSinkAdapter` over an in-memory `AuditLog` satisfies
 * `SecurityAuditSink` with ZERO glue; the records land in the
 * tenant-scoped, hash-chained, append-only trail and the chain
 * verifies.
 *
 * NOTE: `@fleetos/audit` is imported HERE (test scope) only — src/ never
 * imports it (the ownership gate scans src/ only). This mirrors the
 * W022-disclosed pattern and is the proof that the seam is structurally
 * satisfied by W012's adapter.
 */

import { describe, expect, test } from "bun:test";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import {
  NOOP_SECURITY_AUDIT_SINK,
  SECURITY_AUDIT_ACTIONS,
  assessSecurityPosture,
  createInMemoryPostureFindingsLedger,
  createInMemorySecurityAuditSink,
} from "../src/index";
import type { SecurityAuditSink } from "../src/index";
import {
  CORR,
  CORR_2,
  DEV_1,
  TENANT_A,
  T0,
  T1,
  scopeA,
  securityObservation,
  worstPayload,
} from "./helpers";

function derive(at: string, history: Parameters<typeof assessSecurityPosture>[0]["history"] = []) {
  const result = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEV_1,
    observations: [securityObservation(worstPayload())],
    at,
    history,
  });
  if (!result.ok) throw new Error(result.error.message);
  return [...result.posture.findings];
}

describe("D4: posture-finding mutation emission policy", () => {
  test("recording v1 findings emits security.finding.recorded per finding", () => {
    const sink = createInMemorySecurityAuditSink();
    const ledger = createInMemoryPostureFindingsLedger({ auditSink: sink });
    const findings = derive(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    expect(sink.records.length).toBe(findings.length);
    const record = sink.records[0];
    expect(record?.action).toBe(SECURITY_AUDIT_ACTIONS.findingRecorded);
    expect(record?.tenantId).toBe(TENANT_A);
    expect(record?.subject).toBe(DEV_1);
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as {
      findingId: string;
      recordId: string;
      code: string;
      severity: string;
      classification: string;
      interpretationVersion: number;
      supersedes: string | undefined;
      evidenceCount: number;
      remediationProposed: boolean;
    };
    expect(details.code).toBe("security.device.disk_encryption.off");
    expect(details.severity).toBe("CRITICAL");
    expect(details.interpretationVersion).toBe(1);
    expect(details.supersedes).toBeUndefined();
    expect(details.evidenceCount).toBe(1);
    expect(details.remediationProposed).toBe(true);
  });

  test("superseding (v2) emits security.finding.superseded; dismissal emits security.finding.dismissed", () => {
    const sink = createInMemorySecurityAuditSink();
    const ledger = createInMemoryPostureFindingsLedger({ auditSink: sink });
    const v1 = derive(T0);
    ledger.recordFindings(scopeA(), DEV_1, v1, { at: T0, correlationId: CORR });
    expect(sink.records.every((r) => r.action === SECURITY_AUDIT_ACTIONS.findingRecorded)).toBe(true);

    const v2 = derive(T1, ledger.listEntries(scopeA(), DEV_1));
    ledger.recordFindings(scopeA(), DEV_1, v2, { at: T1, correlationId: CORR_2 });
    expect(sink.records.filter((r) => r.action === SECURITY_AUDIT_ACTIONS.findingSuperseded).length).toBe(
      v2.length,
    );
    const supersededRecord = sink.records.find(
      (r) => r.action === SECURITY_AUDIT_ACTIONS.findingSuperseded,
    );
    expect((supersededRecord?.details as { interpretationVersion: number }).interpretationVersion).toBe(2);
    expect(supersededRecord?.correlationId).toBe(CORR_2);

    const dismissal = ledger.dismissFinding(scopeA(), DEV_1, v1[0]!.findingId, {
      at: T1,
      reason: "risk_accepted",
      correlationId: CORR,
    });
    expect(dismissal.ok).toBe(true);
    const dismissedRecord = sink.records[sink.records.length - 1];
    expect(dismissedRecord?.action).toBe(SECURITY_AUDIT_ACTIONS.findingDismissed);
    expect((dismissedRecord?.details as { findingId: string }).findingId).toBe(v1[0]!.findingId);
    expect((dismissedRecord?.details as { reason: string }).reason).toBe("risk_accepted");
  });

  test("pure derivations never audit; failed mutations never audit", () => {
    const sink = createInMemorySecurityAuditSink();
    // assessSecurityPosture is a pure derivation — no audit.
    derive(T0);
    expect(sink.records.length).toBe(0);

    const ledger = createInMemoryPostureFindingsLedger({ auditSink: sink });
    const v1 = derive(T0);
    // The first record succeeds and emits.
    expect(ledger.recordFindings(scopeA(), DEV_1, v1, { at: T0, correlationId: CORR }).ok).toBe(true);
    expect(sink.records.length).toBe(v1.length);
    // A rejected replay (version out of sequence) emits nothing extra.
    const replay = ledger.recordFindings(scopeA(), DEV_1, v1, { at: T1, correlationId: CORR });
    expect(replay.ok).toBe(false);
    expect(sink.records.length).toBe(v1.length);
    // A rejected dismissal (unknown identity) emits nothing.
    const badDismissal = ledger.dismissFinding(scopeA(), DEV_1, "sec_unknown000000", {
      at: T1,
      reason: "remediated",
      correlationId: CORR,
    });
    expect(badDismissal.ok).toBe(false);
    expect(sink.records.length).toBe(v1.length);
  });

  test("the default sink is a silent no-op", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const v1 = derive(T0);
    expect(ledger.recordFindings(scopeA(), DEV_1, v1, { at: T0, correlationId: CORR }).ok).toBe(true);
    expect(NOOP_SECURITY_AUDIT_SINK.append).toBeDefined();
  });
});

describe("D4: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies SecurityAuditSink structurally (no glue)", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, { source: "security.test" });
    const sink: SecurityAuditSink = adapter; // the structural assignment
    expect(typeof sink.append).toBe("function");

    const findings = derive(T0);
    const ledger = createInMemoryPostureFindingsLedger({ auditSink: sink });
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });

    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(findings.length);
    const record = records[0];
    expect(record?.action).toBe("security.finding.recorded");
    expect(record?.source).toBe("security.test");
    expect((record?.details as { subject: string }).subject).toBe(DEV_1);
    expect((record?.details as { severity: string }).severity).toBe("CRITICAL");
  });

  test("the full W012 pattern end to end: ledger -> adapter -> hash-chained AuditLog, chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: SecurityAuditSink = createAuditSinkAdapter(log, { source: "security.findings" });
    const ledger = createInMemoryPostureFindingsLedger({ auditSink: sink });

    const v1 = derive(T0);
    ledger.recordFindings(scopeA(), DEV_1, v1, { at: T0, correlationId: CORR });
    const v2 = derive(T1, ledger.listEntries(scopeA(), DEV_1));
    ledger.recordFindings(scopeA(), DEV_1, v2, { at: T1, correlationId: CORR_2 });
    ledger.dismissFinding(scopeA(), DEV_1, v1[0]!.findingId, {
      at: T1,
      reason: "remediated",
      correlationId: CORR,
    });

    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(v1.length + v2.length + 1);
    const verification = log.verify({ tenantId: TENANT_A });
    expect(verification.ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    // Gapless per-tenant sequence.
    expect(records[0]?.sequence).toBe(1);
    expect(records[records.length - 1]?.sequence).toBe(records.length);
  });
});
