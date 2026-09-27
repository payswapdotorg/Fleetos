/**
 * W040 recovery — contract conformance tests.
 *
 * Proves the package builds AGAINST the frozen @fleetos/contracts
 * surface (snapshot-gated): the `RecoveryIntentPayload` +
 * `ReplacementIntentPayload` shapes are OWNED by @fleetos/recovery per
 * their frozen doc comments — consumed VERBATIM, never re-declared; the
 * observation shapes are the frozen canonical contracts; the fixture
 * builders from the `@fleetos/contracts/testing` subpath construct every
 * cross-cutting value (ids, timestamps, batches, capabilities,
 * decisions, intents).
 */

import { test, expect } from "bun:test";
import {
  RECOVERY_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  isBlockingDecision,
  validateObservationBatch,
} from "@fleetos/contracts";
import type {
  GuardianDecisionType,
  IntentKind,
  ObservationBatch,
  RecoveryIntentPayload,
  ReplacementIntentPayload,
} from "@fleetos/contracts";
import {
  makeIntent,
  makeAllIntents,
  makeObservationBatch,
  makeAdapterCapabilities,
  makeTenantId,
  makeDeviceId,
  makeObservationId,
  makeCorrelationId,
  makeCausationId,
  makeTimestamp,
  makeGuardianDecision,
  makeAllGuardianDecisions,
  type Seed,
} from "@fleetos/contracts/testing";
import {
  ALL_DESTRUCTIVE_RECOVERY_ACTIONS,
  DESTRUCTIVE_INTENT_KIND,
  classifyStaleness,
  LOCATION_OBSERVATION_KIND,
} from "../src/index";

// ---------------------------------------------------------------------------
// The frozen intent payloads are consumed verbatim (never re-declared)
// ---------------------------------------------------------------------------

test("RecoveryIntentPayload is consumed verbatim: deviceId? + lock/locate/wipe/reboot action", () => {
  // The frozen fixture builder produces the frozen payload shape.
  const intent = makeIntent({ seed: 1, kind: RECOVERY_INTENT_KIND });
  const payload = intent.payload as RecoveryIntentPayload & { kind: typeof RECOVERY_INTENT_KIND };
  expect(payload.kind).toBe(RECOVERY_INTENT_KIND);
  expect(["lock", "locate", "wipe", "reboot"]).toContain(payload.action);
  // The frozen action union and this package's action set are the SAME set.
  expect(ALL_DESTRUCTIVE_RECOVERY_ACTIONS).toEqual(["lock", "locate", "wipe", "reboot"]);
  expect(DESTRUCTIVE_INTENT_KIND).toBe(RECOVERY_INTENT_KIND);
});

test("ReplacementIntentPayload is consumed verbatim: deviceId? + reason", () => {
  const intent = makeIntent({ seed: 2, kind: REPLACEMENT_INTENT_KIND });
  const payload = intent.payload as ReplacementIntentPayload & { kind: typeof REPLACEMENT_INTENT_KIND };
  expect(payload.kind).toBe(REPLACEMENT_INTENT_KIND);
  expect(typeof payload.reason).toBe("string");
  expect(payload.reason.length > 0).toBe(true);
});

test("every RecoveryIntent action admits a durable intent record (the frozen payload, verbatim)", () => {
  for (const action of ALL_DESTRUCTIVE_RECOVERY_ACTIONS) {
    const intent = makeIntent({
      seed: `action-${action}`,
      kind: RECOVERY_INTENT_KIND,
      payload: { deviceId: "dev_fixture01", action },
    });
    const payload = intent.payload as RecoveryIntentPayload;
    expect(payload.action).toBe(action);
  }
});

test("the frozen intent-kind constants are reused (never re-declared locally)", () => {
  expect(RECOVERY_INTENT_KIND).toBe("RecoveryIntent");
  expect(REPLACEMENT_INTENT_KIND).toBe("ReplacementIntent");
});

