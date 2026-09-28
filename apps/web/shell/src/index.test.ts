import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION, SHELL_AREA_ORDER, shellRouteTable } from "./index";

test("web-shell module identity is frozen", () => {
  expect(MODULE_NAME).toBe("web-shell");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the canonical area order covers exactly the seven surfaces", () => {
  expect(SHELL_AREA_ORDER).toHaveLength(7);
  expect(shellRouteTable().length).toBeGreaterThan(0);
});
