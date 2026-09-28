/**
 * @fleetos/web-shell — the permission model (who may see and do what).
 *
 * Frozen role union, frozen visibility/interaction matrices, machine-
 * stable refusal codes. The console is read-mostly: every role may
 * OBSERVE every non-destructive surface; interactions escalate by role.
 * The human-approval discipline of the domain (REQUIRE_APPROVAL parks,
 * destructive gates) is mirrored here: only approvers reach the
 * approvals surface, only owners reach the destructive surface.
 */
import type { ShellRoute } from "./navigation";
import { SHELL_AREA_VIEWS } from "./navigation";
import type { ShellSurfaceArea } from "./seams";
import { frozen } from "./internal";

/** The frozen operator role union. */
export type ShellOperatorRole = "owner" | "operator" | "approver" | "auditor" | "viewer";

export const SHELL_ROLES: readonly ShellOperatorRole[] = ["approver", "auditor", "operator", "owner", "viewer"];

/** The interaction kinds the shell may gate. */
export type ShellInteraction =
  | "observe"
  | "propose"
  | "approve"
  | "dispatch"
  | "destructive";

/** The frozen navigation matrix: role -> areas whose views are navigable. */
export const SHELL_NAVIGATION_MATRIX: Readonly<
  Record<ShellOperatorRole, readonly ShellSurfaceArea[] | "all-except-destructive">
> = frozen({
  owner: "all-except-destructive" as const,
  approver: "all-except-destructive" as const,
  operator: "all-except-destructive" as const,
  auditor: "all-except-destructive" as const,
  viewer: "all-except-destructive" as const,
});

/** The frozen interaction matrix: role -> permitted interactions. */
export const SHELL_INTERACTION_MATRIX: Readonly<Record<ShellOperatorRole, readonly ShellInteraction[]>> = frozen({
  viewer: ["observe"],
  auditor: ["observe"],
  operator: ["observe", "propose", "dispatch"],
  approver: ["observe", "propose", "dispatch", "approve"],
  owner: ["observe", "propose", "dispatch", "approve", "destructive"],
});

export type NavigationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "role_forbidden"; readonly role: ShellOperatorRole; readonly area: ShellSurfaceArea };

/** May this role navigate to this route? Machine-stable refusal. */
export function canNavigate(role: ShellOperatorRole, route: ShellRoute): NavigationCheck {
  // The destructive surface is owner-only — the W040/W060 discipline.
  if (route.area === "recovery" && route.view === "destructive" && role !== "owner") {
    return { ok: false, reason: "role_forbidden", role, area: route.area };
  }
  return { ok: true };
}

export type InteractionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "interaction_forbidden"; readonly role: ShellOperatorRole; readonly interaction: ShellInteraction };

/** May this role perform this interaction? Machine-stable refusal. */
export function canInteract(role: ShellOperatorRole, interaction: ShellInteraction): InteractionCheck {
  const allowed = SHELL_INTERACTION_MATRIX[role];
  if (!(allowed as readonly string[]).includes(interaction)) {
    return { ok: false, reason: "interaction_forbidden", role, interaction };
  }
  return { ok: true };
}

/** The views a role may navigate within an area (machine-stable). */
export function navigableViews(role: ShellOperatorRole, area: ShellSurfaceArea): readonly string[] {
  const views = SHELL_AREA_VIEWS[area];
  return views.filter((view) => canNavigate(role, { area, view }).ok);
}

/** A permission summary for the role (frozen; used by the header surface). */
export interface ShellPermissionSummary {
  readonly role: ShellOperatorRole;
  readonly interactions: readonly ShellInteraction[];
  readonly restrictedViews: readonly ShellRoute[];
}

/** Derive the role's permission summary (all restricted views enumerated). */
export function permissionSummaryFor(role: ShellOperatorRole): ShellPermissionSummary {
  const restricted: ShellRoute[] = [];
  for (const area of Object.keys(SHELL_AREA_VIEWS) as ShellSurfaceArea[]) {
    for (const view of SHELL_AREA_VIEWS[area]) {
      if (!canNavigate(role, { area, view }).ok) {
        restricted.push({ area, view });
      }
    }
  }
  return {
    role,
    interactions: SHELL_INTERACTION_MATRIX[role],
    restrictedViews: restricted,
  };
}
