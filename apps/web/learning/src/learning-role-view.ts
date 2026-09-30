/**
 * @fleetos/web-learning — W100B: the ROLE-SHAPED learning surface with
 * EVALUATION-CASE RATIONALE and CAPABILITY-ADOPTION explanations.
 *
 * The W070/W090B learning views (UNCHANGED —
 * `buildEvaluationCasesView` / `buildAdoptionLedgerView` remain the
 * single sources of truth for the record projections) shaped by the
 * active role lens, with the W100B explanation layer:
 *
 *   - EVALUATION-CASE RATIONALE: every case explains WHY it carries
 *     its disposition (the Guardian decision chain — PROPOSED from
 *     ALLOW/WARN, PARKED from REQUIRE_APPROVAL, REJECTED from BLOCK),
 *     why its data carries its redaction state (the governing policy
 *     refs), and what ground truth it teaches;
 *   - ADOPTION RATIONALE: every adoption explains its basis — the
 *     Arena certification it was granted against (ARCHITECTURE-LOCK
 *     item 9: Arena owns capability certification, FleetOS owns
 *     operational adoption), the EXPLICIT HUMAN GRANT (approver +
 *     instant), the rollout, the rollback plan, and the verbatim
 *     warnings;
 *   - the UNDERLYING cases/ledger projections and the rationale texts
 *     are IDENTICAL for every lens (the rationale explains observable
 *     domain truth — it is not role-dependent); the LENS changes ONLY
 *     the emphasis: the lead copy and the spotlight ids (which cases
 *     lead: the parked ones awaiting a human decision for the risk
 *     lens; the proposed ones for the operations lens; the adoptions
 *     reaching cohorts for the team lens);
 *   - the submit-case affordance's availability is AUTHORITY-derived
 *     (identity + Guardian) — NEVER role-derived, with the
 *     restricted-capability explanation (reason + escalation path).
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
import { buildAdoptionLedgerView, buildEvaluationCasesView } from "./learning-view";
import type { AdoptionLedgerView, EvaluationCasesView } from "./learning-view";
import type { LearningSurfaceTenantScope } from "./seams";
import type {
  AdoptionStatus,
  EvaluationDisposition,
  RedactionState,
  RolloutKind,
} from "./seams";
import type { LearningRoleLensView } from "./role-lens";
import type { ExperienceRole, RestrictedCapabilityView, RoleLensAuthorityEcho } from "./role-lens";

// ---------------------------------------------------------------------------
// The disposition rationale (machine-stable — why a case carries its disposition)
// ---------------------------------------------------------------------------

/**
 * WHY each disposition exists (the Guardian decision chain, in this
 * lane's voice). Identical for every lens: the rationale explains
 * observable domain truth.
 */
export const EVALUATION_DISPOSITION_RATIONALE: Readonly<Record<EvaluationDisposition, string>> =
  Object.freeze({
    PROPOSED:
      "The Contract Guardian allowed the submission (decision ALLOW or WARN): the case enters the Arena evaluation loop as proposed evidence.",
    PARKED:
      "The Contract Guardian decided REQUIRE_APPROVAL: the case is parked for a human decision before it may enter the evaluation loop.",
    REJECTED:
      "The Contract Guardian decided BLOCK: the submission was refused by policy — the case never enters the evaluation loop.",
  });

/** WHY each redaction state exists (privacy discipline, this lane's voice). */
export const REDACTION_RATIONALE: Readonly<Record<RedactionState, string>> = Object.freeze({
  raw: "Carried raw: no personal data was present to redact.",
  deidentified:
    "De-identified: identifiers were removed under the tenant's redaction policies before submission.",
  redacted:
    "Redacted: sensitive fields were removed under the tenant's redaction policies before submission.",
});

// ---------------------------------------------------------------------------
// The rationale view-models
// ---------------------------------------------------------------------------

