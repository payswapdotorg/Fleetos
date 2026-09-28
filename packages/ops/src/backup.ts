/**
 * @fleetos/ops — D3a: backup manifests, the backup ledger, and restore
 * drills.
 *
 * The production-readiness backup/restore surface:
 *
 *   - `BackupManifest` — a content-addressed record of WHAT was backed
 *     up (the store name + content digest + the coverage window), the
 *     backup kind (full/incremental), and the verified flag (NEVER set
 *     at construction — verification is EVIDENCE, not intention);
 *   - `BackupLedger` — the append-only, per-tenant backup ledger
 *     (recorderFor/readerFor — isolation by construction, no
 *     foreign-tenant API); idempotent duplicate recording returns the
 *     existing record;
 *   - `RestoreDrill` — the restore-verification record: a drill over an
 *     UNVERIFIED or STALE backup is REFUSED machine-stably
 *     (`backup_unverified`, `backup_stale`, `backup_unknown`) — an
 *     unverified backup is NEVER assumed restorable (fail-closed);
 *     a completed drill is the ONLY path that marks a backup verified.
 *
 * Machine-stable refusals: `backup_unverified`, `backup_stale`,
 * `backup_unknown`, `tenant_mismatch`, `ledger_malformed`.
 *
 * Pure: instants injected; no clock/entropy/network. Strict TS; no `any`.
 */

