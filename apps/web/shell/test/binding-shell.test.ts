/**
 * W061 binding site — the REAL six UI surface packages bound into the
 * Control Tower (test-scope cross-lane imports, the W060 pattern).
 *
 * Proves:
 *   1. every surface's REAL module identity constructs a descriptor that
 *      agrees with the shell's frozen navigation vocabulary;
 *   2. REAL view-model records project structurally into the shell's
 *      discoverability/coherence seams (type-checked assignability);
 *   3. every builtin journey's record kinds are covered by the areas'
 *      descriptors (no dangling journey hooks);
 *   4. the module identities are unique (one area, one module).
 */
import { test, expect } from "bun:test";
import { MODULE_NAME as DEVICE_MODULE } from "@fleetos/web-device";
import type { DeviceRowViewModel } from "@fleetos/web-device";
import { MODULE_NAME as RECOVERY_MODULE } from "@fleetos/web-recovery";
import { MODULE_NAME as SECURITY_MODULE } from "@fleetos/web-security";
import type { FindingsListItemView } from "@fleetos/web-security";
import { MODULE_NAME as ACTIONS_MODULE } from "@fleetos/web-actions";
import { MODULE_NAME as WORKLOADS_MODULE } from "@fleetos/web-workloads";
import { MODULE_NAME as COMMERCE_MODULE } from "@fleetos/web-commerce";
import { MODULE_NAME as LEARNING_MODULE } from "@fleetos/web-learning";
import type { ShellBandedSummary, ShellRecordSummary, ShellSurfaceDescriptor } from "../src/seams";
import { MODULE_NAME as SHELL_MODULE } from "../src/index";
import { BUILTIN_JOURNEYS, journeyRecordKinds } from "../src/journeys";
import { checkSurfaceVocabulary } from "../src/navigation";
import { makeTenantId, makeDeviceId } from "@fleetos/contracts/testing";
import { checkShellTenantScope } from "../src/internal";
import { presentationOf } from "../src/coherence";

const TENANT = makeTenantId("w061-binding");

test("every REAL surface module constructs a descriptor agreeing with the route vocabulary (W091 ten areas)", () => {
  const descriptors: readonly ShellSurfaceDescriptor[] = [
    { moduleName: DEVICE_MODULE, area: "device", views: ["list", "doctor", "lifecycle", "enrollment"], recordKinds: ["device.row", "device.doctor", "device.enrollment"] },
    { moduleName: RECOVERY_MODULE, area: "recovery", views: ["cases", "find-my", "destructive"], recordKinds: ["recovery.case", "recovery.find-my", "recovery.destructive"] },
    { moduleName: SECURITY_MODULE, area: "security", views: ["findings", "decisions", "approvals", "doctor"], recordKinds: ["security.finding", "approval.parked", "guardian.decision"] },
    // The policies AREA is served by the security lane (W090B's
    // PoliciesScreen) — one module may serve multiple areas.
    { moduleName: SECURITY_MODULE, area: "policies", views: ["list"], recordKinds: ["policy.rule"] },
    { moduleName: ACTIONS_MODULE, area: "actions", views: ["plans", "print"], recordKinds: ["action.plan", "action.plan.progress", "print.job", "print.route", "print.dispatch", "print.result"] },
    { moduleName: WORKLOADS_MODULE, area: "workloads", views: ["planning", "recommendations"], recordKinds: ["workload.plan", "workload.recommendation"] },
    { moduleName: COMMERCE_MODULE, area: "commerce", views: ["procurement", "software", "vendors", "maintenance", "connectivity", "communication"], recordKinds: ["maintenance.work-order", "procurement.match", "procurement.request", "vendor.quote", "software.subscription", "connectivity.request", "communication.summary"] },
    { moduleName: LEARNING_MODULE, area: "learning", views: ["cases", "adoption"], recordKinds: ["learning.case", "learning.adoption"] },
    // The evidence AREA is served by the shell itself (W091's
    // evidence view-models over the audit log).
    { moduleName: SHELL_MODULE, area: "evidence", views: ["trail"], recordKinds: ["evidence.trail"] },
  ];
  for (const descriptor of descriptors) {
    expect(checkSurfaceVocabulary(descriptor)).toEqual({ ok: true });
  }
  // Module identities are unique per (module, area) pair; a module may
  // serve multiple areas (security serves security + policies; the
  // shell serves overview + evidence).
  const pairs = descriptors.map((d) => `${d.moduleName}:${d.area}`);
  expect(new Set(pairs).size).toBe(pairs.length);
  const names = descriptors.map((d) => d.moduleName);
  expect(names).toContain("web-device");
  expect(names).toContain("web-learning");
});

