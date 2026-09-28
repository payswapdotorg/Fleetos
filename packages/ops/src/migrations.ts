/**
 * @fleetos/ops — D3b: versioned migrations + the migration runner.
 *
 * The production-readiness migration surface:
 *
 *   - `MigrationStep` — one versioned migration: a machine-stable id,
 *     a strictly increasing version, the target store, and a content
 *     digest over the migration body (content-addressed migrations);
 *   - `MigrationSet` — an ORDERED, digest-CHAINED migration set (each
 *     step's chain digest cites the prior step's — the audit-chain
 *     discipline, tamper-evident by construction);
 *   - `compileMigrationSet` — validation + chain construction with
 *     machine-stable refusals: `versions_not_increasing`,
 *     `duplicate_version`, `duplicate_id`, `empty_set`,
 *     `frozen_surface` (a migration whose target is the contracts
 *     package — ARCHITECTURE-LOCK: the shared seam is FROZEN; the
 *     snapshot digest changes only through a TL ADR, never a
 *     migration), `step_malformed`;
 *   - `MigrationState` / `applyMigrations` — the idempotent runner
 *     over an injected applied-state view: refuses `sequence_gap`
 *     (state at version N, next step is > N+1), `downgrade` (a step
 *     at or below the applied version), `digest_mismatch` (the applied
 *     digest at version N differs from the set's step at N). The
 *     returned state records every applied step verbatim.
 *
 * Pure: instants injected; no clock/entropy/network. Strict TS; no `any`.
 */

import { canonicalJson, digestOf, frozen, frozenArray, sortedUniqueStrings } from "./internal";

// ---------------------------------------------------------------------------
// Migration steps + sets
// ---------------------------------------------------------------------------

/** One versioned migration step. */
export interface MigrationStep {
  /** Machine-stable migration id (dot-namespaced, unique in the set). */
  readonly id: string;
  /** The strictly increasing schema version this step migrates TO. */
  readonly version: number;
  /** The store this step migrates (machine-stable package/store name). */
  readonly target: string;
  /** The content digest over the migration body (8 hex — supplied by the author). */
  readonly bodyDigest: string;
  /** Human-readable description (recorded verbatim; never interpreted). */
  readonly description: string;
}

/** An ordered, digest-chained migration set. */
export interface MigrationSet {
  /** The steps in strictly increasing version order. */
  readonly steps: readonly MigrationStep[];
  /** The set digest (FNV-1a over the canonical chain — the LAST step's chain digest). */
  readonly setDigest: string;
}

const HEX8 = /^[0-9a-f]{8}$/;
const MIGRATION_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

/** The chain digest for step i: fnv(chain_{i-1} || canonical(step_i)). */
function chainDigest(steps: readonly MigrationStep[], index: number): string {
  const prior = index === 0 ? "genesis" : chainDigest(steps, index - 1);
  return digestOf({ prior, step: canonicalJson(steps[index]) });
}

/** Migration set compilation failures (machine-stable, accumulated). */
export interface MigrationSetFailure {
  readonly ok: false;
  readonly kind: "migration_set_malformed";
  readonly reasons: ReadonlyArray<string>;
}

export type MigrationSetResult =
  | { readonly ok: true; readonly set: MigrationSet }
  | MigrationSetFailure;

/**
 * Compile a migration set: validate every step, refuse FROZEN-surface
 * targets (the contracts package — ARCHITECTURE-LOCK), enforce strictly
 * increasing versions + unique ids, and build the digest chain.
 */
