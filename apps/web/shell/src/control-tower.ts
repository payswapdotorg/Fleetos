/**
 * @fleetos/web-shell — the Control Tower view-model (W091 [TL]).
 *
 * The first screen after tenant selection. Per spec/ui/CONSOLE-DESIGN.md
 * it must answer, without deep navigation:
 *
 *   - What needs my attention?           (the primary attention stream)
 *   - Which devices are unhealthy/at risk? (fleet pulse)
 *   - Which security decisions require action? (security pulse)
 *   - Which consequential actions are awaiting approval? (approval pulse)
 *   - Which maintenance jobs are due/late? / procurement in flight?
 *     (commerce pulse — derived from the same banded summaries)
 *   - What recently changed?             (recent consequential acts)
 *   - Where is the evidence?             (every item links the trail)
 *
 * Composition rules (frozen):
 *   - ONE primary "Needs attention" stream (severity-ordered, never a
 *     wall of KPI cards);
 *   - a compact per-area-group pulse (counts by band, machine-stable);
 *   - recent activity from injected audit records (presented verbatim);
 *   - a small set of high-value counters;
 *   - DIRECT links into the exact record's area (route = the area's
 *     canonical entry view) plus an evidence-trail link for every item;
 *   - the onboarding entry point (enroll fleet) is ALWAYS discoverable,
 *     with its authorization state visible (never a dead button);
 *   - the acting role + its permission summary are part of the view
 *     (authorization status is visible on consequential state).
 *
 * PURE and DETERMINISTIC: no clock, no entropy, no I/O. Invalid inputs
 * refuse machine-stably with {path, reason} — never a throw. Output is
 * deep-frozen. Cross-tenant audit records REFUSE (fail-closed, never
 * silently filtered).
 */
import type {
  ShellAuditRecordLike,
  ShellBandedSummary,
  ShellSurfaceArea,
} from "./seams";
import type { ShellTenantScope } from "./internal";
import { checkShellTenantScope } from "./internal";
import { frozen, frozenArray } from "./internal";
import {
  BAND_SEVERITY_ORDER,
  compareBands,
  presentationOf,
  type ShellStatusBand,
} from "./coherence";
import { SHELL_AREA_VIEWS } from "./navigation";
import {
  canInteract,
  canNavigate,
  type ShellInteraction,
  type ShellOperatorRole,
  type ShellPermissionSummary,
} from "./permissions";

/** The attention-band cutoff: records at or above this severity stream. */
export const ATTENTION_CUTOFF: readonly ShellStatusBand[] = frozenArray([
  "critical",
  "high",
  "medium",
]);

/** One attention-stream item (a record that needs the operator). */
export interface ControlTowerAttentionItem {
  readonly area: ShellSurfaceArea;
  readonly recordId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly band: ShellStatusBand;
  /** The canonical route into the record's area (direct link). */
  readonly route: { readonly area: ShellSurfaceArea; readonly view: string };
  /** The evidence-trail route for this record. */
  readonly evidenceRoute: { readonly area: "evidence"; readonly view: "trail" };
  /** May the acting role navigate there? (authorization state, visible) */
  readonly navigable: boolean;
}

/** A per-area-group pulse: counts by band (compact, machine-stable). */
export interface ControlTowerPulse {
  /** The pulse group label (operator-facing). */
  readonly group: string;
  /** The areas aggregated into this group. */
  readonly areas: readonly ShellSurfaceArea[];
  /** Total records considered. */
  readonly total: number;
  /** Records at/above the attention cutoff. */
  readonly attention: number;
  /** Per-band counts (only non-zero bands, severity order). */
  readonly bands: readonly { readonly band: ShellStatusBand; readonly count: number }[];
}

/** One recent-activity item (a consequential act, verbatim projection). */
export interface ControlTowerActivityItem {
  readonly recordId: string;
  readonly actor: string;
  readonly action: string;
  readonly at: string;
  readonly outcome: string;
}

