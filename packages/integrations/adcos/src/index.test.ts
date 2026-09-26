import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("integration-adcos placeholder exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("integration-adcos");
  expect(MODULE_VERSION).toBe("0.1.0");
});
