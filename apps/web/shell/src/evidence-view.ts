/**
 * @fleetos/web-shell — the Evidence & Audit view-model (W091 [TL]).
 *
 * The first-class Evidence & Audit area (spec/ui/CONSOLE-DESIGN.md;
 * UX-JOURNEY-SIMULATION Journey 8 — the direct discoverability gap).
 *
 * The view presents the audit trail the domain already records
 * (`@fleetos/audit` append-only log, per-tenant hash chains) through
 * STRUCTURAL seams (ShellAuditRecordLike): the shell never re-derives
 * chain truth, never computes hashes, never mutates the log. It
 * validates machine-stably, REFUSES cross-tenant records (fail-closed),
 * orders steps machine-stably (the injected `at` instant, then record
 * id — never a clock read), and returns a deep-frozen view.
 *
 * The trail shape follows the simulation's required evidence view:
 * source observation -> diagnosis/prediction version -> policy/Guardian
 * decision -> approval -> command/action -> execution result ->
 * verification -> related notifications/integration outcome — each
 * stage is an observable audit record; the ORDER is the recorded order.
 */
import type {
  ShellAuditChainState,
  ShellAuditRecordLike,
  ShellEvidenceStep,
  ShellEvidenceTrail,
  ShellSurfaceArea,
} from "./seams";
import type { ShellTenantScope } from "./internal";
import { checkShellTenantScope } from "./internal";
import { frozen, frozenArray } from "./internal";

/** The valid subject areas for an evidence trail (navigation back-link). */
const VALID_TRAIL_AREAS: readonly ShellSurfaceArea[] = frozenArray([
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

/** The default trail length cap (machine-stable presentation bound). */
export const TRAIL_STEP_LIMIT = 64;

export type EvidenceTrailCheck =
  | { readonly ok: true; readonly trail: ShellEvidenceTrail }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_scope"
        | "invalid_tenant"
        | "cross_tenant_audit"
        | "invalid_audit_record"
        | "invalid_subject"
        | "invalid_stage"
        | "empty_steps";
      readonly path?: string;
    };

interface TrailInput {
  readonly scope: ShellTenantScope;
  readonly subjectId: string;
  readonly subjectTitle: string;
  /** The area the subject record lives in (navigation back-link). */
  readonly subjectArea: ShellSurfaceArea;
  /**
   * The audit records projecting the trail, each with the stage label
   * the binding site derived from the domain action vocabulary.
   */
  readonly records: readonly (ShellAuditRecordLike & { readonly stage: string })[];
  /** The observable chain-verification state (from the domain log). */
  readonly chainState: ShellAuditChainState;
}

/** Build one evidence trail (pure, deterministic, deep-frozen). */
export function buildEvidenceTrail(input: TrailInput): EvidenceTrailCheck {
  const scopeCheck = checkShellTenantScope(input.scope);
  if (!scopeCheck.ok) {
    return {
      ok: false,
      reason: scopeCheck.reason === "invalid_tenant" ? "invalid_tenant" : "missing_scope",
    };
  }
  if (input.subjectId.trim().length === 0 || input.subjectTitle.trim().length === 0) {
    return { ok: false, reason: "invalid_subject", path: "subject" };
  }
  if (!(VALID_TRAIL_AREAS as readonly string[]).includes(input.subjectArea)) {
    return { ok: false, reason: "invalid_subject", path: "subjectArea" };
  }
  if (input.records.length === 0) {
    return { ok: false, reason: "empty_steps", path: "records" };
  }
  for (let i = 0; i < input.records.length; i += 1) {
    const rec = input.records[i]!;
    const path = `records[${i}]`;
    if (rec.tenantId !== input.scope.tenantId) {
      return { ok: false, reason: "cross_tenant_audit", path };
    }
    if (rec.recordId.trim().length === 0 || rec.action.trim().length === 0) {
      return { ok: false, reason: "invalid_audit_record", path };
    }
    if (rec.stage.trim().length === 0) {
      return { ok: false, reason: "invalid_stage", path: `${path}.stage` };
    }
  }

  // Machine-stable order: the recorded instant, then record id. Input
  // order never matters. Cap at TRAIL_STEP_LIMIT (earliest kept).
  const ordered = [...input.records]
    .sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
    })
    .slice(0, TRAIL_STEP_LIMIT);

  const steps: readonly ShellEvidenceStep[] = frozenArray(
    ordered.map((rec) => ({
      stage: rec.stage,
      actor: rec.actor,
      at: rec.at,
      outcome: rec.outcome,
      evidenceRefs: frozenArray([...rec.evidenceRefs]),
      recordId: rec.recordId,
    })),
  );

  return {
    ok: true,
    trail: frozen({
      subjectId: input.subjectId,
      subjectTitle: input.subjectTitle,
      area: input.subjectArea,
      steps,
      chainState: input.chainState,
    }),
  };
}

/** One row of the Evidence & Audit index (the trail list view). */
export interface EvidenceIndexRow {
  readonly subjectId: string;
  readonly subjectTitle: string;
  readonly area: ShellSurfaceArea;
  readonly stepCount: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly chainState: ShellAuditChainState;
}

export type EvidenceIndexCheck =
  | { readonly ok: true; readonly rows: readonly EvidenceIndexRow[] }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_scope"
        | "invalid_tenant"
        | "cross_tenant_audit"
        | "invalid_trail"
        | "invalid_audit_record";
      readonly path?: string;
    };

/**
 * Build the Evidence & Audit index over complete trails (the area's
 * default view). Rows order machine-stably: subject area, then subject
 * id — never a clock, never input order.
 */
export function buildEvidenceIndex(
  scope: ShellTenantScope,
  trails: readonly TrailInput[],
): EvidenceIndexCheck {
  const scopeCheck = checkShellTenantScope(scope);
  if (!scopeCheck.ok) {
    return {
      ok: false,
      reason: scopeCheck.reason === "invalid_tenant" ? "invalid_tenant" : "missing_scope",
    };
  }
  const rows: EvidenceIndexRow[] = [];
  for (let i = 0; i < trails.length; i += 1) {
    const built = buildEvidenceTrail(trails[i]!);
    if (!built.ok) {
      return { ok: false, reason: "invalid_trail", path: `trails[${i}]` };
    }
    const trail = built.trail;
    if (trail.steps.length === 0) {
      return { ok: false, reason: "invalid_audit_record", path: `trails[${i}]` };
    }
    rows.push({
      subjectId: trail.subjectId,
      subjectTitle: trail.subjectTitle,
      area: trail.area,
      stepCount: trail.steps.length,
      firstAt: trail.steps[0]!.at,
      lastAt: trail.steps[trail.steps.length - 1]!.at,
      chainState: trail.chainState,
    });
  }
  rows.sort((a, b) => {
    if (a.area !== b.area) return a.area < b.area ? -1 : 1;
    return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
  });
  return { ok: true, rows: frozenArray(rows) };
}
