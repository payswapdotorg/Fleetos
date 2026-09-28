/**
 * @fleetos/ops — D4a: end-to-end journey evidence.
 *
 * The production-readiness E2E evidence surface:
 *
 *   - `JourneyEvidenceStep` — one step of an operational journey with
 *     its evidence refs (opaque content-addressed strings) + the
 *     machine-stable step outcome;
 *   - `E2EEvidenceBundle` — the per-journey evidence bundle: the
 *     journey id, the covered record kinds, the ordered steps, and the
 *     deterministic bundle digest (FNV-1a over the canonical form);
 *   - `compileE2EEvidence` — validation with the W071
 *     destructive-review discipline: a MISSING evidence ref or outcome
 *     refuses `evidence_incomplete` with the SORTED list of missing
 *     field paths — BEFORE anything is consumed (fail-fast);
 *   - `E2ECoverageReport` — the release-gate input: which journeys
 *     have COMPLETE bundles + which are missing (the four W061 shell
 *     journeys are the canonical coverage vocabulary at the binding
 *     site — REAL @fleetos/web-shell builtin journeys bind in test/).
 *
 * Machine-stable refusals: `evidence_incomplete`, `bundle_malformed`,
 * `journey_unknown`.
 *
 * Pure: instants injected; no clock/entropy/network. Strict TS; no `any`.
 */

import { digestOf, frozen, frozenArray, isValidInstant, sortedUniqueStrings } from "./internal";

// ---------------------------------------------------------------------------
// Evidence steps + bundles
// ---------------------------------------------------------------------------

/** One step's machine-stable outcome. */
export type EvidenceStepOutcome = "SUCCEEDED" | "FAILED" | "SKIPPED";

/** One journey step with its evidence. */
export interface JourneyEvidenceStep {
  /** The step's machine-stable ordinal (1-based, strictly increasing). */
  readonly ordinal: number;
  /** The step description vocabulary entry (machine-stable, dot-namespaced). */
  readonly step: string;
  /** The evidence refs (opaque content-addressed strings — never interpreted here). */
  readonly evidenceRefs: readonly string[];
  /** The outcome. */
  readonly outcome: EvidenceStepOutcome;
}

/** A complete E2E evidence bundle for one journey. */
export interface E2EEvidenceBundle {
  /** The journey id (the coverage vocabulary's id — recorded verbatim). */
  readonly journeyId: string;
  /** The record kinds the journey covers (sorted at construction). */
  readonly recordKinds: readonly string[];
  /** The ordered evidence steps. */
  readonly steps: readonly JourneyEvidenceStep[];
  /** The captured-at instant (injected). */
  readonly capturedAt: string;
  /** The deterministic bundle digest. */
  readonly bundleDigest: string;
}

const STEP_VOCAB = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

/** Bundle compilation failures (machine-stable, accumulated). */
export type BundleFailure =
  | { readonly ok: false; readonly kind: "bundle_malformed"; readonly reasons: ReadonlyArray<string> }
  | { readonly ok: false; readonly kind: "evidence_incomplete"; readonly missing: ReadonlyArray<string> };

export type BundleResult =
  | { readonly ok: true; readonly bundle: E2EEvidenceBundle }
  | BundleFailure;

/**
 * Compile an E2E evidence bundle — fail-fast on INCOMPLETE evidence
 * (the W071 discipline): every step must carry at least one non-empty
 * evidence ref and a valid outcome; ordinals strictly increase by 1
 * from 1; a FAILED or SKIPPED outcome still requires its evidence (the
 * step's proof of attempt). Missing pieces refuse with the SORTED
 * field-path list.
 */