/** One evaluation case's rationale (why this disposition, this redaction, this ground truth). */
export interface CaseRationaleView {
  /** The proposal identity. */
  readonly proposalId: string;
  /** The disposition (verbatim). */
  readonly disposition: EvaluationDisposition;
  /** Why the disposition exists (from the rationale table). */
  readonly dispositionRationale: string;
  /** The Guardian decision type that produced the disposition (verbatim). */
  readonly gateDecision: string;
  /** The decision instant (verbatim). */
  readonly decidedAt: string;
  /** Why the data carries its redaction state (from the rationale table). */
  readonly redactionRationale: string;
  /** The governing redaction policy refs (verbatim, opaque). */
  readonly redactionPolicies: readonly string[];
  /** The ground truth the case teaches (label: value). */
  readonly groundTruth: string;
}

/** One capability adoption's rationale (certification basis + human grant + rollback). */
export interface AdoptionRationaleView {
  /** The adoption identity. */
  readonly adoptionId: string;
  /** The capability id (verbatim). */
  readonly capabilityId: string;
  /** The one-paragraph summary (composed from observable fields only). */
  readonly summary: string;
  /** The certification basis (LOCK 9: Arena owns certification; FleetOS owns operational adoption). */
  readonly certificationBasis: string;
  /** The EXPLICIT HUMAN GRANT (approver + instant, verbatim). */
  readonly humanGrant: string;
  /** The rollback plan (the version to roll back to). */
  readonly rollbackPlan: string;
  /** The verbatim machine-stable warnings (may be empty). */
  readonly warnings: readonly string[];
}

/** The submit-case affordance (availability is authority-derived). */
export interface SubmitCaseAffordanceView {
  /** The gated capability this affordance presents. */
  readonly capability: "learning.case.submit";
  /** Whether the effective authority permits the capability. */
  readonly available: boolean;
  /** The restricted-capability explanation when unavailable (else null). */
  readonly restricted: RestrictedCapabilityView | null;
  /** Machine-asserted: this affordance grants nothing. */
  readonly grantsAnything: false;
}

/** The per-role lead (emphasis copy + spotlights). */
export interface LearningLensLead {
  /** The per-role emphasis paragraph. */
  readonly copy: string;
  /** The spotlight proposal ids (which cases lead — emphasis only). */
  readonly spotlightProposalIds: readonly string[];
  /** The spotlight adoption ids (which adoptions lead — emphasis only). */
  readonly spotlightAdoptionIds: readonly string[];
}

/** The role-shaped learning view (emphasis changes; records and rationales never do). */
export interface RoleShapedLearningView {
  /** The acting tenant scope. */
  readonly tenantId: LearningSurfaceTenantScope["tenantId"];
  /** The active role. */
  readonly activeRole: ExperienceRole;
  /** The active role's label. */
  readonly roleLabel: string;
  /** The one-line lens lead (from the lens view). */
  readonly lensLead: string;
  /** The role-shaped lead (emphasis copy + spotlights). */
  readonly lead: LearningLensLead;
  /** The UNDERLYING evaluation-cases view — IDENTICAL across lenses (proven). */
  readonly cases: EvaluationCasesView;
  /** The UNDERLYING adoption-ledger view — IDENTICAL across lenses (proven). */
  readonly ledger: AdoptionLedgerView;
  /** The per-case rationales (deterministic — identical across lenses). */
  readonly caseRationales: readonly CaseRationaleView[];
  /** The per-adoption rationales (deterministic — identical across lenses). */
  readonly adoptionRationales: readonly AdoptionRationaleView[];
  /** The submit-case affordance (authority-derived availability). */
  readonly submitAffordance: SubmitCaseAffordanceView;
  /** The authority echo — VERBATIM from the lens. */
  readonly authority: RoleLensAuthorityEcho;
  /** Machine-asserted: this view grants nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildRoleShapedLearningView`. */
export type RoleShapedLearningResult = SurfaceResult<RoleShapedLearningView>;

// ---------------------------------------------------------------------------
// The per-role emphasis tables (the spotlight derivation)
// ---------------------------------------------------------------------------

/** The per-role learning lead copy (the emphasis paragraphs). */
export const LEARNING_LEAD_COPY: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin":
    "The fleet's learning loop: which cases are proposed or parked, and what has been adopted under which certification.",
  "service.desk":
    "Operational learning: the cases drawn from the outcomes of the treatments you drive.",
  "security.compliance":
    "Risk lens: the policy-gated evaluation cases — including the parked ones awaiting a human decision — and the certified adoptions with their rationale and warnings.",
  "asset.manager":
    "Resource lens: the capabilities adopted behind the fleet's resources, with their certification basis.",
  "team.manager":
    "Team lens: how adopted capabilities reach your team's cohorts, and what they were certified against.",
  "employee":
    "Plain-language: what the fleet learned from recent outcomes — no operational duties here.",
  "vendor.operator":
    "Scoped view: the learning context relevant to your contracted services.",
});

