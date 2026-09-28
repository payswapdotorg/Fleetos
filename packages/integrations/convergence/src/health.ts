/**
 * @fleetos/integration-convergence — D3: adapter health aggregation.
 *
 * The NEUTRAL adapter-health model + the fail-closed aggregate:
 *
 *   - `AdapterHealth` / `AdapterHealthProbe` — the neutral status shape
 *     and the INJECTED probe seam (each adapter binding supplies its own
 *     probe; this package never imports an adapter from src/);
 *   - `aggregateIntegrationHealth` — the fail-closed, worst-wins
 *     aggregation: an expected adapter with NO bound probe is UNKNOWN
 *     per-adapter and DEGRADES the whole snapshot (absence of evidence
 *     is never health); a probe that THROWS or returns a shape-invalid
 *     value is DEGRADED (never silently healthy); an empty probe set
 *     yields UNKNOWN (never HEALTHY).
 *
 * Pure: no clock reads (the evaluation instant is injected), no
 * entropy, no runtime dependencies. Strict TS; no `any`.
 */

import { frozen, frozenArray } from "./internal";

/** The neutral adapter-health status. */
export type AdapterHealthStatus = "HEALTHY" | "DEGRADED" | "UNKNOWN";

/** The worst-wins rank (higher = worse). */
export const ADAPTER_HEALTH_RANK: Readonly<Record<AdapterHealthStatus, number>> = frozen({
  HEALTHY: 0,
  UNKNOWN: 1,
  DEGRADED: 2,
});

/** One adapter's health (the neutral shape every probe returns). */
export interface AdapterHealth {
  /** The adapter name (matches the expected-adapter list / probe's own declaration). */
  readonly adapter: string;
  /** The health status. */
  readonly status: AdapterHealthStatus;
  /** The machine-stable detail (why this status — never free-form-only). */
  readonly detail: string;
}

/** The injected per-adapter probe seam. May throw — the aggregate is fail-closed. */
export interface AdapterHealthProbe {
  /** The adapter this probe reports on. */
  readonly adapter: string;
  /** Probe the adapter. Throwing is tolerated (aggregated as DEGRADED). */
  probe(): AdapterHealth;
}

/** The aggregate snapshot. */
export interface IntegrationHealthSnapshot {
  /** The worst-wins aggregate status (fail-closed — see module header). */
  readonly status: AdapterHealthStatus;
  /** The per-adapter results (expected order first, then extra probes in order). */
  readonly adapters: readonly AdapterHealth[];
  /** The injected evaluation instant (ISO 8601; this package reads no clock). */
  readonly evaluatedAt: string;
  /** The machine-stable aggregate detail. */
  readonly detail: string;
}

/** Validate a probe's returned health (shape guard). */
function validHealth(value: unknown): value is AdapterHealth {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.adapter !== "string" || v.adapter.length === 0) return false;
  if (v.status !== "HEALTHY" && v.status !== "DEGRADED" && v.status !== "UNKNOWN") return false;
  if (v.detail !== undefined && typeof v.detail !== "string") return false;
  return true;
}

/** Call one probe fail-closed: throwing → DEGRADED; shape-invalid → DEGRADED. */
function probeFailClosed(adapter: string, probe: AdapterHealthProbe): AdapterHealth {
  try {
    const health = probe.probe();
    if (!validHealth(health) || health.adapter !== adapter) {
      return frozen({ adapter, status: "DEGRADED", detail: "probe_shape_invalid" });
    }
    return frozen({ adapter, status: health.status, detail: health.detail ?? health.status });
  } catch {
    return frozen({ adapter, status: "DEGRADED", detail: "probe_threw" });
  }
}

/**
 * The fail-closed, worst-wins aggregate.
 *
 * Rules (each one is asserted by the D3 test suite):
 *   1. every EXPECTED adapter must have a bound probe — an unbound one
 *      is reported UNKNOWN (`probe_unbound`) and DEGRADES the whole
 *      snapshot (fail-closed: absence of evidence is never health);
 *   2. a probe that throws, or returns a shape-invalid/mismatched
 *      value, is DEGRADED (`probe_threw` / `probe_shape_invalid`);
 *   3. otherwise the snapshot is the WORST per-adapter status
 *      (DEGRADED > UNKNOWN > HEALTHY);
 *   4. nothing at all bound (no expected adapters, no probes) →
 *      UNKNOWN (`no_probes_bound`) — never silently HEALTHY.
 *
 * @param expectedAdapters the adapters the caller declares as bound
 *   (deterministic order; duplicates collapse to the first)
 * @param probes the injected probes (first probe per adapter wins)
 * @param at the injected evaluation instant (ISO 8601)
 */
export function aggregateIntegrationHealth(
  expectedAdapters: readonly string[],
  probes: readonly AdapterHealthProbe[],
  at: string,
): IntegrationHealthSnapshot {
  if (typeof at !== "string" || at.length === 0) {
    throw new TypeError("aggregateIntegrationHealth: evaluatedAt must be a non-empty ISO 8601 string");
  }
  if (!Array.isArray(expectedAdapters) || !Array.isArray(probes)) {
    throw new TypeError("aggregateIntegrationHealth: expectedAdapters and probes must be arrays");
  }

  const results: AdapterHealth[] = [];
  const seen = new Set<string>();
  let unbound = false;

  // 1. The expected adapters (caller-declared order; first probe wins).
  for (const adapter of expectedAdapters) {
    if (typeof adapter !== "string" || adapter.length === 0) {
      throw new TypeError("aggregateIntegrationHealth: expected adapter names must be non-empty strings");
    }
    if (seen.has(adapter)) continue; // deterministic: first occurrence wins
    seen.add(adapter);
    const probe = probes.find((p) => p !== null && typeof p === "object" && p.adapter === adapter);
    if (probe === undefined) {
      unbound = true;
      results.push(frozen({ adapter, status: "UNKNOWN", detail: "probe_unbound" }));
    } else {
      results.push(probeFailClosed(adapter, probe));
    }
  }

  // 2. Extra probes (adapters beyond the expected list — evidence too).
  for (const probe of probes) {
    if (probe === null || typeof probe !== "object" || typeof probe.adapter !== "string") {
      continue; // a probe that cannot even declare its adapter is skipped
    }
    if (seen.has(probe.adapter)) continue;
    seen.add(probe.adapter);
    results.push(probeFailClosed(probe.adapter, probe));
  }

  // 3. The fail-closed aggregate.
  if (results.length === 0) {
    return frozen({
      status: "UNKNOWN",
      adapters: frozenArray(results),
      evaluatedAt: at,
      detail: "no_probes_bound",
    });
  }
  if (unbound) {
    // An expected adapter without a probe: per-adapter UNKNOWN, and the
    // snapshot is DEGRADED (never silently healthy).
    return frozen({
      status: "DEGRADED",
      adapters: frozenArray(results),
      evaluatedAt: at,
      detail: "probe_unbound",
    });
  }
  let worst: AdapterHealthStatus = "HEALTHY";
  for (const r of results) {
    if (ADAPTER_HEALTH_RANK[r.status] > ADAPTER_HEALTH_RANK[worst]) {
      worst = r.status;
    }
  }
  const detail =
    worst === "HEALTHY"
      ? "all_adapters_healthy"
      : worst === "UNKNOWN"
        ? "adapter_health_unknown"
        : "adapter_degraded";
  return frozen({
    status: worst,
    adapters: frozenArray(results),
    evaluatedAt: at,
    detail,
  });
}
