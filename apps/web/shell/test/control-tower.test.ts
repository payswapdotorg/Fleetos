/**
 * W091 [TL] — the Control Tower view-model tests (pure logic).
 *
 * Covers: the attention stream's severity ordering + direct record
 * links, the compact pulses, the counters, recent activity ordering,
 * the onboarding entry point's authorization visibility, the
 * permission summary, machine-stable refusals (invalid summaries,
 * cross-tenant audit REFUSES fail-closed), and deep-frozen output.
 */
import { describe, expect, test } from "bun:test";
import { buildControlTowerView, PULSE_GROUPS, ATTENTION_CUTOFF } from "../src/control-tower";
import type { ShellBandedSummary } from "../src/seams";
import { makeTenantId } from "@fleetos/contracts/testing";

const TENANT = makeTenantId("w091-tower");
const SCOPE = { tenantId: TENANT };

function summary(
  index: number,
  area: ShellBandedSummary["area"],
  band: string,
): ShellBandedSummary {
  return {
    area,
    recordId: `rec_${String(index).padStart(3, "0")}`,
    title: `Record ${index}`,
    keywords: ["record"],
    band,
    subtitle: `subtitle ${index}`,
  };
}

describe("W091 Control Tower view-model", () => {
  test("the attention stream orders by severity, then area, then record id — input order never matters", () => {
    const summaries = [
      summary(1, "device", "ok"),
      summary(2, "security", "critical"),
      summary(3, "device", "high"),
      summary(4, "actions", "high"),
      summary(5, "device", "medium"),
    ];
    const a = buildControlTowerView({ scope: SCOPE, role: "owner", summaries });
    const b = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [...summaries].reverse(),
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.view.attentionStream.map((i) => i.recordId)).toEqual([
      "rec_002",
      "rec_004",
      "rec_003",
      "rec_005",
    ]);
    expect(b.view.attentionStream.map((i) => i.recordId)).toEqual(
      a.view.attentionStream.map((i) => i.recordId),
    );
  });

  test("every attention item carries the direct record route + the evidence route + authorization state", () => {
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [summary(1, "security", "critical")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.view.attentionStream[0]!;
    expect(item.route).toEqual({ area: "security", view: "findings" });
    expect(item.evidenceRoute).toEqual({ area: "evidence", view: "trail" });
    expect(item.navigable).toBe(true);
  });

  test("the pulses are the frozen four groups with machine-stable band counts", () => {
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [
        summary(1, "device", "high"),
        summary(2, "device", "ok"),
        summary(3, "security", "critical"),
        summary(4, "actions", "high"),
        summary(5, "commerce", "neutral"),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.pulses.map((p) => p.group)).toEqual(PULSE_GROUPS.map((g) => g.group));
    const fleet = result.view.pulses[0]!;
    expect(fleet.total).toBe(2);
    expect(fleet.attention).toBe(1);
    const sec = result.view.pulses[1]!;
    expect(sec.attention).toBe(1);
  });

  test("the onboarding entry point is ALWAYS present with its authorization state", () => {
    const owner = buildControlTowerView({ scope: SCOPE, role: "owner", summaries: [] });
    const viewer = buildControlTowerView({ scope: SCOPE, role: "viewer", summaries: [] });
    expect(owner.ok && owner.view.onboarding.navigable).toBe(true);
    expect(owner.ok && owner.view.onboarding.route).toEqual({ area: "device", view: "enrollment" });
    // viewer: navigation is all-except-destructive, so enrollment is navigable;
    // the authorization VISIBILITY is the contract, whatever the verdict.
    expect(viewer.ok && typeof viewer.view.onboarding.navigable).toBe("boolean");
  });

  test("recent activity is latest-first by injected instant, then record id (no clock)", () => {
    const audit = [
      {
        recordId: "a1",
        tenantId: TENANT,
        actor: "user:op1",
        action: "device.enrolled",
        at: "2026-01-06T09:00:00Z",
        outcome: "success",
        correlationId: "cor_1",
        evidenceRefs: [],
      },
      {
        recordId: "a2",
        tenantId: TENANT,
        actor: "user:op1",
        action: "action.plan.approved",
        at: "2026-01-06T12:00:00Z",
        outcome: "success",
        correlationId: "cor_2",
        evidenceRefs: [],
      },
    ];
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [],
      recentAudit: audit,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.recentActivity.map((i) => i.recordId)).toEqual(["a2", "a1"]);
  });

  test("cross-tenant audit records REFUSE fail-closed (never silently filtered)", () => {
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [],
      recentAudit: [
        {
          recordId: "a1",
          tenantId: TENANT,
          actor: "user:op1",
          action: "device.enrolled",
          at: "2026-01-06T09:00:00Z",
          outcome: "success",
          correlationId: "cor_1",
          evidenceRefs: [],
        },
        {
          recordId: "a2",
          tenantId: makeTenantId("w091-other"),
          actor: "user:op2",
          action: "device.wiped",
          at: "2026-01-06T10:00:00Z",
          outcome: "success",
          correlationId: "cor_3",
          evidenceRefs: [],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cross_tenant_audit");
  });

  test("invalid summaries refuse machine-stably with a path", () => {
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [summary(1, "device", "nonsense")],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_summary");
    expect(result.path).toBe("summaries[0].band");
  });

  test("the output is deep-frozen; the attention cutoff is the frozen attention band set", () => {
    const result = buildControlTowerView({
      scope: SCOPE,
      role: "owner",
      summaries: [summary(1, "device", "high")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.view)).toBe(true);
    expect(Object.isFrozen(result.view.attentionStream)).toBe(true);
    expect([...ATTENTION_CUTOFF]).toEqual(["critical", "high", "medium"]);
    expect(Object.isFrozen(ATTENTION_CUTOFF)).toBe(true);
  });
});
