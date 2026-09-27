/**
 * W031 D3 tests — the Guardian evaluation engine: condition matching per
 * facet, blocking precedence (exhaustive pairwise), machine-stable
 * reasons, evidence links, purity, and the decision-shape conformance.
 */

import { describe, expect, test } from "bun:test";
import { makeGuardianDecision } from "@fleetos/contracts";
import type { EvidenceRef, GuardianDecisionType } from "@fleetos/contracts";
import {
  DECISION_PRECEDENCE_ORDER,
  DECISION_PRECEDENCE_RANK,
  GUARDIAN_REASON_CODES,
  compileGuardianRuleSet,
  evaluateGuardianRequest,
  resolvePrecedence,
} from "../src/index";
import type { GuardianRule } from "../src/index";
import {
  CORR,
  DEV_1,
  TENANT_A,
  TENANT_B,
  T0,
  USER_1,
  WL_1,
  evidenceRef,
  request,
  rule,
} from "./helpers";

function ruleSetOf(rules: readonly GuardianRule[], version = 1) {
  const compiled = compileGuardianRuleSet(TENANT_A, { rules, version, at: T0 });
  if (!compiled.ok) throw new Error(`test rule set invalid: ${compiled.error.message}`);
  return compiled.ruleSet;
}

function evaluate(rules: readonly GuardianRule[], req = request(), at: string = T0) {
  const result = evaluateGuardianRequest(ruleSetOf(rules), req, { at, correlationId: CORR });
  if (!result.ok) throw new Error(`test evaluation failed: ${result.error.message}`);
  return result.evaluation;
}

describe("D3: blocking precedence (BLOCK > REQUIRE_APPROVAL > WARN > ALLOW)", () => {
  // Exhaustive pairwise: for every (stronger, weaker) pair of decision
  // types, two firing rules (one per effect) must resolve to the
  // stronger one. 4 decision types -> 6 ordered pairs.
  const effects: readonly GuardianDecisionType[] = DECISION_PRECEDENCE_ORDER;

  test("the precedence table matches the work order's total order", () => {
    expect(DECISION_PRECEDENCE_RANK.BLOCK).toBe(3);
    expect(DECISION_PRECEDENCE_RANK.REQUIRE_APPROVAL).toBe(2);
    expect(DECISION_PRECEDENCE_RANK.WARN).toBe(1);
    expect(DECISION_PRECEDENCE_RANK.ALLOW).toBe(0);
    expect(DECISION_PRECEDENCE_ORDER).toEqual(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]);
  });

  for (const stronger of effects) {
    for (const weaker of effects) {
      if (DECISION_PRECEDENCE_RANK[stronger] <= DECISION_PRECEDENCE_RANK[weaker]) continue;
      test(`pairwise: ${stronger} beats ${weaker} (both rules fire)`, () => {
        const strong = rule(TENANT_A, {
          name: "strong-rule",
          condition: { kind: "action", actions: { in: ["file.upload"] } },
          effect: stronger,
          at: T0,
        });
        const weak = rule(TENANT_A, {
          name: "weak-rule",
          condition: { kind: "action", actions: { in: ["file.upload"] } },
          effect: weaker,
          at: T0,
        });
        const evaluation = evaluate([weak, strong]); // input order must not matter
        expect(evaluation.decision.decision).toBe(stronger);
        // BOTH fired rules are recorded (audit completeness).
        expect(evaluation.decision.rules).toHaveLength(2);
        // The precedence resolution is a machine-stable reason.
        expect(
          evaluation.reasons.some(
            (r) => r.code === GUARDIAN_REASON_CODES.precedenceResolved && r.chosen === stronger,
          ),
        ).toBe(true);
      });
    }
  }

  test("all four firing together resolve to BLOCK deterministically", () => {
    const rules = DECISION_PRECEDENCE_ORDER.map((effect, i) =>
      rule(TENANT_A, {
        name: `rule-${i}`,
        condition: { kind: "action", actions: { in: ["file.upload"] } },
        effect,
        at: T0,
      }),
    );
    for (const permutation of [rules, [...rules].reverse(), [rules[2]!, rules[0]!, rules[3]!, rules[1]!]]) {
      const evaluation = evaluate(permutation);
      expect(evaluation.decision.decision).toBe("BLOCK");
      expect(evaluation.decision.rules).toHaveLength(4);
    }
  });

  test("resolvePrecedence is a pure max-rank function", () => {
    expect(resolvePrecedence(["WARN", "ALLOW"])).toBe("WARN");
    expect(resolvePrecedence(["ALLOW", "WARN", "ALLOW"])).toBe("WARN");
    expect(resolvePrecedence(["REQUIRE_APPROVAL", "WARN"])).toBe("REQUIRE_APPROVAL");
    expect(resolvePrecedence(["BLOCK", "REQUIRE_APPROVAL"])).toBe("BLOCK");
  });
});