export function compileMigrationSet(steps: readonly unknown[]): MigrationSetResult {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, kind: "migration_set_malformed", reasons: ["empty_set"] };
  }
  const reasons: string[] = [];
  const typed: MigrationStep[] = [];
  const ids = new Set<string>();
  const versions = new Set<number>();

  for (const s of steps) {
    if (s === null || typeof s !== "object") {
      reasons.push("step_malformed");
      continue;
    }
    const v = s as Record<string, unknown>;
    if (typeof v.id !== "string" || !MIGRATION_ID.test(v.id)) {
      reasons.push("step_id_invalid");
    } else if (ids.has(v.id)) {
      reasons.push("duplicate_id");
    } else {
      ids.add(v.id);
    }
    if (typeof v.version !== "number" || !Number.isInteger(v.version) || v.version < 1) {
      reasons.push("step_version_invalid");
    } else if (versions.has(v.version)) {
      reasons.push("duplicate_version");
    } else {
      versions.add(v.version);
    }
    if (typeof v.target !== "string" || v.target.length === 0) {
      reasons.push("step_target_required");
    } else if (v.target === "@fleetos/contracts") {
      // ARCHITECTURE-LOCK: the shared seam is FROZEN. Migrations may
      // never target it (a contracts change is a TL ADR, not a
      // migration).
      reasons.push("frozen_surface");
    }
    if (typeof v.bodyDigest !== "string" || !HEX8.test(v.bodyDigest)) {
      reasons.push("body_digest_malformed");
    }
    if (typeof v.description !== "string" || v.description.length === 0) {
      reasons.push("description_required");
    }
    typed.push({
      id: v.id as string,
      version: v.version as number,
      target: v.target as string,
      bodyDigest: v.bodyDigest as string,
      description: v.description as string,
    });
  }

  // Strictly increasing version ORDER (the input array must already be
  // in version order — the runner applies in order).
  for (let i = 1; i < typed.length; i++) {
    if (typed[i].version <= typed[i - 1].version) {
      reasons.push("versions_not_increasing");
      break;
    }
  }

  if (reasons.length > 0) {
    return { ok: false, kind: "migration_set_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const frozenSteps = frozenArray(typed.map((s) => frozen({ ...s })));
  return {
    ok: true,
    set: frozen({ steps: frozenSteps, setDigest: chainDigest(frozenSteps, frozenSteps.length - 1) }),
  };
}

// ---------------------------------------------------------------------------
// The migration runner (idempotent, fail-closed against state drift)
// ---------------------------------------------------------------------------

/** One applied-step record in the migration state. */
export interface AppliedStep {
  readonly id: string;
  readonly version: number;
  readonly bodyDigest: string;
  readonly appliedAt: string;
}

/** The migration state view (the applied history — INJECTED at the binding site). */
export interface MigrationState {
  /** The applied steps in application order (strictly increasing version). */
  readonly applied: readonly AppliedStep[];
}

/** The runner outcome: every step applied now, or already applied before. */
export interface MigrationRunResult {
  /** The steps that were applied BY THIS RUN (application order). */
  readonly appliedNow: readonly AppliedStep[];
  /** The steps that were already applied BEFORE this run. */
  readonly alreadyApplied: readonly AppliedStep[];
  /** The resulting full state (prior applied + newly applied). */
  readonly resultingState: MigrationState;
}

/** Runner refusals (machine-stable — fail-closed against state drift). */
export type MigrationRunFailure =
  | { readonly ok: false; readonly kind: "sequence_gap"; readonly expectedNext: number; readonly found: number }
  | { readonly ok: false; readonly kind: "downgrade"; readonly appliedVersion: number; readonly stepVersion: number }
  | { readonly ok: false; readonly kind: "digest_mismatch"; readonly version: number }
  | { readonly ok: false; readonly kind: "state_malformed"; readonly reasons: ReadonlyArray<string> };

/**
 * Apply a compiled migration set to an injected state view — IDEMPOTENT
 * and fail-closed:
 *
 *   1. steps already in the state (by version, digest matching) are
 *      skipped (idempotent re-runs converge);
 *   2. a step at or below the applied version that is NOT in the state
 *      → `digest_mismatch` (the state's history disagrees with the set);
 *   3. the first not-yet-applied step must be exactly appliedVersion+1
 *      → else `sequence_gap` (never silently skipped);
 *   4. a fully-applied set re-runs to a no-op.
 */
export function applyMigrations(
  migrationSet: MigrationSet,
  state: MigrationState,
  appliedAt: string,
): { readonly ok: true; readonly result: MigrationRunResult } | MigrationRunFailure {
  // State validation: applied steps strictly increasing, well-formed.
  const reasons: string[] = [];
  for (let i = 0; i < state.applied.length; i++) {
    const a = state.applied[i];
    if (typeof a.version !== "number" || !Number.isInteger(a.version) || a.version < 1) {
      reasons.push("applied_version_invalid");
    }
    if (typeof a.id !== "string" || a.id.length === 0) reasons.push("applied_id_invalid");
    if (typeof a.bodyDigest !== "string" || !HEX8.test(a.bodyDigest)) reasons.push("applied_digest_invalid");
    if (typeof a.appliedAt !== "string" || a.appliedAt.length === 0) reasons.push("applied_at_invalid");
    if (i > 0 && typeof a.version === "number" && a.version <= state.applied[i - 1].version) {
      reasons.push("applied_not_increasing");
    }
  }
  if (reasons.length > 0) {
    return { ok: false, kind: "state_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const appliedByVersion = new Map<number, AppliedStep>();
  for (const a of state.applied) appliedByVersion.set(a.version, a);
  const appliedVersion = state.applied.length > 0 ? state.applied[state.applied.length - 1].version : 0;

  const appliedNow: AppliedStep[] = [];
  const alreadyApplied: AppliedStep[] = [];
  // The RUNNING cursor: advances with every step applied in THIS run
  // (and starts at the state's applied version) — gaps are judged
  // against the cursor, never against the stale original version.
  let currentVersion = appliedVersion;

  for (const step of migrationSet.steps) {
    const existing = appliedByVersion.get(step.version);
    if (existing !== undefined) {
      // Already applied: the recorded digest MUST match the set's step
      // (history drift is a hard refusal — never silently retried).
      if (existing.bodyDigest !== step.bodyDigest || existing.id !== step.id) {
        return { ok: false, kind: "digest_mismatch", version: step.version };
      }
      alreadyApplied.push(existing);
      continue;
    }
    if (step.version <= currentVersion) {
      // Not in the state but at/below the applied version: downgrade or
      // missing history — refused.
      return { ok: false, kind: "downgrade", appliedVersion: currentVersion, stepVersion: step.version };
    }
    // The next not-yet-applied step must be exactly cursor+1 (never a
    // silently skipped version).
    if (step.version > currentVersion + 1) {
      return { ok: false, kind: "sequence_gap", expectedNext: currentVersion + 1, found: step.version };
    }
    appliedNow.push(frozen({ id: step.id, version: step.version, bodyDigest: step.bodyDigest, appliedAt }));
    currentVersion = step.version;
  }

  return {
    ok: true,
    result: frozen({
      appliedNow: frozenArray(appliedNow),
      alreadyApplied: frozenArray(alreadyApplied),
      resultingState: frozen({
        applied: frozenArray([...state.applied, ...appliedNow]),
      }),
    }),
  };
}
