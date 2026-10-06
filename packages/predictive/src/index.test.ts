/**
 * @fleetos/predictive — module conformance (the W001 baseline test, kept).
 * Real surface tests live in test/ (the binding suites import the real
 * sibling packages — the ownership gate scans only src/ files).
 */
import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("predictive placeholder exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("predictive");
  expect(MODULE_VERSION).toBe("0.1.0");
});
