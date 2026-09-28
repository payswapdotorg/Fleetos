/**
 * @fleetos/web-actions module test — the public surface markers and a
 * smoke derivation (every public builder is pure, tagged and frozen).
 */

import { test, expect } from "bun:test";
import {
  DECISION_TO_PLAN_STATUS,
  MODULE_NAME,
  MODULE_VERSION,
  PLAN_TRANSITIONS,
  TERMINAL_PLAN_STATUSES,
  buildActionPlanView,
  buildGroupSelectionView,
  buildPlanProgressionView,
  buildPrintRoutingView,
  isBlockingDecisionView,
} from "./index";

test("the actions surface exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("web-actions");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the surface's frozen tables are frozen (machine-stable data, not control flow)", () => {
  expect(Object.isFrozen(PLAN_TRANSITIONS)).toBe(true);
  expect(Object.isFrozen(TERMINAL_PLAN_STATUSES)).toBe(true);
  expect(Object.isFrozen(DECISION_TO_PLAN_STATUS)).toBe(true);
});

test("every public builder returns a tagged result (never throws on valid input)", () => {
  const scope = { tenantId: "tnt_modulesmoke" as never };
  expect(buildGroupSelectionView(scope, { kind: "all" }, []).ok).toBe(true);
  expect(buildPlanProgressionView(scope, []).ok).toBe(false); // empty history refuses
  expect(isBlockingDecisionView("BLOCK")).toBe(true);
});

test("an invalid scope refuses every builder (fail-closed, tagged)", () => {
  const scope = { tenantId: "" as never };
  expect(buildActionPlanView(scope, {} as never).ok).toBe(false);
  expect(buildGroupSelectionView(scope, { kind: "all" }, []).ok).toBe(false);
  expect(buildPrintRoutingView(scope, {} as never).ok).toBe(false);
});
