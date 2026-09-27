/**
 * W031 D1/D4 tests — the append-only findings ledger: versioned
 * supersession (new records supersede, never rewrite), dismissal, the
 * derived active view, byte-level immutability of prior entries, and
 * tenant isolation by construction.
 */

import { describe, expect, test } from "bun:test";
import {
  createInMemoryPostureFindingsLedger,
  assessSecurityPosture,
} from "../src/index";
import type { SecurityFinding } from "../src/index";
import {
  CORR,
  DEV_1,
  TENANT_A,
  T0,
  T1,
  scopeA,
  scopeB,
  securityObservation,
  worstPayload,
} from "./helpers";

function deriveFindings(at: string = T0, history: Parameters<typeof assessSecurityPosture>[0]["history"] = []): SecurityFinding[] {
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

describe("D1: append-only supersession discipline", () => {
  test("recording findings appends; re-assessment appends NEW versions (v1 bytes untouched)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const v1Findings = deriveFindings(T0);
    const first = ledger.recordFindings(scopeA(), DEV_1, v1Findings, { at: T0, correlationId: CORR });
    expect(first.ok).toBe(true);
    const v1Snapshot = JSON.stringify(ledger.listEntries(scopeA(), DEV_1));

    const v2Findings = deriveFindings(T1, ledger.listEntries(scopeA(), DEV_1));
    const second = ledger.recordFindings(scopeA(), DEV_1, v2Findings, { at: T1, correlationId: CORR });
    expect(second.ok).toBe(true);

    const entries = ledger.listEntries(scopeA(), DEV_1);
    expect(entries).toHaveLength(v1Findings.length + v2Findings.length);
    // The v1 records are STILL THERE, byte-identical.
    expect(JSON.stringify(entries.slice(0, v1Findings.length))).toBe(v1Snapshot);
    // Every v2 finding supersedes its v1 record.
    for (const v2 of v2Findings) {
      expect(v2.interpretationVersion).toBe(2);
      expect(v2.supersedes).toBeDefined();
    }
    expect(ledger.size(scopeA(), DEV_1)).toBe(entries.length);
  });

  test("version-out-of-sequence appends are rejected (no silent rewrites)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const v1Findings = deriveFindings(T0);
    expect(ledger.recordFindings(scopeA(), DEV_1, v1Findings, { at: T0, correlationId: CORR }).ok).toBe(true);

    // Re-recording v1 (version 1 again) is out of sequence.
    const replay = ledger.recordFindings(scopeA(), DEV_1, v1Findings, { at: T1, correlationId: CORR });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.code).toBe("security.findings.ledger");
    }
    // Skipping to v3 is out of sequence too.
    const history = ledger.listEntries(scopeA(), DEV_1);
    const v3Findings = deriveFindings(T1, history).map((f) => ({
      ...f,
      interpretationVersion: 3,
    }));
    const skip = ledger.recordFindings(scopeA(), DEV_1, v3Findings, { at: T1, correlationId: CORR });
    expect(skip.ok).toBe(false);
    expect(ledger.size(scopeA(), DEV_1)).toBe(v1Findings.length); // nothing appended.
  });

  test("records are frozen; entries never mutate", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    for (const entry of ledger.listEntries(scopeA(), DEV_1)) {
      expect(Object.isFrozen(entry)).toBe(true);
      if (entry.kind === "finding") {
        expect(Object.isFrozen(entry.finding)).toBe(true);
        expect(Object.isFrozen(entry.finding.evidence)).toBe(true);
      }
    }
  });
});

describe("D1: dismissal + the derived active view", () => {
  test("the active view is the latest version per identity, minus dismissed", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const v1Findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, v1Findings, { at: T0, correlationId: CORR });
    expect(ledger.resolveActiveFindings(scopeA(), DEV_1)).toHaveLength(v1Findings.length);

    // Dismiss one finding.
    const target = v1Findings[0] as SecurityFinding;
    const dismissal = ledger.dismissFinding(scopeA(), DEV_1, target.findingId, {
      at: T1,
      reason: "risk_accepted",
      correlationId: CORR,
    });
    expect(dismissal.ok).toBe(true);
    const active = ledger.resolveActiveFindings(scopeA(), DEV_1);
    expect(active).toHaveLength(v1Findings.length - 1);
    expect(active.some((f) => f.findingId === target.findingId)).toBe(false);
    // The dismissed record REMAINS in history (append-only).
    expect(ledger.listEntries(scopeA(), DEV_1)).toHaveLength(v1Findings.length + 1);
  });

  test("a re-derived finding after dismissal re-activates at the next version (evidence wins)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const v1Findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, v1Findings, { at: T0, correlationId: CORR });
    const target = v1Findings[0] as SecurityFinding;
    ledger.dismissFinding(scopeA(), DEV_1, target.findingId, {
      at: T1,
      reason: "risk_accepted",
      correlationId: CORR,
    });
    // Re-assessment still observes the condition -> v2 -> active again.
    const v2Findings = deriveFindings(T1, ledger.listEntries(scopeA(), DEV_1));
    ledger.recordFindings(scopeA(), DEV_1, v2Findings, { at: T1, correlationId: CORR });
    const active = ledger.resolveActiveFindings(scopeA(), DEV_1);
    const reactivated = active.find((f) => f.findingId === target.findingId);
    expect(reactivated?.interpretationVersion).toBe(2);
  });

  test("dismissing an unknown finding identity is rejected", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const dismissal = ledger.dismissFinding(scopeA(), DEV_1, "sec_unknown000000", {
      at: T0,
      reason: "remediated",
      correlationId: CORR,
    });
    expect(dismissal.ok).toBe(false);
    // Dismissing without a reason is rejected.
    const findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    const noReason = ledger.dismissFinding(scopeA(), DEV_1, findings[0]!.findingId, {
      at: T1,
      reason: "",
      correlationId: CORR,
    });
    expect(noReason.ok).toBe(false);
  });

  test("the active view is deterministically ordered (severity desc, code asc)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    const active = ledger.resolveActiveFindings(scopeA(), DEV_1);
    const severities = active.map((f) => f.severity);
    expect(severities).toEqual([
      "CRITICAL",
      "CRITICAL",
      "CRITICAL",
      "HIGH",
      "HIGH",
      "HIGH",
      "MEDIUM",
      "MEDIUM",
    ]);
  });
});

