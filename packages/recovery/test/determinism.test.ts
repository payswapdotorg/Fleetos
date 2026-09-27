/**
 * W040 recovery — determinism tests: byte-identical re-derivation across
 * runs and input permutations.
 *
 * The work order's determinism guarantees, proven end-to-end:
 *   - re-derivation from the same observations (same batches, same
 *     injected `at` + thresholds) is byte-identical across independent
 *     runs — every record, every revision, every digest;
 *   - input PERMUTATIONS (batches reordered, observations reordered,
 *     evidence refs reordered) produce identical outputs;
 *   - case identities, request identities and escalation identities are
 *     stable across independent runs;
 *   - full FLOWS (open -> transition -> request -> execute) replay
 *     byte-identically.
 */

import { test, expect } from "bun:test";
import { asDeviceId } from "@fleetos/contracts";
import type { DeviceId, ObservationBatch } from "@fleetos/contracts";
import {
  createInMemoryLastSeenLedger,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  createInMemoryReplacementEscalationLedger,
  recordLastSeenObservations,
  openRecoveryCase,
  transitionRecoveryCase,
  requestDestructiveAction,
  escalateReplacement,
  evidenceRefsFromObservations,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  DEV_A1,
  CORR,
  THRESHOLDS,
  atHour,
  atDay,
  scopeA,
  lostTrigger,
  realGuardian,
  ruleSet,
  adapter,
  FULLY_CAPABLE,
  obs,
  locationObservation,
  batch,
} from "./helpers";

// ---------------------------------------------------------------------------
// Last-seen: byte-identical across runs + permutations
// ---------------------------------------------------------------------------

test("last-seen: re-derivation across two independent runs is byte-identical (full ledger history)", () => {
  const observations = [
    obs("device.health", { v: 1 }, atHour(1), "obs_det_1"),
    locationObservation(atHour(2), 40.4, -3.7, "obs_det_2"),
    obs("device.security", { v: 3 }, atHour(2), "obs_det_3"),
  ];
  const runOne = createInMemoryLastSeenLedger();
  const runTwo = createInMemoryLastSeenLedger();
  for (const ledger of [runOne, runTwo]) {
    recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, observations, atHour(2))], {
      at: atHour(3),
      thresholds: THRESHOLDS,
      correlationId: CORR,
    });
    recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", { v: 2 }, atHour(5), "obs_det_4")], atHour(5))], {
      at: atHour(6),
      thresholds: THRESHOLDS,
      correlationId: CORR,
    });
  }
  expect(JSON.stringify(runOne.listLastSeenRevisions(scopeA(), DEV_A1))).toBe(
    JSON.stringify(runTwo.listLastSeenRevisions(scopeA(), DEV_A1)),
  );
});

