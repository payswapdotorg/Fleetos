/**
 * @fleetos/ops — D2: operational observability.
 *
 * The production-readiness observability surface:
 *
 *   - `ComponentHealth` / `ComponentHealthProbe` — the neutral per-
 *     component health shape + the INJECTED probe seam (the W051 D3
 *     discipline: probes are injected, never global; each binding
 *     supplies its own);
 *   - `aggregateOperationalHealth` — the fail-closed, worst-wins
 *     aggregation: an expected component with NO bound probe is UNKNOWN
 *     and DEGRADES the whole snapshot (absence of evidence is never
 *     health); a probe that THROWS or returns a shape-invalid value is
 *     DEGRADED (never silently healthy); an empty component set yields
 *     UNKNOWN (never HEALTHY);
 *   - `OperationalMetrics` — typed, read-only, tenant-scoped counters
 *     and gauges derived from an injected collector snapshot; the
 *     derivation is deterministic and NEVER mutates the source.
 *
 * Machine-stable statuses: HEALTHY / DEGRADED / UNKNOWN.
 *
 * Pure: no clock reads (the evaluation instant is injected), no
 * entropy, no runtime dependencies. Strict TS; no `any`.
 */

import { frozen, frozenArray } from "./internal";

/** The neutral operational health status. */
export type OperationalHealthStatus = "HEALTHY" | "DEGRADED" | "UNKNOWN";

/** The worst-wins rank (higher = worse). */
export const OPERATIONAL_HEALTH_RANK: Readonly<Record<OperationalHealthStatus, number>> = frozen({
  HEALTHY: 0,
  UNKNOWN: 1,
  DEGRADED: 2,
});

/** One component's health (the neutral shape every probe returns). */
export interface ComponentHealth {
  /** The component name (matches the expected-component list). */
  readonly component: string;
  /** The health status. */
  readonly status: OperationalHealthStatus;
  /** The machine-stable detail (why this status). */
  readonly detail: string;
}

/** The injected per-component probe seam. May throw — the aggregate is fail-closed. */
export interface ComponentHealthProbe {
  /** The component this probe reports on. */
  readonly component: string;
  /** Probe the component. Throwing is tolerated (aggregated as DEGRADED). */
  probe(): ComponentHealth;
}

/** The operational health snapshot. */
export interface OperationalHealthSnapshot {
  /** The worst-wins aggregate status (fail-closed — see module header). */
  readonly status: OperationalHealthStatus;
  /** The per-component results (expected order first, then extra probes in order). */
  readonly components: readonly ComponentHealth[];
  /** The injected evaluation instant (ISO 8601; this package reads no clock). */
  readonly evaluatedAt: string;
  /** The machine-stable aggregate detail. */
  readonly detail: string;
}

/** Validate a probe's returned health (shape guard). */
function validComponentHealth(value: unknown): value is ComponentHealth {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.component !== "string" || v.component.length === 0) return false;
  if (v.status !== "HEALTHY" && v.status !== "DEGRADED" && v.status !== "UNKNOWN") return false;
  if (v.detail !== undefined && typeof v.detail !== "string") return false;
  return true;
}

/** Call one probe fail-closed: throwing → DEGRADED; shape-invalid → DEGRADED. */
function probeFailClosed(component: string, probe: ComponentHealthProbe): ComponentHealth {
  try {
    const health = probe.probe();
    if (!validComponentHealth(health) || health.component !== component) {
      return frozen({ component, status: "DEGRADED", detail: "probe_shape_invalid" });
    }
    return frozen({ component, status: health.status, detail: health.detail ?? health.status });
  } catch {
    return frozen({ component, status: "DEGRADED", detail: "probe_threw" });
  }
}

/**
 * The fail-closed, worst-wins operational health aggregate.
 *
 * Rules (each asserted by the D2 test suite — the W051 D3 discipline,
 * byte-for-byte semantics):
 *   1. every EXPECTED component must have a bound probe — an unbound one
 *      is reported UNKNOWN (`probe_unbound`) and DEGRADES the whole
 *      snapshot (fail-closed: absence of evidence is never health);
 *   2. a throwing / shape-invalid probe → that component is DEGRADED
 *      (`probe_threw` / `probe_shape_invalid`);
 *   3. otherwise the snapshot is the WORST per-component status
 *      (DEGRADED > UNKNOWN > HEALTHY);
 *   4. an EXTRA probe (bound but not expected) is aggregated too (the
 *      caller sees everything it wired);
 *   5. nothing at all bound (no expected components, no probes) →
 *      UNKNOWN (`no_components_bound`) — never silently HEALTHY.
 */