export function compileE2EEvidence(input: unknown): BundleResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, kind: "bundle_malformed", reasons: ["input_required"] };
  }
  const v = input as Record<string, unknown>;
  const malformed: string[] = [];

  if (typeof v.journeyId !== "string" || v.journeyId.length === 0) malformed.push("journey_id_required");
  if (!Array.isArray(v.recordKinds) || v.recordKinds.length === 0) malformed.push("record_kinds_required");
  else if (v.recordKinds.some((k) => typeof k !== "string" || k.length === 0)) malformed.push("record_kind_malformed");
  if (!Array.isArray(v.steps) || v.steps.length === 0) malformed.push("steps_required");
  if (!isValidInstant(v.capturedAt)) malformed.push("captured_at_invalid");

  if (malformed.length > 0) {
    return { ok: false, kind: "bundle_malformed", reasons: sortedUniqueStrings(malformed) };
  }

  // Evidence completeness (fail-fast, sorted missing paths).
  const missing: string[] = [];
  const typedSteps: JourneyEvidenceStep[] = [];
  const rawSteps = v.steps as readonly Record<string, unknown>[];

  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i];
    if (s === null || typeof s !== "object") {
      malformed.push("step_malformed");
      continue;
    }
    const ordinal = i + 1;
    if (typeof s.ordinal !== "number" || s.ordinal !== ordinal) {
      malformed.push("ordinal_sequence_broken");
    }
    if (typeof s.step !== "string" || !STEP_VOCAB.test(s.step)) {
      malformed.push("step_vocabulary_invalid");
    }
    if (s.outcome !== "SUCCEEDED" && s.outcome !== "FAILED" && s.outcome !== "SKIPPED") {
      malformed.push("outcome_invalid");
    }
    if (!Array.isArray(s.evidenceRefs)) {
      missing.push(`steps[${i}].evidenceRefs`);
    } else {
      const refs = s.evidenceRefs as unknown[];
      if (refs.length === 0) missing.push(`steps[${i}].evidenceRefs`);
      else if (refs.some((r) => typeof r !== "string" || r.length === 0)) missing.push(`steps[${i}].evidenceRefs`);
    }
    typedSteps.push({
      ordinal: s.ordinal as number,
      step: s.step as string,
      evidenceRefs: Array.isArray(s.evidenceRefs) ? (s.evidenceRefs as string[]) : [],
      outcome: s.outcome as EvidenceStepOutcome,
    });
  }

  if (malformed.length > 0) {
    return { ok: false, kind: "bundle_malformed", reasons: sortedUniqueStrings(malformed) };
  }
  if (missing.length > 0) {
    return { ok: false, kind: "evidence_incomplete", missing: sortedUniqueStrings(missing) };
  }

  const journeyId = v.journeyId as string;
  const recordKinds = sortedUniqueStrings(v.recordKinds as string[]);
  const steps = frozenArray(
    typedSteps.map((s) => frozen({ ...s, evidenceRefs: frozenArray([...s.evidenceRefs]) })),
  );
  const bundleDigest = digestOf({
    journeyId,
    recordKinds,
    steps,
    capturedAt: v.capturedAt,
  });

  return {
    ok: true,
    bundle: frozen({ journeyId, recordKinds, steps, capturedAt: v.capturedAt as string, bundleDigest }),
  };
}

// ---------------------------------------------------------------------------
// Coverage report (the release-gate input)
// ---------------------------------------------------------------------------

/** The E2E coverage report — complete + missing journeys. */
export interface E2ECoverageReport {
  /** The journeys with COMPLETE bundles (sorted by journeyId). */
  readonly covered: readonly string[];
  /** The required journeys with NO complete bundle (sorted). */
  readonly missing: readonly string[];
  /** True when `missing` is empty (the release-gate condition). */
  readonly complete: boolean;
}

/**
 * Compile the coverage report over the required journey vocabulary
 * against the collected bundles: a journey is covered ONLY by a
 * complete bundle with the SAME journeyId (unknown bundles are ignored
 * — `journey_unknown` is reported in `extraneous`, never counted).
 */
export function compileCoverageReport(
  requiredJourneys: readonly string[],
  bundles: readonly E2EEvidenceBundle[],
): E2ECoverageReport & { readonly extraneous: ReadonlyArray<string> } {
  const required = new Set(requiredJourneys);
  const coveredSet = new Set<string>();
  const extraneous: string[] = [];
  for (const b of bundles) {
    if (required.has(b.journeyId)) coveredSet.add(b.journeyId);
    else extraneous.push(b.journeyId);
  }
  const covered = [...coveredSet].sort();
  const missing = [...required].filter((j) => !coveredSet.has(j)).sort();
  return frozen({
    covered: frozenArray(covered),
    missing: frozenArray(missing),
    complete: missing.length === 0,
    extraneous: frozenArray([...new Set(extraneous)].sort()),
  });
}
