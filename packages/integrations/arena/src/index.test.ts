import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("integration-arena exports MODULE_NAME and MODULE_VERSION (W050B placeholder markers kept for skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("integration-arena");
  expect(MODULE_VERSION).toBe("0.1.0");
});