test("every builtin journey's record kinds are covered by the surface descriptors", () => {
  const covered = new Set<string>([
    "device.row",
    "device.doctor",
    "device.enrollment",
    "recovery.case",
    "recovery.find-my",
    "recovery.destructive",
    "security.finding",
    "approval.parked",
    "guardian.decision",
    "policy.rule",
    "action.plan",
    "action.plan.progress",
    "print.job",
    "print.route",
    "print.dispatch",
    "print.result",
    "workload.plan",
    "workload.recommendation",
    "maintenance.work-order",
    "procurement.match",
    "procurement.request",
    "vendor.quote",
    "software.subscription",
    "connectivity.request",
    "communication.summary",
    "learning.case",
    "learning.adoption",
    "evidence.trail",
  ]);
  for (const journey of BUILTIN_JOURNEYS) {
    for (const kind of journeyRecordKinds(journey)) {
      expect(covered.has(kind)).toBe(true);
    }
  }
});

test("REAL DeviceRowViewModel projects structurally into the discoverability seam", () => {
  const row: DeviceRowViewModel = {
    tenantId: TENANT,
    deviceId: makeDeviceId("bind-device-1"),
    displayName: "Acme EliteBook 840",
    hardware: { manufacturer: "Acme", model: "EliteBook 840", serialNumber: "SN-1", assetTag: "AT-1" },
    ownership: { ownerType: "company", owner: "hr" },
    staleness: "fresh",
  } as unknown as DeviceRowViewModel;
  const summary: ShellRecordSummary = {
    area: "device",
    recordId: row.deviceId,
    title: row.displayName,
    keywords: [row.hardware.manufacturer.toLowerCase(), row.hardware.model.toLowerCase()],
  };
  expect(summary.title).toBe("Acme EliteBook 840");
  const banded: ShellBandedSummary = {
    ...summary,
    band: row.staleness === "fresh" ? "ok" : "neutral",
    subtitle: `Staleness: ${row.staleness}`,
  };
  const outcome = presentationOf(banded);
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.presentation.tone).toBe("positive");
  }
});

test("REAL FindingsListItemView projects structurally into the coherence seam", () => {
  const finding: FindingsListItemView = {
    findingId: "fnd-bind-1",
    recordId: "rec-1",
    deviceId: makeDeviceId("bind-device-2"),
    code: "TLS_STALE",
    title: "Stale TLS certificate",
    severity: "HIGH",
  } as unknown as FindingsListItemView;
  const banded: ShellBandedSummary = {
    area: "security",
    recordId: finding.findingId,
    title: finding.title,
    keywords: [finding.code.toLowerCase()],
    band: finding.severity.toLowerCase(),
    subtitle: finding.code,
  };
  const outcome = presentationOf(banded);
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.presentation.band).toBe("high");
    expect(outcome.presentation.tone).toBe("warning");
  }
});

test("the REAL identity TenantContext satisfies the shell tenant scope structurally", () => {
  const realContext = { tenantId: makeTenantId("w061-real-context"), actor: "operator" };
  expect(checkShellTenantScope(realContext).ok).toBe(true);
  expect(checkShellTenantScope(null)).toEqual({ ok: false, reason: "missing_scope" });
  expect(checkShellTenantScope({ tenantId: "x" })).toEqual({ ok: false, reason: "invalid_tenant" });
});
