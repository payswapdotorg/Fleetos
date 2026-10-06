/**
 * W156 (TL convergence) — the PREDICTIVE TWIN ADVISORY binding's machine
 * tests: the ADR-0002 § "Acceptance" rule proven at the PRODUCT BINDING
 * SITE (the REAL packages — @fleetos/predictive, @fleetos/world-model,
 * @fleetos/world-context, the REAL demo fleet store, the REAL demo
 * Guardian decision — never mocked away).
 *
 * Battery A (pure runtime — `src/runtime/predictive-advisory.ts`):
 *   - the demo device 1's telemetry check-in history is admitted through
 *     the REAL device-model boundary (the W156 demo enrichment);
 *   - the advisory journey over the REAL demo twin store produces the
 *     READY view (observed + predicted + hypothetical + model +
 *     provenance + context);
 *   - OBSERVED / PREDICTED / HYPOTHETICAL are DISTINCT sections (the
 *     machine markers; the counterfactual's uncertainty is wider + its
 *     confidence lower than the unconditional prediction's);
 *   - the prediction carries evidence/version/uncertainty/provenance;
 *   - the Arena note lands PARKED under the demo tier's REAL
 *     REQUIRE_APPROVAL Guardian decision (the bridge NEVER submits);
 *   - determinism: the same inputs produce byte-identical advisories;
 *   - the unavailable adapter degrades honestly (model_unavailable);
 *   - the thin feed degrades honestly (insufficient_history);
 *   - the view model carries NO authorization surface (the recursive
 *     key scan — no predictive result can bypass Guardian);
 *   - the procurement facet derivation maps the demo demand honestly;
 *   - the reference path identity: no GPU, no model provider, no network.
 *
 * Battery B (the live product UI): the device.lifecycle route renders
 * the Predictive Twin advisory panel over the REAL composed demo app —
 * the end-to-end advisory journey (Control Tower -> Devices -> device
 * detail/lifecycle -> the advisory panel), with the three state kinds
 * visibly distinct and the Arena intake note visible.
 */
import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { asDeviceId, asObservationId, asTenantId } from "@fleetos/contracts";
import type { Observation } from "@fleetos/contracts";
import { createReferenceAdapter, createUnavailableAdapter } from "@fleetos/world-model";
import { ConsoleApp } from "../src/console-app";
import { demoTwinStore, demoGuardianDecision, TENANT_ID } from "../src/runtime/demo-fleet";
import { DEMO_DEMAND_FACETS } from "../src/runtime/lane-feeds";
import {
  buildPredictiveAdvisory,
  buildEvaluationAdvisoryNote,
  deriveProcurementStageFacets,
} from "../src/runtime/predictive-advisory";
import type { PredictiveAdvisoryTwinLike } from "../src/runtime/predictive-advisory";
import type { ShellRoute } from "@fleetos/web-shell";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// The shared fixtures (the REAL demo composition — never mocked)
// ---------------------------------------------------------------------------

const DEMO_DEVICE = asDeviceId("dev_w091demo000001");
const ADVISORY_WINDOW = { from: "2026-01-06T00:00:00Z", to: "2026-01-06T14:00:00Z" } as const;
const ADVISORY_AS_OF = "2026-01-06T14:00:00Z" as const;
const DEMO_CANDIDATE_ACTION = {
  ref: "act_w091_demo_replace_battery",
  description: "Replace the battery (the demo counterfactual)",
} as const;

/** The demo device 1's twin, read from the REAL demo store. */
function demoTwin(): PredictiveAdvisoryTwinLike {
  const store = demoTwinStore();
  const twin = store.get(TENANT_ID, DEMO_DEVICE);
  if (twin === undefined) throw new Error("the demo device 1 must be enrolled in the demo store");
  return {
    deviceId: twin.deviceId,
    telemetry: {
      lastObservedAt: twin.telemetry.lastObservedAt,
      observationCount: twin.telemetry.observationCount,
      latest: twin.telemetry.latest,
    },
  };
}

