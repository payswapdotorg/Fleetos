import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("the world-model module markers are exported (the skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("world-model");
  expect(MODULE_VERSION).toBe("0.1.0");
});
