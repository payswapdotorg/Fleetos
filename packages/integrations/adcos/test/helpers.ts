/**
 * W050A ADCOS test helpers — the CROSS-LANE binding site.
 *
 * Local to the test suite (outside src/ — the ownership gate scans only
 * src/ files, so test files may import across lanes; the established
 * W040-disclosed pattern). Everything here binds the cross-lane module
 * edges to the REAL sibling packages, proving structural compatibility:
 *   - @fleetos/policy      — the REAL Guardian engine
 *                            (evaluateGuardianRequest) + real rule-set
 *                            compilation;
 *   - @fleetos/audit       — the REAL hash-chained AuditLog + sink
 *                            adapter;
 *   - @fleetos/identity    — the REAL TenantContext (makeTenantContext);
 *   - @fleetos/contracts/testing — the frozen fixture builders.
 */

import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import type { CorrelationId, TenantId } from "@fleetos/contracts";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type {
  DefineGuardianRuleInput,
  GuardianRule,
  GuardianRuleSet,
} from "@fleetos/policy";
import type { AdcosGuardianEvaluateFn } from "../src/policy-seam";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_adcos_test01");
export const CORR_2: CorrelationId = asCorrelationId("cor_adcos_test02");

/** A deterministic device ref (verbatim payload string). */
export const DEV_A1 = "dev_testdevice00a1" as string;

// ---------------------------------------------------------------------------
// The REAL Guardian engine + rule sets (the policy module edge)
// ---------------------------------------------------------------------------

/** Define a Guardian rule or throw (test setup stays terse). */
export function rule(tenantId: TenantId, input: DefineGuardianRuleInput): GuardianRule {
  const built = defineGuardianRule(tenantId, input);
  if (!built.ok) throw new Error(`test rule invalid: ${built.error.message}`);
  return built.rule;
}

/** Compile a rule set or throw. */
export function ruleSet(tenantId: TenantId, rules: readonly GuardianRule[], version = 1): GuardianRuleSet {
  const compiled = compileGuardianRuleSet(tenantId, { rules, version, at: T0 });
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.ruleSet;
}

/**
 * The REAL W031 Guardian evaluation function — injected at the binding
 * site wherever the ADCOS package's `AdcosGuardianEvaluateFn` seam is
 * expected (TypeScript structural typing accepts it; the tests prove the
 * routing runs through the real engine).
 */
export const realGuardian: AdcosGuardianEvaluateFn<GuardianRuleSet> = evaluateGuardianRequest;

/** A rule that fires WARN for the ADCOS submission action. */
export function warnRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `warn-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "WARN",
    at: T0,
  });
}

/** A rule that fires REQUIRE_APPROVAL for the ADCOS submission action. */
export function approvalRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `approval-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
}

/** A rule that fires BLOCK for the ADCOS submission action. */
export function blockRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `block-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "BLOCK",
    at: T0,
  });
}

/** A rule that fires REQUIRE_APPROVAL for corporate-zone network requests. */
export function privateZoneApprovalRule(tenantId: TenantId): GuardianRule {
  return rule(tenantId, {
    name: "approval-corporate-zone",
    condition: { kind: "network", zones: { in: ["corporate"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
}
