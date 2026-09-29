import { test, expect } from "bun:test";
import {
  SHELL_AREA_ORDER,
  SHELL_AREA_VIEWS,
  breadcrumbsFor,
  compareShellRoutes,
  shellRouteTable,
  shellSections,
  validateShellRoute,
  checkSurfaceVocabulary,
} from "../src/navigation";
import type { ShellSurfaceDescriptor } from "../src/seams";

test("the canonical area order is frozen and machine-stable", () => {
  expect([...SHELL_AREA_ORDER]).toEqual([
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
  expect(Object.isFrozen(SHELL_AREA_ORDER)).toBe(true);
});

test("every area has a non-empty frozen view vocabulary", () => {
  for (const area of SHELL_AREA_ORDER) {
    const views = SHELL_AREA_VIEWS[area];
    expect(views.length).toBeGreaterThan(0);
    expect(Object.isFrozen(views)).toBe(true);
  }
});

test("valid routes validate; unknown area/view refuse machine-stably", () => {
  expect(validateShellRoute("device", "list")).toEqual({ ok: true, route: { area: "device", view: "list" } });
  expect(validateShellRoute("nonsense", "list")).toEqual({
    ok: false,
    reason: "unknown_area",
    area: "nonsense",
  });
  expect(validateShellRoute("device", "nonsense")).toEqual({
    ok: false,
    reason: "unknown_view",
    area: "device",
    view: "nonsense",
  });
  expect(validateShellRoute(42, "list")).toEqual({ ok: false, reason: "invalid_route" });
});

test("sections derive in canonical order with title-cased labels", () => {
  const sections = shellSections();
  expect(sections.map((s) => s.area)).toEqual([...SHELL_AREA_ORDER]);
  expect(sections[0]!.label).toBe("Control Tower");
  expect(sections[1]!.label).toBe("Devices");
  expect(sections[7]!.label).toBe("Commerce");
  expect(sections[8]!.label).toBe("Evidence & Audit");
  expect(Object.isFrozen(sections)).toBe(true);
});

test("breadcrumbs: single crumb when view maps to the area label; two otherwise", () => {
  const home = breadcrumbsFor({ area: "overview", view: "home" });
  expect(home).toHaveLength(2);
  expect(home[0]!.label).toBe("Control Tower");
  expect(home[1]!.label).toBe("Control Tower / Home");
  const single = breadcrumbsFor({ area: "actions", view: "plans" });
  expect(single).toHaveLength(2);
});

test("route ordering is total and machine-stable", () => {
  const a = { area: "device" as const, view: "doctor" };
  const b = { area: "device" as const, view: "list" };
  const c = { area: "security" as const, view: "findings" };
  expect(compareShellRoutes(a, b)).toBeLessThan(0); // doctor < list (total string order)
  expect(compareShellRoutes(a, c)).toBeLessThan(0); // device < security (canonical area order)
  expect(compareShellRoutes(b, a)).toBeGreaterThan(0);
  expect(compareShellRoutes(a, a)).toBe(0);
});

test("the route table is complete, frozen, and canonically ordered", () => {
  const table = shellRouteTable();
  const expected = SHELL_AREA_ORDER.reduce<number>((acc, area) => acc + SHELL_AREA_VIEWS[area].length, 0);
  expect(table).toHaveLength(expected);
  expect(Object.isFrozen(table)).toBe(true);
  const sorted = [...table].sort(compareShellRoutes);
  expect(table).toEqual(sorted);
});

test("surface vocabulary check refuses drift from the route vocabulary", () => {
  const good: ShellSurfaceDescriptor = {
    moduleName: "web-device",
    area: "device",
    views: ["list", "doctor", "lifecycle"],
    recordKinds: ["device.row"],
  };
  expect(checkSurfaceVocabulary(good)).toEqual({ ok: true });
  expect(checkSurfaceVocabulary({ ...good, views: ["list", "nope"] })).toEqual({
    ok: false,
    reason: "unknown_view",
    moduleName: "web-device",
    view: "nope",
  });
  expect(checkSurfaceVocabulary({ ...good, area: "nonsense" as "device" })).toEqual({
    ok: false,
    reason: "unknown_area",
    moduleName: "web-device",
  });
  expect(checkSurfaceVocabulary({ ...good, views: [] })).toEqual({
    ok: false,
    reason: "empty_views",
    moduleName: "web-device",
  });
});
