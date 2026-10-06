/**
 * @fleetos/web — W152 Fix 1 (R2 residual): the SEARCH-DECISION OVERLAY
 * regression tests.
 *
 * These tests pin the R2 residual's closure: after an approve execution,
 * the global search (Ctrl+K) for `pln_fb564c1e` returns the overlaid
 * title `Decided plan (APPROVED) — w091-demo-enable-encryption` (the
 * seeded `Parked plan — ` shape replaced) instead of the seeded
 * `Parked plan — w091-demo-enable-encryption`.
 *
 * The overlay is PURE + DETERMINISTIC: same inputs always produce the
 * same output; the empty executed-decision state yields the input
 * array unchanged (referential equality preserved for the no-op case);
 * records NOT decided pass through with their original object identity
 * preserved.
 *
 * The tests follow the W149 verification test pattern
 * (apps/web/test/w149-verification.test.ts is the exemplar — the same
 * `executeApproveDecision` helper drives the runtime, the same
 * `deriveExecutedDecisionState` produces the executed-decision state,
 * the same `composeConsoleAreas` produces the demo's search records).
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId } from "@fleetos/contracts";
import type { ShellRecordSummary } from "../shell/src/seams";
import {
  createApprovalDecisionRuntime,
  openApprovalDecision,
  acknowledgeDecision,
  enterConfirmationPhrase,
  markConfirmed,
  dispatchDecision,
  buildAuthority,
  decisionCorrelationId,
  APPROVAL_PERMISSION,
  confirmationPhrase,
} from "../src/runtime/approval-decision-runtime";
import { deriveExecutedDecisionState } from "../src/runtime/executed-decision-state";
import { overlaySearchRecordsWithExecutedDecisions } from "../src/runtime/search-decision-overlay";
import { composeConsoleAreas } from "../src/runtime/demo-fleet";

const DEMO_TENANT = "tnt_w091demo000001";
const NOW = "2026-01-06T14:00:00Z";
const PARKED_PLAN_ID = "pln_fb564c1e";

// ---------------------------------------------------------------------------
// Helper: drive a full Approve execution through the runtime (the
// typed-phrase gate -> the boundary -> the audit trail) — the W149
// test battery's own helper, replicated here so this file is
// self-contained.
// ---------------------------------------------------------------------------

function executeApproveDecision(planId: string): ReturnType<typeof createApprovalDecisionRuntime> {
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w091demoop001",
    [APPROVAL_PERMISSION],
    ["fleet.admin"],
  );
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId,
    action: "approve" as const,
    by: asUserId("usr_w091demoop001"),
    correlationId: decisionCorrelationId(),
  };
  let runtime = createApprovalDecisionRuntime();
  runtime = openApprovalDecision(runtime, { tenantId: asTenantId(DEMO_TENANT) }, context, authority, NOW).state;
  runtime = acknowledgeDecision(runtime, NOW).state;
  runtime = enterConfirmationPhrase(runtime, confirmationPhrase(context)).state;
  runtime = markConfirmed(runtime, NOW).state;
  runtime = dispatchDecision(runtime, NOW).state;
  return runtime;
}

function executeRejectDecision(planId: string): ReturnType<typeof createApprovalDecisionRuntime> {
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w091demoop001",
    [APPROVAL_PERMISSION],
    ["fleet.admin"],
  );
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId,
    action: "reject" as const,
    by: asUserId("usr_w091demoop001"),
    correlationId: decisionCorrelationId(),
  };
  let runtime = createApprovalDecisionRuntime();
  runtime = openApprovalDecision(runtime, { tenantId: asTenantId(DEMO_TENANT) }, context, authority, NOW).state;
  runtime = acknowledgeDecision(runtime, NOW).state;
  runtime = enterConfirmationPhrase(runtime, confirmationPhrase(context)).state;
  runtime = markConfirmed(runtime, NOW).state;
  runtime = dispatchDecision(runtime, NOW).state;
  return runtime;
}

// ---------------------------------------------------------------------------
// P1 — the pure overlay (the per-record transformation)
// ---------------------------------------------------------------------------

test("W152 Fix 1 P1 — the empty executed-decision state yields the input array unchanged (referential equality)", () => {
  // The empty state's overlay is a no-op: the input array passes through
  // with its original object identity preserved (no copy, no transform).
  const emptyState = deriveExecutedDecisionState(createApprovalDecisionRuntime());
  expect(emptyState.decidedPlanIds.length).toBe(0);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Parked plan — w091-demo-enable-encryption",
      keywords: ["plan", "parked", "approval"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, emptyState);
  // Referential equality: the same array object passes through.
  expect(overlaid).toBe(records);
});

test("W152 Fix 1 P1 — a decided plan's title is overlaid (Parked plan -> Decided plan (APPROVED) — <name>)", () => {
  // The R2 residual's closure: after an Approve execution, the search
  // record's title `Parked plan — w091-demo-enable-encryption` becomes
  // `Decided plan (APPROVED) — w091-demo-enable-encryption` (the seeded
  // parked-plan shape replaced; the plan's name preserved verbatim).
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  expect(executed.decidedPlanIds).toContain(PARKED_PLAN_ID);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Parked plan — w091-demo-enable-encryption",
      keywords: ["plan", "parked", "approval", "lock", "action", "encryption"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  expect(overlaid.length).toBe(1);
  const overlaidRecord = overlaid[0];
  if (overlaidRecord === undefined) throw new Error("unreachable");
  // The title is overlaid: `Parked plan — ` -> `Decided plan (APPROVED) — `.
  expect(overlaidRecord.title).toBe("Decided plan (APPROVED) — w091-demo-enable-encryption");
  // The keywords are EXTENDED by `decided` + the lowercase status.
  expect(overlaidRecord.keywords).toContain("decided");
  expect(overlaidRecord.keywords).toContain("approved");
  // The original keywords are preserved.
  expect(overlaidRecord.keywords).toContain("plan");
  expect(overlaidRecord.keywords).toContain("parked");
  expect(overlaidRecord.keywords).toContain("encryption");
  // The area + recordId are preserved (the search index's structural
  // identity is unchanged — only the label surface is overlaid).
  expect(overlaidRecord.area).toBe("actions");
  expect(overlaidRecord.recordId).toBe(PARKED_PLAN_ID);
});

test("W152 Fix 1 P1 — a REJECTED decision overlays the title with (REJECTED)", () => {
  // The same overlay applies for a REJECTED decision: the title becomes
  // `Decided plan (REJECTED) — <name>` + the keywords extended by
  // `decided` + `rejected`.
  const runtime = executeRejectDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Parked plan — w091-demo-enable-encryption",
      keywords: ["plan", "parked"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  expect(overlaid[0]?.title).toBe("Decided plan (REJECTED) — w091-demo-enable-encryption");
  expect(overlaid[0]?.keywords).toContain("decided");
  expect(overlaid[0]?.keywords).toContain("rejected");
});

test("W152 Fix 1 P1 — an unrecognized title shape gets the ` (decided: APPROVED)` suffix (never mangled)", () => {
  // The overlay NEVER mangles an unrecognized title: if the title does
  // not match the `Parked plan — ` shape, the suffix
  // ` (decided: APPROVED)` is appended instead (the original title
  // preserved verbatim).
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Action plan — w091-demo-enable-encryption",
      keywords: ["plan", "action"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  expect(overlaid[0]?.title).toBe("Action plan — w091-demo-enable-encryption (decided: APPROVED)");
  // The keywords are still extended.
  expect(overlaid[0]?.keywords).toContain("decided");
  expect(overlaid[0]?.keywords).toContain("approved");
});

test("W152 Fix 1 P1 — records NOT decided pass through with their original object identity preserved", () => {
  // The overlay preserves the original object identity for records NOT
  // decided (untouched records are NOT copied — referential equality
  // holds for the pass-through case).
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const otherRecord: ShellRecordSummary = Object.freeze({
    area: "actions",
    recordId: "pln_other_plan_001",
    title: "Parked plan — some-other-plan",
    keywords: ["plan", "parked"],
  });
  const nonActionsRecord: ShellRecordSummary = Object.freeze({
    area: "security",
    recordId: "fnd_demo_finding_01",
    title: "CRITICAL — Disk encryption disabled",
    keywords: ["critical", "security"],
  });
  // A `pln_fb564c1e` record with a non-`actions` area is NOT overlaid
  // (the overlay maps ONLY `area === "actions"` records).
  const sameIdDifferentArea: ShellRecordSummary = Object.freeze({
    area: "security",
    recordId: PARKED_PLAN_ID,
    title: "Parked plan — w091-demo-enable-encryption",
    keywords: ["plan", "parked"],
  });
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Parked plan — w091-demo-enable-encryption",
      keywords: ["plan", "parked"],
    },
    otherRecord,
    nonActionsRecord,
    sameIdDifferentArea,
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  // The decided record is overlaid (a NEW object).
  expect(overlaid[0]).not.toBe(records[0]);
  expect(overlaid[0]?.title).toBe("Decided plan (APPROVED) — w091-demo-enable-encryption");
  // The other `actions` record (NOT decided) is the SAME object.
  expect(overlaid[1]).toBe(otherRecord);
  // The `security` records (NOT `actions`) are the SAME objects.
  expect(overlaid[2]).toBe(nonActionsRecord);
  expect(overlaid[3]).toBe(sameIdDifferentArea);
});

test("W152 Fix 1 P1 — when no record matches the executed plan ids, the input array passes through unchanged", () => {
  // The overlay's no-op case: the executed-decision state is non-empty,
  // but no search-index record matches the decided plan ids. The input
  // array passes through with its original identity preserved.
  const runtime = executeApproveDecision("pln_some_other_plan");
  const executed = deriveExecutedDecisionState(runtime);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: "pln_yet_another_plan",
      title: "Parked plan — yet-another-plan",
      keywords: ["plan", "parked"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  expect(overlaid).toBe(records);
});

test("W152 Fix 1 P1 — duplicate keywords are deduped (the original tokens preserved, the new tokens appended once)", () => {
  // The overlay's keyword extension dedupes: if the original keywords
  // already include `decided` or the lowercase status, the duplicates
  // are NOT added (the original tokens preserved; the new tokens
  // appended at most once).
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const records: readonly ShellRecordSummary[] = [
    {
      area: "actions",
      recordId: PARKED_PLAN_ID,
      title: "Parked plan — w091-demo-enable-encryption",
      keywords: ["plan", "parked", "decided", "approved", "decided"],
    },
  ];
  const overlaid = overlaySearchRecordsWithExecutedDecisions(records, executed);
  if (overlaid[0] === undefined) throw new Error("unreachable");
  // `decided` and `approved` appear exactly once each (deduped).
  const decidedCount = overlaid[0].keywords.filter((k) => k === "decided").length;
  const approvedCount = overlaid[0].keywords.filter((k) => k === "approved").length;
  expect(decidedCount).toBe(1);
  expect(approvedCount).toBe(1);
});

// ---------------------------------------------------------------------------
// P2 — the wiring (the AppShell's search records reflect the overlay)
// ---------------------------------------------------------------------------

test("W152 Fix 1 P2 — the demo's composed search records include the seeded parked-plan record (the overlay's input)", () => {
  // The demo's `composeConsoleAreas` produces a search-index that
  // INCLUDES the seeded parked-plan record (the overlay's input). This
  // test pins the input shape so the overlay's wiring test (P2b) has a
  // stable fixture.
  const baseline = composeConsoleAreas(
    DEMO_TENANT,
    "owner" as never,
    undefined,
    undefined,
  );
  expect(baseline.ok).toBe(true);
  if (!baseline.ok) return;
  const parkedRecord = baseline.view.searchRecords.find(
    (r) => r.area === "actions" && r.recordId === PARKED_PLAN_ID,
  );
  expect(parkedRecord).toBeDefined();
  if (parkedRecord === undefined) return;
  expect(parkedRecord.title).toBe("Parked plan — w091-demo-enable-encryption");
});

test("W152 Fix 1 P2 (a) — the overlay applied to the demo's composed search records overlays the decided plan's title", () => {
  // The wiring-site composition (the same code path console-app.tsx
  // runs in the `searchRecords` memo): the demo's composed search
  // records + the executed-decision state -> the overlaid array. The
  // decided plan's title is overlaid; the other records pass through.
  const baseline = composeConsoleAreas(
    DEMO_TENANT,
    "owner" as never,
    undefined,
    undefined,
  );
  expect(baseline.ok).toBe(true);
  if (!baseline.ok) return;
  // No executed decisions: the overlay is a no-op (referential equality).
  const emptyState = deriveExecutedDecisionState(createApprovalDecisionRuntime());
  const noOverlay = overlaySearchRecordsWithExecutedDecisions(
    baseline.view.searchRecords,
    emptyState,
  );
  expect(noOverlay).toBe(baseline.view.searchRecords);
  // After an Approve execution: the parked-plan record's title is overlaid.
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const overlaid = overlaySearchRecordsWithExecutedDecisions(
    baseline.view.searchRecords,
    executed,
  );
  const overlaidParked = overlaid.find(
    (r) => r.area === "actions" && r.recordId === PARKED_PLAN_ID,
  );
  expect(overlaidParked).toBeDefined();
  if (overlaidParked === undefined) return;
  expect(overlaidParked.title).toBe("Decided plan (APPROVED) — w091-demo-enable-encryption");
  expect(overlaidParked.keywords).toContain("decided");
  expect(overlaidParked.keywords).toContain("approved");
  // The other records (the approved-plan record, the finding, the
  // policy, etc.) pass through with their original titles.
  const approvedRecord = overlaid.find(
    (r) => r.area === "actions" && r.recordId !== PARKED_PLAN_ID,
  );
  if (approvedRecord !== undefined) {
    // The approved-plan record (a non-decided record) keeps its
    // original `Approved plan — ` title (NOT overlaid).
    expect(approvedRecord.title.startsWith("Approved plan — ")).toBe(true);
  }
});

test("W152 Fix 1 P2 (b) — the overlaid record is discoverable via the extended keywords (Ctrl+K `decided` / `approved`)", () => {
  // The R2 residual's verbatim report: after the approve execution,
  // Ctrl+K `pln_fb564c1e` returned the seeded `Parked plan — ` title.
  // The overlay's keywords extension ensures the record is discoverable
  // via `decided` + the lowercase status (so a search for `decided` or
  // `approved` surfaces the overlaid record — the propagation's
  // surface-truth).
  const baseline = composeConsoleAreas(
    DEMO_TENANT,
    "owner" as never,
    undefined,
    undefined,
  );
  if (!baseline.ok) return;
  const runtime = executeApproveDecision(PARKED_PLAN_ID);
  const executed = deriveExecutedDecisionState(runtime);
  const overlaid = overlaySearchRecordsWithExecutedDecisions(
    baseline.view.searchRecords,
    executed,
  );
  // The overlaid record is discoverable via `decided` (the seeded
  // `Approved plan — ` record does NOT carry `decided` — only the
  // overlaid record does).
  const byDecided = overlaid.filter((r) => r.keywords.includes("decided"));
  expect(byDecided.length).toBe(1);
  expect(byDecided[0]?.recordId).toBe(PARKED_PLAN_ID);
  // The overlaid record is discoverable via `approved` (the seeded
  // `Approved plan — ` record also carries `approved` — both surface;
  // the overlaid record is one of them).
  const byApproved = overlaid.filter((r) => r.keywords.includes("approved"));
  expect(byApproved.length).toBeGreaterThanOrEqual(1);
  expect(byApproved.some((r) => r.recordId === PARKED_PLAN_ID)).toBe(true);
  // The overlaid record is still discoverable via the original keywords.
  const byPlan = overlaid.filter((r) => r.keywords.includes("plan"));
  expect(byPlan.some((r) => r.recordId === PARKED_PLAN_ID)).toBe(true);
});