/** The full demo advisory input (the console binding's own composition). */
function demoAdvisoryInput() {
  return {
    scope: { tenantId: TENANT_ID },
    deviceId: DEMO_DEVICE,
    twin: demoTwin(),
    adapter: createReferenceAdapter(),
    workloadAssignments: [],
    procurementStages: deriveProcurementStageFacets([DEMO_DEMAND_FACETS]),
    window: ADVISORY_WINDOW,
    asOf: ADVISORY_AS_OF,
    horizonMs: 86_400_000,
    candidateAction: DEMO_CANDIDATE_ACTION,
  };
}

/** A thin-feed twin (ONE observation — below the W153 minimum of 2). */
function thinTwin(): PredictiveAdvisoryTwinLike {
  const only: Observation = {
    id: asObservationId("obsw156thin000001"),
    kind: "device.security",
    observedAt: "2026-01-06T10:00:00Z",
    schemaVersion: 1,
    payload: { diskEncryption: false },
  };
  return {
    deviceId: DEMO_DEVICE,
    telemetry: { lastObservedAt: only.observedAt, observationCount: 1, latest: [only] },
  };
}

/** Recursively collect every key in a JSON-serializable value. PURE. */
function allKeys(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

// ---------------------------------------------------------------------------
// Battery A — the pure runtime binding (the REAL packages, no mocks)
// ---------------------------------------------------------------------------

test("W156 A1 — the demo device 1's telemetry check-in history is admitted through the REAL device-model boundary", () => {
  const twin = demoTwin();
  // Five telemetry check-ins + the enrollment's security observation.
  expect(twin.telemetry.observationCount).toBe(6);
  expect(twin.telemetry.latest.filter((o) => o.kind === "device.telemetry").length).toBe(5);
  expect(twin.telemetry.lastObservedAt).toBe("2026-01-06T12:45:00Z");
});

test("W156 A2 — the advisory journey over the REAL demo twin store produces the READY view", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error(build.error.message);
  expect(build.advisory.kind).toBe("ready");
});

test("W156 A3 — OBSERVED / PREDICTED / HYPOTHETICAL are DISTINCT sections with machine markers", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  if (!build.ok || build.advisory.kind !== "ready") throw new Error("expected the ready advisory");
  const view = build.advisory;
  // The OBSERVED section is sourced from the canonical Device Twin ONLY.
  expect(view.observed.kind).toBe("observed");
  expect(view.observed.observationCount).toBe(6);
  expect(view.observed.lastObservedAt).toBe("2026-01-06T12:45:00Z");
  // The PREDICTED section is ADVISORY (the machine marker).
  expect(view.predicted.kind).toBe("predicted");
  expect(view.predicted.advisory).toBe(true);
  // The HYPOTHETICAL section carries the machine-carried marker + the
  // candidate action — a counterfactual can NEVER render as fact.
  expect(view.hypothetical).not.toBeNull();
  if (view.hypothetical === null) throw new Error("expected the hypothetical section");
  expect(view.hypothetical.kind).toBe("hypothetical");
  expect(view.hypothetical.hypothetical).toBe(true);
  expect(view.hypothetical.candidateAction.ref).toBe(DEMO_CANDIDATE_ACTION.ref);
});

test("W156 A4 — the counterfactual's uncertainty is WIDER and its confidence LOWER than the prediction's (the W154 discipline at the binding)", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  if (!build.ok || build.advisory.kind !== "ready") throw new Error("expected the ready advisory");
  const view = build.advisory;
  if (view.hypothetical === null) throw new Error("expected the hypothetical section");
  expect(view.hypothetical.uncertainty.spread).toBeGreaterThanOrEqual(view.predicted.uncertainty.spread);
  expect(view.hypothetical.uncertainty.confidence).toBeLessThanOrEqual(view.predicted.uncertainty.confidence);
});