/** The frozen area groups for the compact pulse (design contract). */
export const PULSE_GROUPS: readonly {
  readonly group: string;
  readonly areas: readonly ShellSurfaceArea[];
}[] = frozenArray([
  { group: "Fleet health", areas: frozenArray(["device", "recovery"]) },
  { group: "Security & policy", areas: frozenArray(["security", "policies"]) },
  { group: "Actions & approvals", areas: frozenArray(["actions"]) },
  { group: "Workloads & commerce", areas: frozenArray(["workloads", "commerce"]) },
]);

/** The onboarding entry point (always discoverable, authorization-visible). */
export interface ControlTowerOnboarding {
  readonly route: { readonly area: "device"; readonly view: "enrollment" };
  readonly label: string;
  readonly navigable: boolean;
  readonly reason: string;
}

/** The complete Control Tower view (deep-frozen). */
export interface ControlTowerView {
  readonly tenantId: string;
  readonly role: ShellOperatorRole;
  readonly interactions: readonly ShellInteraction[];
  readonly attentionStream: readonly ControlTowerAttentionItem[];
  readonly pulses: readonly ControlTowerPulse[];
  readonly counters: readonly { readonly area: ShellSurfaceArea; readonly total: number; readonly attention: number }[];
  readonly recentActivity: readonly ControlTowerActivityItem[];
  readonly onboarding: ControlTowerOnboarding;
}

export type ControlTowerCheck =
  | { readonly ok: true; readonly view: ControlTowerView }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_scope"
        | "invalid_tenant"
        | "invalid_summary"
        | "cross_tenant_audit"
        | "invalid_audit_record"
        | "invalid_role";
      readonly path?: string;
    };

interface BuildInput {
  readonly scope: ShellTenantScope;
  readonly role: ShellOperatorRole;
  readonly summaries: readonly ShellBandedSummary[];
  readonly recentAudit?: readonly ShellAuditRecordLike[];
  readonly activityLimit?: number;
}

/** Normalize a banded summary or refuse machine-stably. */
function normalizedSummary(
  summary: ShellBandedSummary,
  index: number,
): { ok: true } | { ok: false; path: string } {
  const path = `summaries[${index}]`;
  if (summary.title.trim().length === 0) return { ok: false, path: `${path}.title` };
  if (!(BAND_SEVERITY_ORDER as readonly string[]).includes(summary.band)) {
    return { ok: false, path: `${path}.band` };
  }
  return { ok: true };
}

