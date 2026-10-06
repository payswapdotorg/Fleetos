/**
 * @fleetos/predictive — the W001 placeholder module test (required by
 * tools/verify-skeleton.mjs). The real lane tests live under
 * `packages/predictive/test/` (the W070 pattern: per-concern test files
 * alongside the contract-conformance test).
 */
import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("the predictive module markers are exported (the skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("predictive");
  expect(MODULE_VERSION).toBe("0.1.0");
});
