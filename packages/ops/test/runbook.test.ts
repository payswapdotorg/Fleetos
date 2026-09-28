import { describe, expect, test } from "bun:test";
import { compileRunbookProcedure, runbookDigestFor, RUNBOOK_INTENTS } from "../src/runbook";

const GOOD = {
  procedureId: "ops.runbook.release",
  revision: 1,
  steps: [
    { ordinal: 1, intent: "ops.verify", instruction: "run all gates", expectedEvidence: "gate output digest" },
    { ordinal: 2, intent: "ops.backup", instruction: "take a verified backup", expectedEvidence: "backup id + drill" },
    { ordinal: 3, intent: "ops.deploy", instruction: "deploy the approved plan", expectedEvidence: "plan id + approval" },
    { ordinal: 4, intent: "ops.observe", instruction: "watch the health snapshot", expectedEvidence: "snapshot digest" },
    { ordinal: 5, intent: "ops.confirm", instruction: "record the release", expectedEvidence: "release record id" },
  ],
};

describe("W080 D4b — operator runbook procedures", () => {
  test("a well-formed procedure is content-addressed and deterministic", () => {
    const a = compileRunbookProcedure(GOOD);
    const b = compileRunbookProcedure(GOOD);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    if (!b.ok) throw new Error("expected ok");
    expect(a.procedure.digest).toBe(b.procedure.digest);
    expect(a.procedure.digest).toHaveLength(8);
    expect(a.procedure.steps).toHaveLength(5);
  });

  test("the intent vocabulary is frozen (10 verbs)", () => {
    expect(RUNBOOK_INTENTS).toHaveLength(10);
    expect(RUNBOOK_INTENTS).toContain("ops.rollback");
    expect(RUNBOOK_INTENTS).toContain("ops.escalate");
  });

  test("off-vocabulary intents refuse machine-stably", () => {
    const bad = compileRunbookProcedure({
      ...GOOD,
      steps: [{ ordinal: 1, intent: "ops.explode", instruction: "x", expectedEvidence: "y" }],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("intent_vocabulary_invalid");
  });

  test("duplicate intents within one procedure refuse (an operator never performs the same verb twice)", () => {
    const bad = compileRunbookProcedure({
      ...GOOD,
      steps: [
        { ordinal: 1, intent: "ops.verify", instruction: "a", expectedEvidence: "e" },
        { ordinal: 2, intent: "ops.verify", instruction: "b", expectedEvidence: "e" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("duplicate_step_intent");
  });

  test("broken ordinal sequence refuses (step_order_invalid)", () => {
    const bad = compileRunbookProcedure({
      ...GOOD,
      steps: [
        { ordinal: 1, intent: "ops.verify", instruction: "a", expectedEvidence: "e" },
        { ordinal: 3, intent: "ops.deploy", instruction: "b", expectedEvidence: "e" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("step_order_invalid");
  });

  test("ops.rollback must be the LAST step when present", () => {
    const bad = compileRunbookProcedure({
      ...GOOD,
      steps: [
        { ordinal: 1, intent: "ops.rollback", instruction: "roll back", expectedEvidence: "prior digest" },
        { ordinal: 2, intent: "ops.confirm", instruction: "confirm", expectedEvidence: "note" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("rollback_step_not_last");
  });

  test("revision discipline: revision > 1 requires the prior digest; revision 1 cannot supersede", () => {
    const badRev = compileRunbookProcedure({ ...GOOD, revision: 2 });
    expect(badRev.ok).toBe(false);
    if (badRev.ok) return;
    expect(badRev.reasons).toContain("supersedes_required_for_revision");

    const badFirst = compileRunbookProcedure({ ...GOOD, revision: 1, supersedesDigest: "aaaaaaaa" });
    expect(badFirst.ok).toBe(false);
    if (badFirst.ok) return;
    expect(badFirst.reasons).toContain("first_revision_cannot_supersede");

    const goodRev = compileRunbookProcedure({ ...GOOD, revision: 2, supersedesDigest: "aaaaaaaa" });
    expect(goodRev.ok).toBe(true);
  });

  test("runbookDigestFor is byte-stable and matches compile's digest", () => {
    const compiled = compileRunbookProcedure(GOOD);
    if (!compiled.ok) throw new Error("expected ok");
    const manual = runbookDigestFor(GOOD.procedureId, GOOD.revision, undefined, GOOD.steps);
    expect(manual).toBe(compiled.procedure.digest);
  });
});
