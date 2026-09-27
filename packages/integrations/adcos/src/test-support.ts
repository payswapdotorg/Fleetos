/**
 * @fleetos/integration-adcos — deterministic test support for the
 * in-package (src) test suites. Local to the package (not exported from
 * `src/index.ts`); everything here is a pure function of its inputs: no
 * clock, no entropy, no network.
 *
 * The CROSS-LANE binding proofs (the REAL Guardian engine, the REAL
 * hash-chained audit log) live in `test/` — the ownership gate scans
 * only src/ files, so test files outside src/ may import across lanes
 * (the established W040-disclosed pattern). The src suites use the
 * LOCAL deterministic evaluator below for the gate's decision paths.
 */

import {
  asCorrelationId,
  asDeviceId,
  asTenantId,
  makeGuardianDecision,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  GuardianDecision,
  GuardianDecisionType,
  TenantId,
} from "@fleetos/contracts";
import type {
  AdcosGuardianEvaluateFn,
  AdcosGuardianOutcome,
} from "./policy-seam";
import type { ConnectivityIntentRequirements } from "./request-model";
import type { AdcosStatusReport } from "./status-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { asAdcosProviderHandle } from "./provider-boundary";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** Later injected instants for revision/adoption flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device refs (verbatim payload strings). */
export const DEV_A1 = "dev_testdevice00a1" as string;
export const DEV_A2 = "dev_testdevice00a2" as string;

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_adcos_test01");
export const CORR_2: CorrelationId = asCorrelationId("cor_adcos_test02");

/** Deterministic intent ids. */
export const INTENT_1 = "int_testintent0001" as string;
export const INTENT_2 = "int_testintent0002" as string;

// ---------------------------------------------------------------------------
// Intent envelope fixtures (the frozen shape, constructed literally)
// ---------------------------------------------------------------------------

/** A frozen ConnectivityIntent envelope with the given payload facets. */
export function connectivityIntent(payload: {
  sourceDeviceId?: string;
  targetDeviceId?: string;
  outcome: string;
  kind?: string;
  tenantId?: TenantId;
  intentId?: string;
  version?: number;
  createdAt?: string;
}): {
  intentId: string;
  tenantId: TenantId;
  version: number;
  createdAt: string;
  payload: { kind: string; sourceDeviceId?: string; targetDeviceId?: string; outcome: string };
} {
  return {
    intentId: payload.intentId ?? INTENT_1,
    tenantId: payload.tenantId ?? TENANT_A,
    version: payload.version ?? 1,
    createdAt: payload.createdAt ?? T0,
    payload: {
      kind: payload.kind ?? "ConnectivityIntent",
      ...(payload.sourceDeviceId !== undefined ? { sourceDeviceId: payload.sourceDeviceId } : {}),
      ...(payload.targetDeviceId !== undefined ? { targetDeviceId: payload.targetDeviceId } : {}),
      outcome: payload.outcome,
    },
  };
}

// ---------------------------------------------------------------------------
// Requirement-profile fixtures (typed, per canonical outcome)
// ---------------------------------------------------------------------------

/** A valid secure-private-connectivity requirement profile. */
export function securePrivateRequirements(): ConnectivityIntentRequirements {
  return {
    properties: {
      isolation: "private",
      redundancy: "path_redundant",
      availabilityTarget: 0.999,
    },
    constraints: {
      requiredZones: ["corporate"],
      forbiddenZones: ["public"],
      egressAllowed: false,
    },
    duration: { startAt: T0, endAt: T1 },
    budget: { budgetRef: "budget/test-quarterly", policyRefs: ["policy/test-connectivity"] },
    security: {
      encryption: "required",
      privateRouting: true,
      complianceRefs: ["soc2"],
    },
  };
}

/** A valid low-latency-local-group requirement profile. */
export function lowLatencyRequirements(): ConnectivityIntentRequirements {
  return {
    properties: {
      maxLatencyMs: 50,
      isolation: "any",
      redundancy: "none",
    },
    constraints: {
      requiredZones: [],
      forbiddenZones: [],
      egressAllowed: true,
    },
    duration: { startAt: T0, indefinite: true },
    security: {
      encryption: "not_required",
      privateRouting: false,
      complianceRefs: [],
    },
  };
}

/** A valid high-throughput-transfer requirement profile. */
export function highThroughputRequirements(): ConnectivityIntentRequirements {
  return {
    properties: {
      minThroughputMbps: 1000,
      isolation: "any",
      redundancy: "none",
    },
    constraints: {
      requiredZones: [],
      forbiddenZones: [],
      egressAllowed: true,
    },
    duration: { startAt: T0, endAt: T2 },
    security: {
      encryption: "not_required",
      privateRouting: false,
      complianceRefs: [],
    },
  };
}

