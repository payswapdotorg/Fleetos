/**
 * @fleetos/web-security — W100B: the ROLE-SHAPED findings surface.
 *
 * The W031/W090B findings list view (UNCHANGED — `buildFindingsListView`
 * remains the single source of truth for the record projection) shaped
 * by the active role lens:
 *
 *   - the UNDERLYING record set, severity ordering, evidence refs and
 *     remediation PROPOSALs are IDENTICAL for every lens (proven by
 *     test: same records + different lens => identical `findings` view,
 *     identical authority echo, identical affordance availability);
 *   - the LENS changes ONLY the presentation emphasis: the lead copy,
 *     the spotlight finding ids (which findings lead), the evidence-
 *     first emphasis, and the remediation-affordance framing;
 *   - the remediation affordance's availability is AUTHORITY-derived
 *     (the effective permission set from identity + Guardian) — NEVER
 *     role-derived. When unavailable it renders the restricted-capability
 *     explanation (reason + escalation path — the matrix rule).
 *
 * The lens NEVER filters records: the employee's personal-device
 * scoping happens at the BINDING SITE (the records passed in), never
 * here — same records in = same records out for every lens.
 *
 * PURE: no clock, no entropy, no I/O; deterministic and deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  deepFrozen,
  frozen,
  frozenArray,
  isPlainObject,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult } from "./internal";
import { buildFindingsListView } from "./findings-view";
import type { FindingsListView } from "./findings-view";
import type { SecurityFindingRecord, SurfaceFindingClassification, SurfaceTenantScope } from "./surface-contracts";
import type { SecurityRoleLensView } from "./role-lens";
import type { ExperienceRole, RestrictedCapabilityView, RoleLensAuthorityEcho } from "./role-lens";

// ---------------------------------------------------------------------------
// The lens input + view-models
// ---------------------------------------------------------------------------

/** The role lens the findings surface is shaped by (the W100B lens view). */
export type FindingsRoleLens = SecurityRoleLensView;

/** The per-role spotlight derivation (which findings lead — emphasis only). */
export type FindingsSpotlightKind =
  | "critical-high-risk-classifications"
  | "actionable-remediations"
  | "critical-impact"
  | "configuration-conditions"
  | "none";

/** The frozen spotlight table: which findings lead per active role. */
export const FINDINGS_SPOTLIGHT: Readonly<Record<ExperienceRole, FindingsSpotlightKind>> =
  Object.freeze({
    "fleet.admin": "critical-high-risk-classifications",
    "service.desk": "actionable-remediations",
    "security.compliance": "critical-high-risk-classifications",
    "asset.manager": "configuration-conditions",
    "team.manager": "critical-impact",
    "employee": "actionable-remediations",
    "vendor.operator": "none",
  });

/** Whether the lens leads with the evidence trail (evidence-first emphasis). */
export const EVIDENCE_FIRST_LENS: Readonly<Record<ExperienceRole, boolean>> = Object.freeze({
  "fleet.admin": false,
  "service.desk": false,
  "security.compliance": true,
  "asset.manager": false,
  "team.manager": false,
  "employee": false,
  "vendor.operator": false,
});

/** The per-role findings lead copy (the emphasis paragraph). */
export const FINDINGS_LEAD_COPY: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin":
    "Fleet-wide posture: the most severe conditions across every enrolled device, with the policy context that governs remediation.",
  "service.desk":
    "Operational queue: findings with a recommended remediation lead — what you can safely drive next, gated by the Contract Guardian.",
  "security.compliance":
    "Risk posture: critical and high findings with compliance and threat classifications lead. Every finding links the immutable observations that support it.",
  "asset.manager":
    "Resource context: configuration conditions on the devices you provision and maintain, ahead of replacement or remediation decisions.",
  "team.manager":
    "Team impact: the critical findings affecting your team's devices, summarized — remediation stays with the security and service roles.",
  "employee":
    "Plain-language guidance: the findings that carry a recommended action, what they mean for you, and how to request help.",
  "vendor.operator":
    "Scoped view: the security findings relevant to your contracted work only.",
});

/** The derived lead counts (identical data, presented by the lens). */
export interface FindingsLensLead {
  /** The per-role emphasis paragraph (from FINDINGS_LEAD_COPY). */
  readonly copy: string;
  /** The CRITICAL count (derived from the base view). */
  readonly criticalCount: number;
  /** The HIGH count (derived). */
  readonly highCount: number;
  /** The distinct device count (derived). */
  readonly deviceCount: number;
  /** The per-classification counts (derived). */
  readonly classificationCounts: Readonly<Record<SurfaceFindingClassification, number>>;
  /** The count of findings carrying a remediation PROPOSAL (derived). */
  readonly remediationProposalCount: number;
  /** The spotlight finding ids (the lens's lead subset, in base-view order). */
  readonly spotlightFindingIds: readonly string[];
  /** Whether the lens leads with the evidence trail (evidence-first). */
  readonly evidenceFirst: boolean;
}

/** The remediation affordance (availability is authority-derived). */
export interface RemediationAffordanceView {
  /** The gated capability this affordance presents. */
  readonly capability: "security.remediation.propose";
  /** Whether the effective authority permits the capability. */
  readonly available: boolean;
  /** The restricted-capability explanation when unavailable (else null). */
  readonly restricted: RestrictedCapabilityView | null;
  /** Machine-asserted: this affordance grants nothing. */
  readonly grantsAnything: false;
}

