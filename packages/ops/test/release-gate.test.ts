import { describe, expect, test } from "bun:test";
import { evaluateReleaseGate, createReleaseLedger, releaseBackupHorizon } from "../src/release-gate";
import { makeDeploymentManifest, makeDeploymentPlan, decideDeploymentPlan } from "../src/deployment";
import { compileMigrationSet, applyMigrations } from "../src/migrations";
import { compileCoverageReport, compileE2EEvidence } from "../src/evidence";
import { aggregateOperationalHealth } from "../src/observability";
import { asTenantId } from "@fleetos/contracts";

const TENANT = asTenantId("tnt_ops_release");
const NOW = "2026-09-28T12:00:00Z";

function approvedPlan() {
  const manifest = makeDeploymentManifest({
    components: [{ name: "@fleetos/ops", contentDigest: "0f5d3ad7" }],
    environment: "production",
    tenantId: TENANT,
    createdAt: NOW,
    releaseLabel: "release-1.0.0",
  });
  if (!manifest.ok) throw new Error("manifest");
  const plan = makeDeploymentPlan({
    manifest: {
      components: [{ name: "@fleetos/ops", contentDigest: "0f5d3ad7" }],
      environment: "production",
      tenantId: TENANT,
      createdAt: NOW,
      releaseLabel: "release-1.0.0",
    },
    environment: "production",
    proposedAt: NOW,
  });
  if (!plan.ok) throw new Error("plan");
  const decided = decideDeploymentPlan(plan.plan, {
    status: "APPROVED",
    decidedBy: "usr_operator",
    decidedAt: "2026-09-28T12:10:00Z",
  });
  if (!decided.ok) throw new Error("decided");
  return decided.plan;
}

function migrationResult() {
  const set = compileMigrationSet([
    { id: "ops.schema.init", version: 1, target: "@fleetos/ops", bodyDigest: "11111111", description: "init" },
  ]);
  if (!set.ok) throw new Error("set");
  const run = applyMigrations(set.set, { applied: [] }, NOW);
  if (!run.ok) throw new Error("run");
  return run.result;
}

function e2eCoverage(complete: boolean) {
  const required = ["journey.remediate-finding"];
  if (!complete) return compileCoverageReport(required, []);
  const bundle = compileE2EEvidence({
    journeyId: "journey.remediate-finding",
    recordKinds: ["security.finding"],
    steps: [{ ordinal: 1, step: "ops.verify", evidenceRefs: ["ref"], outcome: "SUCCEEDED" }],
    capturedAt: NOW,
  });
  if (!bundle.ok) throw new Error("bundle");
  return compileCoverageReport(required, [bundle.bundle]);
}

function healthySnapshot(status: "HEALTHY" | "DEGRADED") {
  return aggregateOperationalHealth(["db"], [{ component: "db", probe: () => ({ component: "db", status, detail: status }) }], NOW);
}

function greenCandidate() {
  return {
    plan: approvedPlan(),
    testRun: { total: 2555, failures: 0, runDigest: "rundiges" },
    contractsSnapshotDigest: "a1b2c3d4",
    expectedContractsSnapshotDigest: "a1b2c3d4",
    auditChain: { valid: true, chains: 2 },
    backupReadiness: { verified: true, takenAt: "2026-09-28T06:00:00Z" },
    migrations: migrationResult(),
    e2eCoverage: e2eCoverage(true),
    operationalHealth: healthySnapshot("HEALTHY"),
    maxBackupAgeHours: 24,
  };
}

