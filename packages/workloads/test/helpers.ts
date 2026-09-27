/**
 * W022 test helpers — deterministic builders for workloads-package tests.
 *
 * Local to the test suite (not exported from src/). Everything here is a
 * pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asTenantId, asWorkloadId } from "@fleetos/contracts";
import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type { CandidateCapabilities } from "../src/constraints";
import type { CreateWorkloadProfileInput, WorkloadProfile } from "../src/profile";
import { buildWorkloadProfile } from "../src/profile";
import type { RequirementVector } from "../src/requirement-vector";
import { normalizeRequirements } from "../src/requirement-vector";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** A later injected timestamp for revision/dismissal flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic workload ids for tests. */
export const WL_1: WorkloadId = asWorkloadId("wl_testworkload01");
export const WL_2: WorkloadId = asWorkloadId("wl_testworkload02");

/** Deterministic correlation ids for tests. */
export const CORR: CorrelationId = asCorrelationId("cor_workloads_test");
export const CORR_2: CorrelationId = asCorrelationId("cor_workloads_tst2");

/** Deterministic contexts. */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

/**
 * Build a requirement vector from raw factors (thin test wrapper over
 * the pure normalizer — throws on invalid input so test setup stays
 * terse; invalid-input cases are tested explicitly).
 */
export function vector(raw: Parameters<typeof normalizeRequirements>[0]): RequirementVector {
  const result = normalizeRequirements(raw);
  if (!result.ok) throw new Error(`test vector invalid: ${JSON.stringify(result.failures)}`);
  return result.vector;
}

/** The canonical "balanced knowledge worker" vector used across tests. */
export function balancedVector(): RequirementVector {
  return vector({
    cpuUtilization: 0.4,
    minMemoryGb: 16,
    minStorageGb: 256,
    networkMbps: 100,
    unpluggedMinutes: 480,
    offsiteFraction: 0.4,
    peripheralCount: 3,
    classification: "internal",
    downtimeCostPerHourUsd: 500,
  });
}

/** The canonical "mobile field engineer" vector used across tests. */
export function fieldVector(): RequirementVector {
  return vector({
    cpuUtilization: 0.6,
    minMemoryGb: 32,
    networkMbps: 500,
    unpluggedMinutes: 480,
    offsiteFraction: 0.9,
    peripheralCount: 5,
    classification: "confidential",
    downtimeCostPerHourUsd: 2000,
  });
}

/** A minimal create input (deterministic; workloadId explicit). */
export function createInput(overrides: Partial<CreateWorkloadProfileInput> = {}): CreateWorkloadProfileInput {
  return {
    workloadId: WL_1,
    subjectKind: "role",
    name: "finance.analyst",
    description: "Financial analyst workload: spreadsheets, BI dashboards, video calls.",
    requirements: balancedVector(),
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** Build a profile directly (pure builder; throws on invalid input). */
export function profile(overrides: Partial<CreateWorkloadProfileInput> = {}): WorkloadProfile {
  const input = createInput(overrides);
  const built = buildWorkloadProfile(TENANT_A, input);
  if (!built.ok) throw new Error(`test profile invalid: ${built.error.message}`);
  return built.profile;
}

/** Build a candidate with a fully-specified capability vector. */
export function candidate(overrides: Partial<CandidateCapabilities> = {}): CandidateCapabilities {
  return {
    candidateId: "class.standard_laptop",
    label: "Standard laptop",
    vector: vector({
      cpuUtilization: 0.6,
      gpuUtilization: 0.2,
      minMemoryGb: 32,
      minStorageGb: 512,
      networkMbps: 1000,
      unpluggedMinutes: 480,
      offsiteFraction: 0.4,
      peripheralCount: 5,
      classification: "confidential",
      downtimeCostPerHourUsd: 1000,
    }),
    maxSecurityClassification: "confidential",
    environments: ["office", "home", "travel", "field"],
    peripherals: ["printer", "scanner", "external_display", "dock", "headset", "webcam"],
    availableApplications: [
      { appId: "app.office_suite", version: "2026.1" },
      { appId: "app.bi_dashboard", version: "5.2", subscriptionRequired: true },
    ],
    ...overrides,
  };
}
