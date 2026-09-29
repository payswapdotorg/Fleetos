/**
 * W091 [TL] — the Evidence & Audit view-model tests (pure logic).
 *
 * Covers: trail construction with machine-stable step ordering, the
 * step cap, cross-tenant fail-closed refusal, machine-stable
 * validation failures, the index's deterministic row ordering, and
 * deep-frozen outputs.
 */
import { describe, expect, test } from "bun:test";
import { buildEvidenceTrail, buildEvidenceIndex, TRAIL_STEP_LIMIT } from "../src/evidence-view";
import { makeTenantId } from "@fleetos/contracts/testing";

const TENANT = makeTenantId("w091-evid");
const SCOPE = { tenantId: TENANT };

interface Auditish {
  readonly recordId: string;
  readonly tenantId: ReturnType<typeof makeTenantId>;
  readonly actor: string;
  readonly action: string;
  readonly at: string;
  readonly outcome: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly stage: string;
}

function rec(index: number, at: string, stage = `stage_${index}`): Auditish {
  return {
    recordId: `aud_${String(index).padStart(3, "0")}`,
    tenantId: TENANT,
    actor: "user:op1",
    action: `domain.act.${index}`,
    at,
    outcome: "success",
    correlationId: "cor_1",
    evidenceRefs: [`evidence/ref-${index}`],
    stage,
  };
}

describe("W091 Evidence trail view-model", () => {
  test("steps order by injected instant then record id — input order never matters; output deep-frozen", () => {
    const later = rec(2, "2026-01-06T12:00:00Z");
    const earlier = rec(1, "2026-01-06T09:00:00Z");
    const a = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: [later, earlier],
      chainState: "verified",
    });
    const b = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: [earlier, later],
      chainState: "verified",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.trail.steps.map((s) => s.recordId)).toEqual(["aud_001", "aud_002"]);
    expect(b.trail.steps.map((s) => s.recordId)).toEqual(a.trail.steps.map((s) => s.recordId));
    expect(Object.isFrozen(a.trail)).toBe(true);
    expect(Object.isFrozen(a.trail.steps)).toBe(true);
    expect(a.trail.chainState).toBe("verified");
  });

  test("the trail step cap is the frozen bound", () => {
    const many = Array.from({ length: TRAIL_STEP_LIMIT + 10 }, (_, i) =>
      rec(i, `2026-01-0${(i % 8) + 1}T09:00:00Z`),
    );
    const result = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: many,
      chainState: "verified",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trail.steps.length).toBe(TRAIL_STEP_LIMIT);
  });

  test("cross-tenant records REFUSE fail-closed with the path", () => {
    const foreign = { ...rec(1, "2026-01-06T09:00:00Z"), tenantId: makeTenantId("w091-other") };
    const result = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: [rec(2, "2026-01-06T10:00:00Z"), foreign],
      chainState: "verified",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cross_tenant_audit");
    expect(result.path).toBe("records[1]");
  });

  test("blank stage labels and empty steps refuse machine-stably", () => {
    const blankStage = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: [{ ...rec(1, "2026-01-06T09:00:00Z"), stage: "  " }],
      chainState: "verified",
    });
    expect(blankStage.ok).toBe(false);
    if (blankStage.ok) return;
    expect(blankStage.reason).toBe("invalid_stage");

    const empty = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: "sub_1",
      subjectTitle: "Subject One",
      subjectArea: "actions",
      records: [],
      chainState: "verified",
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.reason).toBe("empty_steps");
  });
});

describe("W091 Evidence index view-model", () => {
  test("rows order by subject area then subject id — machine-stable", () => {
    const trails = [
      {
        scope: SCOPE,
        subjectId: "sub_b",
        subjectTitle: "B",
        subjectArea: "device" as const,
        records: [rec(1, "2026-01-06T09:00:00Z")],
        chainState: "verified" as const,
      },
      {
        scope: SCOPE,
        subjectId: "sub_a",
        subjectTitle: "A",
        subjectArea: "actions" as const,
        records: [rec(2, "2026-01-06T10:00:00Z")],
        chainState: "verified" as const,
      },
    ];
    const result = buildEvidenceIndex(SCOPE, trails);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.subjectId)).toEqual(["sub_a", "sub_b"]);
    expect(result.rows[0]!.stepCount).toBe(1);
    expect(result.rows[0]!.firstAt).toBe("2026-01-06T10:00:00Z");
    expect(result.rows[0]!.lastAt).toBe("2026-01-06T10:00:00Z");
    expect(Object.isFrozen(result.rows)).toBe(true);
  });

  test("an invalid trail inside the index refuses with the trail's path", () => {
    const result = buildEvidenceIndex(SCOPE, [
      {
        scope: SCOPE,
        subjectId: "sub_x",
        subjectTitle: "X",
        subjectArea: "actions" as const,
        records: [],
        chainState: "verified" as const,
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_trail");
    expect(result.path).toBe("trails[0]");
  });
});
