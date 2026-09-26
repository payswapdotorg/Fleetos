import { test, expect } from "bun:test";
import {
  brand,
  isBranded,
  asTenantId,
  asDeviceId,
  asEventId,
  asCorrelationId,
  asCausationId,
  asIdempotencyKey,
  type TenantId,
  type DeviceId,
  type EventId,
} from "../src/ids";

test("brand<T,B>() returns the input value unchanged at runtime (no allocation)", () => {
  const input = "tnt_abc12345";
  const result = brand<string, "TenantId">(input);
  expect(result).toBe(input);
  // Runtime identity — branded IDs are zero-cost.
  expect(typeof result).toBe("string");
});

test("branded IDs are structurally strings but nominally distinct at the type level", () => {
  const tenantId: TenantId = asTenantId("tnt_abc12345");
  const deviceId: DeviceId = asDeviceId("dev_xyz");
  // Both are strings at runtime.
  expect(typeof tenantId).toBe("string");
  expect(typeof deviceId).toBe("string");
  // The brand tag is type-level only — JSON.stringify produces a plain string.
  expect(JSON.stringify(tenantId)).toBe('"tnt_abc12345"');
});

test("asXxx() constructors produce the expected runtime value", () => {
  expect(asTenantId("tnt_abc")).toBe("tnt_abc");
  expect(asDeviceId("dev_xyz")).toBe("dev_xyz");
  expect(asEventId("evt_001")).toBe("evt_001");
  expect(asCorrelationId("cor_001")).toBe("cor_001");
  expect(asCausationId("cau_001")).toBe("cau_001");
  expect(asIdempotencyKey("idem_001")).toBe("idem_001");
});

test("isBranded() type-guards string-branded values", () => {
  const t: unknown = asTenantId("tnt_abc12345");
  expect(isBranded<string, "TenantId">(t)).toBe(true);
  expect(isBranded<string, "TenantId">(42)).toBe(false);
  expect(isBranded<string, "TenantId">(null)).toBe(false);
  expect(isBranded<string, "TenantId">(undefined)).toBe(false);
});

test("branded id type-guard roundtrip: brand -> guard -> re-assign", () => {
  const original = "tnt_roundtrip";
  const branded = brand<string, "TenantId">(original);
  const guardResult = isBranded<string, "TenantId">(branded);
  expect(guardResult).toBe(true);
  if (guardResult) {
    // Inside this branch, `branded` is narrowed to Branded<string, "TenantId">.
    const roundtripped: TenantId = branded;
    expect(roundtripped).toBe(original);
  }
});
