import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION, SHELL_AREA_ORDER, shellRouteTable } from "./index";

test("web-shell module identity is frozen", () => {
  expect(MODULE_NAME).toBe("web-shell");
  expect(MODULE_VERSION).toBe("0.2.0");
});

test("the canonical area order covers exactly the TEN console areas (W091 final vocabulary)", () => {
  expect(SHELL_AREA_ORDER).toHaveLength(10);
  expect(SHELL_AREA_ORDER).toEqual([
    "overview",
    "device",
    "recovery",
    "security",
    "policies",
    "actions",
    "workloads",
    "commerce",
    "evidence",
    "learning",
  ]);
  expect(shellRouteTable().length).toBeGreaterThan(0);
});
