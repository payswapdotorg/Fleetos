import { test, expect } from "bun:test";
import {
  SHELL_INTERACTION_MATRIX,
  SHELL_ROLES,
  canInteract,
  canNavigate,
  navigableViews,
  permissionSummaryFor,
} from "../src/permissions";
import { SHELL_AREA_VIEWS } from "../src/navigation";

test("the role union is frozen and machine-stably ordered", () => {
  expect([...SHELL_ROLES]).toEqual(["approver", "auditor", "operator", "owner", "viewer"]);
});

test("every role navigates every surface EXCEPT recovery/destructive (owner-only)", () => {
  for (const role of SHELL_ROLES) {
    for (const area of Object.keys(SHELL_AREA_VIEWS) as (keyof typeof SHELL_AREA_VIEWS)[]) {
      for (const view of SHELL_AREA_VIEWS[area]) {
        const check = canNavigate(role, { area, view });
        if (area === "recovery" && view === "destructive") {
          if (role === "owner") {
            expect(check.ok).toBe(true);
          } else {
            expect(check).toEqual({
              ok: false,
              reason: "role_forbidden",
              role,
              area: "recovery",
            });
          }
        } else {
          expect(check.ok).toBe(true);
        }
      }
    }
  }
});

test("the interaction matrix escalates monotonically viewer -> owner", () => {
  expect([...SHELL_INTERACTION_MATRIX.viewer]).toEqual(["observe"]);
  expect([...SHELL_INTERACTION_MATRIX.auditor]).toEqual(["observe"]);
  expect(SHELL_INTERACTION_MATRIX.operator).toContain("propose");
  expect(SHELL_INTERACTION_MATRIX.approver).toContain("approve");
  expect([...SHELL_INTERACTION_MATRIX.owner]).toContain("destructive");
  for (const interaction of SHELL_INTERACTION_MATRIX.approver) {
    expect(SHELL_INTERACTION_MATRIX.owner).toContain(interaction);
  }
});

test("canInteract refuses machine-stably", () => {
  expect(canInteract("viewer", "propose")).toEqual({
    ok: false,
    reason: "interaction_forbidden",
    role: "viewer",
    interaction: "propose",
  });
  expect(canInteract("approver", "destructive")).toEqual({
    ok: false,
    reason: "interaction_forbidden",
    role: "approver",
    interaction: "destructive",
  });
  expect(canInteract("owner", "destructive").ok).toBe(true);
});

test("navigableViews filters the destructive view for non-owners", () => {
  expect(navigableViews("viewer", "recovery")).toEqual(["cases", "find-my"]);
  expect(navigableViews("owner", "recovery")).toEqual(["cases", "find-my", "destructive"]);
});

test("permission summaries enumerate restricted views exactly", () => {
  const viewer = permissionSummaryFor("viewer");
  expect(viewer.restrictedViews).toEqual([{ area: "recovery", view: "destructive" }]);
  const owner = permissionSummaryFor("owner");
  expect(owner.restrictedViews).toEqual([]);
  expect(owner.interactions).toContain("destructive");
});
