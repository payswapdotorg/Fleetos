/**
 * W122 — THE ISOLATION LAW (machine tests over the tenant-scoped
 * console composition).
 *
 * The law: console areas render records scoped to the ACTIVE session's
 * tenant. The demo tenant (tnt_w091demo000001) sees the rich demo
 * fleet; EVERY non-demo workspace sees ONLY its own records — for a
 * fresh workspace that means honest empty states in every area, and a
 * NON-DEMO TENANT CAN NEVER RESOLVE A DEMO RECORD: no demo record id,
 * no demo fixture string, no demo tenant id — in ANY area (tower view,
 * evidence index + trails, search records, device fleet, findings,
 * approvals, policies, learning), at any time. Fail-closed: an
 * unknown/cross-tenant composition is a machine-stable refusal, never
 * a silent fallback to demo data.
 */

import { describe, test, expect } from "bun:test";
import {
  DEMO,
  DEMO_PERSONAS,
  DEMO_WORKSPACE_NAME,
  TENANT_ID,
  composeConsoleAreas,
  isDemoTenant,
} from "../src/runtime/demo-fleet";
import { PRODUCT_EXPERIENCE_ROLES } from "@fleetos/web-product";

const NON_DEMO_TENANT = "tnt_w101test0042";

/** Every demo record id + fixture string marker that must NEVER leak. */
const DEMO_MARKERS: readonly string[] = [
  "tnt_w091demo000001",
  "dev_w091demo000001",
  "dev_w091demo000002",
  "dev_w091demo000003",
  "W091-DEMO-0001",
  "W091-DEMO-0002",
  "W091-DEMO-0003",
  "w091-demo-enable-encryption",
  "w091-demo-lock-lost-device",
  "w091-demo-require-approval",
  "cor_w091demo000001",
  "obsw091demo0000010",
  "cap_w091_demo_lock",
  "prp_w091demo000001",
  "suite_w091_demo_rev1",
  "ThinkPad T14",
  "MacBook Air M3",
  "Pixel 9",
  "Lenovo",
  "action.plan.approved",
  "action.plan.dispatched",
  "disk encryption",
];

describe("W122 demo persona catalog (the frozen seven-role vocabulary)", () => {
  test("one demo persona per experience role — the full frozen matrix vocabulary, matrix order", () => {
    expect(DEMO_PERSONAS.map((p) => p.role)).toEqual([...PRODUCT_EXPERIENCE_ROLES]);
    for (const persona of DEMO_PERSONAS) {
      expect(persona.personaId).toMatch(/^demo-[a-z-]+$/);
      expect(persona.displayName).toMatch(/^Demo — /);
      expect(persona.memberRef).toMatch(/^demo\.[a-z.]+@fleetos\.demo$/);
    }
  });

  test("the demo workspace name is honestly DEMO-labeled; the tenant id is the dedicated demo tenant", () => {
    expect(DEMO_WORKSPACE_NAME).toBe("Demo — FleetOS Workspace");
    expect(TENANT_ID).toBe("tnt_w091demo000001");
    expect(isDemoTenant(TENANT_ID)).toBe(true);
    expect(isDemoTenant(NON_DEMO_TENANT)).toBe(false);
    expect(isDemoTenant("")).toBe(false);
  });
});

describe("W122 THE ISOLATION LAW — the demo tenant sees the rich demo fleet", () => {
  test("composeConsoleAreas(demo tenant) resolves the full demo composition in every area", () => {
    const result = composeConsoleAreas(TENANT_ID, "owner");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.isDemo).toBe(true);
    expect(view.tenantId).toBe(TENANT_ID);
    // The tower: the frozen attention stream (the W091 composition).
    expect(view.towerView.attentionStream.length).toBe(DEMO.towerView.attentionStream.length);
    expect(view.towerView.attentionStream.map((i) => i.recordId)).toEqual(
      DEMO.towerView.attentionStream.map((i) => i.recordId),
    );
    expect(view.towerView.recentActivity.length).toBeGreaterThan(0);
    // Evidence: the three composed trails + the index rows.
    expect(view.evidenceTrails.length).toBe(3);
    expect(view.evidenceIndex.length).toBe(3);
    // Search: the eight banded records.
    expect(view.searchRecords.length).toBe(8);
    // The lane views: the real demo fleet records.
    expect(view.fleetView.ok && view.fleetView.view.totalDevices).toBe(3);
    expect(view.findingsView.ok && view.findingsView.view.items.length).toBeGreaterThan(0);
    expect(view.approvalsView.ok && view.approvalsView.view.items.length).toBe(1);
    expect(view.policiesView.ok && view.policiesView.view.items.length).toBe(1);
    expect(view.learning.feed.ok && view.learning.feed.view.items.length).toBeGreaterThan(0);
    expect(view.learning.cases.ok && view.learning.cases.view.items.length).toBe(1);
    // The ledger carries the CURRENT adoption revision (the superseded
    // revision stays in the lineage, one live entry).
    expect(view.learning.ledger.ok && view.learning.ledger.view.items.length).toBe(1);
  });

  test("the demo tower view is role-shaped for non-owner demo personas (the same demo records)", () => {
    const owner = composeConsoleAreas(TENANT_ID, "owner");
    const viewer = composeConsoleAreas(TENANT_ID, "viewer");
    expect(owner.ok && viewer.ok).toBe(true);
    if (!owner.ok || !viewer.ok) return;
    // The same demo records flow to every demo persona (role shapes
    // interactions, not the record set).
    expect(viewer.view.towerView.attentionStream.map((i) => i.recordId)).toEqual(
      owner.view.towerView.attentionStream.map((i) => i.recordId),
    );
    expect(viewer.view.towerView.role).toBe("viewer");
    expect(owner.view.towerView.role).toBe("owner");
  });
});

