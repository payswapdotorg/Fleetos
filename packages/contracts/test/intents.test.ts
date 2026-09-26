import { test, expect } from "bun:test";
import {
  canTransition,
  INTENT_TRANSITIONS,
  TERMINAL_INTENT_STATUSES,
  ALL_INTENT_KINDS,
  isTerminalIntentStatus,
  type IntentStatus,
} from "../src/intents";

test("intent lifecycle: happy path REQUESTED -> AUTHORIZED -> DISPATCHED -> EXECUTING -> VERIFIED -> COMPLETED is legal", () => {
  const path: IntentStatus[] = [
    "REQUESTED",
    "AUTHORIZED",
    "DISPATCHED",
    "EXECUTING",
    "VERIFIED",
    "COMPLETED",
  ];
  for (let i = 0; i < path.length - 1; i++) {
    expect(canTransition(path[i], path[i + 1])).toBe(true);
  }
});

test("intent lifecycle: skipping a state is illegal", () => {
  expect(canTransition("REQUESTED", "DISPATCHED")).toBe(false);
  expect(canTransition("REQUESTED", "EXECUTING")).toBe(false);
  expect(canTransition("AUTHORIZED", "EXECUTING")).toBe(false);
  expect(canTransition("DISPATCHED", "VERIFIED")).toBe(false);
  expect(canTransition("EXECUTING", "COMPLETED")).toBe(false);
});

test("intent lifecycle: REQUESTED may transition to REJECTED", () => {
  expect(canTransition("REQUESTED", "REJECTED")).toBe(true);
});

test("intent lifecycle: pre-VERIFIED states may transition to CANCELLED", () => {
  expect(canTransition("AUTHORIZED", "CANCELLED")).toBe(true);
  expect(canTransition("DISPATCHED", "CANCELLED")).toBe(true);
  expect(canTransition("EXECUTING", "CANCELLED")).toBe(true);
});

test("intent lifecycle: REQUESTED may NOT transition to CANCELLED", () => {
  expect(canTransition("REQUESTED", "CANCELLED")).toBe(false);
});

test("intent lifecycle: post-DISPATCH states may transition to FAILED (not REQUESTED/AUTHORIZED)", () => {
  expect(canTransition("DISPATCHED", "FAILED")).toBe(true);
  expect(canTransition("EXECUTING", "FAILED")).toBe(true);
  expect(canTransition("VERIFIED", "FAILED")).toBe(true);
  expect(canTransition("REQUESTED", "FAILED")).toBe(false);
  expect(canTransition("AUTHORIZED", "FAILED")).toBe(false);
});

test("intent lifecycle: terminal states have no outgoing transitions", () => {
  for (const terminal of TERMINAL_INTENT_STATUSES) {
    const allowed = INTENT_TRANSITIONS[terminal];
    expect(allowed).toEqual([]);
  }
});

test("intent lifecycle: canTransition returns false for terminal -> anything", () => {
  for (const terminal of TERMINAL_INTENT_STATUSES) {
    expect(canTransition(terminal, "REQUESTED")).toBe(false);
    expect(canTransition(terminal, "COMPLETED")).toBe(false);
  }
});

test("intent lifecycle: canTransition returns false for unknown transitions", () => {
  // Terminal -> non-terminal is always illegal.
  expect(canTransition("COMPLETED", "REQUESTED")).toBe(false);
  expect(canTransition("REJECTED", "AUTHORIZED")).toBe(false);
  expect(canTransition("FAILED", "EXECUTING")).toBe(false);
  expect(canTransition("CANCELLED", "DISPATCHED")).toBe(false);
});

test("isTerminalIntentStatus: terminal statuses return true, non-terminal return false", () => {
  expect(isTerminalIntentStatus("COMPLETED")).toBe(true);
  expect(isTerminalIntentStatus("REJECTED")).toBe(true);
  expect(isTerminalIntentStatus("FAILED")).toBe(true);
  expect(isTerminalIntentStatus("CANCELLED")).toBe(true);
  expect(isTerminalIntentStatus("REQUESTED")).toBe(false);
  expect(isTerminalIntentStatus("AUTHORIZED")).toBe(false);
  expect(isTerminalIntentStatus("DISPATCHED")).toBe(false);
  expect(isTerminalIntentStatus("EXECUTING")).toBe(false);
  expect(isTerminalIntentStatus("VERIFIED")).toBe(false);
});

test("ALL_INTENT_KINDS contains exactly the nine durable intents from spec/ARCHITECTURE.md § Intent model", () => {
  expect(ALL_INTENT_KINDS).toEqual([
    "MaintainDeviceIntent",
    "SecurityRemediationIntent",
    "ConnectivityIntent",
    "ProcurementIntent",
    "SoftwareSubscriptionIntent",
    "ReplacementIntent",
    "RecoveryIntent",
    "PrintIntent",
    "FleetActionIntent",
  ]);
  expect(ALL_INTENT_KINDS.length).toBe(9);
});

test("ALL_INTENT_KINDS is frozen", () => {
  expect(Object.isFrozen(ALL_INTENT_KINDS)).toBe(true);
});