/** The role-shaped findings view (emphasis changes; records never do). */
export interface RoleShapedFindingsView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The active role. */
  readonly activeRole: ExperienceRole;
  /** The active role's label. */
  readonly roleLabel: string;
  /** The one-line lens lead (from the lens view). */
  readonly lensLead: string;
  /** The role-shaped lead (emphasis copy + derived counts + spotlights). */
  readonly lead: FindingsLensLead;
  /** The UNDERLYING findings list view — IDENTICAL across lenses (proven). */
  readonly findings: FindingsListView;
  /** The authority echo — VERBATIM from the lens. */
  readonly authority: RoleLensAuthorityEcho;
  /** The remediation affordance (authority-derived availability). */
  readonly remediationAffordance: RemediationAffordanceView;
  /** Machine-asserted: this view grants nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildRoleShapedFindingsView`. */
export type RoleShapedFindingsResult = SurfaceResult<RoleShapedFindingsView>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a lens view structurally (the fields this surface reads). */
function validateLens(
  candidate: unknown,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path: "/lens", reason: "object_required" });
    return;
  }
  if (candidate["grantsAnything"] !== false) {
    failures.push({ path: "/lens/grantsAnything", reason: "must_be_false" });
  }
  const authority = candidate["authority"];
  if (!isPlainObject(authority)) {
    failures.push({ path: "/lens/authority", reason: "object_required" });
  } else if (authority["lensGrantsNothing"] !== true) {
    failures.push({ path: "/lens/authority/lensGrantsNothing", reason: "must_be_true" });
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the role-shaped findings view.
 *
 * The underlying findings list view is built by the EXISTING
 * `buildFindingsListView` (single source of truth — the record
 * projection is lens-independent); the lens shapes ONLY the lead copy,
 * the spotlight subset, the evidence-first flag and the remediation
 * affordance framing. Affordance availability is derived from the
 * lens's AUTHORITY echo (identity + Guardian), never from the role.
 *
 * @param scope the acting tenant scope
 * @param lens the role lens view (from `buildSecurityRoleLens`)
 * @param findings the finding records (the W031 ledger's active view, bound at the binding site)
 * @returns the tagged result: the role-shaped view or a machine-stable error
 */
export function buildRoleShapedFindingsView(
  scope: SurfaceTenantScope,
  lens: FindingsRoleLens,
  findings: readonly SecurityFindingRecord[],
): RoleShapedFindingsResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || typeof scope.tenantId !== "string" || scope.tenantId.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "role-shaped findings surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — the lens discipline (fail-closed: the lens view must be
  // one of OUR lens views — grantsAnything false, authority echoed).
  const lensFailures: { path: string; reason: string }[] = [];
  validateLens(lens, lensFailures);
  if (lensFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role-shaped findings surface requires a valid role lens view",
        scope.tenantId,
        lensFailures,
      ),
    };
  }
  if (lens.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "role-shaped findings surface refuses a cross-tenant lens",
        scope.tenantId,
        [{ path: "/lens/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 2 — the base projection (the EXISTING builder — single source
  // of truth; its own tenant/structural refusals pass through).
  const base = buildFindingsListView(scope, findings);
  if (!base.ok) {
    return { ok: false, error: base.error };
  }
  // Phase 3 — the role-shaped lead (emphasis only; the derived counts
  // come from the base view — identical data for every lens).
  const view = base.view;
  const classificationCounts: Record<SurfaceFindingClassification, number> = {
    compliance: 0,
    configuration: 0,
    exposure: 0,
    threat: 0,
  };
  const devices = new Set<string>();
  let remediationProposalCount = 0;
  for (const item of view.items) {
    classificationCounts[item.classification] += 1;
    devices.add(item.deviceId);
    if (item.remediationProposal !== null) remediationProposalCount += 1;
  }
  const spotlightKind = FINDINGS_SPOTLIGHT[lens.activeRole];
  const spotlightFindingIds: string[] = [];
  for (const item of view.items) {
    const severe = item.severity === "CRITICAL" || item.severity === "HIGH";
    switch (spotlightKind) {
      case "critical-high-risk-classifications":
        if (severe && (item.classification === "compliance" || item.classification === "threat")) {
          spotlightFindingIds.push(item.findingId);
        }
        break;
      case "actionable-remediations":
        if (item.remediationProposal !== null) spotlightFindingIds.push(item.findingId);
        break;
      case "critical-impact":
        if (item.severity === "CRITICAL") spotlightFindingIds.push(item.findingId);
        break;
      case "configuration-conditions":
        if (item.classification === "configuration") spotlightFindingIds.push(item.findingId);
        break;
      case "none":
        break;
    }
  }
  // Phase 4 — the remediation affordance (authority-derived, never
  // role-derived: identical availability for every lens — proven).
  const remediationCapability = "security.remediation.propose" as const;
  const available = (lens.authority.permissions as readonly string[]).includes(
    remediationCapability,
  );
  const restricted = available
    ? null
    : (lens.restricted.find((r) => r.capability === remediationCapability) ?? null);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        activeRole: lens.activeRole,
        roleLabel: lens.roleLabel,
        lensLead: lens.lensLead,
        lead: frozen({
          copy: FINDINGS_LEAD_COPY[lens.activeRole],
          criticalCount: view.severityCounts.CRITICAL,
          highCount: view.severityCounts.HIGH,
          deviceCount: devices.size,
          classificationCounts: frozen({ ...classificationCounts }),
          remediationProposalCount,
          spotlightFindingIds: frozenArray(spotlightFindingIds),
          evidenceFirst: EVIDENCE_FIRST_LENS[lens.activeRole],
        } satisfies FindingsLensLead),
        findings: view,
        authority: lens.authority,
        remediationAffordance: frozen({
          capability: remediationCapability,
          available,
          restricted,
          grantsAnything: false,
        } satisfies RemediationAffordanceView),
        grantsAnything: false,
      } satisfies RoleShapedFindingsView),
    ),
  };
}
