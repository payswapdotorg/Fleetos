/**
 * @fleetos/web-shell — cross-surface journeys (the Control Tower's glue).
 *
 * A journey is a frozen sequence of steps, each citing a shell area, a
 * view in that area's vocabulary, a record kind the surface presents,
 * and a purpose. Journeys are DESCRIPTIVE (navigation + discoverability
 * affordances) — they never mutate FleetOS truth and never bypass a
 * domain gate; the domain's own PROPOSAL/approval machinery remains the
 * single source of consequential truth.
 */
import type { ShellRoute } from "./navigation";
import { SHELL_AREA_VIEWS, validateShellRoute } from "./navigation";
import type { ShellSurfaceArea } from "./seams";
import { canonicalJson, fnv1a, frozenArray } from "./internal";

/** The purpose a journey step serves (frozen union). */
export type JourneyStepPurpose = "observe" | "prepare" | "approve" | "dispatch" | "verify";

/** One journey step. */
export interface JourneyStep {
  readonly area: ShellSurfaceArea;
  readonly view: string;
  /** The record kind this step operates on (surface vocabulary). */
  readonly recordKind: string;
  readonly purpose: JourneyStepPurpose;
}

/** A cross-surface journey descriptor. */
export interface JourneyDescriptor {
  readonly journeyId: string;
  readonly title: string;
  readonly steps: readonly JourneyStep[];
}

export type JourneyCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "invalid_step_route" | "empty_steps" | "duplicate_journey_id";
      readonly stepIndex?: number;
    };

/** Validate a journey descriptor against the route vocabulary. */
export function checkJourneyDescriptor(descriptor: JourneyDescriptor): JourneyCheck {
  if (descriptor.steps.length === 0) return { ok: false, reason: "empty_steps" };
  for (let i = 0; i < descriptor.steps.length; i += 1) {
    const step = descriptor.steps[i]!;
    const routeCheck = validateShellRoute(step.area, step.view);
    if (!routeCheck.ok) return { ok: false, reason: "invalid_step_route", stepIndex: i };
  }
  return { ok: true };
}

/** Deterministic journey digest over the canonical descriptor form. */
export function journeyDigest(descriptor: JourneyDescriptor): string {
  return fnv1a(
    canonicalJson({
      journeyId: descriptor.journeyId,
      steps: descriptor.steps.map((s) => ({
        area: s.area,
        view: s.view,
        recordKind: s.recordKind,
        purpose: s.purpose,
      })),
    }),
  );
}

/**
 * The built-in journeys (frozen). Each mirrors a domain flow the
 * surfaces already present — the shell's cross-surface composition of
 * the established W031/W040/W041/W042/W050 flows.
 */
export const BUILTIN_JOURNEYS: readonly JourneyDescriptor[] = frozenArray([
  {
    journeyId: "remediate-finding",
    title: "Remediate a Security Finding",
    steps: [
      { area: "security", view: "findings", recordKind: "security.finding", purpose: "observe" },
      { area: "actions", view: "plans", recordKind: "action.plan", purpose: "prepare" },
      { area: "security", view: "approvals", recordKind: "approval.parked", purpose: "approve" },
      { area: "actions", view: "plans", recordKind: "action.plan.progress", purpose: "verify" },
    ],
  },
  {
    journeyId: "service-device",
    title: "Service an Unhealthy Device",
    steps: [
      { area: "device", view: "doctor", recordKind: "device.doctor", purpose: "observe" },
      { area: "commerce", view: "maintenance", recordKind: "maintenance.work-order", purpose: "prepare" },
      { area: "commerce", view: "procurement", recordKind: "procurement.match", purpose: "verify" },
    ],
  },
  {
    journeyId: "recover-lost-device",
    title: "Recover a Lost Device",
    steps: [
      { area: "device", view: "list", recordKind: "device.row", purpose: "observe" },
      { area: "recovery", view: "find-my", recordKind: "recovery.find-my", purpose: "verify" },
      { area: "recovery", view: "cases", recordKind: "recovery.case", purpose: "prepare" },
    ],
  },
  {
    journeyId: "onboard-connectivity",
    title: "Onboard Workload Connectivity",
    steps: [
      { area: "workloads", view: "planning", recordKind: "workload.plan", purpose: "observe" },
      { area: "commerce", view: "connectivity", recordKind: "connectivity.request", purpose: "prepare" },
      { area: "commerce", view: "communication", recordKind: "communication.summary", purpose: "verify" },
    ],
  },
]);

/** Journey progress over completed steps (machine-stable derivation). */
export interface JourneyProgress {
  readonly journeyId: string;
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly remainingSteps: readonly JourneyStep[];
  readonly nextStep: JourneyStep | null;
  readonly complete: boolean;
  /** Steps reported complete but not part of the journey (ignored, surfaced). */
  readonly ignoredStepKinds: readonly string[];
}

/**
 * Derive journey progress from the set of completed record kinds.
 * Unknown/duplicate completions are ignored but surfaced — never an
 * error, never a reordering of the frozen step sequence.
 */
export function journeyProgress(
  descriptor: JourneyDescriptor,
  completedRecordKinds: readonly string[],
): JourneyProgress {
  const done = new Set(completedRecordKinds);
  const remaining = descriptor.steps.filter((step) => !done.has(step.recordKind));
  const journeyKinds = new Set(descriptor.steps.map((step) => step.recordKind));
  const ignored = [...new Set(completedRecordKinds.filter((k) => !journeyKinds.has(k)))].sort();
  return {
    journeyId: descriptor.journeyId,
    totalSteps: descriptor.steps.length,
    completedSteps: descriptor.steps.length - remaining.length,
    remainingSteps: frozenArray(remaining),
    nextStep: remaining.length > 0 ? remaining[0]! : null,
    complete: remaining.length === 0,
    ignoredStepKinds: frozenArray(ignored),
  };
}

/** The routes a journey touches (in step order, deduplicated). */
export function journeyRoutes(descriptor: JourneyDescriptor): readonly ShellRoute[] {
  const seen = new Set<string>();
  const routes: ShellRoute[] = [];
  for (const step of descriptor.steps) {
    const key = `${step.area}:${step.view}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push({ area: step.area, view: step.view });
    }
  }
  return frozenArray(routes);
}

/** All record kinds the journey vocabulary references (sorted, unique). */
export function journeyRecordKinds(descriptor: JourneyDescriptor): readonly string[] {
  return frozenArray([...new Set(descriptor.steps.map((s) => s.recordKind))].sort());
}

/** Guard: does the area/view vocabulary cover every builtin journey? */
export function builtinJourneysValidate(): JourneyCheck[] {
  return BUILTIN_JOURNEYS.map((j) => checkJourneyDescriptor(j));
}

/** Utility used by the binding site: views available in an area. */
export function viewsForArea(area: ShellSurfaceArea): readonly string[] {
  return SHELL_AREA_VIEWS[area];
}
