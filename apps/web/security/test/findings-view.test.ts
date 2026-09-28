/**
 * W060B D1 tests — the Security Doctor findings surface view-model:
 * severity ordering (machine-stable, input-order invariant), opaque
 * evidence refs, remediations presented as PROPOSALs (never direct
 * execution), tenant-scoped refusal, determinism, read-only outputs.
 */

import { describe, expect, test } from "bun:test";
import {
  buildFindingsListView,
  SURFACE_SEVERITY_RANK,
  type FindingsListView,
} from "../src/findings-view";
import type { ObservationId, TenantId } from "@fleetos/contracts";
import type { SecurityFindingRecord } from "../src/surface-contracts";
import type { SurfaceResult } from "../src/internal";
import {
  DEV_A1,
  DEV_A2,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  T2,
  finding,
  remediationDraft,
  scopeA,
} from "./helpers";

function okView(result: SurfaceResult<FindingsListView>): FindingsListView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

describe("D1: findings list ordering is machine-stable", () => {
  test("items are ordered by severity rank desc, then code asc, then deviceId asc", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [
        finding({ code: "security.device.firewall.off", severity: "MEDIUM", deviceId: DEV_A2 }),
        finding({ code: "security.device.disk_encryption.off", severity: "HIGH", deviceId: DEV_A2 }),
        finding({ code: "security.device.malware.active", severity: "CRITICAL", deviceId: DEV_A1 }),
        finding({ code: "security.device.firewall.off", severity: "MEDIUM", deviceId: DEV_A1 }),
        finding({ code: "security.device.screen_lock.off", severity: "LOW", deviceId: DEV_A1 }),
      ]),
    );
    const ordered = view.items.map((item) => item.severity);
    expect(ordered).toEqual(["CRITICAL", "HIGH", "MEDIUM", "MEDIUM", "LOW"]);
    // Within the same severity (MEDIUM, firewall.off), deviceId asc wins.
    expect(view.items[2]?.deviceId).toBe(DEV_A1);
    expect(view.items[3]?.deviceId).toBe(DEV_A2);
    expect(view.items[1]?.code).toBe("security.device.disk_encryption.off");
  });

  test("input order never matters — the same findings in any order produce a byte-identical view", () => {
    const findings = [
      finding({ code: "security.device.malware.active", severity: "CRITICAL" }),
      finding({ code: "security.device.disk_encryption.off", severity: "HIGH", deviceId: DEV_A2 }),
      finding({ code: "security.device.disk_encryption.off", severity: "HIGH", deviceId: DEV_A1 }),
      finding({ code: "security.device.screen_lock.off", severity: "LOW" }),
    ];
    const a = okView(buildFindingsListView(scopeA(), findings));
    const b = okView(buildFindingsListView(scopeA(), [...findings].reverse()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("interpretation versions break ties within the same (severity, code, device)", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [
        finding({
          code: "security.device.disk_encryption.off",
          severity: "HIGH",
          interpretationVersion: 3,
          recordId: "rec_v3",
          supersedes: "rec_v2",
        }),
        finding({
          code: "security.device.disk_encryption.off",
          severity: "HIGH",
          interpretationVersion: 2,
          recordId: "rec_v2",
        }),
      ]),
    );
    // The LATEST interpretation leads (version desc within the same key).
    expect(view.items.map((item) => item.recordId)).toEqual(["rec_v3", "rec_v2"]);
    expect(view.items[0]?.supersedes).toBe("rec_v2");
    expect(view.items[0]?.interpretationVersion).toBe(3);
  });
});

describe("D1: severity rollup counts are derived deterministically", () => {
  test("severityCounts mirror the items", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [
        finding({ severity: "CRITICAL" }),
        finding({ severity: "CRITICAL", code: "security.device.firewall.off" }),
        finding({ severity: "HIGH", code: "security.device.firewall.off" }),
        finding({ severity: "LOW", code: "security.device.screen_lock.off" }),
      ]),
    );
    expect(view.total).toBe(4);
    expect(view.severityCounts).toEqual({ CRITICAL: 2, HIGH: 1, MEDIUM: 0, LOW: 1 });
    expect(view.tenantId).toBe(TENANT_A);
  });

  test("an empty findings list is a valid empty view", () => {
    const view = okView(buildFindingsListView(scopeA(), []));
    expect(view.total).toBe(0);
    expect(view.items).toEqual([]);
    expect(view.severityCounts).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  });

  test("the severity rank table is machine-stable (CRITICAL > HIGH > MEDIUM > LOW)", () => {
    expect(SURFACE_SEVERITY_RANK.CRITICAL).toBeGreaterThan(SURFACE_SEVERITY_RANK.HIGH);
    expect(SURFACE_SEVERITY_RANK.HIGH).toBeGreaterThan(SURFACE_SEVERITY_RANK.MEDIUM);
    expect(SURFACE_SEVERITY_RANK.MEDIUM).toBeGreaterThan(SURFACE_SEVERITY_RANK.LOW);
  });
});

