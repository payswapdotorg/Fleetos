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
 * The built-in journeys (frozen). W091 [TL] — EXPANDED from the W061
 * four to the complete design-contract acceptance set (spec/ui/
 * CONSOLE-DESIGN.md "Acceptance": every journey a human must be able to
 * walk without knowing internal implementation names, plus the
 * UX-JOURNEY-SIMULATION's required changes: enrollment, Fleet Action,
 * Print, Evidence/Audit, Policies and Learning first-class). Each
 * mirrors a domain flow the surfaces already present — the shell's
 * cross-surface composition of the established W031/W040/W041/W042/
 * W050/W070 flows.
 */
export const BUILTIN_JOURNEYS: readonly JourneyDescriptor[] = frozenArray([
  {
    journeyId: "enroll-fleet",
    title: "Enroll an Existing Fleet",
    steps: [
      { area: "device", view: "enrollment", recordKind: "device.enrollment", purpose: "prepare" },
      { area: "device", view: "list", recordKind: "device.row", purpose: "verify" },
    ],
  },
  {
    journeyId: "inspect-device",
    title: "Inspect a Device and Its Diagnosis",
    steps: [
      { area: "device", view: "list", recordKind: "device.row", purpose: "observe" },
      { area: "device", view: "doctor", recordKind: "device.doctor", purpose: "verify" },
    ],
  },
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
      { area: "recovery", view: "find-my", recordKind: "recovery.find-my", purpose: "prepare" },
      { area: "recovery", view: "cases", recordKind: "recovery.case", purpose: "prepare" },
      { area: "recovery", view: "destructive", recordKind: "recovery.destructive", purpose: "verify" },
    ],
  },
  {
    journeyId: "understand-guardian-decision",
    title: "Understand a Contract Guardian Decision",
    steps: [
      { area: "security", view: "decisions", recordKind: "guardian.decision", purpose: "observe" },
      { area: "policies", view: "list", recordKind: "policy.rule", purpose: "prepare" },
    ],
  },
  {
    journeyId: "approve-execute-action",
    title: "Approve, Execute and Verify a Fleet Action",
    steps: [
      { area: "actions", view: "plans", recordKind: "action.plan", purpose: "observe" },
      { area: "security", view: "approvals", recordKind: "approval.parked", purpose: "approve" },
      { area: "actions", view: "plans", recordKind: "action.plan", purpose: "dispatch" },
      { area: "actions", view: "plans", recordKind: "action.plan.progress", purpose: "verify" },
    ],
  },
  {
    journeyId: "route-print",
    title: "Route a Print Job",
    steps: [
      { area: "actions", view: "print", recordKind: "print.job", purpose: "observe" },
      { area: "actions", view: "print", recordKind: "print.route", purpose: "prepare" },
      { area: "actions", view: "print", recordKind: "print.dispatch", purpose: "dispatch" },
      { area: "actions", view: "print", recordKind: "print.result", purpose: "verify" },
    ],
  },
  {
    journeyId: "plan-workload",
    title: "Plan a Workload and Its Software",
    steps: [
      { area: "workloads", view: "planning", recordKind: "workload.plan", purpose: "observe" },
      { area: "workloads", view: "recommendations", recordKind: "workload.recommendation", purpose: "prepare" },
      { area: "commerce", view: "software", recordKind: "software.subscription", purpose: "verify" },
    ],
  },
  {
    journeyId: "procure-vendor-quote",
    title: "Request Procurement and Inspect Vendor/Quote Progress",
    steps: [
      { area: "commerce", view: "procurement", recordKind: "procurement.request", purpose: "prepare" },
      { area: "commerce", view: "vendors", recordKind: "vendor.quote", purpose: "verify" },
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
  {
    journeyId: "inspect-evidence",
    title: "Inspect the Evidence Trail for a Consequential Record",
    steps: [
      { area: "evidence", view: "trail", recordKind: "evidence.trail", purpose: "observe" },
      { area: "evidence", view: "trail", recordKind: "evidence.trail", purpose: "verify" },
    ],
  },
  {
    journeyId: "inspect-learning",
    title: "Inspect Learning and Capability Adoption",
    steps: [
      { area: "learning", view: "cases", recordKind: "learning.case", purpose: "observe" },
      { area: "learning", view: "adoption", recordKind: "learning.adoption", purpose: "verify" },
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