/** Build the Control Tower view (pure, deterministic, deep-frozen). */
export function buildControlTowerView(input: BuildInput): ControlTowerCheck {
  const scopeCheck = checkShellTenantScope(input.scope);
  if (!scopeCheck.ok) {
    return { ok: false, reason: scopeCheck.reason === "invalid_tenant" ? "invalid_tenant" : "missing_scope" };
  }
  const role = input.role;

  // 1. Validate every summary machine-stably (never a throw).
  for (let i = 0; i < input.summaries.length; i += 1) {
    const check = normalizedSummary(input.summaries[i]!, i);
    if (!check.ok) return { ok: false, reason: "invalid_summary", path: check.path };
  }

  // 2. Validate audit records; cross-tenant REFUSES (fail-closed).
  const audit = input.recentAudit ?? [];
  for (let i = 0; i < audit.length; i += 1) {
    const rec = audit[i]!;
    const path = `recentAudit[${i}]`;
    if (rec.tenantId !== input.scope.tenantId) {
      return { ok: false, reason: "cross_tenant_audit", path };
    }
    if (rec.recordId.trim().length === 0 || rec.action.trim().length === 0) {
      return { ok: false, reason: "invalid_audit_record", path };
    }
  }

  // 3. The attention stream: attention bands only, severity -> area ->
  //    recordId total order (input order never matters).
  const attentionRaw = input.summaries
    .map((summary, index) => {
      const presentation = presentationOf(summary);
      if (!presentation.ok) return null;
      return { summary, index, presentation: presentation.presentation };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry) => (ATTENTION_CUTOFF as readonly string[]).includes(entry.presentation.band));

  const attentionStream: ControlTowerAttentionItem[] = attentionRaw
    .map((entry) => ({
      area: entry.summary.area,
      recordId: entry.summary.recordId,
      title: entry.presentation.title,
      subtitle: entry.presentation.subtitle,
      band: entry.presentation.band,
      route: { area: entry.summary.area, view: SHELL_AREA_VIEWS[entry.summary.area][0]! },
      evidenceRoute: { area: "evidence" as const, view: "trail" as const },
      navigable: canNavigate(role, {
        area: entry.summary.area,
        view: SHELL_AREA_VIEWS[entry.summary.area][0]!,
      }).ok,
    }))
    .sort((a, b) => {
      const bandDelta = compareBands(a.band, b.band);
      if (bandDelta !== 0) return bandDelta;
      if (a.area !== b.area) return a.area < b.area ? -1 : 1;
      return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
    });

  // 4. The compact pulses (counts by band per frozen group).
  const pulses: ControlTowerPulse[] = PULSE_GROUPS.map((group) => {
    const inGroup = input.summaries.filter((s) => group.areas.includes(s.area));
    const bandCounts = new Map<ShellStatusBand, number>();
    for (const s of inGroup) {
      const band = s.band as ShellStatusBand;
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
    }
    const bands = (BAND_SEVERITY_ORDER as readonly ShellStatusBand[])
      .filter((band) => (bandCounts.get(band) ?? 0) > 0)
      .map((band) => ({ band, count: bandCounts.get(band)! }));
    const attention = inGroup.filter((s) =>
      (ATTENTION_CUTOFF as readonly string[]).includes(s.band),
    ).length;
    return {
      group: group.group,
      areas: group.areas,
      total: inGroup.length,
      attention,
      bands,
    };
  });

  // 5. High-value counters per area (canonical area order).
  const counters = (["device", "recovery", "security", "policies", "actions", "workloads", "commerce", "learning"] as const)
    .map((area) => {
      const rows = input.summaries.filter((s) => s.area === area);
      return {
        area,
        total: rows.length,
        attention: rows.filter((s) => (ATTENTION_CUTOFF as readonly string[]).includes(s.band)).length,
      };
    })
    .filter((row) => row.total > 0);

  // 6. Recent activity: injected audit records, latest-first by `at`
  //    (ISO string compare) then recordId — machine-stable, no clock.
  const limit = typeof input.activityLimit === "number" && input.activityLimit > 0
    ? input.activityLimit
    : 8;
  const recentActivity: ControlTowerActivityItem[] = [...audit]
    .sort((a, b) => {
      if (a.at !== b.at) return a.at > b.at ? -1 : 1;
      return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
    })
    .slice(0, limit)
    .map((rec) => ({
      recordId: rec.recordId,
      actor: rec.actor,
      action: rec.action,
      at: rec.at,
      outcome: rec.outcome,
    }));

  // 7. The onboarding entry point — always present, authorization-visible.
  const onboardingNav = canNavigate(role, { area: "device", view: "enrollment" });
  const onboarding: ControlTowerOnboarding = frozen({
    route: { area: "device" as const, view: "enrollment" as const },
    label: "Enroll an existing fleet",
    navigable: onboardingNav.ok,
    reason: onboardingNav.ok ? "" : `Role '${role}' cannot open device enrollment.`,
  });

  // 8. The acting identity's permission summary (visible authorization).
  const interactions = (
    ["observe", "propose", "approve", "dispatch", "destructive"] as const
  ).filter((interaction) => canInteract(role, interaction));

  return {
    ok: true,
    view: frozen({
      tenantId: input.scope.tenantId,
      role,
      interactions: frozenArray(interactions),
      attentionStream: frozenArray(attentionStream),
      pulses: frozenArray(pulses),
      counters: frozenArray(counters),
      recentActivity: frozenArray(recentActivity),
      onboarding,
    }),
  };
}

export type { ShellPermissionSummary };