test("makeAllIntents covers both recovery-owned kinds within the frozen nine", () => {
  const intents = makeAllIntents(42);
  const kinds = new Set(intents.map((i) => (i.payload as { kind: IntentKind }).kind));
  expect(kinds.has(RECOVERY_INTENT_KIND)).toBe(true);
  expect(kinds.has(REPLACEMENT_INTENT_KIND)).toBe(true);
  expect(kinds.size).toBe(9);
});

// ---------------------------------------------------------------------------
// The frozen observation shapes (validateObservationBatch honored)
// ---------------------------------------------------------------------------

test("frozen observation-batch fixtures validate (the frozen canonical shape)", () => {
  const batches: ObservationBatch[] = [makeObservationBatch({ seed: 3, count: 5 })];
  for (const b of batches) {
    expect(validateObservationBatch(b)).toEqual({ ok: true });
  }
});

test("the canonical location observation kind is the frozen contracts kind", () => {
  expect(LOCATION_OBSERVATION_KIND).toBe("device.location");
});

// ---------------------------------------------------------------------------
// The frozen decision-type helpers are reused
// ---------------------------------------------------------------------------

test("the frozen isBlockingDecision helper semantics hold (WARN non-blocking)", () => {
  expect(isBlockingDecision("ALLOW")).toBe(false);
  expect(isBlockingDecision("WARN")).toBe(false);
  expect(isBlockingDecision("REQUIRE_APPROVAL")).toBe(true);
  expect(isBlockingDecision("BLOCK")).toBe(true);
});

test("frozen guardian-decision fixtures satisfy the frozen shape", () => {
  const decisions = makeAllGuardianDecisions(7);
  expect(decisions.length).toBe(4);
  const types = new Set(decisions.map((d) => d.decision as GuardianDecisionType));
  expect(types.has("ALLOW")).toBe(true);
  expect(types.has("WARN")).toBe(true);
  expect(types.has("REQUIRE_APPROVAL")).toBe(true);
  expect(types.has("BLOCK")).toBe(true);
  expect(() => makeGuardianDecision({ ...decisions[0], tenantId: makeTenantId(9) })).not.toThrow();
});

// ---------------------------------------------------------------------------
// The fixture builders this package's tests consume (the conformance list)
// ---------------------------------------------------------------------------

test("the @fleetos/contracts/testing fixture builders construct every cross-cutting value", () => {
  const seed: Seed = "w040-conformance";
  expect(makeTenantId(seed)).toMatch(/^tnt_[a-z0-9]+$/);
  expect(makeDeviceId(seed)).toMatch(/^dev_/);
  expect(makeObservationId(seed)).toMatch(/^obs_/);
  expect(makeCorrelationId(seed)).toMatch(/^cor_/);
  expect(makeCausationId(seed)).toMatch(/^cau_/);
  expect(makeTimestamp(seed)).toMatch(/T\d{2}:\d{2}/);
  const caps = makeAdapterCapabilities({ supported: ["lock", "locate", "wipe", "reboot"] });
  expect(caps.lock).toBe(true);
  expect(caps.locate).toBe(true);
  expect(caps.wipe).toBe(true);
  expect(caps.reboot).toBe(true);
  expect(caps.enforce).toBeUndefined();
  const b = makeObservationBatch({ seed, count: 4 });
  expect(validateObservationBatch(b)).toEqual({ ok: true });
});

// ---------------------------------------------------------------------------
// Deterministic staleness against injected thresholds (no clock reads)
// ---------------------------------------------------------------------------

test("classifyStaleness is a pure function of injected inputs", () => {
  const thresholds = { freshWithinMs: 1_000, staleAfterMs: 10_000 };
  expect(classifyStaleness("2026-01-01T00:10:00Z", "2026-01-01T00:09:59Z", thresholds)).toBe("fresh");
  expect(classifyStaleness("2026-01-01T00:10:00Z", "2026-01-01T00:09:55Z", thresholds)).toBe("unknown");
  expect(classifyStaleness("2026-01-01T00:10:00Z", "2026-01-01T00:09:00Z", thresholds)).toBe("stale");
  // Future-dated evidence: never a guess.
  expect(classifyStaleness("2026-01-01T00:10:00Z", "2026-01-01T00:11:00Z", thresholds)).toBe("unknown");
});
