/**
 * W031 D4 tests — the policy audit seam: emission policy (consequential
 * BLOCK / REQUIRE_APPROVAL decisions and rule-set publications audit;
 * ALLOW / WARN and failures never do) and the structural compatibility
 * with W012's audit primitives — `createAuditSinkAdapter` over an
 * in-memory `AuditLog` satisfies `PolicyAuditSink` with ZERO glue and
 * lands the records in the tenant-scoped, hash-chained, append-only
 * trail. The chain verifies.
 *
 * NOTE: `@fleetos/audit` is imported HERE (test scope) only — src/ never
 * imports it (the ownership gate forbids cross-lane src imports; the
 * gate scans src/ only). This mirrors the W022-disclosed pattern and is
 * the proof that the seam is structurally satisfied by W012's adapter.
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
  NOOP_POLICY_AUDIT_SINK,
  POLICY_AUDIT_ACTIONS,
  compileGuardianRuleSet,
  createInMemoryGuardianRuleSetStore,
  createInMemoryPolicyAuditSink,
  evaluateGuardianRequest,
} from "../src/index";
import type { PolicyAuditSink } from "../src/index";
import { CORR, CORR_2, TENANT_A, TENANT_B, T0, T1, request, rule, scopeA, scopeB } from "./helpers";

const uploadCondition = { kind: "action", actions: { in: ["file.upload"] } } as const;

describe("D4: Guardian evaluation emission policy", () => {
  test("a BLOCK decision emits exactly one audit record", () => {
    const sink = createInMemoryPolicyAuditSink();
    const r = rule(TENANT_A, { name: "blocker", condition: uploadCondition, effect: "BLOCK", at: T0 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const result = evaluateGuardianRequest(compiled.ruleSet, request(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(POLICY_AUDIT_ACTIONS.guardianEvaluated);
    expect(record?.tenantId).toBe(TENANT_A);
    expect(record?.subject).toBe("dev_testdevice0001");
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as {
      decision: string;
      ruleSetId: string;
      ruleSetVersion: number;
      rules: { ruleId: string; ruleVersion: number }[];
      actionKind: string;
      matchedRuleCount: number;
    };
    expect(details.decision).toBe("BLOCK");
    expect(details.ruleSetVersion).toBe(1);
    expect(details.rules).toHaveLength(1);
    expect(details.rules[0]?.ruleId).toBe(r.ruleId);
    expect(details.rules[0]?.ruleVersion).toBe(1);
    expect(details.actionKind).toBe("file.upload");
    expect(details.matchedRuleCount).toBe(1);
  });

  test("a REQUIRE_APPROVAL decision audits; WARN and ALLOW do not", () => {
    const sink = createInMemoryPolicyAuditSink();
    for (const effect of ["REQUIRE_APPROVAL", "WARN", "ALLOW"] as const) {
      const r = rule(TENANT_A, { name: `emit-${effect}`, condition: uploadCondition, effect, at: T0 });
      const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
      if (!compiled.ok) throw new Error(compiled.error.message);
      evaluateGuardianRequest(compiled.ruleSet, request(), { at: T0, correlationId: CORR, auditSink: sink });
    }
    // Only the REQUIRE_APPROVAL emission.
    expect(sink.records.length).toBe(1);
    expect((sink.records[0]?.details as { decision: string }).decision).toBe("REQUIRE_APPROVAL");
  });

  test("no sink injected -> no emission, decision unchanged (the default is a silent no-op)", () => {
    const r = rule(TENANT_A, { name: "noop-sink", condition: uploadCondition, effect: "BLOCK", at: T0 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const result = evaluateGuardianRequest(compiled.ruleSet, request(), { at: T0, correlationId: CORR });
    expect(result.ok).toBe(true);
    expect(NOOP_POLICY_AUDIT_SINK.append).toBeDefined();
  });

  test("failed evaluations never audit (errors carry their own trace)", () => {
    const sink = createInMemoryPolicyAuditSink();
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const crossTenant = evaluateGuardianRequest(compiled.ruleSet, request({ tenantId: TENANT_B }), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(crossTenant.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });
});

describe("D4: rule-set publication emission", () => {
  test("publishing emits policy.ruleset.published; rejected puts never audit", () => {
    const sink = createInMemoryPolicyAuditSink();
    const store = createInMemoryGuardianRuleSetStore({ auditSink: sink });
    const r = rule(TENANT_A, { name: "pub-rule", condition: uploadCondition, effect: "WARN", at: T0 });
    const v1 = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
    if (!v1.ok) throw new Error(v1.error.message);
    expect(store.putRuleSet(scopeA(), v1.ruleSet).ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(POLICY_AUDIT_ACTIONS.ruleSetPublished);
    expect(record?.tenantId).toBe(TENANT_A);
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as {
      ruleSetId: string;
      version: number;
      contentDigest: string;
      ruleCount: number;
    };
    expect(details.version).toBe(1);
    expect(details.ruleCount).toBe(1);
    expect(typeof details.contentDigest).toBe("string");

    // Idempotent republication: no duplicate emission (nothing mutated).
    expect(store.putRuleSet(scopeA(), v1.ruleSet).ok).toBe(true);
    expect(sink.records.length).toBe(1);

    // Cross-tenant put: rejected, never audited.
    expect(store.putRuleSet(scopeB(), v1.ruleSet).ok).toBe(false);
    expect(sink.records.length).toBe(1);

    // Version 2 publishes with its own trace.
    const v2 = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 2, at: T1 });
    if (!v2.ok) throw new Error(v2.error.message);
    expect(store.putRuleSet(scopeA(CORR_2), v2.ruleSet).ok).toBe(true);
    expect(sink.records.length).toBe(2);
    expect(sink.records[1]?.correlationId).toBe(CORR_2);
  });
});

describe("D4: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies PolicyAuditSink structurally (no glue)", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, { source: "policy.test" });
    const sink: PolicyAuditSink = adapter; // the structural assignment
    expect(typeof sink.append).toBe("function");

    const r = rule(TENANT_A, { name: "adapter-rule", condition: uploadCondition, effect: "BLOCK", at: T0 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const result = evaluateGuardianRequest(compiled.ruleSet, request(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record?.action).toBe("policy.guardian.evaluated");
    expect(record?.source).toBe("policy.test");
    expect(record?.correlationId).toBe(CORR);
    expect((record?.details as { subject: string }).subject).toBe("dev_testdevice0001");
    expect((record?.details as { decision: string }).decision).toBe("BLOCK");
  });

  test("the full W012 pattern end to end: engine -> adapter -> hash-chained AuditLog, chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: PolicyAuditSink = createAuditSinkAdapter(log, {
      source: "policy.guardian",
    });
    const r = rule(TENANT_A, { name: "chain-rule", condition: uploadCondition, effect: "REQUIRE_APPROVAL", at: T0 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    evaluateGuardianRequest(compiled.ruleSet, request(), { at: T0, correlationId: CORR, auditSink: sink });
    evaluateGuardianRequest(compiled.ruleSet, request({ dataClassification: "CONFIDENTIAL" }), {
      at: T1,
      correlationId: CORR_2,
      auditSink: sink,
    });

    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(2);
    expect(records.map((x) => x.action)).toEqual([
      "policy.guardian.evaluated",
      "policy.guardian.evaluated",
    ]);
    const verification = log.verify({ tenantId: TENANT_A });
    expect(verification.ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(records.map((x) => x.sequence)).toEqual([1, 2]);
  });

  test("per-tenant chains stay separate through the adapter", () => {
    const log = createInMemoryAuditLog();
    const sink: PolicyAuditSink = createAuditSinkAdapter(log, { source: "policy.test" });
    const store = createInMemoryGuardianRuleSetStore({ auditSink: sink });
    const rA = rule(TENANT_A, { name: "a-rule", condition: uploadCondition, effect: "WARN", at: T0 });
    const rB = rule(TENANT_B, { name: "b-rule", condition: uploadCondition, effect: "WARN", at: T0 });
    const setA = compileGuardianRuleSet(TENANT_A, { rules: [rA], version: 1, at: T0 });
    const setB = compileGuardianRuleSet(TENANT_B, { rules: [rB], version: 1, at: T0 });
    if (!setA.ok || !setB.ok) throw new Error("compile failed");
    store.putRuleSet(scopeA(), setA.ruleSet);
    store.putRuleSet(scopeB(), setB.ruleSet);
    expect(log.records({ tenantId: TENANT_A }).length).toBe(1);
    expect(log.records({ tenantId: TENANT_B }).length).toBe(1);
    expect(log.verify({ tenantId: TENANT_A }).ok).toBe(true);
    expect(log.verify({ tenantId: TENANT_B }).ok).toBe(true);
  });
});