/** Which cases the lens spotlights. */
const CASE_SPOTLIGHT: Readonly<Record<ExperienceRole, "parked" | "proposed" | "none">> =
  Object.freeze({
    "fleet.admin": "parked",
    "service.desk": "proposed",
    "security.compliance": "parked",
    "asset.manager": "none",
    "team.manager": "none",
    employee: "none",
    "vendor.operator": "none",
  });

/** Which adoptions the lens spotlights. */
const ADOPTION_SPOTLIGHT: Readonly<Record<ExperienceRole, "warnings" | "all" | "none">> =
  Object.freeze({
    "fleet.admin": "all",
    "service.desk": "none",
    "security.compliance": "warnings",
    "asset.manager": "all",
    "team.manager": "all",
    employee: "none",
    "vendor.operator": "none",
  });

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the role-shaped learning view with the evaluation-case and
 * adoption rationales.
 *
 * The underlying cases/ledger views are built by the EXISTING builders
 * (single sources of truth — lens-independent); the rationale layer is
 * a deterministic derivation over their observable fields (identical
 * for every lens); the lens shapes ONLY the lead copy and the spotlight
 * ids. The submit-case affordance's availability derives from the
 * lens's AUTHORITY echo (identity + Guardian), never from the role.
 *
 * @param scope the acting tenant scope
 * @param lens the role lens view (from `buildLearningRoleLens`)
 * @param proposals the evaluation-case proposal records (the real W070/W050B shapes, bound at the binding site)
 * @param adoptions the adoption records (the real W070 records, bound at the binding site)
 * @returns the tagged result: the role-shaped view or a machine-stable error
 */