test("last-seen: batch ORDER permutation produces identical records", () => {
  const b1 = batch(DEV_A1, [obs("device.health", 1, atHour(1), "obs_perm_b1")], atHour(1));
  const b2 = batch(DEV_A1, [obs("device.health", 2, atHour(4), "obs_perm_b2")], atHour(4));
  const one = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [b1, b2], {
    at: atHour(5),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const two = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [b2, b1], {
    at: atHour(5),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(JSON.stringify(one.ok ? one.record : null)).toBe(JSON.stringify(two.ok ? two.record : null));
});

test("evidence refs from observations are order-insensitive (sorted by key)", () => {
  const observations = [
    obs("device.health", { v: 1 }, atHour(1), "obs_ev_b"),
    obs("device.security", { v: 2 }, atHour(1), "obs_ev_a"),
  ];
  const one = evidenceRefsFromObservations(DEV_A1, observations);
  const two = evidenceRefsFromObservations(DEV_A1, [observations[1], observations[0]]);
  expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  expect(one.map((e) => e.key)).toEqual([...one.map((e) => e.key)].sort());
});

// ---------------------------------------------------------------------------
// Cases: identity + revision determinism
// ---------------------------------------------------------------------------

test("case identities are stable across independent runs (same inputs -> same caseId + revisions)", () => {
  const runOne = createInMemoryRecoveryCaseStore();
  const runTwo = createInMemoryRecoveryCaseStore();
  for (const store of [runOne, runTwo]) {
    const opened = openRecoveryCase(
      scopeA(),
      store,
      { deviceId: DEV_A1, trigger: lostTrigger(), lastSeenRecordId: "ls_det", postureFindingRefs: ["secfnd_det"] },
      { at: T0, correlationId: CORR },
    );
    if (!opened.ok) throw new Error(opened.error.message);
    transitionRecoveryCase(scopeA(), store, opened.record, "SECURING", { at: T1, correlationId: CORR });
  }
  const idsOne = runOne.listCaseIds(scopeA());
  const idsTwo = runTwo.listCaseIds(scopeA());
  expect(idsOne).toEqual(idsTwo);
  expect(JSON.stringify(runOne.listCaseRevisions(scopeA(), idsOne[0]))).toBe(
    JSON.stringify(runTwo.listCaseRevisions(scopeA(), idsTwo[0])),
  );
});

// ---------------------------------------------------------------------------
// Destructive requests: full-flow replay determinism
// ---------------------------------------------------------------------------

test("the full flow (open -> securing -> request -> execute) replays byte-identically", () => {
  const replay = () => {
    const caseStore = createInMemoryRecoveryCaseStore();
    const opened = openRecoveryCase(
      scopeA(),
      caseStore,
      { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
      { at: T0, correlationId: CORR },
    );
    if (!opened.ok) throw new Error(opened.error.message);
    const securing = transitionRecoveryCase(scopeA(), caseStore, opened.record, "SECURING", { at: T1, correlationId: CORR });
    if (!securing.ok) throw new Error(securing.error.message);
    const requestStore = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const result = requestDestructiveAction(scopeA(), requestStore, securing.record, "lock", {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
      evidence: evidenceRefsFromObservations(DEV_A1, [obs("device.security", { diskEncryption: false }, atHour(1), "obs_flow_1")]),
    });
    if (!result.ok) throw new Error(result.error.message);
    return { caseStore, requestStore, requestId: result.record.requestId };
  };
  const one = replay();
  const two = replay();
  expect(one.requestId).toBe(two.requestId);
  expect(JSON.stringify(one.requestStore.listRequestRevisions(scopeA(), one.requestId))).toBe(
    JSON.stringify(two.requestStore.listRequestRevisions(scopeA(), two.requestId)),
  );
  expect(JSON.stringify(one.caseStore.listCaseRevisions(scopeA(), one.caseStore.listCaseIds(scopeA())[0]))).toBe(
    JSON.stringify(two.caseStore.listCaseRevisions(scopeA(), two.caseStore.listCaseIds(scopeA())[0])),
  );
});

// ---------------------------------------------------------------------------
// Escalations: identity + revision determinism
// ---------------------------------------------------------------------------

test("escalation identities are stable across independent runs", () => {
  const diagnosis = {
    hypothesisId: "hyp_det",
    recommendationId: "tr_det",
    causeId: "health.hardware_failing",
    confidence: 0.9,
    proposedIntent: {
      intentKind: "ReplacementIntent" as const,
      payload: { deviceId: DEV_A1 as string, reason: "hardware failing" },
    },
    observationIds: ["obs_esc_2", "obs_esc_1"],
  };
  const runOne = escalateReplacement(
    scopeA(),
    createInMemoryReplacementEscalationLedger(),
    { deviceId: DEV_A1, diagnosis },
    { at: atDay(2), correlationId: CORR },
  );
  const runTwo = escalateReplacement(
    scopeA(),
    createInMemoryReplacementEscalationLedger(),
    { deviceId: DEV_A1, diagnosis },
    { at: atDay(2), correlationId: CORR },
  );
  expect(runOne.ok && runTwo.ok).toBe(true);
  expect(JSON.stringify(runOne.ok ? runOne.record : null)).toBe(JSON.stringify(runTwo.ok ? runTwo.record : null));
});

// ---------------------------------------------------------------------------
// A shuffled multi-device scenario: the whole ledger state is
// permutation-invariant when each device's evidence is unchanged
// ---------------------------------------------------------------------------

test("multi-device last-seen state is invariant to DEVICE ORDER (per-partition derivation is isolated)", () => {
  const DEV_M1 = asDeviceId("dev_multi_0001");
  const DEV_M2 = asDeviceId("dev_multi_0002");
  const run = (firstIsOne: boolean) => {
    const ledger = createInMemoryLastSeenLedger();
    const forOne = [batch(DEV_M1, [obs("device.health", 1, atHour(1), "obs_multi_a")], atHour(1))];
    const forTwo = [batch(DEV_M2, [obs("device.health", 2, atHour(2), "obs_multi_b")], atHour(2))];
    const sequence: readonly (readonly [DeviceId, readonly ObservationBatch[]])[] = firstIsOne
      ? ([[DEV_M1, forOne], [DEV_M2, forTwo]] as const)
      : ([[DEV_M2, forTwo], [DEV_M1, forOne]] as const);
    for (const [deviceId, batches] of sequence) {
      const write = recordLastSeenObservations(scopeA(), ledger, deviceId, batches, {
        at: atHour(3),
        thresholds: THRESHOLDS,
        correlationId: CORR,
      });
      if (!write.ok) throw new Error(write.error.message);
    }
    return ledger;
  };
  const one = run(true);
  const two = run(false);
  expect(JSON.stringify(one.listDeviceIds(scopeA()))).toBe(JSON.stringify(two.listDeviceIds(scopeA())));
  for (const deviceId of one.listDeviceIds(scopeA())) {
    expect(JSON.stringify(one.listLastSeenRevisions(scopeA(), deviceId))).toBe(
      JSON.stringify(two.listLastSeenRevisions(scopeA(), deviceId)),
    );
  }
});
