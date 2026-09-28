/**
 * @fleetos/ops — D4b: the typed operator runbook.
 *
 * The production-readiness runbook surface:
 *
 *   - `RunbookStep` — one typed step: a machine-stable intent verb, the
 *     expected evidence (what the step must produce — evidence refs +
 *     expected outcome), and the human idempotency key scope;
 *   - `RunbookProcedure` — an ordered, content-addressed procedure
 *     (deterministic FNV-1a digest over the canonical form; versioned —
 *     a revision supersedes its prior by citing it, the prior is never
 *     rewritten);
 *   - `compileRunbookProcedure` — validation with machine-stable
 *     refusals: `steps_required`, `step_order_invalid` (ordinals must
 *     strictly increase by 1 from 1), `intent_vocabulary_invalid`,
 *     `duplicate_step_intent`, `rollback_step_not_last`;
 *   - `runbookDigestFor` — the stable procedure digest (byte-identical
 *     across runs and input permutations).
 *
 * The runbook is DESCRIPTIVE: it never executes anything (the operator
 * does); it is the machine-stable instruction + evidence contract the
 * operator follows and the release gate audits.
 *
 * Pure: no clock/entropy/network. Strict TS; no `any`.
 */

import { digestOf, frozen, frozenArray, sortedUniqueStrings } from "./internal";

// ---------------------------------------------------------------------------
// Runbook steps + procedures
// ---------------------------------------------------------------------------

/** The frozen step-intent vocabulary (machine-stable verbs). */
export const RUNBOOK_INTENTS: ReadonlyArray<string> = frozenArray([
  "ops.verify",
  "ops.prepare",
  "ops.deploy",
  "ops.observe",
  "ops.backup",
  "ops.restore",
  "ops.migrate",
  "ops.rollback",
  "ops.escalate",
  "ops.confirm",
]);

/** One typed runbook step. */
export interface RunbookStep {
  /** The step ordinal (1-based, strictly increasing by 1). */
  readonly ordinal: number;
  /** The machine-stable intent verb (from the frozen vocabulary). */
  readonly intent: string;
  /** The instruction for the operator (human-readable, recorded verbatim). */
  readonly instruction: string;
  /** The evidence the step must produce (machine-stable field description). */
  readonly expectedEvidence: string;
}

/** A typed, content-addressed operator procedure. */
export interface RunbookProcedure {
  /** The procedure id (machine-stable, dot-namespaced). */
  readonly procedureId: string;
  /** The procedure revision (1-based). */
  readonly revision: number;
  /** The prior revision's digest this one supersedes (undefined = first). */
  readonly supersedesDigest: string | undefined;
  /** The ordered steps. */
  readonly steps: readonly RunbookStep[];
  /** The deterministic procedure digest. */
  readonly digest: string;
}

/** Procedure compilation failures (machine-stable, accumulated). */
export interface RunbookFailure {
  readonly ok: false;
  readonly kind: "runbook_malformed";
  readonly reasons: ReadonlyArray<string>;
}

export type RunbookResult =
  | { readonly ok: true; readonly procedure: RunbookProcedure }
  | RunbookFailure;

const PROCEDURE_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;
const INTENT_SET = new Set<string>(RUNBOOK_INTENTS);

/**
 * Compile a runbook procedure — machine-stable discipline:
 *
 *   - ordinals strictly increase by 1 from 1 (`step_order_invalid`);
 *   - every intent is from the FROZEN vocabulary
 *     (`intent_vocabulary_invalid`);
 *   - intents are UNIQUE within a procedure (`duplicate_step_intent`)
 *     — an operator never performs the same verb twice in one run;
 *   - `ops.rollback`, when present, is the LAST step
 *     (`rollback_step_not_last`);
 *   - a revision > 1 must cite the prior revision's digest.
 */
export function compileRunbookProcedure(input: unknown): RunbookResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, kind: "runbook_malformed", reasons: ["input_required"] };
  }
  const v = input as Record<string, unknown>;
  const reasons: string[] = [];

  if (typeof v.procedureId !== "string" || !PROCEDURE_ID.test(v.procedureId)) reasons.push("procedure_id_invalid");
  if (typeof v.revision !== "number" || !Number.isInteger(v.revision) || v.revision < 1) reasons.push("revision_invalid");
  if (typeof v.revision === "number" && v.revision > 1 && (typeof v.supersedesDigest !== "string" || v.supersedesDigest.length !== 8)) {
    reasons.push("supersedes_required_for_revision");
  }
  if (v.revision === 1 && v.supersedesDigest !== undefined) {
    reasons.push("first_revision_cannot_supersede");
  }
  if (!Array.isArray(v.steps) || v.steps.length === 0) {
    reasons.push("steps_required");
  } else {
    const rawSteps = v.steps as readonly Record<string, unknown>[];
    const intents = new Set<string>();
    rawSteps.forEach((s, i) => {
      if (s === null || typeof s !== "object") {
        reasons.push("step_malformed");
        return;
      }
      if (typeof s.ordinal !== "number" || s.ordinal !== i + 1) reasons.push("step_order_invalid");
      if (typeof s.intent !== "string" || !INTENT_SET.has(s.intent)) reasons.push("intent_vocabulary_invalid");
      else if (intents.has(s.intent)) reasons.push("duplicate_step_intent");
      else intents.add(s.intent);
      if (typeof s.instruction !== "string" || s.instruction.length === 0) reasons.push("instruction_required");
      if (typeof s.expectedEvidence !== "string" || s.expectedEvidence.length === 0) reasons.push("expected_evidence_required");
    });
    // rollback is terminal when present
    if (rawSteps.length > 0) {
      const last = rawSteps[rawSteps.length - 1] as Record<string, unknown> | null;
      const hasRollback = rawSteps.some(
        (s) => s !== null && typeof s === "object" && (s as Record<string, unknown>).intent === "ops.rollback",
      );
      if (hasRollback && last !== null && typeof last === "object" && last.intent !== "ops.rollback") {
        reasons.push("rollback_step_not_last");
      }
    }
  }

  if (reasons.length > 0) {
    return { ok: false, kind: "runbook_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const typed = v as {
    procedureId: string;
    revision: number;
    supersedesDigest: string | undefined;
    steps: readonly RunbookStep[];
  };
  const steps = frozenArray(typed.steps.map((s) => frozen({ ...s })));
  const digest = digestOf({
    procedureId: typed.procedureId,
    revision: typed.revision,
    supersedesDigest: typed.supersedesDigest,
    steps,
  });
  return {
    ok: true,
    procedure: frozen({
      procedureId: typed.procedureId,
      revision: typed.revision,
      supersedesDigest: typed.supersedesDigest,
      steps,
      digest,
    }),
  };
}

/**
 * The stable procedure digest over a canonical step view — used by
 * revisions to cite their prior (byte-identical across runs; the exact
 * same digest basis `compileRunbookProcedure` uses).
 */
export function runbookDigestFor(
  procedureId: string,
  revision: number,
  supersedesDigest: string | undefined,
  steps: readonly RunbookStep[],
): string {
  return digestOf({ procedureId, revision, supersedesDigest, steps });
}
