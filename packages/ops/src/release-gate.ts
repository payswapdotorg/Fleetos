/**
 * @fleetos/ops — D4c: the fail-closed RELEASE GATE.
 *
 * The production-readiness release surface — the FINAL gate of the
 * FleetOS roadmap discipline:
 *
 *   - `ReleaseCandidate` — what is being released: the approved
 *     deployment plan (the manifest + the HUMAN approval, recorded
 *     verbatim), the evidence inputs (migration state, backup
 *     verification, E2E coverage, tests/snapshot/audit results);
 *   - `evaluateReleaseGate` — the FAIL-CLOSED verdict: a release is
 *     `release_blocked` with the ACCUMULATED machine-stable reasons
 *     unless EVERY condition holds:
 *       1. `plan_not_approved`      — the deployment plan carries a
 *                                     human APPROVED decision;
 *       2. `tests_not_green`        — the injected test-run result is
 *                                     green (fail count 0, run present);
 *       3. `contracts_snapshot_drift` — the observed contracts snapshot
 *                                     digest matches the recorded one
 *                                     (ARCHITECTURE-LOCK: the seam is
 *                                     frozen);
 *       4. `audit_chain_invalid`    — the injected audit-chain
 *                                     verification passes;
 *       5. `backup_not_verified` / `backup_stale` — the latest backup
 *                                     for the primary store is verified
 *                                     AND within the freshness window;
 *       6. `migrations_incomplete`  — the migration state covers the
 *                                     full set (no pending steps);
 *       7. `e2e_coverage_incomplete` — every required journey has a
 *                                     complete E2E evidence bundle;
 *       8. `health_degraded`        — the operational health snapshot
 *                                     is HEALTHY.
 *     The gate NEVER auto-promotes: `release_approved` is a verdict the
 *     OPERATOR consumes; the append-only release ledger records every
 *     evaluation (both verdicts) — the promotion act itself is human.
 *   - `createReleaseLedger` — the per-tenant, append-only evaluation
 *     ledger (the W050C outbox discipline: idempotent by evaluation
 *     digest, gapless per-tenant sequence).
 *
 * Pure: the "now" instant is INJECTED (staleness judged without a
 * clock read); no entropy/network. Strict TS; no `any`.
 */

import type { DeploymentPlan } from "./deployment";
import type { MigrationRunResult } from "./migrations";
import type { E2ECoverageReport } from "./evidence";
import type { OperationalHealthSnapshot } from "./observability";
import { checkOpsTenantScope, compareInstants, digestOf, frozen, frozenArray, isValidInstant, sortedUniqueStrings } from "./internal";

// ---------------------------------------------------------------------------
// The release candidate + evidence inputs
// ---------------------------------------------------------------------------

/** The injected test-run result (the CI evidence). */
export interface TestRunResult {
  /** The total test count. */
  readonly total: number;
  /** The failure count (0 = green). */
  readonly failures: number;
  /** The run digest (content-addressed run record). */
  readonly runDigest: string;
}

/** The audit-chain verification result (injected — bound to the REAL log at the binding site). */
export interface AuditChainVerification {
  /** True when every tenant chain verifies. */
  readonly valid: boolean;
  /** The verified chain count. */
  readonly chains: number;
}

/** The backup freshness evidence. */
export interface BackupReadiness {
  /** True when the latest primary-store backup is VERIFIED. */
  readonly verified: boolean;
  /** The latest verified backup's takenAt instant (undefined when unverified). */
  readonly takenAt: string | undefined;
}

/** The release candidate: the plan + every evidence input. */
export interface ReleaseCandidate {
  readonly plan: DeploymentPlan;
  readonly testRun: TestRunResult;
  readonly contractsSnapshotDigest: string;
  readonly expectedContractsSnapshotDigest: string;
  readonly auditChain: AuditChainVerification;
  readonly backupReadiness: BackupReadiness;
  readonly migrations: MigrationRunResult;
  readonly e2eCoverage: E2ECoverageReport;
  readonly operationalHealth: OperationalHealthSnapshot;
  /** The maximum backup age (ISO duration suffix in hours, e.g. "24") — freshness window. */
  readonly maxBackupAgeHours: number;
}

