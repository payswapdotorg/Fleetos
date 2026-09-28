import { test, expect } from "bun:test";
import {
  BUILTIN_JOURNEYS,
  builtinJourneysValidate,
  checkJourneyDescriptor,
  journeyDigest,
  journeyProgress,
  journeyRecordKinds,
  journeyRoutes,
} from "../src/journeys";

test("every builtin journey validates against the route vocabulary", () => {
  for (const check of builtinJourneysValidate()) {
    expect(check.ok).toBe(true);
  }
  expect(BUILTIN_JOURNEYS).toHaveLength(4);
});

test("journey descriptors with invalid steps refuse with the step index", () => {
  const bad = checkJourneyDescriptor({
    journeyId: "bad",
    title: "Bad",
    steps: [
      { area: "security", view: "findings", recordKind: "x", purpose: "observe" },
      { area: "security", view: "nonsense", recordKind: "x", purpose: "observe" },
    ],
  });
  expect(bad).toEqual({ ok: false, reason: "invalid_step_route", stepIndex: 1 });
  const empty = checkJourneyDescriptor({ journeyId: "e", title: "E", steps: [] });
  expect(empty.ok).toBe(false);
  if (empty.ok) throw new Error("unreachable");
  expect(empty.reason).toBe("empty_steps");
});

test("journey digests are deterministic and input-permutation sensitive", () => {
  const [a] = BUILTIN_JOURNEYS;
  expect(a).toBeDefined();
  const d1 = journeyDigest(a!);
  const d2 = journeyDigest(JSON.parse(JSON.stringify(a!)));
  expect(d2).toBe(d1);
  const reordered = {
    ...a!,
    steps: [...a!.steps].reverse(),
  };
  expect(journeyDigest(reordered)).not.toBe(d1);
});

test("journey progress: machine-stable, duplicates collapse, unknowns surface", () => {
  const journey = BUILTIN_JOURNEYS.find((j) => j.journeyId === "remediate-finding")!;
  const kinds = journeyRecordKinds(journey);
  const empty = journeyProgress(journey, []);
  expect(empty.complete).toBe(false);
  expect(empty.completedSteps).toBe(0);
  expect(empty.nextStep).toEqual(journey.steps[0]);
  const partial = journeyProgress(journey, [kinds[0]!, kinds[0]!]);
  expect(partial.completedSteps).toBe(1);
  const complete = journeyProgress(journey, [...kinds, "not.a.kind"]);
  expect(complete.complete).toBe(true);
  expect(complete.completedSteps).toBe(journey.steps.length);
  expect(complete.ignoredStepKinds).toEqual(["not.a.kind"]);
});

test("journey routes are deduplicated in step order", () => {
  const journey = BUILTIN_JOURNEYS.find((j) => j.journeyId === "remediate-finding")!;
  const routes = journeyRoutes(journey);
  const keys = routes.map((r) => `${r.area}:${r.view}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys[0]).toBe("security:findings");
});

test("record kinds are sorted and unique", () => {
  const journey = BUILTIN_JOURNEYS.find((j) => j.journeyId === "service-device")!;
  const kinds = journeyRecordKinds(journey);
  expect(kinds).toEqual([...kinds].sort());
  expect(new Set(kinds).size).toBe(kinds.length);
});

test("every builtin journey crosses at least two surfaces (cross-surface by construction)", () => {
  for (const journey of BUILTIN_JOURNEYS) {
    const areas = new Set(journey.steps.map((s) => s.area));
    expect(areas.size).toBeGreaterThan(1);
  }
});