describe("W122 THE ISOLATION LAW — a non-demo tenant NEVER resolves demo records", () => {
  test("every console area is EMPTY for a fresh non-demo workspace (honest empty states)", () => {
    const result = composeConsoleAreas(NON_DEMO_TENANT, "owner");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.isDemo).toBe(false);
    expect(view.tenantId).toBe(NON_DEMO_TENANT);
    // Tower: no attention, no recent activity, no counters.
    expect(view.towerView.attentionStream.length).toBe(0);
    expect(view.towerView.recentActivity.length).toBe(0);
    expect(view.towerView.counters.length).toBe(0);
    // Evidence: no trails, no index rows.
    expect(view.evidenceTrails.length).toBe(0);
    expect(view.evidenceIndex.length).toBe(0);
    // Search: no records.
    expect(view.searchRecords.length).toBe(0);
    // The lane views: each tenant-scoped and empty.
    expect(view.fleetView.ok && view.fleetView.view.totalDevices).toBe(0);
    expect(view.fleetView.ok && view.fleetView.view.tenantId).toBe(NON_DEMO_TENANT);
    expect(view.findingsView.ok && view.findingsView.view.items.length).toBe(0);
    expect(view.findingsView.ok && view.findingsView.view.tenantId).toBe(NON_DEMO_TENANT);
    expect(view.approvalsView.ok && view.approvalsView.view.items.length).toBe(0);
    expect(view.policiesView.ok && view.policiesView.view.items.length).toBe(0);
    expect(view.policiesView.ok && view.policiesView.view.tenantId).toBe(NON_DEMO_TENANT);
    expect(view.learning.feed.ok && view.learning.feed.view.items.length).toBe(0);
    expect(view.learning.cases.ok && view.learning.cases.view.items.length).toBe(0);
    expect(view.learning.ledger.ok && view.learning.ledger.view.items.length).toBe(0);
  });

  test("NO demo record id, fixture string or tenant marker appears ANYWHERE in a non-demo composition", () => {
    for (const role of ["owner", "operator", "approver", "auditor", "viewer"] as const) {
      const result = composeConsoleAreas(NON_DEMO_TENANT, role);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const serialized = JSON.stringify(result.view);
      for (const marker of DEMO_MARKERS) {
        expect(serialized.includes(marker)).toBe(false);
      }
      // The composition is scoped to the SESSION's tenant, never the demo tenant.
      expect(serialized.includes(NON_DEMO_TENANT)).toBe(true);
      expect(result.view.towerView.tenantId).toBe(NON_DEMO_TENANT);
    }
  });

  test("cross-tenant record resolution: a demo record id resolves to NOTHING under a non-demo tenant (never a demo fallback)", () => {
    const result = composeConsoleAreas(NON_DEMO_TENANT, "owner");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    // Every demo record id from the demo composition (summaries,
    // search, trails) is unknown here — no surface carries it.
    const demoRecordIds = new Set<string>([
      ...DEMO.searchRecords.map((r) => r.recordId),
      ...DEMO.evidenceTrails.map((t) => t.subjectId),
      ...DEMO.evidenceIndex.map((r) => r.subjectId),
    ]);
    expect(demoRecordIds.size).toBeGreaterThan(0);
    const ownRecordIds = new Set<string>(view.searchRecords.map((r) => r.recordId));
    for (const id of demoRecordIds) {
      expect(ownRecordIds.has(id)).toBe(false);
      // The evidence surface resolves no trail for a demo subject id.
      expect(view.evidenceTrails.find((t) => t.subjectId === id)).toBeUndefined();
      expect(view.evidenceIndex.find((r) => r.subjectId === id)).toBeUndefined();
    }
    // The search surface: a demo keyword matches NOTHING.
    for (const keyword of ["thinkpad", "pixel", "w091-demo", "lenovo"]) {
      const matches = view.searchRecords.filter((r) =>
        r.keywords.some((k) => k.includes(keyword)),
      );
      expect(matches.length).toBe(0);
    }
  });

  test("fail-closed: an invalid tenant grammar is a machine-stable refusal — never a fallback to demo data", () => {
    for (const bad of ["", "nonsense", "TNT_UPPER", "tnt_", "tnt_short", "tnt_w091demo000001 "]) {
      const result = composeConsoleAreas(bad, "owner");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_tenant");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  test("two distinct non-demo tenants compose identical honest empties, each scoped to its own tenant", () => {
    const a = composeConsoleAreas("tnt_w101test0001", "owner");
    const b = composeConsoleAreas("tnt_w101test0002", "owner");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.view.towerView.tenantId).toBe("tnt_w101test0001");
    expect(b.view.towerView.tenantId).toBe("tnt_w101test0002");
    // Deterministic identical shape (the honest empty composition).
    expect(JSON.stringify(a.view.towerView.counters)).toBe(JSON.stringify(b.view.towerView.counters));
    expect(a.view.searchRecords).toEqual(b.view.searchRecords);
  });
});
