import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("health placeholder exports MODULE_NAME and MODULE_VERSION", () => {
  expect(MODULE_NAME).toBe("health");
  expect(MODULE_VERSION).toBe("0.1.0");
});