describe("D4: findings-ledger tenant isolation (by construction)", () => {
  test("a tenant-B scope never observes tenant-A findings (same device id, different partition)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    // Tenant B reads the SAME device id — its partition is empty.
    expect(ledger.listEntries(scopeB(), DEV_1)).toEqual([]);
    expect(ledger.resolveActiveFindings(scopeB(), DEV_1)).toEqual([]);
    expect(ledger.size(scopeB(), DEV_1)).toBe(0);
    // Tenant A sees its own.
    expect(ledger.size(scopeA(), DEV_1)).toBe(findings.length);
  });

  test("cross-tenant findings are rejected on record (tenant_or_device_mismatch)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const foreign = deriveFindings(T0).map((f) => ({ ...f, tenantId: "tnt_testtenant000b" as never }));
    const result = ledger.recordFindings(scopeA(), DEV_1, foreign, { at: T0, correlationId: CORR });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("DomainError");
    }
    expect(ledger.size(scopeA(), DEV_1)).toBe(0);
  });

  test("foreign finding ids are indistinguishable from unknown ones on dismissal", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    // Tenant A records a finding for DEV_1...
    const findings = deriveFindings(T0);
    ledger.recordFindings(scopeA(), DEV_1, findings, { at: T0, correlationId: CORR });
    // ...tenant B tries to dismiss A's finding identity under its own scope:
    // unknown in B's partition — the same error as any unknown id.
    const dismissal = ledger.dismissFinding(scopeB(), DEV_1, findings[0]!.findingId, {
      at: T1,
      reason: "remediated",
      correlationId: CORR,
    });
    expect(dismissal.ok).toBe(false);
    if (!dismissal.ok) {
      expect((dismissal.error as { invariant?: string }).invariant).toBe("finding_unknown");
    }
    // A's finding is untouched.
    expect(ledger.resolveActiveFindings(scopeA(), DEV_1)).toHaveLength(findings.length);
  });

  test("context-free and invalid scopes are rejected at runtime (types bypassed)", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const findings = deriveFindings(T0);
    expect(ledger.recordFindings(undefined as never, DEV_1, findings, { at: T0, correlationId: CORR }).ok).toBe(false);
    expect(ledger.recordFindings(null as never, DEV_1, findings, { at: T0, correlationId: CORR }).ok).toBe(false);
    expect(ledger.recordFindings({} as never, DEV_1, findings, { at: T0, correlationId: CORR }).ok).toBe(false);
    expect(
      ledger.recordFindings({ tenantId: "tnt_bad" } as never, DEV_1, findings, { at: T0, correlationId: CORR }).ok,
    ).toBe(false);
    // Bypassed reads return nothing.
    expect(ledger.listEntries(undefined as never, DEV_1)).toEqual([]);
    expect(ledger.resolveActiveFindings(undefined as never, DEV_1)).toEqual([]);
    expect(ledger.size(undefined as never, DEV_1)).toBe(0);
    // Nothing stored.
    expect(ledger.size(scopeA(), DEV_1)).toBe(0);
  });

  test("per-device ledgers are independent within a tenant partition", () => {
    const ledger = createInMemoryPostureFindingsLedger();
    const dev1 = deriveFindings(T0);
    const dev2 = deriveFindings(T0).map((f) => ({
      ...f,
      deviceId: "dev_testdevice0002" as never,
      tenantId: TENANT_A,
    }));
    ledger.recordFindings(scopeA(), DEV_1, dev1, { at: T0, correlationId: CORR });
    ledger.recordFindings(scopeA(), "dev_testdevice0002" as never, dev2, { at: T0, correlationId: CORR });
    expect(ledger.size(scopeA(), DEV_1)).toBe(dev1.length);
    expect(ledger.size(scopeA(), "dev_testdevice0002" as never)).toBe(dev2.length);
  });
});
