/**
 * W153 predictive — D5 determinism tests: golden byte-identical outputs
 * across runs, input permutations, and the golden-digest stability
 * (ADR-0002 invariant 4: absolute determinism).
 */

import { test, expect } from "bun:test";
import {
  EXTRACTOR_VERSION,
  canonicalFeatureSetJson,
  extractDeviceHistoryFeatures,
  type AdmittedDeviceObservation,
} from "../src/index";
import { sha256Hex } from "../src/internal";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  T0,
  absoluteWindow,
  admitted,
  atHour,
  numericHistory,
} from "./helpers";
import { asObservationId } from "@fleetos/contracts";

/** The canonical input the golden digests are derived from. */
function goldenInput() {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
  };
}

/** A deterministic shuffle of the history (input-order permutation). */
function shuffled(): AdmittedDeviceObservation[] {
  const rows = numericHistory();
  // A fixed permutation (indices 5,0,3,1,4,2) — no randomness.
  const order = [5, 0, 3, 1, 4, 2];
  return order.map((index) => rows[index]!);
}

// ---------------------------------------------------------------------------
// Byte-identical determinism
// ---------------------------------------------------------------------------

test("the same immutable inputs extracted twice are byte-identical (golden proof)", () => {
  const first = extractDeviceHistoryFeatures(goldenInput());
  const second = extractDeviceHistoryFeatures(goldenInput());
  expect(canonicalFeatureSetJson(second)).toBe(canonicalFeatureSetJson(first));
  // The whole-set digest (the golden anchor) is stable.
  expect(sha256Hex(canonicalFeatureSetJson(first))).toBe(sha256Hex(canonicalFeatureSetJson(second)));
});

test("a reshuffled-but-corrected input order yields the byte-identical set (canonical order semantics)", () => {
  const straight = extractDeviceHistoryFeatures(goldenInput());
  const permuted = extractDeviceHistoryFeatures({ ...goldenInput(), observations: shuffled() });
  expect(canonicalFeatureSetJson(permuted)).toBe(canonicalFeatureSetJson(straight));
  // The input digest is permutation-stable (canonical (observedAt, id) order).
  expect(permuted.inputDigest?.value).toBe(straight.inputDigest?.value);
  // The canonical refs are in arrival order, not input order.
  expect([...permuted.inputObservationIds]).toEqual([
    "obs_num0001",
    "obs_num0002",
    "obs_num0003",
    "obs_num0004",
    "obs_num0005",
    "obs_num0006",
  ]);
});

test("the GOLDEN digests are frozen (regression lock: change = contract change)", () => {
  const set = extractDeviceHistoryFeatures(goldenInput());
  // The golden whole-set digest over the canonical serialization.
  const wholeSet = sha256Hex(canonicalFeatureSetJson(set));
  expect(wholeSet).toBe("e5f580d962029a68067d3d98dfe1eebf1531195eaa066089e45c7dec994d4d0a");
  // The golden input digest (sha256 over the canonical observation selection).
  expect(set.inputDigest?.value).toBe(
    "39382528aff6928db84440d10dd19d1e91928fa00c0e0097353d38ab86f40c10",
  );
  // The golden canonical serialization itself (a stable prefix lock: the
  // head of the canonical JSON, frozen with the set's identity fields).
  expect(canonicalFeatureSetJson(set).startsWith("{\"deviceId\":\"dev_testdevice00a1\",\"extractedAt\"")).toBe(true);
});

test("a different window, a different payload, or a different observation => a different digest", () => {
  const base = extractDeviceHistoryFeatures(goldenInput());

  const narrowerWindow = extractDeviceHistoryFeatures({
    ...goldenInput(),
    window: absoluteWindow(atHour(1), atHour(24)),
  });
  expect(narrowerWindow.inputDigest?.value).not.toBe(base.inputDigest?.value);
  expect(featureCount(narrowerWindow)).toBe(featureCount(base)); // still 5 in-window -> ok

  const alteredPayload = numericHistory().map((entry, index) =>
    index === 2
      ? admitted({ ...entry.observation, payload: { ...entry.observation.payload as Record<string, unknown>, batteryLevel: 0 } })
      : entry,
  );
  const tampered = extractDeviceHistoryFeatures({ ...goldenInput(), observations: alteredPayload });
  expect(tampered.inputDigest?.value).not.toBe(base.inputDigest?.value);

  const swappedId = numericHistory().map((entry, index) =>
    index === 2 ? admitted({ ...entry.observation, id: asObservationId("obs_numXXXX") }) : entry,
  );
  const renamed = extractDeviceHistoryFeatures({ ...goldenInput(), observations: swappedId });
  expect(renamed.inputDigest?.value).not.toBe(base.inputDigest?.value);
});

test("the extractor version and schema version flow onto the set (version discipline)", () => {
  const base = extractDeviceHistoryFeatures(goldenInput());
  const nextVersion = extractDeviceHistoryFeatures({
    ...goldenInput(),
    extractorVersion: "2.0.0",
    featureSetSchemaVersion: 2,
  });
  expect(nextVersion.extractorVersion).toBe("2.0.0");
  expect(nextVersion.featureSetSchemaVersion).toBe(2);
  // The INPUT digest is version-independent (it anchors the immutable
  // inputs); the SET differs (the version fields are part of it).
  expect(nextVersion.inputDigest?.value).toBe(base.inputDigest?.value);
  expect(canonicalFeatureSetJson(nextVersion)).not.toBe(canonicalFeatureSetJson(base));
  expect(base.extractorVersion).toBe(EXTRACTOR_VERSION);
});

test("repeated runs with the injected audit sink emit identical records (deterministic emission)", () => {
  // Two runs over the same inputs produce byte-identical sets AND
  // byte-identical audit records (occurredAt is the injected instant).
  const collected: string[] = [];
  const sink = {
    append: (record: { action: string; occurredAt: string }): void => {
      collected.push(`${record.action}@${record.occurredAt}`);
    },
  };
  extractDeviceHistoryFeatures({ ...goldenInput(), auditSink: sink });
  extractDeviceHistoryFeatures({ ...goldenInput(), auditSink: sink });
  expect(collected).toEqual([
    "predictive.device_history.extracted@2026-01-02T00:00:00.000Z",
    "predictive.device_history.extracted@2026-01-02T00:00:00.000Z",
  ]);
});

function featureCount(set: ReturnType<typeof extractDeviceHistoryFeatures>): number {
  return set.features.length;
}