describe("W080 D4c — the fail-closed RELEASE GATE", () => {
  test("a fully-evidenced candidate is release_approved with NO reasons", () => {
    const verdict = evaluateReleaseGate(greenCandidate(), NOW);
    expect(verdict.verdict).toBe("release_approved");
    expect(verdict.reasons).toHaveLength(0);
    expect(verdict.planId).toHaveLength(8);
    expect(verdict.evaluationDigest).toHaveLength(8);
  });

  test("a PROPOSED (unapproved) plan blocks with plan_not_approved", () => {
    const manifestInput = {
      components: [{ name: "@fleetos/ops", contentDigest: "0f5d3ad7" }],
      environment: "production",
      tenantId: TENANT,
      createdAt: NOW,
      releaseLabel: "release-1.0.0",
    };
    const plan = makeDeploymentPlan({ manifest: manifestInput, environment: "production", proposedAt: NOW });
    if (!plan.ok) throw new Error("plan");
    const candidate = { ...greenCandidate(), plan: plan.plan };
    const verdict = evaluateReleaseGate(candidate, NOW);
    expect(verdict.verdict).toBe("release_blocked");
    expect(verdict.reasons).toEqual(["plan_not_approved"]);
  });

  test("failing tests block with tests_not_green", () => {
    const candidate = { ...greenCandidate(), testRun: { total: 2555, failures: 3, runDigest: "rundiges" } };
    const verdict = evaluateReleaseGate(candidate, NOW);
    expect(verdict.verdict).toBe("release_blocked");
    expect(verdict.reasons).toEqual(["tests_not_green"]);
  });

  test("contracts snapshot drift blocks (the seam is FROZEN)", () => {
    const candidate = { ...greenCandidate(), contractsSnapshotDigest: "ffffffff" };
    const verdict = evaluateReleaseGate(candidate, NOW);
    expect(verdict.reasons).toEqual(["contracts_snapshot_drift"]);
  });

  test("an invalid audit chain blocks with audit_chain_invalid", () => {
    const candidate = { ...greenCandidate(), auditChain: { valid: false, chains: 2 } };
    const verdict = evaluateReleaseGate(candidate, NOW);
    expect(verdict.reasons).toEqual(["audit_chain_invalid"]);
  });

  test("an unverified backup blocks with backup_not_verified; a stale one with backup_stale", () => {
    const unverified = { ...greenCandidate(), backupReadiness: { verified: false, takenAt: undefined } };
    expect(evaluateReleaseGate(unverified, NOW).reasons).toEqual(["backup_not_verified"]);

    // Verified but taken 7 days ago with a 24h window → stale.
    const stale = {
      ...greenCandidate(),
      backupReadiness: { verified: true, takenAt: "2026-09-21T06:00:00Z" },
    };
    expect(evaluateReleaseGate(stale, NOW).reasons).toEqual(["backup_stale"]);
  });

  test("incomplete migrations and incomplete E2E coverage each block", () => {
    const pending = { ...greenCandidate(), migrations: { appliedNow: [], alreadyApplied: [], resultingState: { applied: [] } } };
    expect(evaluateReleaseGate(pending, NOW).reasons).toEqual(["migrations_incomplete"]);

    const noE2E = { ...greenCandidate(), e2eCoverage: e2eCoverage(false) };
    expect(evaluateReleaseGate(noE2E, NOW).reasons).toEqual(["e2e_coverage_incomplete"]);
  });

  test("DEGRADED operational health blocks with health_degraded (fail-closed: UNKNOWN too)", () => {
    const degraded = { ...greenCandidate(), operationalHealth: healthySnapshot("DEGRADED") };
    expect(evaluateReleaseGate(degraded, NOW).reasons).toEqual(["health_degraded"]);
  });

  test("MULTIPLE failures ACCUMULATE into the SORTED reason list (fail-closed aggregate)", () => {
    const disaster = {
      ...greenCandidate(),
      testRun: { total: 100, failures: 5, runDigest: "" },
      contractsSnapshotDigest: "ffffffff",
      auditChain: { valid: false, chains: 0 },
      backupReadiness: { verified: false, takenAt: undefined },
      e2eCoverage: e2eCoverage(false),
      operationalHealth: healthySnapshot("DEGRADED"),
    };
    const verdict = evaluateReleaseGate(disaster, NOW);
    expect(verdict.verdict).toBe("release_blocked");
    expect(verdict.reasons).toEqual([
      "audit_chain_invalid",
      "backup_not_verified",
      "contracts_snapshot_drift",
      "e2e_coverage_incomplete",
      "health_degraded",
      "tests_not_green",
    ]);
  });

  test("determinism: identical candidates + instants produce identical verdicts", () => {
    const a = evaluateReleaseGate(greenCandidate(), NOW);
    const b = evaluateReleaseGate(greenCandidate(), NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the backup horizon is deterministic (injected now, no clock read)", () => {
    const horizon = releaseBackupHorizon("2026-09-28T12:00:00Z", 24);
    expect(horizon).toBe("2026-09-27T12:00:00.000Z");
  });
});

describe("W080 D4c — the append-only release ledger", () => {
  test("records are idempotent by evaluation digest with a gapless per-tenant sequence", () => {
    const ledger = createReleaseLedger();
    const scope = { tenantId: TENANT };
    const v1 = evaluateReleaseGate(greenCandidate(), NOW);
    const v2 = evaluateReleaseGate(
      { ...greenCandidate(), testRun: { total: 2556, failures: 0, runDigest: "rundiges" } },
      NOW,
    );
    const r1 = ledger.record(scope, v1);
    const r1again = ledger.record(scope, v1);
    const r2 = ledger.record(scope, v2);
    expect(r1.ok).toBe(true);
    expect(r1again.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r1again.ok || !r2.ok) return;
    expect(r1.record.sequence).toBe(1);
    expect(r1again.record.sequence).toBe(1); // idempotent
    expect(r2.record.sequence).toBe(2); // gapless
    expect(ledger.read(scope)).toHaveLength(2);
  });

  test("BOTH verdicts are recorded (the gate never hides a blocked release)", () => {
    const ledger = createReleaseLedger();
    const scope = { tenantId: TENANT };
    const blocked = evaluateReleaseGate(
      { ...greenCandidate(), testRun: { total: 10, failures: 1, runDigest: "x" } },
      NOW,
    );
    const approved = evaluateReleaseGate(greenCandidate(), NOW);
    ledger.record(scope, blocked);
    ledger.record(scope, approved);
    const history = ledger.read(scope);
    expect(history).toHaveLength(2);
    expect(history[0].verdict.verdict).toBe("release_blocked");
    expect(history[1].verdict.verdict).toBe("release_approved");
  });

  test("tenant partitions are isolated; context-free access refuses", () => {
    const ledger = createReleaseLedger();
    const verdict = evaluateReleaseGate(greenCandidate(), NOW);
    const r = ledger.record(null, verdict);
    expect(r.ok).toBe(false);
    expect(ledger.read({ tenantId: asTenantId("tnt_ops_other") })).toHaveLength(0);
  });
});
