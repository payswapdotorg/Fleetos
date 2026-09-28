import { describe, expect, test } from "bun:test";
import {
  aggregateOperationalHealth,
  makeOperationalMetrics,
  type ComponentHealthProbe,
} from "../src/observability";

const NOW = "2026-09-28T12:00:00Z";

function probe(component: string, status: "HEALTHY" | "DEGRADED" | "UNKNOWN", detail?: string): ComponentHealthProbe {
  return { component, probe: () => ({ component, status, detail: detail ?? status }) };
}

describe("W080 D2 — operational health aggregation (fail-closed, worst-wins)", () => {
  test("all healthy probes aggregate HEALTHY", () => {
    const snap = aggregateOperationalHealth(["db", "queue"], [probe("db", "HEALTHY"), probe("queue", "HEALTHY")], NOW);
    expect(snap.status).toBe("HEALTHY");
    expect(snap.components).toHaveLength(2);
    expect(snap.evaluatedAt).toBe(NOW);
  });

  test("an unbound expected component is UNKNOWN and DEGRADES the snapshot (absence of evidence is never health)", () => {
    const snap = aggregateOperationalHealth(["db", "queue", "cache"], [probe("db", "HEALTHY"), probe("queue", "HEALTHY")], NOW);
    expect(snap.status).toBe("DEGRADED");
    const cache = snap.components.find((c) => c.component === "cache");
    expect(cache?.status).toBe("UNKNOWN");
    expect(cache?.detail).toBe("probe_unbound");
  });

  test("a throwing probe is DEGRADED (probe_threw) — never silently healthy", () => {
    const throwing: ComponentHealthProbe = {
      component: "db",
      probe: () => {
        throw new Error("boom");
      },
    };
    const snap = aggregateOperationalHealth(["db"], [throwing], NOW);
    expect(snap.status).toBe("DEGRADED");
    expect(snap.components[0].detail).toBe("probe_threw");
  });

  test("a shape-invalid probe is DEGRADED (probe_shape_invalid)", () => {
    const invalid: ComponentHealthProbe = {
      component: "db",
      // @ts-expect-error deliberate shape violation for the fail-closed test
      probe: () => ({ component: "db", status: "VERY-FINE" }),
    };
    const snap = aggregateOperationalHealth(["db"], [invalid], NOW);
    expect(snap.status).toBe("DEGRADED");
    expect(snap.components[0].detail).toBe("probe_shape_invalid");
  });

  test("no components at all yields UNKNOWN (never HEALTHY)", () => {
    const snap = aggregateOperationalHealth([], [], NOW);
    expect(snap.status).toBe("UNKNOWN");
    expect(snap.detail).toBe("no_components_bound");
  });

  test("extra probes are aggregated; UNKNOWN beats HEALTHY (worst-wins rank)", () => {
    const snap = aggregateOperationalHealth(["db"], [probe("db", "HEALTHY"), probe("extra", "UNKNOWN")], NOW);
    expect(snap.status).toBe("UNKNOWN");
    expect(snap.components).toHaveLength(2);
  });

  test("determinism: identical inputs produce byte-identical snapshots", () => {
    const a = aggregateOperationalHealth(["db", "queue"], [probe("db", "HEALTHY"), probe("queue", "DEGRADED")], NOW);
    const b = aggregateOperationalHealth(["db", "queue"], [probe("db", "HEALTHY"), probe("queue", "DEGRADED")], NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("W080 D2 — typed operational metrics", () => {
  test("readings are validated, sorted by name, and the window derived", () => {
    const result = makeOperationalMetrics("tnt_ops", [
      { name: "ops.queue.depth", kind: "gauge", value: 3, readAt: "2026-09-28T11:00:00Z" },
      { name: "ops.events.total", kind: "counter", value: 100, readAt: "2026-09-28T10:00:00Z" },
      { name: "ops.actions.total", kind: "counter", value: 42, readAt: "2026-09-28T12:00:00Z" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.readings.map((r) => r.name)).toEqual([
      "ops.actions.total",
      "ops.events.total",
      "ops.queue.depth",
    ]);
    expect(result.metrics.window.from).toBe("2026-09-28T10:00:00Z");
    expect(result.metrics.window.to).toBe("2026-09-28T12:00:00Z");
  });

  test("malformed readings refuse machine-stably", () => {
    const bad = makeOperationalMetrics("tnt_ops", [
      { name: "BAD NAME", kind: "counter", value: 1, readAt: "2026-09-28T10:00:00Z" },
      { name: "ops.ok", kind: "wat", value: 1, readAt: "2026-09-28T10:00:00Z" },
      { name: "ops.ok2", kind: "counter", value: Number.POSITIVE_INFINITY, readAt: "nope" },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("metric_name_invalid");
    expect(bad.reasons).toContain("metric_kind_invalid");
    expect(bad.reasons).toContain("metric_value_invalid");
    expect(bad.reasons).toContain("read_at_invalid");
  });

  test("an empty reading set is valid with an undefined window", () => {
    const result = makeOperationalMetrics("tnt_ops", []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.readings).toHaveLength(0);
    expect(result.metrics.window.from).toBeUndefined();
  });
});
