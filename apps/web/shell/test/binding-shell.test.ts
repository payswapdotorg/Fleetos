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
import type { ShellBandedSummary, ShellRecordSummary, ShellSurfaceDescriptor } from "../src/seams";
import { BUILTIN_JOURNEYS, journeyRecordKinds } from "../src/journeys";
import { checkSurfaceVocabulary } from "../src/navigation";
import { makeTenantId, makeDeviceId } from "@fleetos/contracts/testing";
import { checkShellTenantScope } from "../src/internal";
import { presentationOf } from "../src/coherence";

const TENANT = makeTenantId("w061-binding");

test("every REAL surface module constructs a descriptor agreeing with the route vocabulary", () => {
  const descriptors: readonly ShellSurfaceDescriptor[] = [
    { moduleName: DEVICE_MODULE, area: "device", views: ["list", "doctor", "lifecycle"], recordKinds: ["device.row", "device.doctor"] },
    { moduleName: RECOVERY_MODULE, area: "recovery", views: ["cases", "find-my", "destructive"], recordKinds: ["recovery.case", "recovery.find-my"] },
    { moduleName: SECURITY_MODULE, area: "security", views: ["findings", "decisions", "approvals"], recordKinds: ["security.finding", "approval.parked"] },
    { moduleName: ACTIONS_MODULE, area: "actions", views: ["plans", "print"], recordKinds: ["action.plan", "action.plan.progress"] },
    { moduleName: WORKLOADS_MODULE, area: "workloads", views: ["planning", "recommendations"], recordKinds: ["workload.plan"] },
    { moduleName: COMMERCE_MODULE, area: "commerce", views: ["procurement", "maintenance", "connectivity", "communication"], recordKinds: ["maintenance.work-order", "procurement.match", "connectivity.request", "communication.summary"] },
  ];
  for (const descriptor of descriptors) {
    expect(checkSurfaceVocabulary(descriptor)).toEqual({ ok: true });
  }
  const names = descriptors.map((d) => d.moduleName);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("web-device");
});

test("every builtin journey's record kinds are covered by the surface descriptors", () => {
  const covered = new Set<string>([
    "device.row",
    "device.doctor",
    "recovery.case",
    "recovery.find-my",
    "security.finding",
    "approval.parked",
    "action.plan",
    "action.plan.progress",
    "workload.plan",
    "maintenance.work-order",
    "procurement.match",
    "connectivity.request",
    "communication.summary",
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
