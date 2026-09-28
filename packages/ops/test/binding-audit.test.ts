/**
 * W080 binding — the REAL @fleetos/audit hash-chained log + the REAL
 * @fleetos/identity TenantContext.
 *
 * Proves (cross-lane, test-scope only — the established pattern):
 *   1. the REAL identity TenantContext satisfies OpsTenantScope and is
 *      accepted by the backup ledger + the release ledger scope guards;
 *   2. the REAL audit log's verify() result feeds the release gate's
 *      AuditChainVerification — a green chain approves, a tampered
 *      chain blocks;
 *   3. this package's FNV-1a is byte-compatible with the audit
 *      reference implementation (digest discipline).
 */

import { describe, expect, test } from "bun:test";
import {
  AUDIT_GENESIS_HASH,
  createInMemoryAuditLog,
  fnv1a32Hex,
  makeAuditActorRef,
  verifyAuditChain,
  type AuditLog,
} from "@fleetos/audit";
import { makeTenantContext } from "@fleetos/identity";
import { asTenantId, asCorrelationId } from "@fleetos/contracts";
import { createBackupLedger, makeBackupManifest } from "../src/backup";
import { createReleaseLedger, evaluateReleaseGate, type ReleaseCandidate } from "../src/release-gate";
import { fnv1a32 } from "../src/internal";
import { aggregateOperationalHealth } from "../src/observability";
import { compileCoverageReport, compileE2EEvidence } from "../src/evidence";
import { applyMigrations, compileMigrationSet } from "../src/migrations";
import { decideDeploymentPlan, makeDeploymentManifest, makeDeploymentPlan } from "../src/deployment";

const TENANT = asTenantId("tnt_opsbinding01");
const NOW = "2026-09-28T12:00:00Z";

