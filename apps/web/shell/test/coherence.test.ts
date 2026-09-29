import { test, expect } from "bun:test";
import {
  AREA_EMPTY_STATES,
  BAND_SEVERITY_ORDER,
  BAND_TONE,
  areaLabel,
  compareBands,
  emptyStateFor,
  presentationOf,
} from "../src/coherence";
import { makeBandedSummary } from "./helpers";

test("the band -> tone mapping is total and frozen", () => {
  expect(Object.keys(BAND_TONE).sort()).toEqual([...BAND_SEVERITY_ORDER].sort());
  expect(BAND_TONE.critical).toBe("alert");
  expect(BAND_TONE.high).toBe("warning");
  expect(BAND_TONE.medium).toBe("info");
  expect(BAND_TONE.low).toBe("positive");
  expect(BAND_TONE.ok).toBe("positive");
  expect(BAND_TONE.neutral).toBe("muted");
});

test("presentationOf derives the uniform shape; trims; freezes nothing mutable", () => {
  const outcome = presentationOf(
    makeBandedSummary("security", "fnd-1", "  Stale TLS certificate  ", ["tls"], "high", " Certificate expires in 2 days "),
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.presentation).toEqual({
    title: "Stale TLS certificate",
    subtitle: "Certificate expires in 2 days",
    band: "high",
    tone: "warning",
  });
});

test("unknown bands refuse machine-stably (the vocabulary is closed)", () => {
  const outcome = presentationOf(makeBandedSummary("device", "d", "Title", ["k"], "severe", "sub"));
  expect(outcome).toEqual({ ok: false, reason: "unknown_band", band: "severe" });
  const blank = presentationOf(makeBandedSummary("device", "d", "   ", ["k"], "high", "sub"));
  expect(blank).toEqual({ ok: false, reason: "blank_title" });
});

test("every area has a frozen empty state; labels agree with navigation", () => {
  for (const area of Object.keys(AREA_EMPTY_STATES) as (keyof typeof AREA_EMPTY_STATES)[]) {
    expect(emptyStateFor(area).length).toBeGreaterThan(0);
  }
  expect(areaLabel("workloads")).toBe("Workloads");
  expect(areaLabel("overview")).toBe("Control Tower");
  expect(areaLabel("evidence")).toBe("Evidence & Audit");
  expect(areaLabel("actions")).toBe("Fleet Actions");
});

test("band ordering is severity-descending and machine-stable", () => {
  expect(compareBands("critical", "high")).toBeLessThan(0);
  expect(compareBands("ok", "critical")).toBeGreaterThan(0);
  expect(compareBands("neutral", "neutral")).toBe(0);
});
