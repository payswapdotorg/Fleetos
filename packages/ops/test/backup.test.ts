import { describe, expect, test } from "bun:test";
import {
  createBackupLedger,
  latestVerifiedBackup,
  makeBackupManifest,
  runRestoreDrill,
} from "../src/backup";
import { asTenantId } from "@fleetos/contracts";

const TENANT = asTenantId("tnt_ops_backup");
const OTHER = asTenantId("tnt_ops_other");
const SCOPE = { tenantId: TENANT };

const GOOD = {
  store: "fleetos.primary",
  contentDigest: "cafebabe",
  kind: "full" as const,
  windowFrom: "2026-09-28T00:00:00Z",
  windowTo: "2026-09-28T12:00:00Z",
  takenAt: "2026-09-28T12:05:00Z",
};

describe("W080 D3a — backup manifests", () => {
  test("a well-formed backup is content-addressed and NEVER verified at construction", () => {
    const result = makeBackupManifest(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.verified).toBe(false);
    expect(result.backup.backupId).toHaveLength(8);
    const again = makeBackupManifest(GOOD);
    if (!again.ok) throw new Error("expected ok");
    expect(again.backup.backupId).toBe(result.backup.backupId);
  });

  test("incremental backups require a prior; malformed priors refuse", () => {
    const bad = makeBackupManifest({ ...GOOD, kind: "incremental" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toEqual(["incremental_requires_prior"]);

    const badDigest = makeBackupManifest({ ...GOOD, kind: "incremental", priorBackupId: "xyz" });
    expect(badDigest.ok).toBe(false);
    if (badDigest.ok) return;
    expect(badDigest.reasons).toContain("prior_backup_id_malformed");
  });

  test("an inverted window refuses (window_inverted)", () => {
    const bad = makeBackupManifest({ ...GOOD, windowFrom: "2026-09-28T13:00:00Z", windowTo: "2026-09-28T12:00:00Z" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toEqual(["window_inverted"]);
  });
});

describe("W080 D3a — the per-tenant backup ledger", () => {
  test("record is idempotent by backupId; partitions are isolated by construction", () => {
    const ledger = createBackupLedger();
    const backup = makeBackupManifest(GOOD);
    if (!backup.ok) throw new Error("expected ok");
    const a = ledger.record(SCOPE, backup.backup, "2026-09-28T12:06:00Z");
    const b = ledger.record(SCOPE, backup.backup, "2026-09-28T12:07:00Z");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.entry).toBe(b.entry); // idempotent — the SAME record object
    expect(ledger.read(SCOPE)).toHaveLength(1);

    // Foreign tenant sees NOTHING (indistinguishable from unknown).
    expect(ledger.read({ tenantId: OTHER })).toHaveLength(0);
    expect(ledger.find({ tenantId: OTHER }, backup.backup.backupId)).toBeUndefined();
  });

  test("context-free access is refused machine-stably", () => {
    const ledger = createBackupLedger();
    const result = ledger.record(null, makeBackupManifest(GOOD) as never, "2026-09-28T12:06:00Z");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("scope_required");
  });
});

describe("W080 D3a — restore drills (fail-closed verification)", () => {
  test("a SUCCEEDED drill (digest match) is the ONLY verification path", () => {
    const ledger = createBackupLedger();
    const backup = makeBackupManifest(GOOD);
    if (!backup.ok) throw new Error("expected ok");
    ledger.record(SCOPE, backup.backup, "2026-09-28T12:06:00Z");

    const drill = runRestoreDrill(ledger, SCOPE, {
      backupId: backup.backup.backupId,
      drilledAt: "2026-09-28T12:30:00Z",
      runBy: "usr_operator",
      restoredContentDigest: "cafebabe",
    });
    expect(drill.ok).toBe(true);
    if (!drill.ok) return;
    expect(drill.drill.status).toBe("SUCCEEDED");
    expect(drill.backup.verified).toBe(true);

    // The ledger reflects the verified state; latestVerifiedBackup finds it.
    const latest = latestVerifiedBackup(ledger, SCOPE, "fleetos.primary");
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.backup.takenAt).toBe(GOOD.takenAt);
  });

  test("a FAILED drill (digest mismatch) reports FAILED and verifies NOTHING", () => {
    const ledger = createBackupLedger();
    const backup = makeBackupManifest(GOOD);
    if (!backup.ok) throw new Error("expected ok");
    ledger.record(SCOPE, backup.backup, "2026-09-28T12:06:00Z");

    const drill = runRestoreDrill(ledger, SCOPE, {
      backupId: backup.backup.backupId,
      drilledAt: "2026-09-28T12:30:00Z",
      runBy: "usr_operator",
      restoredContentDigest: "deadbeef",
    });
    expect(drill.ok).toBe(true);
    if (!drill.ok) return;
    expect(drill.drill.status).toBe("FAILED");
    expect(drill.backup.verified).toBe(false);

    const latest = latestVerifiedBackup(ledger, SCOPE, "fleetos.primary");
    expect(latest.ok).toBe(false);
  });

  test("an unknown backup refuses backup_unknown (foreign tenants indistinguishable)", () => {
    const ledger = createBackupLedger();
    const drill = runRestoreDrill(ledger, SCOPE, {
      backupId: "00000000",
      drilledAt: "2026-09-28T12:30:00Z",
      runBy: "usr_operator",
      restoredContentDigest: "cafebabe",
    });
    expect(drill.ok).toBe(false);
    if (drill.ok) return;
    expect(drill.kind).toBe("backup_unknown");
  });

  test("malformed drill inputs refuse with SORTED reasons", () => {
    const ledger = createBackupLedger();
    const drill = runRestoreDrill(ledger, SCOPE, {
      backupId: "xyz",
      drilledAt: "nope",
      runBy: "",
      restoredContentDigest: "zzz",
    });
    expect(drill.ok).toBe(false);
    if (drill.ok) return;
    expect(drill.kind).toBe("drill_malformed");
    if (drill.kind === "drill_malformed") {
      expect(drill.reasons).toEqual([...drill.reasons].sort());
      expect(drill.reasons).toContain("backup_id_malformed");
      expect(drill.reasons).toContain("drilled_at_invalid");
      expect(drill.reasons).toContain("run_by_required");
      expect(drill.reasons).toContain("restored_digest_malformed");
    }
  });

  test("verification is idempotent (a second SUCCEEDED drill converges)", () => {
    const ledger = createBackupLedger();
    const backup = makeBackupManifest(GOOD);
    if (!backup.ok) throw new Error("expected ok");
    ledger.record(SCOPE, backup.backup, "2026-09-28T12:06:00Z");
    const input = {
      backupId: backup.backup.backupId,
      drilledAt: "2026-09-28T12:30:00Z",
      runBy: "usr_operator",
      restoredContentDigest: "cafebabe",
    };
    const first = runRestoreDrill(ledger, SCOPE, input);
    const second = runRestoreDrill(ledger, SCOPE, input);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.drill.drillId).toBe(second.drill.drillId);
    expect(ledger.read(SCOPE)).toHaveLength(1);
  });
});
