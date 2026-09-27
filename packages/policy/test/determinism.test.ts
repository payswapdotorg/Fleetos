/**
 * W031 D5 tests — byte-identical determinism across runs and input
 * permutations: the full pipeline (rule definitions -> rule-set
 * compilation -> evaluation) is a pure function of its inputs, and
 * input permutations (rule order, repeated runs, audit on/off) never
 * change a byte of the domain output.
 */

import { describe, expect, test } from "bun:test";
import {
  compileGuardianRuleSet,
  createInMemoryPolicyAuditSink,
  evaluateGuardianRequest,
} from "../src/index";
import type { GuardianRule } from "../src/index";
import { CORR, DEV_1, TENANT_A, T0, evidenceRef, request, rule } from "./helpers";
import { asDeviceId } from "@fleetos/contracts";

/** The canonical W031 demo rule set: the spec's five Guardian examples. */
function specRules(): GuardianRule[] {
  return [
    rule(TENANT_A, {
      name: "block-confidential-external-ai",
      condition: {
        kind: "allOf",
        conditions: [
          { kind: "dataClassification", classification: { notIn: ["PUBLIC", "INTERNAL", "UNCLASSIFIED"] } },
          { kind: "destination", categories: { in: ["external-ai"] } },
          { kind: "action", actions: { in: ["file.upload", "data.export"] } },
        ],
      },
      effect: "BLOCK",
      at: T0,
    }),
    rule(TENANT_A, {
      name: "approved-printers-only",
      condition: { kind: "printer", unapprovedOnly: true },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    }),
    rule(TENANT_A, {
      name: "restrict-removable-media",
      condition: { kind: "destination", categories: { in: ["removable-media"] } },
      effect: "BLOCK",
      at: T0,
    }),
    rule(TENANT_A, {
      name: "corporate-network-for-sensitive-data",
      condition: {
        kind: "allOf",
        conditions: [
          { kind: "dataClassification", classification: { notIn: ["PUBLIC", "UNCLASSIFIED"] } },
          { kind: "network", zones: { notIn: ["corporate", "vpn"] } },
        ],
      },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    }),
    rule(TENANT_A, {
      name: "manager-approved-exception",
      condition: { kind: "principal", roles: { in: ["manager"] } },
      effect: "ALLOW",
      at: T0,
    }),
  ];
}

describe("D5: byte-identical determinism across runs", () => {
  test("the full pipeline is byte-identical on repeated runs", () => {
    const req = request({
      dataClassification: "CONFIDENTIAL",
      destination: { category: "external-ai" },
      network: { zone: "public" },
      evidence: [evidenceRef("evidence/w031-1"), evidenceRef("evidence/w031-2")],
    });
    const runOnce = (): string => {
      const rules = specRules();
      const compiled = compileGuardianRuleSet(TENANT_A, { rules, version: 4, at: T0 });
      if (!compiled.ok) throw new Error(compiled.error.message);
      const result = evaluateGuardianRequest(compiled.ruleSet, req, { at: T0, correlationId: CORR });
      if (!result.ok) throw new Error(result.error.message);
      return JSON.stringify(result.evaluation);
    };
    expect(runOnce()).toBe(runOnce());
    expect(runOnce()).toBe(runOnce());
  });

  test("rule input permutations produce byte-identical rule sets and evaluations", () => {
    const req = request({ dataClassification: "RESTRICTED", network: { zone: "public" } });
    const permutations: GuardianRule[][] = [
      specRules(),
      [...specRules()].reverse(),
      [specRules()[3]!, specRules()[0]!, specRules()[4]!, specRules()[2]!, specRules()[1]!],
    ];
    const serialized: string[] = [];
    for (const rules of permutations) {
      const compiled = compileGuardianRuleSet(TENANT_A, { rules, version: 1, at: T0 });
      if (!compiled.ok) throw new Error(compiled.error.message);
      const result = evaluateGuardianRequest(compiled.ruleSet, req, { at: T0, correlationId: CORR });
      if (!result.ok) throw new Error(result.error.message);
      serialized.push(JSON.stringify({ ruleSet: compiled.ruleSet, evaluation: result.evaluation }));
    }
    expect(serialized[0]).toBe(serialized[1]);
    expect(serialized[0]).toBe(serialized[2]);
  });

  test("audit injection never changes the domain output", () => {
    const req = request({ dataClassification: "CONFIDENTIAL", destination: { category: "external-ai" } });
    const rules = specRules();
    const compiled = compileGuardianRuleSet(TENANT_A, { rules, version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const sink = createInMemoryPolicyAuditSink();
    const withoutAudit = evaluateGuardianRequest(compiled.ruleSet, req, { at: T0, correlationId: CORR });
    const withAudit = evaluateGuardianRequest(compiled.ruleSet, req, {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(withoutAudit.ok && withAudit.ok).toBe(true);
    if (!withoutAudit.ok || !withAudit.ok) return;
    expect(JSON.stringify(withoutAudit.evaluation)).toBe(JSON.stringify(withAudit.evaluation));
    expect(sink.records.length).toBe(1); // the BLOCK decision audited.
  });

  test("evaluation is referentially transparent across many devices", () => {
    const rules = specRules();
    const compiled = compileGuardianRuleSet(TENANT_A, { rules, version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const outputs: string[] = [];
    for (const deviceId of [DEV_1, asDeviceId("dev_testdevice0002"), asDeviceId("dev_testdevice0003")]) {
      const result = evaluateGuardianRequest(
        compiled.ruleSet,
        request({ device: { deviceId } }),
        { at: T0, correlationId: CORR },
      );
      if (!result.ok) throw new Error(result.error.message);
      outputs.push(JSON.stringify(result.evaluation));
    }
    expect(outputs[0]).toBe(outputs[1]);
    expect(outputs[1]).toBe(outputs[2]);
  });
});