/** A valid resilient-connectivity requirement profile. */
export function resilientRequirements(): ConnectivityIntentRequirements {
  return {
    properties: {
      isolation: "any",
      redundancy: "device_redundant",
      availabilityTarget: 0.99,
    },
    constraints: {
      requiredZones: [],
      forbiddenZones: [],
      egressAllowed: true,
    },
    duration: { startAt: T0, indefinite: true },
    security: {
      encryption: "not_required",
      privateRouting: false,
      complianceRefs: [],
    },
  };
}

// ---------------------------------------------------------------------------
// The LOCAL deterministic Guardian evaluator (src-suite decision double)
// ---------------------------------------------------------------------------

/** The local rule-set double: a fixed decision per tenant. */
export interface LocalRuleSet {
  readonly tenantId: TenantId;
  readonly decision: GuardianDecisionType;
}

/**
 * The local deterministic evaluator — satisfies the
 * `AdcosGuardianEvaluateFn<LocalRuleSet>` seam type. The REAL engine
 * binding (evaluateGuardianRequest from @fleetos/policy) is proven in
 * `test/guardian-gate.test.ts`; this double exists so the src suites
 * can exercise every decision path without a cross-lane import.
 */
export const localGuardian: AdcosGuardianEvaluateFn<LocalRuleSet> = (
  ruleSet,
  request,
  options,
): AdcosGuardianOutcome => {
  if (ruleSet.tenantId !== request.tenantId) {
    return {
      ok: false,
      error: {
        kind: "DomainError",
        code: "policy.guardian.evaluation",
        message: "tenant mismatch",
        tenantId: request.tenantId,
        correlationId: options.correlationId,
        domain: "policy.guardian.evaluation",
        invariant: "tenant_mismatch",
      },
    };
  }
  const decision: GuardianDecision = makeGuardianDecision({
    tenantId: request.tenantId,
    decision: ruleSet.decision,
    rules: [],
    evidence: [],
    decidedAt: options.at,
    schemaVersion: 1,
  });
  return {
    ok: true,
    evaluation: {
      decision,
      ruleSetId: "local-ruleset",
      ruleSetVersion: 1,
      matchedRules:
        ruleSet.decision === "ALLOW"
          ? []
          : [{ ruleId: "pol_local_rule0001", version: 1 }],
      reasons:
        ruleSet.decision === "ALLOW"
          ? [{ code: "policy.no_rule_matched" }]
          : [
              {
                code: "policy.rule.matched",
                ruleId: "pol_local_rule0001",
                ruleVersion: 1,
                effect: ruleSet.decision,
                chosen: ruleSet.decision,
              },
            ],
    },
  };
};

/** Convenience: a rule set deciding the given type for tenant A. */
export function ruleset(decision: GuardianDecisionType, tenantId: TenantId = TENANT_A): LocalRuleSet {
  return { tenantId, decision };
}

// ---------------------------------------------------------------------------
// Provider-side status report fixtures
// ---------------------------------------------------------------------------

/** A fixed, valid evidence ref (deterministic values). */
export function evidenceRef(key = "evidence/adcos-test-1"): {
  key: string;
  sizeBytes: number;
  hash: string;
  hashAlgorithm: string;
} {
  return { key, sizeBytes: 128, hash: "0123456789abcdef0123456789abcdef", hashAlgorithm: "sha256" };
}

/** A canonical degraded-ACTIVE status report for the given connectivity. */
export function degradedActiveReport(
  connectivityId: string,
  handle: AdcosProviderHandle,
  reportedAt: string,
): AdcosStatusReport {
  return {
    connectivityId,
    handle,
    executionState: "ACTIVE",
    acceptedRequirements: {
      outcome: "secure_private_connectivity",
      properties: {
        isolation: "private",
        redundancy: "path_redundant",
        availabilityTarget: 0.999,
      },
      constraints: {
        requiredZones: ["corporate"],
        forbiddenZones: ["public"],
        egressAllowed: false,
      },
      duration: { startAt: T0, endAt: T1 },
      security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
    },
    measurements: [
      {
        kind: "latency_ms",
        value: 180,
        measuredAt: reportedAt,
        evidence: evidenceRef("evidence/adcos-latency-1"),
      },
    ],
    degradation: { kind: "latency_degraded", detail: "p99 above bound" },
    failure: { kind: "none" },
    termination: null,
    reportedAt,
  };
}

/** The device id branded helper (used by contract-conformance suites). */
export const asDevice = asDeviceId;

/** Narrow a FleetError to its DomainError arm or throw (test assertions stay terse). */
export function domainErrorOf(error: import("@fleetos/contracts").FleetError): import("@fleetos/contracts").DomainError {
  if (error.kind !== "DomainError") {
    throw new Error(`expected DomainError, got ${error.kind}`);
  }
  return error;
}