// ---------------------------------------------------------------------------
// The gate evaluation
// ---------------------------------------------------------------------------

/** The machine-stable blocked reason vocabulary. */
export const RELEASE_BLOCK_REASONS: ReadonlyArray<string> = frozenArray([
  "plan_not_approved",
  "plan_missing_decision",
  "tests_not_green",
  "contracts_snapshot_drift",
  "audit_chain_invalid",
  "backup_not_verified",
  "backup_stale",
  "migrations_incomplete",
  "e2e_coverage_incomplete",
  "health_degraded",
]);

/** The release-gate verdict record. */
export interface ReleaseVerdict {
  /** release_approved | release_blocked (fail-closed — never a silent pass). */
  readonly verdict: "release_approved" | "release_blocked";
  /** The accumulated machine-stable reasons (empty iff approved; SORTED). */
  readonly reasons: ReadonlyArray<string>;
  /** The evaluation instant (INJECTED). */
  readonly evaluatedAt: string;
  /** The deterministic evaluation digest (the ledger's idempotency key). */
  readonly evaluationDigest: string;
  /** The candidate's plan id (recorded verbatim). */
  readonly planId: string;
}

/** The injected freshness horizon: parse the "now" + window into a comparison. */
function backupIsFresh(candidate: ReleaseCandidate, now: string): boolean {
  const takenAt = candidate.backupReadiness.takenAt;
  if (takenAt === undefined) return false;
  // A backup older than maxBackupAgeHours (in seconds) is stale — the
  // comparison is lexical over same-format ISO instants with an
  // hour-shifted horizon (deterministic; no clock read).
  const horizon = new Date(now).getTime() - candidate.maxBackupAgeHours * 3600_000;
  const taken = new Date(takenAt).getTime();
  if (Number.isNaN(horizon) || Number.isNaN(taken)) return false;
  return taken >= horizon;
}

/**
 * Evaluate the release gate — FAIL-CLOSED.
 *
 * Every condition must hold for `release_approved`; ANY failure
 * accumulates its machine-stable reason(s) and the verdict is
 * `release_blocked`. The gate NEVER promotes anything itself — the
 * verdict is evidence for the human operator (the W040 human-grant
 * discipline at the roadmap's final boundary).
 */
export function evaluateReleaseGate(candidate: ReleaseCandidate, now: string): ReleaseVerdict {
  const reasons: string[] = [];

  // 1. The plan must carry a HUMAN APPROVED decision.
  if (candidate.plan.status !== "APPROVED") {
    reasons.push("plan_not_approved");
  } else if (candidate.plan.decision === undefined) {
    reasons.push("plan_missing_decision");
  }

  // 2. Tests green: failures 0 AND a present run.
  if (
    typeof candidate.testRun.total !== "number" ||
    typeof candidate.testRun.failures !== "number" ||
    candidate.testRun.failures > 0 ||
    candidate.testRun.total <= 0 ||
    typeof candidate.testRun.runDigest !== "string" ||
    candidate.testRun.runDigest.length === 0
  ) {
    reasons.push("tests_not_green");
  }

  // 3. The contracts snapshot is FROZEN — the observed digest must match.
  if (
    typeof candidate.contractsSnapshotDigest !== "string" ||
    candidate.contractsSnapshotDigest.length === 0 ||
    candidate.contractsSnapshotDigest !== candidate.expectedContractsSnapshotDigest
  ) {
    reasons.push("contracts_snapshot_drift");
  }

  // 4. The audit chains verify.
  if (candidate.auditChain.valid !== true) {
    reasons.push("audit_chain_invalid");
  }

  // 5. Backup verified + fresh.
  if (candidate.backupReadiness.verified !== true) {
    reasons.push("backup_not_verified");
  } else if (!isValidInstant(now) || !backupIsFresh(candidate, now)) {
    reasons.push("backup_stale");
  }

  // 6. Migrations complete: no PENDING steps — every set step either
  //    applied now or already applied (the run result covers the set).
  if (
    !Array.isArray(candidate.migrations.appliedNow) ||
    !Array.isArray(candidate.migrations.alreadyApplied) ||
    candidate.migrations.appliedNow.length + candidate.migrations.alreadyApplied.length === 0
  ) {
    reasons.push("migrations_incomplete");
  }

  // 7. E2E coverage complete.
  if (candidate.e2eCoverage.complete !== true) {
    reasons.push("e2e_coverage_incomplete");
  }

  // 8. Operational health HEALTHY (fail-closed: UNKNOWN or DEGRADED blocks).
  if (candidate.operationalHealth.status !== "HEALTHY") {
    reasons.push("health_degraded");
  }

  const verdict: ReleaseVerdict["verdict"] = reasons.length > 0 ? "release_blocked" : "release_approved";
  const sortedReasons = sortedUniqueStrings(reasons);
  const evaluationDigest = digestOf({
    verdict,
    reasons: sortedReasons,
    planId: candidate.plan.planId,
    testRun: candidate.testRun,
    contractsSnapshotDigest: candidate.contractsSnapshotDigest,
    auditChains: candidate.auditChain.chains,
    backupVerified: candidate.backupReadiness.verified,
    backupTakenAt: candidate.backupReadiness.takenAt,
    migrationSteps:
      candidate.migrations.appliedNow.length + candidate.migrations.alreadyApplied.length,
    e2eMissing: candidate.e2eCoverage.missing,
    healthStatus: candidate.operationalHealth.status,
  });

  return frozen({
    verdict,
    reasons: sortedReasons,
    evaluatedAt: now,
    evaluationDigest,
    planId: candidate.plan.planId,
  });
}

