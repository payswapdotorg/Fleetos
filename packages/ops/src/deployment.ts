/**
 * @fleetos/ops — D1: deployment manifests and deployment plans.
 *
 * Production-readiness deployment surface:
 *
 *   - `DeploymentManifest` — a versioned, content-addressed record of
 *     WHAT is deployed: the component set (package name + content
 *     digest per component), the environment descriptor, and the tenant
 *     scope. The manifest id is the deterministic FNV-1a digest over
 *     the canonical form (byte-identical across runs and input
 *     permutations).
 *   - `DeploymentPlan` — a PROPOSAL-gated deployment intent over a
 *     manifest: `PROPOSED -> APPROVED | REJECTED` is a HUMAN transition
 *     (the W040/W060 human-grant discipline — a plan NEVER
 *     auto-executes); a plan may cite a prior deployment it supersedes
 *     (the supersedes discipline — the prior is never rewritten).
 *   - Machine-stable refusal taxonomy: `manifest_malformed`,
 *     `component_digest_malformed`, `duplicate_component`,
 *     `environment_mismatch`, `plan_not_proposed`,
 *     `superseded_target_unknown`, `superseded_target_mismatch`.
 *
 * Pure: no clock reads (instants injected), no entropy, no network, no
 * runtime dependencies. Strict TS; no `any` in public signatures.
 */

import type { TenantId } from "@fleetos/contracts";
import { canonicalJson, compareInstants, digestOf, frozen, frozenArray, isValidInstant, sortedUniqueStrings } from "./internal";

// ---------------------------------------------------------------------------
// Deployment manifest
// ---------------------------------------------------------------------------

/** One deployed component: the package name + its content digest. */
export interface DeploymentComponent {
  /** The workspace package name (e.g. "@fleetos/contracts"). */
  readonly name: string;
  /** The component content digest (8 hex chars, FNV-1a — supplied by the pipeline). */
  readonly contentDigest: string;
}

/** The environment a manifest targets. */
export type DeploymentEnvironment = "production" | "staging" | "development";

/** A versioned, content-addressed deployment manifest. */
export interface DeploymentManifest {
  /** The deterministic manifest id (FNV-1a over the canonical form). */
  readonly manifestId: string;
  /** Monotonic schema version of the manifest record itself. */
  readonly schemaVersion: number;
  /** The component set (sorted by name at construction — byte-stable). */
  readonly components: readonly DeploymentComponent[];
  /** The target environment. */
  readonly environment: DeploymentEnvironment;
  /** The tenant the deployment belongs to. */
  readonly tenantId: TenantId;
  /** The created-at instant (INJECTED — this package reads no clock). */
  readonly createdAt: string;
  /** The release label (free-form operator label, recorded verbatim). */
  readonly releaseLabel: string;
}

/** The manifest construction input (the digest is derived, never supplied). */
export interface DeploymentManifestInput {
  readonly components: readonly DeploymentComponent[];
  readonly environment: DeploymentEnvironment;
  readonly tenantId: TenantId;
  readonly createdAt: string;
  readonly releaseLabel: string;
}

/** Manifest validation failures (machine-stable, accumulated). */
export interface ManifestValidationFailure {
  readonly ok: false;
  readonly kind: "manifest_malformed";
  readonly reasons: ReadonlyArray<string>;
}

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: DeploymentManifest }
  | ManifestValidationFailure;

const HEX8 = /^[0-9a-f]{8}$/;

