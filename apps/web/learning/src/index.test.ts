/**
 * @fleetos/web-learning module test — the public surface markers and a
 * smoke derivation (every public builder is pure, tagged and frozen).
 */

import { test, expect } from "bun:test";
import {
  ALL_ADOPTION_STATUSES,
  ALL_EVALUATION_DISPOSITIONS,
  ALL_LEARNING_SOURCE_SURFACES,
  ALL_REDACTION_STATES,
  ALL_ROLLOUT_KINDS,
  LEARNING_PANELS,
  MODULE_NAME,
  MODULE_VERSION,
  buildAdoptionLedgerView,
  buildEvaluationCasesView,
  buildOutcomeFeedView,
} from "./index";

test("the learning surface exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("web-learning");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the surface's frozen vocabularies are frozen (machine-stable data)", () => {
  expect(Object.isFrozen(ALL_LEARNING_SOURCE_SURFACES)).toBe(true);
  expect(Object.isFrozen(ALL_EVALUATION_DISPOSITIONS)).toBe(true);
  expect(Object.isFrozen(ALL_REDACTION_STATES)).toBe(true);
  expect(Object.isFrozen(ALL_ADOPTION_STATUSES)).toBe(true);
  expect(Object.isFrozen(ALL_ROLLOUT_KINDS)).toBe(true);
  expect(Object.isFrozen(LEARNING_PANELS)).toBe(true);
});

test("every public builder returns a tagged result (never throws on valid input)", () => {
  const scope = { tenantId: "tnt_modulesmoke" as never };
  expect(buildOutcomeFeedView(scope, []).ok).toBe(true);
  expect(buildEvaluationCasesView(scope, []).ok).toBe(true);
  expect(buildAdoptionLedgerView(scope, []).ok).toBe(true);
});

test("the builders refuse an invalid scope with a tagged error (fail-closed)", () => {
  const result = buildOutcomeFeedView({ tenantId: "" as never }, []);
  expect(result.ok).toBe(false);
});
