/**
 * W060B web-actions test helpers — deterministic builders for the
 * surface-lane tests. Local to the test suite (never exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy. Cross-lane imports are test-scope ONLY (per the W060
 * work order: "test/ may import across lanes").
 */

import {
  makeCorrelationId,
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  PolicyId,
  TenantId,
} from "@fleetos/contracts";
import { asDeviceId, asUserId } from "@fleetos/contracts";
import type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
  SurfaceDeviceGroupSelector,
  SurfacePlanStatus,
  SurfacePrintJobRecord,
  SurfacePrinterCapabilities,
  SurfacePrinterRecord,
  SurfaceTenantScope,
} from "../src/surface-contracts";

/** A fixed, well-known anchor for all surface test timestamps. */
export const T0 = "2026-01-01T00:00:00Z";
/** Later injected instants (transition flows). */
export const T1 = "2026-02-01T00:00:00Z";
export const T2 = "2026-03-01T00:00:00Z";

/** Deterministic tenant ids (canonical grammar). */
export const TENANT_A: TenantId = makeTenantId("w060b-act-a");
export const TENANT_B: TenantId = makeTenantId("w060b-act-b");

/** Deterministic device ids (explicit, lexicographically sorted: a1 < a2 < a3). */
export const DEV_A1: DeviceId = asDeviceId("dev_w060b_a1");
export const DEV_A2: DeviceId = asDeviceId("dev_w060b_a2");
export const DEV_A3: DeviceId = asDeviceId("dev_w060b_a3");

/** Deterministic principal id. */
export const USER_1 = asUserId("usr_w060bact01");

/** The acting tenant-A scope. */
export function scopeA(): SurfaceTenantScope {
  return { tenantId: TENANT_A };
}

/** A fixed, valid evidence ref (deterministic values, opaque). */
export function evidenceRef(key = "evidence/w060b-act-1"): EvidenceRef {
  return {
    key,
    sizeBytes: 128,
    hash: "0123456789abcdef0123456789abcdef",
    hashAlgorithm: "sha256",
  };
}

/** A deterministic rule ref. */
export function ruleRef(seed: string, version = 1): { ruleId: PolicyId; ruleVersion: number } {
  return { ruleId: makePolicyId(`w060b-${seed}`), ruleVersion: version };
}

/** A deterministic timestamp distinct per seed (ISO 8601). */
export function at(seed: string): string {
  return makeTimestamp(`w060b-at-${seed}`);
}

/** The canonical print-flow correlation id for tests. */
export const PRINT_CORR: CorrelationId = makeCorrelationId("w060b-print-1");

/** Build a deterministic, valid-by-construction plan record. */
export function plan(overrides: Partial<SurfaceActionPlanRecord> = {}): SurfaceActionPlanRecord {
  const version = overrides.version ?? 1;
  const status = overrides.status ?? "PROPOSAL";
  const selectedTargets = overrides.selectedTargets ?? [DEV_A1, DEV_A2];
  return {
    planId: overrides.planId ?? "plan_w060b_act_01",
    tenantId: overrides.tenantId ?? TENANT_A,
    name: overrides.name ?? "w060b-action-plan",
    description: overrides.description,
    version,
    selector: overrides.selector ?? { kind: "all" },
    capability: overrides.capability ?? "lock",
    selectedTargets,
    targetCount: overrides.targetCount ?? selectedTargets.length,
    status,
    createdAt: overrides.createdAt ?? T0,
    transitionedAt:
      overrides.transitionedAt !== undefined
        ? overrides.transitionedAt
        : status === "PROPOSAL"
          ? undefined
          : T1,
    requestedBy: overrides.requestedBy ?? USER_1,
    evidence: overrides.evidence ?? [evidenceRef()],
    contentDigest: overrides.contentDigest ?? `digest_${version}_${status}`,
  };
}

/** Build a deterministic, valid-by-construction Guardian decision record. */
export function decision(
  overrides: Partial<GuardianDecisionRecord> = {},
): GuardianDecisionRecord {
  const decisionType = overrides.decision ?? "REQUIRE_APPROVAL";
  return {
    tenantId: overrides.tenantId ?? TENANT_A,
    decision: decisionType,
    rules: overrides.rules ?? [ruleRef(`act-${decisionType}`)],
    evidence: overrides.evidence ?? [evidenceRef()],
    decidedAt: overrides.decidedAt ?? T1,
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

/** Build a deterministic print job record. */
export function printJob(
  overrides: Partial<SurfacePrintJobRecord> = {},
): SurfacePrintJobRecord {
  const status = overrides.status ?? "ROUTED";
  const refused = status === "REFUSED";
  const hasPrinterId = "printerId" in overrides;
  const hasQueuePosition = "queuePosition" in overrides;
  const hasRoutingReasons = "routingReasons" in overrides;
  return {
    jobId: overrides.jobId ?? "prn_w060b_job_01",
    tenantId: overrides.tenantId ?? TENANT_A,
    version: overrides.version ?? 1,
    payload: overrides.payload ?? { documentRef: "doc://w060b-report" },
    requiredFeatures: overrides.requiredFeatures ?? { color: true },
    printerId: hasPrinterId
      ? overrides.printerId
      : refused
        ? undefined
        : "prn_w060b_color_01",
    queuePosition: hasQueuePosition
      ? overrides.queuePosition
      : refused
        ? undefined
        : 1,
    status,
    createdAt: overrides.createdAt ?? T0,
    transitionedAt: overrides.transitionedAt,
    evidence: overrides.evidence ?? [evidenceRef("evidence/w060b-print-1")],
    correlationId: overrides.correlationId ?? PRINT_CORR,
    routingReasons: hasRoutingReasons
      ? overrides.routingReasons
      : refused
        ? ["unsupported_feature:color"]
        : undefined,
    contentDigest: overrides.contentDigest ?? `printdigest_${status}`,
  };
}

/** Build a deterministic printer record. */
export function printer(overrides: Partial<SurfacePrinterRecord> = {}): SurfacePrinterRecord {
  return {
    printerId: overrides.printerId ?? "prn_w060b_color_01",
    tenantId: overrides.tenantId ?? TENANT_A,
    capabilities: overrides.capabilities ?? { color: true, duplex: true },
    approved: overrides.approved ?? true,
    location: overrides.location ?? "hq",
  };
}

/** A canonical selector for tests. */
export const allSelector: SurfaceDeviceGroupSelector = { kind: "all" };
export const byPlatformSelector: SurfaceDeviceGroupSelector = { kind: "byPlatform", platform: "windows" };

/** All plan statuses (for exhaustive table tests). */
export const ALL_STATUSES: readonly SurfacePlanStatus[] = [
  "PROPOSAL",
  "ADVANCED",
  "PARKED",
  "APPROVED",
  "REJECTED",
];

/** The full printer-capability flags list (for exhaustive matrix tests). */
export const CAPABILITY_NAMES: readonly (keyof SurfacePrinterCapabilities)[] = [
  "color",
  "duplex",
  "staple",
  "punch",
  "scan",
  "fax",
  "largeFormat",
  "photo",
  "cardstock",
];

/** All three flag states a capability may carry. */
export const FLAG_STATES: readonly (boolean | undefined)[] = [true, false, undefined];