describe("D1: evidence refs are opaque", () => {
  test("evidence carries the observation id + kind verbatim — nothing derived, nothing interpreted", () => {
    const evidence = [
      { observationId: "obs_w060b_alpha" as ObservationId, kind: "device.security" },
      { observationId: "obs_w060b_beta" as ObservationId, kind: "device.security" },
    ];
    const view = okView(buildFindingsListView(scopeA(), [finding({ evidence })]));
    expect(view.items[0]?.evidence).toEqual([
      { observationId: "obs_w060b_alpha", kind: "device.security" },
      { observationId: "obs_w060b_beta", kind: "device.security" },
    ]);
    expect(view.items[0]?.evidenceCount).toBe(2);
  });

  test("evidence order is preserved verbatim (the derivation already sorts by observationId)", () => {
    const evidence = [
      { observationId: "obs_w060b_zulu" as ObservationId, kind: "device.security" },
      { observationId: "obs_w060b_alpha" as ObservationId, kind: "device.security" },
    ];
    const view = okView(buildFindingsListView(scopeA(), [finding({ evidence })]));
    expect(view.items[0]?.evidence.map((e) => e.observationId)).toEqual([
      "obs_w060b_zulu",
      "obs_w060b_alpha",
    ]);
  });
});

describe("D1: remediations are presented as PROPOSALs (never direct execution)", () => {
  test("a remediation becomes a proposal view with no intent id, no status, no execution path", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [finding({ remediation: remediationDraft() })]),
    );
    const proposal = view.items[0]?.remediationProposal;
    expect(proposal).not.toBeNull();
    expect(proposal?.presentation).toBe("PROPOSAL");
    expect(proposal?.intentKind).toBe("SecurityRemediationIntent");
    expect(proposal?.payload.description).toBe("Enable disk encryption on the device");
    expect(proposal?.payload.deviceId).toBe(DEV_A1);
    expect(proposal?.payload.findingId).toBe("sec_w060b_finding");
    // The serialized proposal carries NO intentId and NO lifecycle status.
    const serialized = JSON.stringify(proposal);
    expect(serialized.includes("intentId")).toBe(false);
    expect(serialized.includes("status")).toBe(false);
    expect(serialized.includes("dispatch")).toBe(false);
    expect(serialized.includes("commandId")).toBe(false);
  });

  test("the proposal view discloses that there is no direct-execution path (LOCK 16)", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [finding({ remediation: remediationDraft() })]),
    );
    expect(view.items[0]?.remediationProposal?.executionPath).toBe("none");
  });

  test("a finding without a remediation surfaces a null proposal (not a fabricated one)", () => {
    const view = okView(buildFindingsListView(scopeA(), [finding()]));
    expect(view.items[0]?.remediationProposal).toBeNull();
  });
});

describe("D1: the surface is tenant-scoped and fail-closed", () => {
  test("a cross-tenant finding REFUSES the whole build with a machine-stable error", () => {
    const result = buildFindingsListView(scopeA(), [finding(), finding({ tenantId: TENANT_B })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.tenant_mismatch");
    expect(result.error.tenantId).toBe(TENANT_A);
    expect(result.error.failures.length).toBe(1);
    expect(result.error.failures[0]?.path).toBe("/findings/1");
    expect(result.error.failures[0]?.reason).toBe("tenant_mismatch");
  });

  test("a malformed scope refuses with scope_invalid", () => {
    const result = buildFindingsListView({ tenantId: "" as TenantId }, [finding()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.scope_invalid");
    expect(result.error.kind).toBe("ValidationError");
  });

  test("a malformed finding refuses with finding_invalid and a JSON-pointer path", () => {
    const bad = { ...finding(), severity: "SUPER_BAD" } as unknown as SecurityFindingRecord;
    const result = buildFindingsListView(scopeA(), [bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.finding_invalid");
    expect(result.error.failures[0]?.path).toBe("/findings/0/severity");
    expect(result.error.failures[0]?.reason).toBe("unknown_severity");
  });

  test("a non-ISO detectedAt refuses with not_iso", () => {
    const result = buildFindingsListView(scopeA(), [finding({ detectedAt: "yesterday" })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("not_iso");
  });
});

describe("D1: the view is read-only and deterministic", () => {
  test("outputs are deeply frozen (read-only surface)", () => {
    const view = okView(buildFindingsListView(scopeA(), [finding()]));
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.items)).toBe(true);
    expect(Object.isFrozen(view.items[0])).toBe(true);
    expect(Object.isFrozen(view.items[0]?.evidence)).toBe(true);
  });

  test("the same input twice produces a byte-identical view (determinism)", () => {
    const input = [finding(), finding({ code: "security.device.firewall.off", severity: "MEDIUM" })];
    const a = okView(buildFindingsListView(scopeA(), input));
    const b = okView(buildFindingsListView(scopeA(), input));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the builder never mutates its input (read-only derivation)", () => {
    const input = [finding()];
    const snapshot = JSON.stringify(input);
    buildFindingsListView(scopeA(), input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("timestamps pass through verbatim (no clock reads on the surface)", () => {
    const view = okView(
      buildFindingsListView(scopeA(), [finding({ detectedAt: T2, observedAt: T1 })]),
    );
    expect(view.items[0]?.detectedAt).toBe(T2);
    expect(view.items[0]?.observedAt).toBe(T1);
  });
});