export function aggregateOperationalHealth(
  expectedComponents: readonly string[],
  probes: readonly ComponentHealthProbe[],
  evaluatedAt: string,
): OperationalHealthSnapshot {
  const byComponent = new Map<string, ComponentHealthProbe>();
  for (const p of probes) {
    if (!byComponent.has(p.component)) byComponent.set(p.component, p);
  }

  const results: ComponentHealth[] = [];
  let unbound = false;
  for (const component of expectedComponents) {
    const probe = byComponent.get(component);
    if (probe === undefined) {
      unbound = true;
      results.push(frozen({ component, status: "UNKNOWN", detail: "probe_unbound" }));
    } else {
      results.push(probeFailClosed(component, probe));
      byComponent.delete(component);
    }
  }
  // Extra probes (bound but not expected) — aggregated in binding order.
  for (const probe of probes) {
    if (byComponent.has(probe.component)) {
      results.push(probeFailClosed(probe.component, probe));
      byComponent.delete(probe.component);
    }
  }

  if (results.length === 0) {
    return frozen({ status: "UNKNOWN", components: frozenArray(results), evaluatedAt, detail: "no_components_bound" });
  }
  if (unbound) {
    // An expected component without a probe: per-component UNKNOWN, and
    // the SNAPSHOT is DEGRADED (never silently healthy).
    return frozen({ status: "DEGRADED", components: frozenArray(results), evaluatedAt, detail: "probe_unbound" });
  }
  const status: OperationalHealthStatus = results.reduce<OperationalHealthStatus>(
    (worst, r) => (OPERATIONAL_HEALTH_RANK[r.status] > OPERATIONAL_HEALTH_RANK[worst] ? r.status : worst),
    "HEALTHY",
  );
  const detail =
    status === "HEALTHY" ? "all_components_healthy" : status === "UNKNOWN" ? "component_health_unknown" : "component_degraded";
  return frozen({ status, components: frozenArray(results), evaluatedAt, detail });
}

// ---------------------------------------------------------------------------
// Typed operational metrics (read-only derivation over an injected snapshot)
// ---------------------------------------------------------------------------

/** One typed metric reading. */
export interface MetricReading {
  /** The metric name (machine-stable vocabulary — dot-namespaced). */
  readonly name: string;
  /** The reading kind. */
  readonly kind: "counter" | "gauge";
  /** The numeric value (finite). */
  readonly value: number;
  /** The reading instant (injected — never a clock read). */
  readonly readAt: string;
}

/** A typed, read-only operational metrics snapshot. */
export interface OperationalMetrics {
  /** The metrics (sorted by name at construction — byte-stable). */
  readonly readings: readonly MetricReading[];
  /** The tenant scope. */
  readonly tenantId: string;
  /** The derived instant range [earliest, latest] (ISO; empty -> undefined). */
  readonly window: { readonly from: string | undefined; readonly to: string | undefined };
}

/** Metrics derivation failures (machine-stable). */
export interface MetricsFailure {
  readonly ok: false;
  readonly kind: "metrics_malformed";
  readonly reasons: ReadonlyArray<string>;
}

const METRIC_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

/**
 * Derive the typed operational metrics snapshot from an injected set of
 * readings. The derivation: validates every reading (name grammar, kind,
 * finite value, instant), SORTS by name (ties by readAt — byte-stable),
 * computes the instant window, and NEVER mutates the source array.
 */
export function makeOperationalMetrics(
  tenantId: string,
  readings: readonly unknown[],
): { readonly ok: true; readonly metrics: OperationalMetrics } | MetricsFailure {
  const reasons: string[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    reasons.push("tenant_id_required");
  }
  if (!Array.isArray(readings)) {
    reasons.push("readings_required");
  } else {
    for (const r of readings) {
      if (r === null || typeof r !== "object") {
        reasons.push("reading_malformed");
        continue;
      }
      const v = r as Record<string, unknown>;
      if (typeof v.name !== "string" || !METRIC_NAME.test(v.name)) {
        reasons.push("metric_name_invalid");
      }
      if (v.kind !== "counter" && v.kind !== "gauge") {
        reasons.push("metric_kind_invalid");
      }
      if (typeof v.value !== "number" || !Number.isFinite(v.value)) {
        reasons.push("metric_value_invalid");
      }
      if (typeof v.readAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.readAt)) {
        reasons.push("read_at_invalid");
      }
    }
  }
  if (reasons.length > 0) {
    return { ok: false, kind: "metrics_malformed", reasons: [...new Set(reasons)].sort() };
  }

  const typed = readings as readonly MetricReading[];
  const sorted = [...typed].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.readAt < b.readAt ? -1 : 1));
  const instants = sorted.map((r) => r.readAt).sort();
  return {
    ok: true,
    metrics: frozen({
      readings: frozenArray(sorted.map((r) => frozen({ ...r }))),
      tenantId,
      window: frozen({
        from: instants.length > 0 ? instants[0] : undefined,
        to: instants.length > 0 ? instants[instants.length - 1] : undefined,
      }),
    }),
  };
}
