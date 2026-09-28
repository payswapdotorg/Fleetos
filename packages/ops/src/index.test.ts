import { describe, expect, test } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";
import * as ops from "./index";

describe("@fleetos/ops — package surface placeholder (the W001 skeleton contract)", () => {
  test("MODULE_NAME is ops", () => {
    expect(MODULE_NAME).toBe("ops");
  });

  test("MODULE_VERSION is 0.1.0", () => {
    expect(MODULE_VERSION).toBe("0.1.0");
  });

  test("the public surface exports every production-readiness module", () => {
    // D1 deployment
    expect(typeof ops.makeDeploymentManifest).toBe("function");
    expect(typeof ops.makeDeploymentPlan).toBe("function");
    expect(typeof ops.decideDeploymentPlan).toBe("function");
    // D2 observability
    expect(typeof ops.aggregateOperationalHealth).toBe("function");
    expect(typeof ops.makeOperationalMetrics).toBe("function");
    // D3a backup
    expect(typeof ops.makeBackupManifest).toBe("function");
    expect(typeof ops.createBackupLedger).toBe("function");
    expect(typeof ops.runRestoreDrill).toBe("function");
    expect(typeof ops.latestVerifiedBackup).toBe("function");
    // D3b migrations
    expect(typeof ops.compileMigrationSet).toBe("function");
    expect(typeof ops.applyMigrations).toBe("function");
    // D4a evidence
    expect(typeof ops.compileE2EEvidence).toBe("function");
    expect(typeof ops.compileCoverageReport).toBe("function");
    // D4b runbook
    expect(typeof ops.compileRunbookProcedure).toBe("function");
    expect(typeof ops.runbookDigestFor).toBe("function");
    // D4c release gate
    expect(typeof ops.evaluateReleaseGate).toBe("function");
    expect(typeof ops.createReleaseLedger).toBe("function");
    expect(typeof ops.RELEASE_BLOCK_REASONS).toBe("object");
    expect(typeof ops.RUNBOOK_INTENTS).toBe("object");
  });
});