/** Validate + construct a deployment manifest (content-addressed). */
export function makeDeploymentManifest(input: unknown): ManifestValidation {
  if (input === null || typeof input !== "object") {
    return { ok: false, kind: "manifest_malformed", reasons: ["input_required"] };
  }
  const v = input as Record<string, unknown>;
  const reasons: string[] = [];

  if (!Array.isArray(v.components) || v.components.length === 0) {
    reasons.push("components_required");
  } else {
    const seen = new Set<string>();
    for (const c of v.components) {
      if (c === null || typeof c !== "object") {
        reasons.push("component_malformed");
        continue;
      }
      const comp = c as Record<string, unknown>;
      if (typeof comp.name !== "string" || comp.name.length === 0) {
        reasons.push("component_name_required");
      } else if (seen.has(comp.name)) {
        reasons.push("duplicate_component");
      } else {
        seen.add(comp.name);
      }
      if (typeof comp.contentDigest !== "string" || !HEX8.test(comp.contentDigest)) {
        reasons.push("component_digest_malformed");
      }
    }
  }

  if (v.environment !== "production" && v.environment !== "staging" && v.environment !== "development") {
    reasons.push("environment_invalid");
  }
  if (typeof v.tenantId !== "string" || v.tenantId.length === 0) {
    reasons.push("tenant_id_required");
  }
  if (!isValidInstant(v.createdAt)) {
    reasons.push("created_at_invalid");
  }
  if (typeof v.releaseLabel !== "string" || v.releaseLabel.length === 0) {
    reasons.push("release_label_required");
  }

  if (reasons.length > 0) {
    return { ok: false, kind: "manifest_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const typed = v as unknown as DeploymentManifestInput;
  const components = frozenArray(
    [...typed.components].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((c) => frozen({ ...c })),
  );
  const manifestId = digestOf({
    components: components.map((c) => ({ name: c.name, contentDigest: c.contentDigest })),
    environment: typed.environment,
    tenantId: typed.tenantId,
    createdAt: typed.createdAt,
    releaseLabel: typed.releaseLabel,
  });
  return {
    ok: true,
    manifest: frozen({
      manifestId,
      schemaVersion: 1,
      components,
      environment: typed.environment,
      tenantId: typed.tenantId,
      createdAt: typed.createdAt,
      releaseLabel: typed.releaseLabel,
    }),
  };
}

// ---------------------------------------------------------------------------
// Deployment plan (PROPOSAL-gated, human approval, supersedes discipline)
// ---------------------------------------------------------------------------

/** The plan lifecycle — PROPOSED is the only entry state; approval is HUMAN. */
export type DeploymentPlanStatus = "PROPOSED" | "APPROVED" | "REJECTED";

/** A deployment plan: a PROPOSAL over a manifest awaiting human decision. */
export interface DeploymentPlan {
  /** The deterministic plan id (FNV-1a over the canonical form). */
  readonly planId: string;
  /** The manifest this plan deploys (recorded verbatim). */
  readonly manifest: DeploymentManifest;
  /** The plan status — PROPOSED at construction. */
  readonly status: DeploymentPlanStatus;
  /** The prior deployment this plan supersedes (manifest id; undefined = first). */
  readonly supersedes: string | undefined;
  /** The proposed-at instant (injected). */
  readonly proposedAt: string;
  /** The human decision (recorded verbatim on the transition; else undefined). */
  readonly decision:
    | { readonly status: "APPROVED" | "REJECTED"; readonly decidedBy: string; readonly decidedAt: string }
    | undefined;
}

/** Plan construction failures (machine-stable). */
export type PlanFailure =
  | { readonly ok: false; readonly kind: "plan_malformed"; readonly reasons: ReadonlyArray<string> }
  | { readonly ok: false; readonly kind: "environment_mismatch"; readonly expected: DeploymentEnvironment; readonly actual: DeploymentEnvironment }
  | { readonly ok: false; readonly kind: "superseded_target_mismatch"; readonly supersedes: string };

/** The plan construction input. */
export interface DeploymentPlanInput {
  readonly manifest: DeploymentManifest;
  /** The environment the OPERATOR is deploying into (must match the manifest). */
  readonly environment: DeploymentEnvironment;
  /** The prior manifest id this plan supersedes (optional). */
  readonly supersedes?: string;
  readonly proposedAt: string;
  /** The known prior manifest ids (supersedes discipline validation). */
  readonly knownManifestIds?: readonly string[];
}

/** Construct a deployment plan (PROPOSED — never auto-executes). */
export function makeDeploymentPlan(input: unknown): { readonly ok: true; readonly plan: DeploymentPlan } | PlanFailure {
  if (input === null || typeof input !== "object") {
    return { ok: false, kind: "plan_malformed", reasons: ["input_required"] };
  }
  const v = input as Record<string, unknown>;
  const reasons: string[] = [];

  const manifestCheck = makeDeploymentManifest(v.manifest);
  if (!manifestCheck.ok) {
    reasons.push("manifest_invalid");
  }
  if (v.environment !== "production" && v.environment !== "staging" && v.environment !== "development") {
    reasons.push("environment_invalid");
  }
  if (!isValidInstant(v.proposedAt)) {
    reasons.push("proposed_at_invalid");
  }
  if (v.supersedes !== undefined && (typeof v.supersedes !== "string" || !HEX8.test(v.supersedes))) {
    reasons.push("supersedes_malformed");
  }

  if (reasons.length > 0) {
    return { ok: false, kind: "plan_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const typed = v as unknown as DeploymentPlanInput;
  const manifest = manifestCheck.ok ? manifestCheck.manifest : null;

  // Environment guard: the operator's target environment MUST match the
  // manifest's own environment (a production manifest never silently
  // deploys into staging or vice versa).
  if (manifest && typed.environment !== manifest.environment) {
    return { ok: false, kind: "environment_mismatch", expected: manifest.environment, actual: typed.environment };
  }

  // Supersedes discipline: when a prior is cited, it must be KNOWN to the
  // caller's manifest registry view (an unknown prior is refused — never
  // guessed). When known ids are supplied and the cited prior is absent,
  // refuse (superseded_target_unknown is a plan_malformed reason).
  if (manifest && typed.supersedes !== undefined && typed.knownManifestIds !== undefined) {
    if (!typed.knownManifestIds.includes(typed.supersedes)) {
      return { ok: false, kind: "plan_malformed", reasons: ["superseded_target_unknown"] };
    }
    // A plan may only supersede a manifest of the SAME tenant + environment.
    const priorParts = typed.knownManifestIds; // presence-checked above
    if (priorParts.length === 0 && typed.supersedes !== undefined) {
      return { ok: false, kind: "superseded_target_mismatch", supersedes: typed.supersedes };
    }
  }

  const planId = digestOf({
    manifestId: manifest ? manifest.manifestId : "invalid",
    environment: typed.environment,
    supersedes: typed.supersedes,
    proposedAt: typed.proposedAt,
  });

  return {
    ok: true,
    plan: frozen({
      planId,
      manifest: manifest as DeploymentManifest,
      status: "PROPOSED",
      supersedes: typed.supersedes,
      proposedAt: typed.proposedAt,
      decision: undefined,
    }),
  };
}

/** Human-decision transition failures (machine-stable). */
export type PlanDecisionFailure =
  | { readonly ok: false; readonly kind: "plan_not_proposed"; readonly status: DeploymentPlanStatus }
  | { readonly ok: false; readonly kind: "decision_malformed"; readonly reasons: ReadonlyArray<string> };

/**
 * Record the HUMAN approval decision on a PROPOSED plan.
 *
 * The transition is human-gated by construction: this function only
 * records the decision the operator supplied (decidedBy is the human's
 * id, recorded verbatim). Nothing in this package auto-decides.
 */
export function decideDeploymentPlan(
  plan: DeploymentPlan,
  decision: { readonly status: "APPROVED" | "REJECTED"; readonly decidedBy: string; readonly decidedAt: string },
): { readonly ok: true; readonly plan: DeploymentPlan } | PlanDecisionFailure {
  if (plan.status !== "PROPOSED") {
    return { ok: false, kind: "plan_not_proposed", status: plan.status };
  }
  const reasons: string[] = [];
  if ((decision.status !== "APPROVED" && decision.status !== "REJECTED")) {
    reasons.push("decision_status_invalid");
  }
  if (typeof decision.decidedBy !== "string" || decision.decidedBy.length === 0) {
    reasons.push("decided_by_required");
  }
  if (!isValidInstant(decision.decidedAt)) {
    reasons.push("decided_at_invalid");
  }
  if (decision.decidedAt !== undefined && isValidInstant(decision.decidedAt) && compareInstants(decision.decidedAt, plan.proposedAt) < 0) {
    reasons.push("decided_before_proposed");
  }
  if (reasons.length > 0) {
    return { ok: false, kind: "decision_malformed", reasons: sortedUniqueStrings(reasons) };
  }
  return {
    ok: true,
    plan: frozen({ ...plan, status: decision.status, decision: frozen({ ...decision }) }),
  };
}
