import { test, expect } from "bun:test";
import {
  DEVICE_LIFECYCLE_ORDER,
  DEVICE_LIFECYCLE_TRANSITIONS,
  canTransitionDevice,
  lifecycleIndex,
  AdapterCapabilities,
  ALL_ADAPTER_CAPABILITIES,
  DESTRUCTIVE_CAPABILITIES,
  assertSupported,
  isSupported,
  isDestructive,
} from "../src/device";

test("device lifecycle states are exactly the nine from spec/ARCHITECTURE.md", () => {
  expect(DEVICE_LIFECYCLE_ORDER).toEqual([
    "ENROLL",
    "OBSERVE",
    "ASSESS",
    "DIAGNOSE",
    "PLAN",
    "AUTHORIZE",
    "EXECUTE",
    "VERIFY",
    "LEARN",
  ]);
});

test("device lifecycle is a strict linear progression", () => {
  // Each non-terminal state transitions only to the next state.
  expect(canTransitionDevice("ENROLL", "OBSERVE")).toBe(true);
  expect(canTransitionDevice("OBSERVE", "ASSESS")).toBe(true);
  expect(canTransitionDevice("ASSESS", "DIAGNOSE")).toBe(true);
  expect(canTransitionDevice("DIAGNOSE", "PLAN")).toBe(true);
  expect(canTransitionDevice("PLAN", "AUTHORIZE")).toBe(true);
  expect(canTransitionDevice("AUTHORIZE", "EXECUTE")).toBe(true);
  expect(canTransitionDevice("EXECUTE", "VERIFY")).toBe(true);
  expect(canTransitionDevice("VERIFY", "LEARN")).toBe(true);
});

test("device lifecycle: skipping a state is illegal", () => {
  expect(canTransitionDevice("ENROLL", "ASSESS")).toBe(false);
  expect(canTransitionDevice("OBSERVE", "DIAGNOSE")).toBe(false);
  expect(canTransitionDevice("ENROLL", "LEARN")).toBe(false);
});

test("device lifecycle: LEARN is terminal (no outgoing transitions)", () => {
  expect(DEVICE_LIFECYCLE_TRANSITIONS["LEARN"]).toEqual([]);
  expect(canTransitionDevice("LEARN", "ENROLL")).toBe(false);
  expect(canTransitionDevice("LEARN", "OBSERVE")).toBe(false);
});

test("device lifecycle: backward transitions are illegal", () => {
  expect(canTransitionDevice("OBSERVE", "ENROLL")).toBe(false);
  expect(canTransitionDevice("LEARN", "VERIFY")).toBe(false);
  expect(canTransitionDevice("VERIFY", "EXECUTE")).toBe(false);
});

test("lifecycleIndex: returns 0-indexed position", () => {
  expect(lifecycleIndex("ENROLL")).toBe(0);
  expect(lifecycleIndex("OBSERVE")).toBe(1);
  expect(lifecycleIndex("LEARN")).toBe(8);
});

test("ALL_ADAPTER_CAPABILITIES lists exactly the eleven capabilities from spec/ARCHITECTURE.md", () => {
  expect(ALL_ADAPTER_CAPABILITIES).toEqual([
    "identify",
    "observe",
    "diagnose",
    "enforce",
    "remediate",
    "lock",
    "locate",
    "wipe",
    "reboot",
    "update",
    "health",
  ]);
  expect(ALL_ADAPTER_CAPABILITIES.length).toBe(11);
});

test("DESTRUCTIVE_CAPABILITIES includes enforce, remediate, lock, locate, wipe, reboot, update", () => {
  expect(DESTRUCTIVE_CAPABILITIES).toEqual([
    "enforce",
    "remediate",
    "lock",
    "locate",
    "wipe",
    "reboot",
    "update",
  ]);
});

test("isSupported: returns true only for explicitly-supported capabilities", () => {
  const flags: AdapterCapabilities = {
    identify: true,
    observe: true,
    health: true,
    // All others implicitly false.
  };
  expect(isSupported("identify", flags)).toBe(true);
  expect(isSupported("observe", flags)).toBe(true);
  expect(isSupported("health", flags)).toBe(true);
  expect(isSupported("diagnose", flags)).toBe(false);
  expect(isSupported("wipe", flags)).toBe(false);
});

test("isDestructive: returns true for destructive capabilities", () => {
  expect(isDestructive("wipe")).toBe(true);
  expect(isDestructive("lock")).toBe(true);
  expect(isDestructive("locate")).toBe(true);
  expect(isDestructive("identify")).toBe(false);
  expect(isDestructive("observe")).toBe(false);
  expect(isDestructive("health")).toBe(false);
});

test("assertSupported: non-destructive supported capability returns ok", () => {
  const flags: AdapterCapabilities = { identify: true };
  const result = assertSupported("identify", flags);
  expect(result).toEqual({ ok: true });
});

test("assertSupported: unsupported capability returns ok:false with reason=unsupported", () => {
  const flags: AdapterCapabilities = { identify: true };
  const result = assertSupported("wipe", flags);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported");
    expect(result.capability).toBe("wipe");
  }
});

test("assertSupported: destructive supported capability WITHOUT policy grant returns ok:false with reason=destructive_unauthorized", () => {
  const flags: AdapterCapabilities = { wipe: true };
  const result = assertSupported("wipe", flags, false);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("destructive_unauthorized");
    expect(result.capability).toBe("wipe");
  }
});

test("assertSupported: destructive supported capability WITH policy grant returns ok:true", () => {
  const flags: AdapterCapabilities = { wipe: true };
  const result = assertSupported("wipe", flags, true);
  expect(result).toEqual({ ok: true });
});

test("assertSupported: unsupported destructive capability returns ok:false with reason=unsupported (NOT destructive_unauthorized)", () => {
  // Critical: unsupported destructive behavior may never be emulated. The
  // assertion fails with "unsupported" first — the policy grant is
  // irrelevant when the capability is not declared.
  const flags: AdapterCapabilities = { identify: true };
  const result = assertSupported("wipe", flags, true);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported");
  }
});