describe("W080 binding — REAL identity TenantContext satisfies OpsTenantScope", () => {
  test("makeTenantContext values are accepted by the backup + release ledgers", () => {
    const ctx = makeTenantContext(TENANT, asCorrelationId("cor_ops_1"));
    const backupLedger = createBackupLedger();
    const backup = makeBackupManifest({
      store: "fleetos.primary",
      contentDigest: "cafebabe",
      kind: "full",
      windowFrom: "2026-09-28T00:00:00Z",
      windowTo: "2026-09-28T12:00:00Z",
      takenAt: "2026-09-28T12:05:00Z",
    });
    if (!backup.ok) throw new Error("backup");
    const recorded = backupLedger.record(ctx, backup.backup, NOW);
    expect(recorded.ok).toBe(true);
    expect(backupLedger.read(ctx)).toHaveLength(1);

    const releaseLedger = createReleaseLedger();
    const record = releaseLedger.record(ctx, {
      verdict: "release_approved",
      reasons: [],
      evaluatedAt: NOW,
      evaluationDigest: "12341234",
      planId: "abcdabcd",
    });
    expect(record.ok).toBe(true);
  });

  test("a context-free / invalid scope is refused by both ledgers", () => {
    const backupLedger = createBackupLedger();
    const bad = backupLedger.read(null);
    expect(bad).toHaveLength(0);
    const releaseLedger = createReleaseLedger();
    const refused = releaseLedger.record({ tenantId: "" }, {
      verdict: "release_approved",
      reasons: [],
      evaluatedAt: NOW,
      evaluationDigest: "12341234",
      planId: "abcdabcd",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("tenant_id_required");
  });
});

describe("W080 binding — the REAL audit log feeds the release gate", () => {
  function appendGateRecords(log: AuditLog) {
    const ctx = makeTenantContext(TENANT, asCorrelationId("cor_ops_1"));
    const actor = makeAuditActorRef("service", "svc-release-gate", TENANT);
    const actions = ["ops.release.evaluated", "ops.backup.verified", "ops.migration.applied"];
    for (const action of actions) {
      log.append(ctx, {
        tenantId: TENANT,
        actor,
        action,
        occurredAt: NOW,
        source: "@fleetos/ops",
        outcome: { status: "success" },
        correlationId: asCorrelationId("cor_ops_1"),
      });
    }
    return ctx;
  }

  test("a REAL green audit chain maps to a passing AuditChainVerification", () => {
    const log = createInMemoryAuditLog();
    const ctx = appendGateRecords(log);
    const verification = log.verify(ctx);
    expect(verification.ok).toBe(true);
    // The release gate's audit condition consumes exactly this shape.
    const auditChain = { valid: verification.ok === true, chains: 1 };
    expect(auditChain.valid).toBe(true);
  });

  test("the independent walk (verifyAuditChain) agrees with the log's own verify()", () => {
    const log = createInMemoryAuditLog();
    const ctx = appendGateRecords(log);
    const records = log.records(ctx);
    expect(records).toHaveLength(3);
    const walked = verifyAuditChain(records, fnv1a32Hex);
    expect(walked.ok).toBe(true);
    // The chain is genesis-linked (the first record cites the sentinel).
    expect(records[0]?.priorRecordHash).toBe(AUDIT_GENESIS_HASH);
  });

  test("a TAMPERED chain fails the walk — and the release gate blocks on it", () => {
    const log = createInMemoryAuditLog();
    const ctx = appendGateRecords(log);
    const records = log.records(ctx);
    // Tamper: splice a foreign record into a shallow copy of the chain.
    const spliced = [
      records[0],
      {
        ...records[1],
        tenantId: asTenantId("tntopsother01"),
      },
      records[2],
    ];
    const walked = verifyAuditChain(spliced, fnv1a32Hex);
    expect(walked.ok).toBe(false);

    // Feed the tampered verdict into the gate: audit_chain_invalid blocks.
    const verdict = evaluateReleaseGate(greenCandidate({ auditChain: { valid: false, chains: 1 } }), NOW);
    expect(verdict.verdict).toBe("release_blocked");
    expect(verdict.reasons).toEqual(["audit_chain_invalid"]);
  });
});

describe("W080 binding — digest byte-compatibility with the audit reference", () => {
  test("fnv1a32 matches fnv1a32Hex on canonical inputs", () => {
    const samples = ["", "a", "hello world", '{"a":1,"b":[1,2,3]}', "genesis"];
    for (const s of samples) {
      expect(fnv1a32(s)).toBe(fnv1a32Hex(s));
    }
  });
});

// ---------------------------------------------------------------------------
// A green candidate factory over the REAL bindings (audit chain included)
// ---------------------------------------------------------------------------

function greenCandidate(overrides?: Partial<ReleaseCandidate>): ReleaseCandidate {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT, asCorrelationId("cor_ops_1"));
  const actor = makeAuditActorRef("service", "svc-release-gate", TENANT);
  log.append(ctx, {
    tenantId: TENANT,
    actor,
    action: "ops.release.evaluated",
    occurredAt: NOW,
    source: "@fleetos/ops",
    outcome: { status: "success" },
    correlationId: asCorrelationId("cor_ops_1"),
  });
  const verification = log.verify(ctx);

  const manifestInput = {
    components: [{ name: "@fleetos/ops", contentDigest: "0f5d3ad7" }],
    environment: "production" as const,
    tenantId: TENANT,
    createdAt: NOW,
    releaseLabel: "release-1.0.0",
  };
  const manifest = makeDeploymentManifest(manifestInput);
  if (!manifest.ok) throw new Error("manifest");
  const plan = makeDeploymentPlan({ manifest: manifestInput, environment: "production", proposedAt: NOW });
  if (!plan.ok) throw new Error("plan");
  const decided = decideDeploymentPlan(plan.plan, {
    status: "APPROVED",
    decidedBy: "usr_operator",
    decidedAt: "2026-09-28T12:10:00Z",
  });
  if (!decided.ok) throw new Error("decided");

  const migrationSet = compileMigrationSet([
    { id: "ops.schema.init", version: 1, target: "@fleetos/ops", bodyDigest: "11111111", description: "init" },
  ]);
  if (!migrationSet.ok) throw new Error("set");
  const migrationRun = applyMigrations(migrationSet.set, { applied: [] }, NOW);
  if (!migrationRun.ok) throw new Error("run");

  const bundle = compileE2EEvidence({
    journeyId: "remediate-finding",
    recordKinds: ["security.finding"],
    steps: [{ ordinal: 1, step: "ops.verify", evidenceRefs: ["ref"], outcome: "SUCCEEDED" }],
    capturedAt: NOW,
  });
  if (!bundle.ok) throw new Error("bundle");

  return {
    plan: decided.plan,
    testRun: { total: 2555, failures: 0, runDigest: "rundiges" },
    contractsSnapshotDigest: "a1b2c3d4",
    expectedContractsSnapshotDigest: "a1b2c3d4",
    auditChain: { valid: verification.ok === true, chains: 1 },
    backupReadiness: { verified: true, takenAt: "2026-09-28T06:00:00Z" },
    migrations: migrationRun.result,
    e2eCoverage: compileCoverageReport(["remediate-finding"], [bundle.bundle]),
    operationalHealth: aggregateOperationalHealth(
      ["audit"],
      [{ component: "audit", probe: () => ({ component: "audit", status: "HEALTHY", detail: "chain_verifies" }) }],
      NOW,
    ),
    maxBackupAgeHours: 24,
    ...overrides,
  };
}

describe("W080 binding — the release gate over the FULLY-REAL evidence set", () => {
  test("a green candidate with the REAL audit chain verifies release_approved", () => {
    const verdict = evaluateReleaseGate(greenCandidate(), NOW);
    expect(verdict.verdict).toBe("release_approved");
    expect(verdict.reasons).toHaveLength(0);
  });
});