describe("D3: no rule fires -> ALLOW by default", () => {
  test("an empty rule set allows with an empty rules list", () => {
    const evaluation = evaluate([]);
    expect(evaluation.decision.decision).toBe("ALLOW");
    expect(evaluation.decision.rules).toHaveLength(0);
    expect(evaluation.reasons).toHaveLength(1);
    expect(evaluation.reasons[0]?.code).toBe(GUARDIAN_REASON_CODES.noRuleMatched);
  });

  test("a non-matching rule set allows", () => {
    const r = rule(TENANT_A, {
      name: "no-match",
      condition: { kind: "action", actions: { in: ["device.wipe"] } },
      effect: "BLOCK",
      at: T0,
    });
    const evaluation = evaluate([r]);
    expect(evaluation.decision.decision).toBe("ALLOW");
    expect(evaluation.decision.rules).toHaveLength(0);
  });

  test("disabled rules never fire", () => {
    const r = rule(TENANT_A, {
      name: "disabled",
      condition: { kind: "action", actions: { in: ["file.upload"] } },
      effect: "BLOCK",
      enabled: false,
      at: T0,
    });
    const evaluation = evaluate([r]);
    expect(evaluation.decision.decision).toBe("ALLOW");
  });
});

describe("D3: condition matching per facet (observable facts only)", () => {
  test("principal: role/department/service matching; absent facet never matches", () => {
    const svcOnly = rule(TENANT_A, {
      name: "svc-only",
      condition: { kind: "principal", servicePrincipals: true },
      effect: "BLOCK",
      at: T0,
    });
    expect(evaluate([svcOnly]).decision.decision).toBe("ALLOW"); // no principal facet
    expect(
      evaluate([svcOnly], request({ principal: { userId: USER_1, role: "employee" } })).decision.decision,
    ).toBe("ALLOW"); // human principal
    expect(
      evaluate([svcOnly], request({ principal: { isServicePrincipal: true } })).decision.decision,
    ).toBe("BLOCK");

    const managerOnly = rule(TENANT_A, {
      name: "manager-only",
      condition: { kind: "principal", roles: { in: ["manager"] } },
      effect: "WARN",
      at: T0,
    });
    expect(
      evaluate([managerOnly], request({ principal: { role: "employee" } })).decision.decision,
    ).toBe("ALLOW");
    expect(
      evaluate([managerOnly], request({ principal: { role: "manager" } })).decision.decision,
    ).toBe("WARN");
  });

  test("device: ids, platforms, ownership, and posture severity", () => {
    const postureGate = rule(TENANT_A, {
      name: "posture-gate",
      condition: { kind: "device", minPostureStatus: "AT_RISK" },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    // No posture summary -> no match.
    expect(evaluate([postureGate]).decision.decision).toBe("ALLOW");
    // HEALTHY posture -> below the gate.
    expect(
      evaluate([postureGate], request({ device: { deviceId: DEV_1, posture: { status: "HEALTHY", criticalFindings: 0, highFindings: 0, mediumFindings: 0, lowFindings: 2, assessedAt: T0 } } })).decision.decision,
    ).toBe("ALLOW");
    // CRITICAL posture -> at/above the gate.
    expect(
      evaluate([postureGate], request({ device: { deviceId: DEV_1, posture: { status: "CRITICAL", criticalFindings: 1, highFindings: 0, mediumFindings: 0, lowFindings: 0, assessedAt: T0 } } })).decision.decision,
    ).toBe("REQUIRE_APPROVAL");

    const byod = rule(TENANT_A, {
      name: "byod-restrict",
      condition: { kind: "device", ownerships: { in: ["byod"] } },
      effect: "BLOCK",
      at: T0,
    });
    expect(evaluate([byod]).decision.decision).toBe("ALLOW"); // corporate (default fixture)
    expect(
      evaluate([byod], request({ device: { deviceId: DEV_1, ownership: "byod" } })).decision.decision,
    ).toBe("BLOCK");
  });

  test("workload: id and classification matching", () => {
    const confidential = rule(TENANT_A, {
      name: "confidential-workload",
      condition: { kind: "workload", classifications: { in: ["CONFIDENTIAL", "RESTRICTED"] } },
      effect: "WARN",
      at: T0,
    });
    expect(evaluate([confidential]).decision.decision).toBe("ALLOW"); // no workload facet
    expect(
      evaluate([confidential], request({ workload: { workloadId: WL_1, classification: "PUBLIC" } })).decision.decision,
    ).toBe("ALLOW");
    expect(
      evaluate([confidential], request({ workload: { workloadId: WL_1, classification: "CONFIDENTIAL" } })).decision.decision,
    ).toBe("WARN");
  });

  test("dataClassification: UNCLASSIFIED sentinel + fail-closed notIn", () => {
    const sensitive = rule(TENANT_A, {
      name: "sensitive-data",
      condition: { kind: "dataClassification", classification: { notIn: ["PUBLIC", "UNCLASSIFIED"] } },
      effect: "BLOCK",
      at: T0,
    });
    // Absent facet = UNCLASSIFIED -> no match.
    expect(evaluate([sensitive]).decision.decision).toBe("ALLOW");
    expect(
      evaluate([sensitive], request({ dataClassification: "PUBLIC" })).decision.decision,
    ).toBe("ALLOW");
    expect(
      evaluate([sensitive], request({ dataClassification: "CONFIDENTIAL" })).decision.decision,
    ).toBe("BLOCK");
  });

  test("contract: missing obligations fire fail-closed (absent facet included)", () => {
    const requiresOb = rule(TENANT_A, {
      name: "requires-obligation",
      condition: { kind: "contract", missingAnyObligations: ["ob.data-handling"] },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    // No contract facet -> obligation missing -> fires.
    expect(evaluate([requiresOb]).decision.decision).toBe("REQUIRE_APPROVAL");
    // Obligation in force -> no fire.
    expect(
      evaluate([requiresOb], request({ contract: { obligations: ["ob.data-handling"] } })).decision.decision,
    ).toBe("ALLOW");
    // Other obligations only -> still missing -> fires.
    expect(
      evaluate([requiresOb], request({ contract: { obligations: ["ob.other"] } })).decision.decision,
    ).toBe("REQUIRE_APPROVAL");

    const forbids = rule(TENANT_A, {
      name: "forbids-obligation",
      condition: { kind: "contract", presentAnyObligations: ["ob.export-ban"] },
      effect: "BLOCK",
      at: T0,
    });
    expect(
      evaluate([forbids], request({ contract: { obligations: ["ob.export-ban"] } })).decision.decision,
    ).toBe("BLOCK");
  });

  test("destination: categories and hosts", () => {
    const externalAi = rule(TENANT_A, {
      name: "external-ai",
      condition: { kind: "destination", categories: { in: ["external-ai"] } },
      effect: "BLOCK",
      at: T0,
    });
    expect(
      evaluate([externalAi], request({ destination: { category: "internal" } })).decision.decision,
    ).toBe("ALLOW");
    expect(
      evaluate([externalAi], request({ destination: { category: "external-ai", host: "ai.vendor.example" } })).decision.decision,
    ).toBe("BLOCK");
  });

  test("network: notIn is fail-closed for unknown zones", () => {
    const corpOnly = rule(TENANT_A, {
      name: "corp-only",
      condition: { kind: "network", zones: { notIn: ["corporate", "vpn"] } },
      effect: "BLOCK",
      at: T0,
    });
    expect(
      evaluate([corpOnly], request({ network: { zone: "corporate" } })).decision.decision,
    ).toBe("ALLOW");
    // Absent zone (unknown) satisfies notIn -> fires (fail-closed).
    expect(evaluate([corpOnly]).decision.decision).toBe("BLOCK");
    expect(
      evaluate([corpOnly], request({ network: { zone: "public" } })).decision.decision,
    ).toBe("BLOCK");
  });

  test("printer: unapprovedOnly fires unless approved === true", () => {
    const approvedOnly = rule(TENANT_A, {
      name: "approved-printers",
      condition: { kind: "printer", unapprovedOnly: true },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    // Absent printer facet -> not approved -> fires (fail-closed).
    expect(evaluate([approvedOnly]).decision.decision).toBe("REQUIRE_APPROVAL");
    expect(
      evaluate([approvedOnly], request({ printer: { printerId: "prn_1", approved: false } })).decision.decision,
    ).toBe("REQUIRE_APPROVAL");
    expect(
      evaluate([approvedOnly], request({ printer: { printerId: "prn_1", approved: true } })).decision.decision,
    ).toBe("ALLOW");
  });

  test("time: within/outside UTC hour windows and weekdays (effective instant)", () => {
    const businessHours = rule(TENANT_A, {
      name: "business-hours-only",
      condition: { kind: "time", outsideHoursUtc: { from: 9, to: 17 } },
      effect: "WARN",
      at: T0,
    });
    // T0 is 2026-01-01T00:00:00Z -> hour 0 -> outside [9,17] -> fires.
    expect(evaluate([businessHours]).decision.decision).toBe("WARN");
    // 12:00Z is inside the window -> does not fire.
    expect(evaluate([businessHours], request(), "2026-01-01T12:00:00Z").decision.decision).toBe("ALLOW");
    // The request's own time facet wins over the decision instant.
    expect(
      evaluate([businessHours], request({ time: { at: "2026-01-01T12:00:00Z" } }), "2026-01-01T00:00:00Z")
        .decision.decision,
    ).toBe("ALLOW");

    const weekdays = rule(TENANT_A, {
      name: "weekdays-only",
      condition: { kind: "time", weekdaysUtc: [1, 2, 3, 4, 5] },
      effect: "WARN",
      at: T0,
    });
    // 2026-01-01 is a Thursday (day 4) -> fires.
    expect(evaluate([weekdays]).decision.decision).toBe("WARN");
    // 2026-01-04 is a Sunday (day 0) -> does not fire.
    expect(evaluate([weekdays], request(), "2026-01-04T12:00:00Z").decision.decision).toBe("ALLOW");
  });

  test("geography: country codes with fail-closed notIn", () => {
    const allowedCountries = rule(TENANT_A, {
      name: "geo-allowlist",
      condition: { kind: "geography", countryCodes: { notIn: ["US", "CA", "DE"] } },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    expect(
      evaluate([allowedCountries], request({ geography: { countryCode: "US" } })).decision.decision,
    ).toBe("ALLOW");
    expect(
      evaluate([allowedCountries], request({ geography: { countryCode: "CN" } })).decision.decision,
    ).toBe("REQUIRE_APPROVAL");
    // Unknown location satisfies notIn -> fires (fail-closed).
    expect(evaluate([allowedCountries]).decision.decision).toBe("REQUIRE_APPROVAL");
  });

  test("action: kind and target matching", () => {
    const wipe = rule(TENANT_A, {
      name: "wipe-gate",
      condition: { kind: "action", actions: { in: ["device.wipe"] } },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    expect(evaluate([wipe]).decision.decision).toBe("ALLOW"); // fixture action is file.upload
    expect(
      evaluate([wipe], request({ action: { action: "device.wipe", targetKind: "device" } })).decision
        .decision,
    ).toBe("REQUIRE_APPROVAL");
  });

  test("allOf: conjunction of facets (the spec's 'confidential upload to unapproved external AI' example)", () => {
    const blockConfidentialExternalAi = rule(TENANT_A, {
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
    });
    // Confidential + external-ai + upload -> BLOCK.
    expect(
      evaluate(
        [blockConfidentialExternalAi],
        request({ dataClassification: "CONFIDENTIAL", destination: { category: "external-ai" } }),
      ).decision.decision,
    ).toBe("BLOCK");
    // Public + external-ai -> allowed.
    expect(
      evaluate(
        [blockConfidentialExternalAi],
        request({ dataClassification: "PUBLIC", destination: { category: "external-ai" } }),
      ).decision.decision,
    ).toBe("ALLOW");
    // Confidential + internal destination -> allowed.
    expect(
      evaluate(
        [blockConfidentialExternalAi],
        request({ dataClassification: "CONFIDENTIAL", destination: { category: "internal" } }),
      ).decision.decision,
    ).toBe("ALLOW");
  });
});

describe("D3: the frozen decision shape + evidence links", () => {
  test("the engine's decision deep-equals a fixture built by the frozen constructor", () => {
    const r = rule(TENANT_A, {
      name: "evidence-rule",
      condition: { kind: "action", actions: { in: ["file.upload"] } },
      effect: "WARN",
      at: T0,
    });
    const evidence: readonly EvidenceRef[] = [evidenceRef()];
    const evaluation = evaluate([r], request({ evidence }));
    const expected = makeGuardianDecision({
      tenantId: TENANT_A,
      decision: "WARN",
      rules: [{ ruleId: r.ruleId, ruleVersion: 1 }],
      evidence,
      decidedAt: T0,
      schemaVersion: 1,
    });
    expect(JSON.stringify(evaluation.decision)).toBe(JSON.stringify(expected));
  });

  test("the decision carries exactly the frozen shape's keys (no extra fields)", () => {
    const evaluation = evaluate([]);
    const keys = Object.keys(evaluation.decision).sort();
    expect(keys).toEqual(["decidedAt", "decision", "evidence", "rules", "schemaVersion", "tenantId"]);
  });

  test("evidence artifacts pass through untouched (never interpreted)", () => {
    const evidence: readonly EvidenceRef[] = [evidenceRef("a"), evidenceRef("b")];
    const evaluation = evaluate([], request({ evidence }));
    expect(evaluation.decision.evidence).toHaveLength(2);
    expect(evaluation.decision.evidence[0]?.key).toBe("a");
    expect(evaluation.decision.evidence[1]?.key).toBe("b");
  });

  test("reasons carry rule ids, versions, condition kinds, and effects", () => {
    const r = rule(TENANT_A, {
      name: "reason-carrier",
      condition: { kind: "network", zones: { notIn: ["corporate"] } },
      effect: "WARN",
      at: T0,
    });
    const evaluation = evaluate([r], request({ network: { zone: "public" } }));
    const matchedReason = evaluation.reasons.find((x) => x.code === GUARDIAN_REASON_CODES.ruleMatched);
    expect(matchedReason?.ruleId).toBe(r.ruleId);
    expect(matchedReason?.ruleVersion).toBe(1);
    expect(matchedReason?.conditionKind).toBe("network");
    expect(matchedReason?.effect).toBe("WARN");
  });
});

describe("D3: validation + tenant isolation by rejection", () => {
  test("a cross-tenant request can never evaluate against the rule set", () => {
    const r = rule(TENANT_A, {
      name: "a-rule",
      condition: { kind: "action", actions: { in: ["file.upload"] } },
      effect: "BLOCK",
      at: T0,
    });
    const result = evaluateGuardianRequest(ruleSetOf([r]), request({ tenantId: TENANT_B }), {
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("policy.guardian.tenant_mismatch");
      expect(result.error.kind).toBe("DomainError");
    }
  });

  test("invalid requests are rejected with tagged validation errors", () => {
    const result = evaluateGuardianRequest(
      ruleSetOf([]),
      request({ action: { action: "" } }),
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ValidationError");
    }
    const badAt = evaluateGuardianRequest(ruleSetOf([]), request(), { at: "now", correlationId: CORR });
    expect(badAt.ok).toBe(false);
    const badCorr = evaluateGuardianRequest(ruleSetOf([]), request(), {
      at: T0,
      correlationId: "" as never,
    });
    expect(badCorr.ok).toBe(false);
  });
});

describe("D3: purity (byte-identical repeated evaluation)", () => {
  test("the same inputs produce byte-identical evaluations", () => {
    const r = rule(TENANT_A, {
      name: "pure-rule",
      condition: { kind: "allOf", conditions: [{ kind: "action", actions: { in: ["file.upload"] } }, { kind: "network", zones: { notIn: ["corporate"] } }] },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    const req = request({ network: { zone: "public" }, evidence: [evidenceRef()] });
    const first = evaluate([r], req);
    const second = evaluate([r], req);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
