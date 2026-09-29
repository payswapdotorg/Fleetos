/**
 * @fleetos/web-shell — the navigation model (the Control Tower's spine).
 *
 * Routes are frozen shapes: { area, view }. The area/view vocabularies
 * are closed unions validated at runtime with machine-stable refusal
 * codes — an unknown area or view NEVER renders, it refuses. The
 * canonical section order, the per-area view sets, and the breadcrumb
 * labels are frozen constants: two independent derivations over the
 * same route yield byte-identical results.
 *
 * W091 [TL] — the FINAL route vocabulary per spec/ui/CONSOLE-DESIGN.md:
 * TEN top-level areas; Devices gains the enrollment/onboarding entry
 * point; Security gains the Security Doctor view; the Commerce tree is
 * complete (Procurement, Software, Vendors, Maintenance, Connectivity,
 * Communication); Policies, Evidence & Audit and Learning are
 * first-class areas. The area labels use the design contract's
 * operator-facing names (not slugs) via SHELL_AREA_LABELS.
 */
import type { ShellSurfaceArea, ShellSurfaceDescriptor } from "./seams";
import { compareStrings, frozen, frozenArray, titleFromSlug } from "./internal";

/** The canonical Control Tower section order (machine-stable, 10 areas). */
export const SHELL_AREA_ORDER: readonly ShellSurfaceArea[] = frozenArray([
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

/** The frozen per-area view vocabulary (route targets per surface). */
export const SHELL_AREA_VIEWS: Readonly<Record<ShellSurfaceArea, readonly string[]>> = frozen({
  overview: frozenArray(["home", "activity"]),
  device: frozenArray(["list", "doctor", "lifecycle", "enrollment"]),
  recovery: frozenArray(["cases", "find-my", "destructive"]),
  security: frozenArray(["findings", "decisions", "approvals", "doctor"]),
  policies: frozenArray(["list"]),
  actions: frozenArray(["plans", "print"]),
  workloads: frozenArray(["planning", "recommendations"]),
  commerce: frozenArray([
    "procurement",
    "software",
    "vendors",
    "maintenance",
    "connectivity",
    "communication",
  ]),
  evidence: frozenArray(["trail"]),
  learning: frozenArray(["cases", "adoption"]),
});

/**
 * The operator-facing area labels (the design contract's top-level
 * names — e.g. "Evidence & Audit", not "Evidence"). Frozen total map.
 */
export const SHELL_AREA_LABELS: Readonly<Record<ShellSurfaceArea, string>> = frozen({
  overview: "Control Tower",
  device: "Devices",
  recovery: "Recovery",
  security: "Security",
  policies: "Policies",
  actions: "Fleet Actions",
  workloads: "Workloads",
  commerce: "Commerce",
  evidence: "Evidence & Audit",
  learning: "Learning",
});

/** The operator-facing view labels (frozen, human-readable). */
export const SHELL_VIEW_LABELS: Readonly<Record<string, string>> = frozen({
  "overview.home": "Home",
  "overview.activity": "Recent activity",
  "device.list": "Fleet list",
  "device.doctor": "Device Doctor",
  "device.lifecycle": "Lifecycle",
  "device.enrollment": "Enroll fleet",
  "recovery.cases": "Recovery cases",
  "recovery.find-my": "Find My Device",
  "recovery.destructive": "Destructive actions",
  "security.findings": "Findings",
  "security.decisions": "Guardian decisions",
  "security.approvals": "Approvals",
  "security.doctor": "Security Doctor",
  "policies.list": "Policies",
  "actions.plans": "Action plans",
  "actions.print": "Print",
  "workloads.planning": "Planning",
  "workloads.recommendations": "Recommendations",
  "commerce.procurement": "Procurement",
  "commerce.software": "Software",
  "commerce.vendors": "Vendors",
  "commerce.maintenance": "Maintenance",
  "commerce.connectivity": "Connectivity",
  "commerce.communication": "Communication",
  "evidence.trail": "Evidence trail",
  "learning.cases": "Evaluation cases",
  "learning.adoption": "Adoption & certification",
});

/** Operator-facing label for a route (area + view; frozen derivation). */
export function labelForRoute(area: ShellSurfaceArea, view: string): string {
  const key = `${area}.${view}`;
  const specific = SHELL_VIEW_LABELS[key];
  if (typeof specific === "string") return specific;
  return titleFromSlug(view);
}

/** A shell route: area + view. The complete navigation address. */
export interface ShellRoute {
  readonly area: ShellSurfaceArea;
  readonly view: string;
}

/** A navigation section (the sidebar model). */
export interface ShellSection {
  readonly area: ShellSurfaceArea;
  readonly label: string;
  readonly views: readonly string[];
}

export type ShellRouteCheck =
  | { readonly ok: true; readonly route: ShellRoute }
  | {
      readonly ok: false;
      readonly reason: "unknown_area" | "unknown_view" | "invalid_route";
      readonly area?: string;
      readonly view?: string;
    };

/** Validate a candidate route (unknown grammar refuses — never renders). */
export function validateShellRoute(area: unknown, view: unknown): ShellRouteCheck {
  if (typeof area !== "string" || typeof view !== "string") {
    return { ok: false, reason: "invalid_route" };
  }
  if (!(SHELL_AREA_ORDER as readonly string[]).includes(area)) {
    return { ok: false, reason: "unknown_area", area };
  }
  const views = SHELL_AREA_VIEWS[area as ShellSurfaceArea];
  if (!(views as readonly string[]).includes(view)) {
    return { ok: false, reason: "unknown_view", area, view };
  }
  return { ok: true, route: { area: area as ShellSurfaceArea, view } };
}

/** The sidebar sections in canonical order (frozen output). */
export function shellSections(): readonly ShellSection[] {
  return frozenArray(
    SHELL_AREA_ORDER.map((area) => ({
      area,
      label: SHELL_AREA_LABELS[area],
      views: SHELL_AREA_VIEWS[area],
    })),
  );
}

/** A breadcrumb crumb. */
export interface ShellCrumb {
  readonly area: ShellSurfaceArea;
  readonly view: string;
  readonly label: string;
}

/** Derive breadcrumbs for a route: [Area, Area / View]. Frozen output. */
export function breadcrumbsFor(route: ShellRoute): readonly ShellCrumb[] {
  const areaLabel = SHELL_AREA_LABELS[route.area];
  const crumbs: ShellCrumb[] = [
    { area: route.area, view: route.view, label: areaLabel },
  ];
  const viewLabel = labelForRoute(route.area, route.view);
  if (viewLabel.length > 0 && viewLabel.toLowerCase() !== areaLabel.toLowerCase()) {
    crumbs.push({ area: route.area, view: route.view, label: `${areaLabel} / ${viewLabel}` });
  }
  return frozenArray(crumbs);
}

/** Machine-stable route ordering key: area index, then view. */
export function compareShellRoutes(a: ShellRoute, b: ShellRoute): number {
  const areaDelta = (SHELL_AREA_ORDER as readonly string[]).indexOf(a.area) -
    (SHELL_AREA_ORDER as readonly string[]).indexOf(b.area);
  if (areaDelta !== 0) return areaDelta;
  return compareStrings(a.view, b.view);
}

/** All valid routes in canonical order (the complete route table). */
export function shellRouteTable(): readonly ShellRoute[] {
  const routes: ShellRoute[] = [];
  for (const area of SHELL_AREA_ORDER) {
    for (const view of SHELL_AREA_VIEWS[area]) {
      routes.push({ area, view });
    }
  }
  return frozenArray(routes.sort(compareShellRoutes));
}

/**
 * Check that a bound surface descriptor's area/views agree with the
 * frozen navigation vocabulary (the binding-site integrity check — the
 * REAL descriptors must never drift from the shell's route table).
 */
export type SurfaceVocabularyCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unknown_area" | "unknown_view" | "empty_views";
      readonly moduleName: string;
      readonly view?: string;
    };

export function checkSurfaceVocabulary(descriptor: ShellSurfaceDescriptor): SurfaceVocabularyCheck {
  if (!(SHELL_AREA_ORDER as readonly string[]).includes(descriptor.area)) {
    return { ok: false, reason: "unknown_area", moduleName: descriptor.moduleName };
  }
  if (descriptor.views.length === 0) {
    return { ok: false, reason: "empty_views", moduleName: descriptor.moduleName };
  }
  const allowed = SHELL_AREA_VIEWS[descriptor.area];
  for (const view of descriptor.views) {
    if (!(allowed as readonly string[]).includes(view)) {
      return { ok: false, reason: "unknown_view", moduleName: descriptor.moduleName, view };
    }
  }
  return { ok: true };
}
