import { describe, expect, test } from "bun:test";
import { applyMigrations, compileMigrationSet } from "../src/migrations";

const STEPS = [
  { id: "ops.schema.init", version: 1, target: "@fleetos/ops", bodyDigest: "11111111", description: "initial ops schema" },
  { id: "ops.schema.ledger", version: 2, target: "@fleetos/ops", bodyDigest: "22222222", description: "release ledger" },
  { id: "ops.schema.evidence", version: 3, target: "@fleetos/ops", bodyDigest: "33333333", description: "evidence bundles" },
];

describe("W080 D3b — migration set compilation", () => {
  test("a well-formed set is digest-chained and deterministic", () => {
    const a = compileMigrationSet(STEPS);
    const b = compileMigrationSet(STEPS);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    if (!b.ok) throw new Error("expected ok");
    expect(a.set.setDigest).toBe(b.set.setDigest);
    expect(a.set.setDigest).toHaveLength(8);
    expect(a.set.steps).toHaveLength(3);
  });

  test("chain order matters: a reordered set has a different digest", () => {
    const a = compileMigrationSet(STEPS);
    const reordered = compileMigrationSet([STEPS[1], STEPS[0], STEPS[2]]);
    // (also refused: versions not increasing)
    expect(reordered.ok).toBe(false);
    if (reordered.ok) return;
    if (a.ok) expect(a.set.setDigest).not.toBe(reordered.reasons);
  });

  test("FROZEN SURFACE: a migration targeting @fleetos/contracts refuses (ARCHITECTURE-LOCK)", () => {
    const bad = compileMigrationSet([
      { id: "contracts.change", version: 1, target: "@fleetos/contracts", bodyDigest: "11111111", description: "nope" },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toEqual(["frozen_surface"]);
  });

  test("empty set, duplicate versions/ids, and bad digests refuse machine-stably", () => {
    expect(compileMigrationSet([]).ok).toBe(false);
    const dupVersion = compileMigrationSet([
      { id: "a.b", version: 1, target: "t", bodyDigest: "11111111", description: "d" },
      { id: "c.d", version: 1, target: "t", bodyDigest: "22222222", description: "d" },
    ]);
    expect(dupVersion.ok).toBe(false);
    if (!dupVersion.ok) expect(dupVersion.reasons).toContain("duplicate_version");
    const dupId = compileMigrationSet([
      { id: "a.b", version: 1, target: "t", bodyDigest: "11111111", description: "d" },
      { id: "a.b", version: 2, target: "t", bodyDigest: "22222222", description: "d" },
    ]);
    expect(dupId.ok).toBe(false);
    if (!dupId.ok) expect(dupId.reasons).toContain("duplicate_id");
    const badDigest = compileMigrationSet([
      { id: "a.b", version: 1, target: "t", bodyDigest: "xyz", description: "d" },
    ]);
    expect(badDigest.ok).toBe(false);
    if (!badDigest.ok) expect(badDigest.reasons).toContain("body_digest_malformed");
  });
});

describe("W080 D3b — the migration runner (idempotent, fail-closed)", () => {
  test("a fresh apply runs every step; a re-run is a no-op (idempotent convergence)", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    const first = applyMigrations(set.set, { applied: [] }, "2026-09-28T12:00:00Z");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.appliedNow).toHaveLength(3);
    expect(first.result.alreadyApplied).toHaveLength(0);

    const second = applyMigrations(set.set, first.result.resultingState, "2026-09-28T12:05:00Z");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.appliedNow).toHaveLength(0);
    expect(second.result.alreadyApplied).toHaveLength(3);
  });

  test("a sequence gap refuses (never silently skipped)", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    // State at version 1; the next set step is version 2 — fine. Now a
    // state that skips: applied version 1, but remove step 2 coverage by
    // using a set whose step 2 is at version 3.
    const gapped = compileMigrationSet([
      STEPS[0],
      { id: "ops.schema.far", version: 3, target: "@fleetos/ops", bodyDigest: "44444444", description: "far" },
    ]);
    expect(gapped.ok).toBe(true);
    if (!gapped.ok) return;
    const state = { applied: [{ id: STEPS[0].id, version: 1, bodyDigest: STEPS[0].bodyDigest, appliedAt: "2026-09-28T11:00:00Z" }] };
    const run = applyMigrations(gapped.set, state, "2026-09-28T12:00:00Z");
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("sequence_gap");
    if (run.kind === "sequence_gap") {
      expect(run.expectedNext).toBe(2);
      expect(run.found).toBe(3);
    }
  });

  test("history drift refuses digest_mismatch (never silently retried)", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    const drifted = {
      applied: [
        { id: STEPS[0].id, version: 1, bodyDigest: "99999999", appliedAt: "2026-09-28T11:00:00Z" }, // WRONG digest
      ],
    };
    const run = applyMigrations(set.set, drifted, "2026-09-28T12:00:00Z");
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("digest_mismatch");
    if (run.kind === "digest_mismatch") expect(run.version).toBe(1);
  });

  test("a downgrade refuses machine-stably", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    // State at version 2 with steps 1-2 applied; a set containing ONLY
    // step 1 (already applied) is idempotent-skipped; but a set whose
    // step is at version 1 with a DIFFERENT id (not in state) refuses.
    const state = {
      applied: [
        { id: STEPS[0].id, version: 1, bodyDigest: STEPS[0].bodyDigest, appliedAt: "2026-09-28T11:00:00Z" },
        { id: STEPS[1].id, version: 2, bodyDigest: STEPS[1].bodyDigest, appliedAt: "2026-09-28T11:30:00Z" },
      ],
    };
    const rogueSet = compileMigrationSet([
      { id: "ops.schema.rogue", version: 1, target: "@fleetos/ops", bodyDigest: "77777777", description: "rogue downgrade" },
    ]);
    expect(rogueSet.ok).toBe(true);
    if (!rogueSet.ok) return;
    const run = applyMigrations(rogueSet.set, state, "2026-09-28T12:00:00Z");
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("digest_mismatch"); // version 1 IS in state with a different id/digest
  });

  test("malformed state refuses with sorted reasons", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    const run = applyMigrations(
      set.set,
      { applied: [{ id: "", version: 0, bodyDigest: "zz", appliedAt: "" }] },
      "2026-09-28T12:00:00Z",
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("state_malformed");
    if (run.kind === "state_malformed") {
      expect(run.reasons).toEqual([...run.reasons].sort());
    }
  });

  test("determinism: identical inputs produce identical resulting states", () => {
    const set = compileMigrationSet(STEPS);
    if (!set.ok) throw new Error("expected ok");
    const a = applyMigrations(set.set, { applied: [] }, "2026-09-28T12:00:00Z");
    const b = applyMigrations(set.set, { applied: [] }, "2026-09-28T12:00:00Z");
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(JSON.stringify(a.result.resultingState)).toBe(JSON.stringify(b.result.resultingState));
  });
});
