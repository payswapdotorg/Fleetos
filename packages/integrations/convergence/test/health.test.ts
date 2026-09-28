/**
 * W051 convergence — D3: adapter-health aggregation tests.
 *
 * The fail-closed rules, each asserted:
 *   - all probes healthy → snapshot HEALTHY;
 *   - one degraded probe → worst-wins snapshot DEGRADED;
 *   - an expected adapter with NO bound probe → per-adapter UNKNOWN
 *     (`probe_unbound`) and snapshot DEGRADED (absence of evidence is
 *     never health);
 *   - nothing at all bound → UNKNOWN (`no_probes_bound`) — never
 *     silently HEALTHY;
 *   - a throwing probe → DEGRADED (`probe_threw`);
 *   - a shape-invalid probe (bad status / adapter mismatch) → DEGRADED
 *     (`probe_shape_invalid`);
 *   - a probe reporting its own UNKNOWN → snapshot UNKNOWN (known
 *     unknown — distinct from unbound).
 */

import { test, expect } from "bun:test";
import { aggregateIntegrationHealth } from "../src/index";
import type { AdapterHealthProbe } from "../src/index";

const AT = "2026-01-01T00:00:00Z";

function healthyProbe(adapter: string): AdapterHealthProbe {
  return {
    adapter,
    probe: () => ({ adapter, status: "HEALTHY", detail: "ok" }),
  };
}

function degradedProbe(adapter: string): AdapterHealthProbe {
  return {
    adapter,
    probe: () => ({ adapter, status: "DEGRADED", detail: "provider_reporting_errors" }),
  };
}

test("D3: all probes healthy → snapshot HEALTHY with per-adapter results", () => {
  const snap = aggregateIntegrationHealth(["adcos", "arena", "aurum"], [
    healthyProbe("adcos"),
    healthyProbe("arena"),
    healthyProbe("aurum"),
  ], AT);
  expect(snap.status).toBe("HEALTHY");
  expect(snap.detail).toBe("all_adapters_healthy");
  expect(snap.adapters).toHaveLength(3);
  expect(snap.evaluatedAt).toBe(AT);
});

test("D3: one degraded probe → worst-wins snapshot DEGRADED", () => {
  const snap = aggregateIntegrationHealth(["adcos", "arena", "aurum"], [
    healthyProbe("adcos"),
    degradedProbe("arena"),
    healthyProbe("aurum"),
  ], AT);
  expect(snap.status).toBe("DEGRADED");
  expect(snap.detail).toBe("adapter_degraded");
});

test("D3: an unbound expected adapter → per-adapter UNKNOWN and snapshot DEGRADED", () => {
  const snap = aggregateIntegrationHealth(["adcos", "arena", "aurum"], [
    healthyProbe("adcos"),
    healthyProbe("arena"),
    // aurum probe NOT bound
  ], AT);
  expect(snap.status).toBe("DEGRADED");
  expect(snap.detail).toBe("probe_unbound");
  const aurum = snap.adapters.find((a) => a.adapter === "aurum");
  expect(aurum?.status).toBe("UNKNOWN");
  expect(aurum?.detail).toBe("probe_unbound");
});

test("D3: nothing at all bound → UNKNOWN, never silently HEALTHY", () => {
  const snap = aggregateIntegrationHealth([], [], AT);
  expect(snap.status).toBe("UNKNOWN");
  expect(snap.detail).toBe("no_probes_bound");
});

test("D3: a throwing probe → DEGRADED (probe_threw)", () => {
  const throwing: AdapterHealthProbe = {
    adapter: "adcos",
    probe: () => {
      throw new Error("probe exploded");
    },
  };
  const snap = aggregateIntegrationHealth(["adcos"], [throwing], AT);
  expect(snap.status).toBe("DEGRADED");
  expect(snap.adapters[0]?.detail).toBe("probe_threw");
});

test("D3: a shape-invalid probe (bad status literal) → DEGRADED (probe_shape_invalid)", () => {
  const invalid = {
    adapter: "arena",
    probe: () => ({ adapter: "arena", status: "GREEN", detail: "made up" }) as never,
  } as AdapterHealthProbe;
  const snap = aggregateIntegrationHealth(["arena"], [invalid], AT);
  expect(snap.status).toBe("DEGRADED");
  expect(snap.adapters[0]?.detail).toBe("probe_shape_invalid");
});

test("D3: a probe declaring a foreign adapter → shape-invalid DEGRADED for the expected slot", () => {
  const mismatched = {
    adapter: "adcos",
    probe: () => ({ adapter: "aurum", status: "HEALTHY", detail: "ok" }) as never,
  } as AdapterHealthProbe;
  const snap = aggregateIntegrationHealth(["adcos"], [mismatched], AT);
  expect(snap.status).toBe("DEGRADED");
  expect(snap.adapters[0]?.adapter).toBe("adcos");
  expect(snap.adapters[0]?.detail).toBe("probe_shape_invalid");
});

test("D3: a probe reporting its own UNKNOWN → snapshot UNKNOWN (a known unknown)", () => {
  const unknownProbe: AdapterHealthProbe = {
    adapter: "adcos",
    probe: () => ({ adapter: "adcos", status: "UNKNOWN", detail: "probe_not_configured" }),
  };
  const snap = aggregateIntegrationHealth(["adcos"], [unknownProbe], AT);
  expect(snap.status).toBe("UNKNOWN");
  expect(snap.detail).toBe("adapter_health_unknown");
});

test("D3: an injected instant is carried verbatim (no clock reads)", () => {
  const snap = aggregateIntegrationHealth(["adcos"], [healthyProbe("adcos")], "2027-12-31T23:59:59Z");
  expect(snap.evaluatedAt).toBe("2027-12-31T23:59:59Z");
});