export function buildRoleShapedLearningView(
  scope: LearningSurfaceTenantScope,
  lens: LearningRoleLensView,
  proposals: readonly unknown[],
  adoptions: readonly unknown[],
): RoleShapedLearningResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || typeof scope.tenantId !== "string" || scope.tenantId.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "role-shaped learning surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — the lens discipline.
  const failures: { path: string; reason: string }[] = [];
  if (!isPlainObject(lens) || lens["grantsAnything"] !== false) {
    failures.push({ path: "/lens", reason: "lens_view_invalid" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role-shaped learning surface requires a valid role lens view",
        scope.tenantId,
        failures,
      ),
    };
  }
  if (lens.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "role-shaped learning surface refuses a cross-tenant lens",
        scope.tenantId,
        [{ path: "/lens/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 2 — the base projections (the EXISTING builders; their own
  // refusals pass through).
  const casesBuild = buildEvaluationCasesView(scope, proposals as never);
  if (!casesBuild.ok) {
    return { ok: false, error: casesBuild.error };
  }
  const ledgerBuild = buildAdoptionLedgerView(scope, adoptions as never);
  if (!ledgerBuild.ok) {
    return { ok: false, error: ledgerBuild.error };
  }
  // Phase 3 — the rationale layer (deterministic derivations over the
  // base views' observable fields — identical for every lens).
  const caseRationales: CaseRationaleView[] = casesBuild.view.items.map((item) =>
    frozen({
      proposalId: item.proposalId,
      disposition: item.disposition,
      dispositionRationale: EVALUATION_DISPOSITION_RATIONALE[item.disposition],
      gateDecision: item.gateDecision,
      decidedAt: item.decidedAt,
      redactionRationale: REDACTION_RATIONALE[item.redactionState],
      redactionPolicies: frozenArray(item.redactionPolicies),
      groundTruth: `${item.outcomeLabel}: ${item.outcomeValue}`,
    } satisfies CaseRationaleView),
  );
  const adoptionRationales: AdoptionRationaleView[] = ledgerBuild.view.items.map((entry) => {
    const latest = entry.revisions[entry.revisions.length - 1] ?? entry.revisions[0];
    const warnings = frozenArray(entry.warnings);
    return frozen({
      adoptionId: entry.adoptionId,
      capabilityId: entry.capabilityId,
      summary:
        `Capability ${entry.capabilityId} v${entry.latestCapabilityVersion} was adopted ` +
        `${entry.rolloutSummary} to cohort ${entry.cohort}, certified against evaluation suite ` +
        `${entry.evaluationSuiteRevision} (Arena ref ${entry.certificationRef}), with the explicit ` +
        `grant by ${entry.approverId} at ${entry.approvedAt}.`,
      certificationBasis:
        `Arena owns capability certification (ref ${entry.certificationRef}, suite ` +
        `${entry.evaluationSuiteRevision}); FleetOS owns operational adoption (compatibility: ` +
        `${entry.compatibilityStatement}).`,
      humanGrant: `${entry.approverId} at ${entry.approvedAt}`,
      rollbackPlan: `roll back to v${entry.rollbackVersion}`,
      warnings,
    } satisfies AdoptionRationaleView);
  });
  // Phase 4 — the role-shaped lead (spotlight derivation; emphasis only).
  const caseSpotlightKind = CASE_SPOTLIGHT[lens.activeRole];
  const spotlightProposalIds =
    caseSpotlightKind === "none"
      ? []
      : casesBuild.view.items
          .filter((item) => item.disposition === (caseSpotlightKind === "parked" ? "PARKED" : "PROPOSED"))
          .map((item) => item.proposalId);
  const adoptionSpotlightKind = ADOPTION_SPOTLIGHT[lens.activeRole];
  const spotlightAdoptionIds =
    adoptionSpotlightKind === "none"
      ? []
      : adoptionSpotlightKind === "all"
        ? ledgerBuild.view.items.map((entry) => entry.adoptionId)
        : ledgerBuild.view.items
            .filter((entry) => entry.warnings.length > 0)
            .map((entry) => entry.adoptionId);
  // Phase 5 — the submit-case affordance (authority-derived).
  const submitCapability = "learning.case.submit" as const;
  const available = (lens.authority.permissions as readonly string[]).includes(submitCapability);
  const restricted = available
    ? null
    : (lens.restricted.find((r) => r.capability === submitCapability) ?? null);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        activeRole: lens.activeRole,
        roleLabel: lens.roleLabel,
        lensLead: lens.lensLead,
        lead: frozen({
          copy: LEARNING_LEAD_COPY[lens.activeRole],
          spotlightProposalIds: frozenArray(spotlightProposalIds),
          spotlightAdoptionIds: frozenArray(spotlightAdoptionIds),
        } satisfies LearningLensLead),
        cases: casesBuild.view,
        ledger: ledgerBuild.view,
        caseRationales: frozenArray(caseRationales),
        adoptionRationales: frozenArray(adoptionRationales),
        submitAffordance: frozen({
          capability: submitCapability,
          available,
          restricted,
          grantsAnything: false,
        } satisfies SubmitCaseAffordanceView),
        authority: lens.authority,
        grantsAnything: false,
      } satisfies RoleShapedLearningView),
    ),
  };
}

// Re-export the seam vocabulary types the rationales reference (public
// convenience for consumers of the role-shaped view).
export type { AdoptionStatus, EvaluationDisposition, RedactionState, RolloutKind };