test("W156 A5 — the prediction carries evidence/version/uncertainty/provenance (the ADR bullet)", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  if (!build.ok || build.advisory.kind !== "ready") throw new Error("expected the ready advisory");
  const view = build.advisory;
  // Version: the capability name + version are surfaced.
  expect(view.predicted.capability.name).toBe("world-model.reference.deterministic");
  expect(view.predicted.capability.version).toBeGreaterThanOrEqual(1);
  // Uncertainty: an honest interval containing the estimate.
  expect(view.predicted.uncertainty.lower).toBeLessThanOrEqual(view.predicted.estimate);
  expect(view.predicted.estimate).toBeLessThanOrEqual(view.predicted.uncertainty.upper);
  expect(view.predicted.uncertainty.confidence).toBeGreaterThan(0);
  expect(view.predicted.uncertainty.confidence).toBeLessThanOrEqual(1);
  // Evidence + provenance: the digests are 64-hex; the evidence refs exist.
  expect(view.provenance.featureSetInputDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(view.provenance.contextDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(view.provenance.provenanceChainDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(view.provenance.evidenceRefCount).toBeGreaterThan(0);
  expect(view.provenance.inputObservationRefCount).toBeGreaterThanOrEqual(2);
  // The context projection is visible (the demo's open procurement demand).
  expect(view.context.procurementStageCount).toBe(1);
  expect(view.context.workloadAssignmentCount).toBe(0);
});

test("W156 A6 — the Arena note lands PARKED under the demo tier's REAL REQUIRE_APPROVAL Guardian decision (the bridge NEVER submits)", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  if (!build.ok || build.advisory.kind !== "ready") throw new Error("expected the ready advisory");
  const decision = demoGuardianDecision();
  expect(decision.decision).toBe("REQUIRE_APPROVAL");
  const noteBuild = buildEvaluationAdvisoryNote({ tenantId: TENANT_ID }, build.advisory.sourcePrediction, decision);
  expect(noteBuild.ok).toBe(true);
  if (!noteBuild.ok) throw new Error(noteBuild.error.message);
  expect(noteBuild.note.disposition).toBe("PARKED");
  expect(noteBuild.note.proposalId).toMatch(/^wcp_[0-9a-f]{64}$/);
  expect(noteBuild.note.hypothetical).toBe(false);
  expect(noteBuild.note.advisory).toBe(true);
});

test("W156 A7 — determinism: the same inputs produce byte-identical advisories", () => {
  const first = buildPredictiveAdvisory(demoAdvisoryInput());
  const second = buildPredictiveAdvisory(demoAdvisoryInput());
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test("W156 A8 — the unavailable adapter degrades honestly (model_unavailable — never a fabricated estimate)", () => {
  const input = {
    ...demoAdvisoryInput(),
    adapter: createUnavailableAdapter("the model provider is not configured"),
  };
  const build = buildPredictiveAdvisory(input);
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error(build.error.message);
  expect(build.advisory.kind).toBe("degraded");
  if (build.advisory.kind !== "degraded") throw new Error("expected the degraded view");
  expect(build.advisory.reason).toBe("model_unavailable");
  expect(build.advisory.detail).toContain("the model provider is not configured");
  // The OBSERVED twin state + the model-health section are still present.
  expect(build.advisory.observed.observationCount).toBe(6);
  expect(build.advisory.model.available).toBe(false);
});

test("W156 A9 — a thin feed (one observation) degrades honestly (insufficient_history — never zero-filled)", () => {
  const input = {
    ...demoAdvisoryInput(),
    twin: thinTwin(),
  };
  const build = buildPredictiveAdvisory(input);
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error(build.error.message);
  expect(build.advisory.kind).toBe("degraded");
  if (build.advisory.kind !== "degraded") throw new Error("expected the degraded view");
  expect(build.advisory.reason).toBe("insufficient_history");
});

test("W156 A10 — the advisory view model carries NO authorization surface (no predictive result can bypass Guardian)", () => {
  const build = buildPredictiveAdvisory(demoAdvisoryInput());
  if (!build.ok || build.advisory.kind !== "ready") throw new Error("expected the ready advisory");
  const keys = allKeys(build.advisory);
  // The forbidden surface vocabulary: an advisory view with any of these
  // keys would be an authorization path. The view is ADVISORY ONLY.
  for (const forbidden of [
    "authorization",
    "authorized",
    "authorize",
    "permission",
    "approve",
    "approved",
    "reject",
    "execute",
    "executed",
    "submit",
    "submitted",
    "mutate",
    "mutated",
    "guardianDecision",
    "decision",
  ]) {
    expect(keys.has(forbidden)).toBe(false);
  }
});

test("W156 A11 — the tenant isolation at the binding's source: the REAL store returns NO twin for a foreign tenant", () => {
  const store = demoTwinStore();
  const foreign = store.get(asTenantId("tnt_other0000000001"), DEMO_DEVICE);
  expect(foreign).toBeUndefined();
});

test("W156 A12 — deriveProcurementStageFacets maps the demo demand honestly (no fabricated quote, honest pre-quote stage)", () => {
  const facets = deriveProcurementStageFacets([DEMO_DEMAND_FACETS]);
  expect(facets.length).toBe(1);
  expect(facets[0]!.demandId).toBe("dmd_w091demo000001");
  expect(facets[0]!.workloadId).toBe("wl_w091demo000001");
  expect(facets[0]!.quantity).toBe(1);
  expect(facets[0]!.activeQuoteId).toBe("");
  expect(facets[0]!.stage).toBe("unknown");
  // Malformed / absent demands map to NOTHING (never fabricated).
  expect(deriveProcurementStageFacets([])).toEqual([]);
});

test("W156 A13 — the reference path identity: the deterministic reference adapter (no GPU, no model provider, no network)", () => {
  const input = demoAdvisoryInput();
  expect(input.adapter.capability.name).toBe("world-model.reference.deterministic");
  const availability = input.adapter.capability.isAvailable({ tenantId: TENANT_ID });
  expect(availability.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Battery B — the live product UI (the end-to-end advisory journey)
// ---------------------------------------------------------------------------

/**
 * Mount the console inside the DEMO workspace session (the W122
 * sanctioned entry — the same harness pattern as the console-journeys
 * suite + the W152 lifecycle suite).
 */
function mountDemoApp(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Fleet Administrator" }));
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

test("W156 B1 — the device.lifecycle route renders the Predictive Twin advisory panel with the three state kinds VISIBLY DISTINCT", () => {
  mountDemoApp({ area: "device", view: "lifecycle" });
  // The panel's advisory badge (never business truth).
  expect(screen.getAllByText(/ADVISORY — never business truth/).length).toBeGreaterThan(0);
  // The OBSERVED section (the Device Twin record — the authoritative state).
  expect(screen.getAllByText("OBSERVED").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/the Device Twin record/).length).toBeGreaterThan(0);
  // The PREDICTED section (the advisory estimate).
  expect(screen.getAllByText("PREDICTED").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/advisory estimate/).length).toBeGreaterThan(0);
  // The HYPOTHETICAL section (the counterfactual — never observed).
  expect(screen.getAllByText("HYPOTHETICAL").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/never observed/).length).toBeGreaterThan(0);
  // The machine-carried marker is rendered verbatim.
  expect(screen.getAllByText(/hypothetical: true/).length).toBeGreaterThan(0);
  // The model-health section names the deterministic reference.
  expect(screen.getAllByText(/world-model\.reference\.deterministic/).length).toBeGreaterThan(0);
});

test("W156 B2 — the advisory panel renders the Arena intake note as PARKED under the REAL Guardian decision", () => {
  mountDemoApp({ area: "device", view: "lifecycle" });
  expect(screen.getByText(/ARENA INTAKE/)).toBeDefined();
  expect(screen.getByText(/evaluation proposal PARKED/)).toBeDefined();
  expect(screen.getByText(/Guardian-gated, never auto-submitted/)).toBeDefined();
});
