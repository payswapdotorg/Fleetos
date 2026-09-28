/**
 * W080 binding — the REAL @fleetos/integration-convergence health
 * aggregate as one ComponentHealthProbe.
 *
 * Proves (cross-lane, test-scope only):
 *   1. the REAL W051 aggregateIntegrationHealth result projects
 *      structurally into this package's ComponentHealth shape and is
 *      aggregated by aggregateOperationalHealth;
 *   2. the fail-closed semantics COMPOSE: an unbound REAL adapter
 *      (UNKNOWN at the convergence layer) degrades the OPERATIONAL
 *      snapshot too — absence of evidence is never health at either
 *      layer;
 *   3. the release gate blocks on the composed DEGRADED status
 *      (health_degraded).
 */

import { describe, expect, test } from "bun:test";
import {
  aggregateIntegrationHealth,
  type AdapterHealthProbe,
} from "@fleetos/integration-convergence";
import { asTenantId } from "@fleetos/contracts";
import { aggregateOperationalHealth, type ComponentHealthProbe } from "../src/observability";
import { evaluateReleaseGate, type ReleaseCandidate } from "../src/release-gate";

const NOW = "2026-09-28T12:00:00Z";

/**
 * The projection: a convergence adapter probe becomes an ops component
 * probe. Both are structural shapes — the adapter's { adapter, status,
 * detail } maps onto { component, status, detail } without any
 * conversion loss (the same three-status vocabulary HEALTHY/DEGRADED/
 * UNKNOWN).
 */
function convergenceComponentProbe(adapter: string): ComponentHealthProbe {
  const adapterProbe: AdapterHealthProbe = {
    adapter,
    probe: () => ({ adapter, status: "HEALTHY", detail: "bound" }),
  };
  return {
    component: `integration.${adapter}`,
    probe: () => {
      // The REAL W051 aggregate over this single adapter.
      const snap = aggregateIntegrationHealth([adapter], [adapterProbe], NOW);
      return {
        component: `integration.${adapter}`,
        status: snap.status,
        detail: snap.detail,
      };
    },
  };
}

describe("W080 binding — REAL convergence health projects into ops components", () => {
  test("a HEALTHY real adapter aggregates HEALTHY at the ops layer", () => {
    const snap = aggregateOperationalHealth(
      ["integration.adcos", "integration.arena", "integration.aurum"],
      [
        convergenceComponentProbe("adcos"),
        convergenceComponentProbe("arena"),
        convergenceComponentProbe("aurum"),
      ],
      NOW,
    );
    expect(snap.status).toBe("HEALTHY");
    expect(snap.components).toHaveLength(3);
    for (const c of snap.components) {
      expect(c.status).toBe("HEALTHY");
    }
  });

  test("an unbound REAL adapter (convergence UNKNOWN) degrades the ops snapshot — fail-closed COMPOSES", () => {
    // Bind only adcos; arena + aurum remain unbound → the REAL
    // convergence aggregate reports them UNKNOWN → the ops aggregate
    // degrades.
    const snap = aggregateOperationalHealth(
      ["integration.adcos", "integration.arena", "integration.aurum"],
      [convergenceComponentProbe("adcos")],
      NOW,
    );
    expect(snap.status).toBe("DEGRADED");
    const arena = snap.components.find((c) => c.component === "integration.arena");
    expect(arena?.status).toBe("UNKNOWN");
    expect(arena?.detail).toBe("probe_unbound");
  });

  test("a throwing REAL adapter probe degrades BOTH layers (probe_threw at convergence, DEGRADED at ops)", () => {
    const throwingAdapter: AdapterHealthProbe = {
      adapter: "adcos",
      probe: () => {
        throw new Error("adapter exploded");
      },
    };
    const opsProbe: ComponentHealthProbe = {
      component: "integration.adcos",
      probe: () => {
        const snap = aggregateIntegrationHealth(["adcos"], [throwingAdapter], NOW);
        return { component: "integration.adcos", status: snap.status, detail: snap.detail };
      },
    };
    // The convergence layer is fail-closed on the throwing probe...
    const convergenceSnap = aggregateIntegrationHealth(["adcos"], [throwingAdapter], NOW);
    expect(convergenceSnap.status).toBe("DEGRADED");
    // ...and so is the ops layer over the composed probe.
    const opsSnap = aggregateOperationalHealth(["integration.adcos"], [opsProbe], NOW);
    expect(opsSnap.status).toBe("DEGRADED");
    expect(opsSnap.components[0].detail).toBe(convergenceSnap.detail);
  });

  test("the release gate blocks (health_degraded) when the composed snapshot is DEGRADED", () => {
    const degradedSnap = aggregateOperationalHealth(
      ["integration.adcos", "integration.arena"],
      [convergenceComponentProbe("adcos")], // arena unbound → DEGRADED
      NOW,
    );
    const candidate = greenCandidate({ operationalHealth: degradedSnap });
    const verdict = evaluateReleaseGate(candidate, NOW);
    expect(verdict.verdict).toBe("release_blocked");
    expect(verdict.reasons).toEqual(["health_degraded"]);
  });
});

function greenCandidate(overrides?: Partial<ReleaseCandidate>): ReleaseCandidate {
  const healthy = aggregateOperationalHealth(
    ["integration.adcos"],
    [convergenceComponentProbe("adcos")],
    NOW,
  );
  const base = {
    plan: {
      planId: "abcdabcd",
      status: "APPROVED" as const,
      manifest: {
        manifestId: "efghefgh",
        schemaVersion: 1,
        components: [{ name: "@fleetos/ops", contentDigest: "0f5d3ad7" }],
        environment: "production" as const,
        tenantId: asTenantId("tnt_ops_binding01"),
        createdAt: NOW,
        releaseLabel: "release-1.0.0",
      },
      supersedes: undefined,
      proposedAt: NOW,
      decision: { status: "APPROVED" as const, decidedBy: "usr_operator", decidedAt: NOW },
    },
    testRun: { total: 2555, failures: 0, runDigest: "rundiges" },
    contractsSnapshotDigest: "a1b2c3d4",
    expectedContractsSnapshotDigest: "a1b2c3d4",
    auditChain: { valid: true, chains: 1 },
    backupReadiness: { verified: true, takenAt: "2026-09-28T06:00:00Z" },
    migrations: {
      appliedNow: [{ id: "ops.schema.init", version: 1, bodyDigest: "11111111", appliedAt: NOW }],
      alreadyApplied: [],
      resultingState: { applied: [{ id: "ops.schema.init", version: 1, bodyDigest: "11111111", appliedAt: NOW }] },
    },
    e2eCoverage: { covered: ["remediate-finding"], missing: [], complete: true, extraneous: [] },
    operationalHealth: healthy,
    maxBackupAgeHours: 24,
    ...overrides,
  };
  return base;
}
