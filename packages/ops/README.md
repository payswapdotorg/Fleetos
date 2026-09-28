# @fleetos/ops

The **W080 [TL] production-readiness** package — the FleetOS roadmap's
FINAL item. Tech-Lead owned (`spec/worker-ownership.yaml`).

## Surface

- **D1 — deployment** (`deployment.ts`): content-addressed
  `DeploymentManifest` (component set + environment + tenant scope,
  FNV-1a digest over the canonical form) and PROPOSAL-gated
  `DeploymentPlan`s (`PROPOSED -> APPROVED/REJECTED` is a HUMAN
  transition; supersedes discipline; machine-stable
  `environment_mismatch` / `plan_not_proposed` / ... refusals).
- **D2 — observability** (`observability.ts`): the fail-closed,
  worst-wins `aggregateOperationalHealth` over INJECTED
  `ComponentHealthProbe` seams (unbound expected component -> UNKNOWN ->
  DEGRADED; throwing/shape-invalid probe -> DEGRADED; empty set ->
  UNKNOWN — never silently healthy) + typed read-only
  `OperationalMetrics`.
- **D3a — backup/restore** (`backup.ts`): content-addressed
  `BackupManifest`s, the append-only per-tenant `BackupLedger`
  (idempotent by backupId), and `RestoreDrill`s — a SUCCEEDED drill
  (digest match) is the ONLY verification path; a FAILED drill verifies
  NOTHING; unverified backups are never assumed restorable.
- **D3b — migrations** (`migrations.ts`): ordered digest-CHAINED
  `MigrationSet`s with the FROZEN-SURFACE guard (a migration targeting
  `@fleetos/contracts` refuses — ARCHITECTURE-LOCK) and the idempotent,
  fail-closed runner (`sequence_gap` / `downgrade` /
  `digest_mismatch`).
- **D4a — E2E evidence** (`evidence.ts`): per-journey
  `E2EEvidenceBundle`s (fail-fast `evidence_incomplete` with SORTED
  missing paths — the W071 discipline) + `E2ECoverageReport`s. The four
  REAL `@fleetos/web-shell` builtin journeys are the canonical coverage
  vocabulary (bound in test/).
- **D4b — runbook** (`runbook.ts`): typed operator procedures over the
  frozen 10-verb intent vocabulary, content-addressed with revision
  supersedes discipline; `ops.rollback` is terminal; descriptive only —
  never executes anything.
- **D4c — the release gate** (`release-gate.ts`): the FAIL-CLOSED
  `evaluateReleaseGate` — a release is `release_blocked` with the
  accumulated SORTED machine-stable reasons unless EVERY condition
  holds (plan human-APPROVED, tests green, contracts snapshot unchanged,
  audit chains verify, backup verified + fresh, migrations complete,
  E2E coverage complete, operational health HEALTHY). The gate never
  auto-promotes; the append-only per-tenant `ReleaseLedger` records
  BOTH verdicts.

## Discipline

- `src/` imports `@fleetos/contracts` ONLY (the ownership gate's
  cross-lane rule). Every cross-lane edge — the REAL `@fleetos/audit`
  hash-chained log, the REAL `@fleetos/identity` TenantContext, the
  REAL `@fleetos/integration-convergence` health aggregate, the REAL
  `@fleetos/web-shell` journeys — is bound at the `test/` binding
  sites (the established W011/.../W071 pattern).
- Deterministic: no clock, no entropy, no network — every instant is
  injected. FNV-1a digests byte-compatible with the `@fleetos/audit`
  reference (asserted by test).
- No runtime dependencies. No `any` in public signatures. Strict TS.
- Reference: `spec/ARCHITECTURE-LOCK.md` items 3, 4, 16, 18, 20;
  `spec/work-items/WORK-ITEM-CATALOG.md` § W080.