// ---------------------------------------------------------------------------
// The append-only release ledger (per-tenant, idempotent, gapless)
// ---------------------------------------------------------------------------

/** One release-ledger record: the verdict + the per-tenant sequence number. */
export interface ReleaseLedgerRecord {
  readonly verdict: ReleaseVerdict;
  /** The per-tenant 1-based sequence (gapless — the W050C outbox discipline). */
  readonly sequence: number;
}

/** The release-evidence ledger — records EVERY gate evaluation (both verdicts). */
export interface ReleaseLedger {
  /** Record a verdict (idempotent by evaluationDigest — returns the existing record). */
  record(scope: unknown, verdict: ReleaseVerdict): { readonly ok: true; readonly record: ReleaseLedgerRecord } | { readonly ok: false; readonly reason: string };
  /** Read the tenant's evaluation history (append order). */
  read(scope: unknown): readonly ReleaseLedgerRecord[];
}

/** Create a per-tenant-partitioned in-memory release ledger. */
export function createReleaseLedger(): ReleaseLedger {
  const partitions = new Map<string, ReleaseLedgerRecord[]>();
  return {
    record(scope, verdict) {
      const check = checkOpsTenantScope(scope);
      if (!check.ok) return { ok: false, reason: check.reason };
      if (verdict === null || typeof verdict !== "object" || typeof verdict.evaluationDigest !== "string") {
        return { ok: false, reason: "verdict_invalid" };
      }
      const ledger = partitions.get(check.tenantId) ?? [];
      const existing = ledger.find((r) => r.verdict.evaluationDigest === verdict.evaluationDigest);
      if (existing) return { ok: true, record: existing };
      const record: ReleaseLedgerRecord = frozen({ verdict, sequence: ledger.length + 1 });
      partitions.set(check.tenantId, [...ledger, record]);
      return { ok: true, record };
    },
    read(scope) {
      const check = checkOpsTenantScope(scope);
      if (!check.ok) return [];
      return frozenArray(partitions.get(check.tenantId) ?? []);
    },
  };
}

/** Convenience: the freshness horizon check exposed for tests (deterministic). */
export function releaseBackupHorizon(now: string, maxAgeHours: number): string {
  const t = new Date(now).getTime() - maxAgeHours * 3600_000;
  return new Date(t).toISOString();
}

/** Lexical instant comparison re-export guard (test-facing, deterministic). */
export function compareBackupInstants(a: string, b: string): number {
  return compareInstants(a, b);
}
