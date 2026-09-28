/**
 * @fleetos/web-security module test — the public surface markers and a
 * smoke derivation (every public builder is pure, tagged and frozen).
 */

import { test, expect } from "bun:test";
import {
  APPROVAL_QUEUE_TRANSITIONS,
  DECISION_PRECEDENCE_RANK_VIEW,
  MODULE_NAME,
  MODULE_VERSION,
  SURFACE_SEVERITY_RANK,
  buildApprovalsQueueView,
  buildBlockHistoryView,
  buildFindingsListView,
  isBlockingDecisionView,
  presentGuardianDecision,
} from "./index";

test("the security surface exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("web-security");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the surface's frozen tables are frozen (machine-stable data, not control flow)", () => {
  expect(Object.isFrozen(SURFACE_SEVERITY_RANK)).toBe(true);
  expect(Object.isFrozen(DECISION_PRECEDENCE_RANK_VIEW)).toBe(true);
  expect(Object.isFrozen(APPROVAL_QUEUE_TRANSITIONS)).toBe(true);
});

test("every public builder returns a tagged result (never throws on valid input)", () => {
  const scope = { tenantId: "tnt_modulesmoke" as never };
  expect(buildFindingsListView(scope, []).ok).toBe(true);
  expect(buildBlockHistoryView(scope, []).ok).toBe(true);
  expect(buildApprovalsQueueView(scope, []).ok).toBe(true);
  expect(isBlockingDecisionView("ALLOW")).toBe(false);
});

test("presentGuardianDecision requires an evaluation record (tagged refusal on malformed input)", () => {
  const result = presentGuardianDecision({ tenantId: "tnt_modulesmoke" as never }, {} as never);
  expect(result.ok).toBe(false);
});
