/**
 * W154 world-model — the tenant-scope + tenant-isolation proof.
 *
 * Proves:
 *   - the `checkWorldModelTenantScope` pure guard accepts a valid scope;
 *   - the guard refuses a missing scope (no tenantId);
 *   - the guard refuses an invalid tenantId (fails the frozen grammar);
 *   - the engine's represent/predict/predictAfterAction/compare ALL
 *     refuse cross-tenant inputs (a foreign scope vs a feature set's
 *     tenantId / a representation's identity.tenantId);
 *   - the engine's compare refuses cross-tenant comparison (two
 *     representations with different identity.tenantId).
 *
 * Per ADR-0002 § "Hard invariants" #7: "Tenant isolation applies to
 * training data, inference context, representations, predictions and
 * evaluation cases." And `spec/ARCHITECTURE-LOCK.md` item 17: "Tenant
 * isolation is enforced at persistence and action boundaries."
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  AS_OF,
  CORR_1,
  DEV_1,
  FOREIGN_SCOPE,
  PRODUCED_AT,
  SCOPE,
  TENANT_B,
  TENANT_ID,
  resetObservationCounter,
  seedDemoFleet,
} from "./helpers";
import {
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  checkWorldModelTenantScope,
  compare,
  predict,
  predictAfterAction,
  represent,
} from "../src/index";
import type { WorldModelContext } from "../src/index";

// ---------------------------------------------------------------------------
// The pure tenant-scope guard
// ---------------------------------------------------------------------------

test("tenant scope: the guard accepts a valid scope", () => {
  const check = checkWorldModelTenantScope(SCOPE);
  expect(check.ok).toBe(true);
  if (!check.ok) throw new Error("expected ok");
  expect(check.tenantId).toBe(TENANT_ID);
});

test("tenant scope: the guard refuses a missing scope", () => {
  const check = checkWorldModelTenantScope(undefined);
  expect(check.ok).toBe(false);
  if (check.ok) throw new Error("expected refusal");
  expect(check.reason).toBe("missing_scope");
});

test("tenant scope: the guard refuses a scope without a tenantId", () => {
  const check = checkWorldModelTenantScope({});
  expect(check.ok).toBe(false);
  if (check.ok) throw new Error("expected refusal");
  expect(check.reason).toBe("missing_scope");
});

test("tenant scope: the guard refuses a scope with an invalid tenantId (fails the frozen grammar)", () => {
  const check = checkWorldModelTenantScope({ tenantId: asTenantId("invalid") });
  expect(check.ok).toBe(false);
  if (check.ok) throw new Error("expected refusal");
  expect(check.reason).toBe("invalid_tenant_id");
});

test("tenant scope: the guard accepts a different valid tenant (TENANT_B)", () => {
  const check = checkWorldModelTenantScope(FOREIGN_SCOPE);
  expect(check.ok).toBe(true);
  if (!check.ok) throw new Error("expected ok");
  expect(check.tenantId).toBe(TENANT_B);
});

// ---------------------------------------------------------------------------
// The engine refuses cross-tenant represent (feature set's tenantId != acting scope)
// ---------------------------------------------------------------------------

test("tenant scope: represent refuses a feature set whose tenantId does not match the acting scope", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  // The feature set is for TENANT_ID; the acting scope is FOREIGN (TENANT_B).
  const build = represent({ scope: FOREIGN_SCOPE, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("tenant_mismatch")).toBe(true);
});

test("tenant scope: represent refuses a context whose tenantId does not match the acting scope", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  // The context's tenantId is FOREIGN (TENANT_B); the acting scope is SCOPE (TENANT_ID).
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_B,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("tenant_mismatch")).toBe(true);
});

test("tenant scope: represent refuses a missing scope", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build = represent({ scope: undefined as never, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("missing_scope")).toBe(true);
});

// ---------------------------------------------------------------------------
// The engine refuses cross-tenant predict (representation's tenantId != acting scope)
// ---------------------------------------------------------------------------

test("tenant scope: predict refuses a representation whose tenantId does not match the acting scope", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  // Build a representation under SCOPE (TENANT_ID), then try to predict
  // under FOREIGN_SCOPE.
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: FOREIGN_SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(false);
  if (pred.ok) throw new Error("expected refusal");
  expect(pred.error.message.includes("tenant_mismatch")).toBe(true);
});

test("tenant scope: predictAfterAction refuses a representation whose tenantId does not match the acting scope", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf = predictAfterAction({
    scope: FOREIGN_SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf.ok).toBe(false);
  if (cf.ok) throw new Error("expected refusal");
  expect(cf.error.message.includes("tenant_mismatch")).toBe(true);
});

// ---------------------------------------------------------------------------
// The engine refuses cross-tenant compare (two representations with different tenantId)
// ---------------------------------------------------------------------------

test("tenant scope: compare refuses two representations with different identity.tenantId", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  // Build a representation under TENANT_ID.
  const contextA: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const repA = represent({ scope: SCOPE, featureSet: dev1.featureSet, context: contextA });
  expect(repA.ok).toBe(true);
  if (!repA.ok) throw new Error("represent A failed");

  // Forge a "representation from TENANT_B" by manually mutating the
  // identity.tenantId (bypass the type system — the engine's compare
  // guard must catch it at runtime).
  const repB = {
    ...repA.representation,
    identity: {
      ...repA.representation.identity,
      tenantId: TENANT_B,
    },
  };
  const cmp = compare(repA.representation, repB);
  expect(cmp.ok).toBe(false);
  if (cmp.ok) throw new Error("expected refusal");
  expect(cmp.error.message).toContain("cross_tenant_comparison");
});

test("tenant scope: compare refuses two representations with different schemaVersion", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const repA = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(repA.ok).toBe(true);
  if (!repA.ok) throw new Error("represent failed");
  // Forge a representation with a different schemaVersion.
  const repB = {
    ...repA.representation,
    schemaVersion: 999,
  };
  const cmp = compare(repA.representation, repB);
  expect(cmp.ok).toBe(false);
  if (cmp.ok) throw new Error("expected refusal");
  expect(cmp.error.message).toContain("cross_version_comparison");
});

test("tenant scope: compare refuses a non-ok representation (one or both must be `ok`)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const repA = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(repA.ok).toBe(true);
  if (!repA.ok) throw new Error("represent failed");
  // Forge a non-ok representation (e.g. insufficient_history).
  const repB = {
    ...repA.representation,
    status: { kind: "insufficient_history", reason: "single_observation", minimumRequired: 2 } as never,
  };
  const cmp = compare(repA.representation, repB);
  expect(cmp.ok).toBe(false);
  if (cmp.ok) throw new Error("expected refusal");
  expect(cmp.error.message).toContain("non_ok_representation");
});