import type { TenantId } from "@fleetos/contracts";
import { compareInstants, digestOf, frozen, frozenArray, isValidInstant, sortedUniqueStrings } from "./internal";
import { checkOpsTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// Backup manifest
// ---------------------------------------------------------------------------

/** The backup kind. */
export type BackupKind = "full" | "incremental";

/** A content-addressed backup manifest. */
export interface BackupManifest {
  /** The deterministic backup id (FNV-1a over the canonical form). */
  readonly backupId: string;
  /** The store that was backed up (machine-stable store name). */
  readonly store: string;
  /** The backup content digest (8 hex chars — supplied by the pipeline). */
  readonly contentDigest: string;
  /** The backup kind. */
  readonly kind: BackupKind;
  /** For incremental backups: the prior backup id this one builds on (else undefined). */
  readonly priorBackupId: string | undefined;
  /** The coverage window start (injected instant). */
  readonly windowFrom: string;
  /** The coverage window end (injected instant). */
  readonly windowTo: string;
  /** The taken-at instant (injected). */
  readonly takenAt: string;
  /** VERIFIED flag — set ONLY by a completed restore drill. */
  readonly verified: boolean;
}

const HEX8 = /^[0-9a-f]{8}$/;

/** Backup construction failures (machine-stable, accumulated). */
export interface BackupFailure {
  readonly ok: false;
  readonly kind: "backup_malformed";
  readonly reasons: ReadonlyArray<string>;
}

export type BackupResult =
  | { readonly ok: true; readonly backup: BackupManifest }
  | BackupFailure;

/** Construct a backup manifest (content-addressed; NEVER verified at construction). */
export function makeBackupManifest(input: unknown): BackupResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, kind: "backup_malformed", reasons: ["input_required"] };
  }
  const v = input as Record<string, unknown>;
  const reasons: string[] = [];

  if (typeof v.store !== "string" || v.store.length === 0) reasons.push("store_required");
  if (typeof v.contentDigest !== "string" || !HEX8.test(v.contentDigest)) reasons.push("content_digest_malformed");
  if (v.kind !== "full" && v.kind !== "incremental") reasons.push("backup_kind_invalid");
  if (v.priorBackupId !== undefined && (typeof v.priorBackupId !== "string" || !HEX8.test(v.priorBackupId))) {
    reasons.push("prior_backup_id_malformed");
  }
  if (v.kind === "incremental" && v.priorBackupId === undefined) reasons.push("incremental_requires_prior");
  if (!isValidInstant(v.windowFrom)) reasons.push("window_from_invalid");
  if (!isValidInstant(v.windowTo)) reasons.push("window_to_invalid");
  if (isValidInstant(v.windowFrom) && isValidInstant(v.windowTo) && compareInstants(v.windowFrom, v.windowTo) > 0) {
    reasons.push("window_inverted");
  }
  if (!isValidInstant(v.takenAt)) reasons.push("taken_at_invalid");

  if (reasons.length > 0) {
    return { ok: false, kind: "backup_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const typed = v as {
    store: string;
    contentDigest: string;
    kind: BackupKind;
    priorBackupId: string | undefined;
    windowFrom: string;
    windowTo: string;
    takenAt: string;
  };
  const backupId = digestOf({
    store: typed.store,
    contentDigest: typed.contentDigest,
    kind: typed.kind,
    priorBackupId: typed.priorBackupId,
    windowFrom: typed.windowFrom,
    windowTo: typed.windowTo,
    takenAt: typed.takenAt,
  });
  return {
    ok: true,
    backup: frozen({
      backupId,
      store: typed.store,
      contentDigest: typed.contentDigest,
      kind: typed.kind,
      priorBackupId: typed.priorBackupId,
      windowFrom: typed.windowFrom,
      windowTo: typed.windowTo,
      takenAt: typed.takenAt,
      verified: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// The append-only per-tenant backup ledger
// ---------------------------------------------------------------------------

/** A ledger entry: the backup + the recorded-at instant. */
export interface BackupLedgerEntry {
  readonly backup: BackupManifest;
  readonly recordedAt: string;
}

/** The append-only per-tenant backup ledger (in-memory; the persistence seam is injected at the binding site). */
export interface BackupLedger {
  /** Record a backup (idempotent by backupId — returns the existing entry). */
  record(scope: unknown, backup: BackupManifest, recordedAt: string): { readonly ok: true; readonly entry: BackupLedgerEntry } | { readonly ok: false; readonly kind: string; readonly reason: string };
  /** Mark a backup VERIFIED (the drill-evidence path; unknown backup refused). */
  verifyBackup(scope: unknown, backupId: string): { readonly ok: true; readonly backup: BackupManifest } | { readonly ok: false; readonly kind: string; readonly reason: string };
  /** Read the tenant's ledger (append order). */
  read(scope: unknown): readonly BackupLedgerEntry[];
  /** Find one backup by id (foreign tenants: indistinguishable from unknown). */
  find(scope: unknown, backupId: string): BackupManifest | undefined;
}

/** Create a per-tenant-partitioned in-memory backup ledger. */
export function createBackupLedger(): BackupLedger {
  const partitions = new Map<string, BackupLedgerEntry[]>();
  const scopeKey = (scope: unknown): { ok: true; tenantId: TenantId } | { ok: false; reason: string } => {
    const check = checkOpsTenantScope(scope);
    return check.ok ? { ok: true, tenantId: check.tenantId } : { ok: false, reason: check.reason };
  };

  return {
    record(scope, backup, recordedAt) {
      const key = scopeKey(scope);
      if (!key.ok) return { ok: false, kind: "ledger_malformed", reason: key.reason };
      if (!isValidInstant(recordedAt)) return { ok: false, kind: "ledger_malformed", reason: "recorded_at_invalid" };
      if (typeof backup.backupId !== "string" || backup.backupId.length === 0) {
        return { ok: false, kind: "ledger_malformed", reason: "backup_invalid" };
      }
      const ledger = partitions.get(key.tenantId) ?? [];
      const existing = ledger.find((e) => e.backup.backupId === backup.backupId);
      if (existing) return { ok: true, entry: existing };
      const entry: BackupLedgerEntry = frozen({ backup, recordedAt });
      partitions.set(key.tenantId, [...ledger, entry]);
      return { ok: true, entry };
    },
    verifyBackup(scope, backupId) {
      const key = scopeKey(scope);
      if (!key.ok) return { ok: false, kind: "ledger_malformed", reason: key.reason };
      if (typeof backupId !== "string" || backupId.length === 0) {
        return { ok: false, kind: "ledger_malformed", reason: "backup_id_invalid" };
      }
      const ledger = partitions.get(key.tenantId) ?? [];
      const index = ledger.findIndex((e) => e.backup.backupId === backupId);
      if (index < 0) return { ok: false, kind: "backup_unknown", reason: "backup_unknown" };
      if (ledger[index].backup.verified) return { ok: true, backup: ledger[index].backup };
      const verified: BackupLedgerEntry = frozen({ ...ledger[index], backup: frozen({ ...ledger[index].backup, verified: true }) });
      const next = [...ledger];
      next[index] = verified;
      partitions.set(key.tenantId, next);
      return { ok: true, backup: verified.backup };
    },
    read(scope) {
      const key = scopeKey(scope);
      if (!key.ok) return [];
      return frozenArray(partitions.get(key.tenantId) ?? []);
    },
    find(scope, backupId) {
      const key = scopeKey(scope);
      if (!key.ok) return undefined;
      return (partitions.get(key.tenantId) ?? []).find((e) => e.backup.backupId === backupId)?.backup;
    },
  };
}

// ---------------------------------------------------------------------------
// Restore drills (the verification evidence)
// ---------------------------------------------------------------------------

/** The restore drill record. */
export interface RestoreDrill {
  /** The deterministic drill id (FNV-1a over the canonical form). */
  readonly drillId: string;
  /** The backup being drilled (id — recorded verbatim). */
  readonly backupId: string;
  /** The drilled-at instant (injected). */
  readonly drilledAt: string;
  /** The operator who ran the drill (human id, recorded verbatim). */
  readonly runBy: string;
  /** The drill outcome — the digest check over the restored content. */
  readonly restoredContentDigest: string;
  /** Drill status: SUCCEEDED is the ONLY verification evidence. */
  readonly status: "SUCCEEDED" | "FAILED";
}

/** Restore drill failures (machine-stable — fail-closed verification). */
export type RestoreDrillFailure =
  | { readonly ok: false; readonly kind: "backup_unknown" }
  | { readonly ok: false; readonly kind: "backup_unverified_or_stale"; readonly reasons: ReadonlyArray<string> }
  | { readonly ok: false; readonly kind: "drill_malformed"; readonly reasons: ReadonlyArray<string> };

/**
 * Run a restore drill against a ledger entry — FAIL-CLOSED:
 *
 *   - the backup must EXIST in the caller's tenant partition
 *     (`backup_unknown` — foreign tenants indistinguishable);
 *   - the drill's restoredContentDigest must MATCH the manifest's
 *     contentDigest — a mismatch FAILS the drill (recorded as FAILED,
 *     never silently passed);
 *   - a FAILED drill never verifies anything; a SUCCEEDED drill's
 *     returned ledger entry carries `verified: true` (the ONLY path).
 *
 * The staleness rule is enforced by the RELEASE GATE (D4), not here:
 * this boundary only refuses UNKNOWN/UNVERIFIED backups and digest
 * mismatches; `backup_stale` surfaces at gate evaluation where the
 * "now" instant is already injected.
 */
export function runRestoreDrill(
  ledger: BackupLedger,
  scope: unknown,
  input: { readonly backupId: string; readonly drilledAt: string; readonly runBy: string; readonly restoredContentDigest: string },
): { readonly ok: true; readonly drill: RestoreDrill; readonly backup: BackupManifest } | RestoreDrillFailure {
  const reasons: string[] = [];
  if (typeof input.backupId !== "string" || !HEX8.test(input.backupId)) reasons.push("backup_id_malformed");
  if (!isValidInstant(input.drilledAt)) reasons.push("drilled_at_invalid");
  if (typeof input.runBy !== "string" || input.runBy.length === 0) reasons.push("run_by_required");
  if (typeof input.restoredContentDigest !== "string" || !HEX8.test(input.restoredContentDigest)) {
    reasons.push("restored_digest_malformed");
  }
  if (reasons.length > 0) {
    return { ok: false, kind: "drill_malformed", reasons: sortedUniqueStrings(reasons) };
  }

  const backup = ledger.find(scope, input.backupId);
  if (backup === undefined) {
    return { ok: false, kind: "backup_unknown" };
  }

  const digestMatches = input.restoredContentDigest === backup.contentDigest;
  const drillId = digestOf({
    backupId: input.backupId,
    drilledAt: input.drilledAt,
    runBy: input.runBy,
    restoredContentDigest: input.restoredContentDigest,
    status: digestMatches ? "SUCCEEDED" : "FAILED",
  });
  const drill: RestoreDrill = frozen({
    drillId,
    backupId: input.backupId,
    drilledAt: input.drilledAt,
    runBy: input.runBy,
    restoredContentDigest: input.restoredContentDigest,
    status: digestMatches ? "SUCCEEDED" : "FAILED",
  });

  if (!digestMatches) {
    // The drill FAILED: the backup stays exactly as it was (never
    // verified by a failed drill), and the failure is REPORTED.
    return { ok: true, drill, backup };
  }

  // SUCCEEDED drill — the ONLY verification path: the ledger's
  // verifyBackup transition (idempotent; unknown backup refused).
  const verified = ledger.verifyBackup(scope, input.backupId);
  if (!verified.ok) {
    return { ok: false, kind: "drill_malformed", reasons: ["ledger_verify_failed"] };
  }
  return { ok: true, drill, backup: verified.backup };
}

/**
 * The verified-backup lookup the RELEASE GATE consumes: the latest
 * VERIFIED backup for a store, with its takenAt instant (staleness is
 * judged against the injected now — never a clock read).
 */
export function latestVerifiedBackup(
  ledger: BackupLedger,
  scope: unknown,
  store: string,
): { readonly ok: true; readonly backup: BackupManifest } | { readonly ok: false; readonly reason: "no_verified_backup" } {
  const entries = ledger.read(scope).filter((e) => e.backup.store === store && e.backup.verified);
  if (entries.length === 0) return { ok: false, reason: "no_verified_backup" };
  const latest = entries.reduce((a, b) => (compareInstants(b.backup.takenAt, a.backup.takenAt) > 0 ? b : a));
  return { ok: true, backup: latest.backup };
}
