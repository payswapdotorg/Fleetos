/**
 * W020 D4 tests — the tenant-scoped adapter registry.
 *
 * Verifies registration (structural validation + conflict detection),
 * lookup by adapterId / device / platform, listing order, size, tenant
 * isolation (foreign lookups indistinguishable from unknown), and
 * unregister semantics.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantId, makeDeviceId, makeTimestamp, makeAdapterCapabilities } from "@fleetos/contracts/testing";
import {
  createAdapterRegistry,
  createEndpointAdapter,
  type EndpointAdapter,
  type EndpointAdapterDescriptor,
} from "../src";
import { createInMemoryWindowsSeam, createInMemoryLinuxSeam, createInMemoryMacOsSeam } from "../src/seams-inmemory";
import { ERROR_CODES } from "../src/internal";

const TENANT_A = makeTenantId("w020-registry-tenant-a");
const TENANT_B = makeTenantId("w020-registry-tenant-b");
const DEVICE_1 = makeDeviceId("w020-registry-device-1");
const DEVICE_2 = makeDeviceId("w020-registry-device-2");
const DEVICE_3 = makeDeviceId("w020-registry-device-3");
const DECLARED_AT = makeTimestamp("w020-registry-declared");

function adapter(
  adapterId: string,
  tenantId: typeof TENANT_A,
  deviceId: typeof DEVICE_1,
  platform: "windows" | "macos" | "linux" = "windows",
): EndpointAdapter {
  const descriptor: EndpointAdapterDescriptor = {
    adapterId,
    platform,
    tenantId,
    deviceId,
    adapterVersion: "0.1.0",
  };
  const seams =
    platform === "windows"
      ? createInMemoryWindowsSeam()
      : platform === "macos"
        ? createInMemoryMacOsSeam()
        : createInMemoryLinuxSeam();
  return createEndpointAdapter({
    descriptor,
    seams,
    capabilities: makeAdapterCapabilities({ supported: ["lock", "health"] }),
    declaredAt: DECLARED_AT,
  });
}

describe("W020 D4: adapter registration + lookup", () => {
  test("registers and looks up by adapterId", () => {
    const registry = createAdapterRegistry();
    const a = adapter("adp_1", TENANT_A, DEVICE_1);
    expect(registry.register(a)).toEqual({ ok: true, adapter: a });
    expect(registry.get(TENANT_A, "adp_1")).toBe(a);
    expect(registry.size()).toBe(1);
  });

  test("looks up the adapter fronting a device", () => {
    const registry = createAdapterRegistry();
    const a = adapter("adp_1", TENANT_A, DEVICE_1);
    registry.register(a);
    expect(registry.forDevice(TENANT_A, DEVICE_1)).toBe(a);
    expect(registry.forDevice(TENANT_A, DEVICE_2)).toBeUndefined();
  });

  test("forPlatform filters by platform in registration order", () => {
    const registry = createAdapterRegistry();
    const windows1 = adapter("adp_w1", TENANT_A, DEVICE_1, "windows");
    const linux1 = adapter("adp_l1", TENANT_A, DEVICE_2, "linux");
    const windows2 = adapter("adp_w2", TENANT_A, DEVICE_3, "windows");
    registry.register(windows1);
    registry.register(linux1);
    registry.register(windows2);
    expect(registry.forPlatform(TENANT_A, "windows")).toEqual([windows1, windows2]);
    expect(registry.forPlatform(TENANT_A, "linux")).toEqual([linux1]);
    expect(registry.forPlatform(TENANT_A, "macos")).toEqual([]);
    expect(registry.list(TENANT_A)).toEqual([windows1, linux1, windows2]);
    expect(registry.size()).toBe(3);
  });

  test("duplicate adapterId within a tenant is a conflict", () => {
    const registry = createAdapterRegistry();
    registry.register(adapter("adp_dup", TENANT_A, DEVICE_1));
    const result = registry.register(adapter("adp_dup", TENANT_A, DEVICE_2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConflictError");
    expect(result.error.code).toBe(ERROR_CODES.adapterRegistrationConflict);
    expect(result.error.message).toContain("adp_dup");
    // The second registration did not land.
    expect(registry.size()).toBe(1);
  });

  test("two adapters for the same device endpoint is a conflict", () => {
    const registry = createAdapterRegistry();
    registry.register(adapter("adp_first", TENANT_A, DEVICE_1));
    const result = registry.register(adapter("adp_second", TENANT_A, DEVICE_1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConflictError");
    expect(result.error.message).toContain(DEVICE_1 as string);
  });

  test("the same adapterId in DIFFERENT tenants is allowed (separate namespaces)", () => {
    const registry = createAdapterRegistry();
    const a = adapter("adp_shared", TENANT_A, DEVICE_1);
    const b = adapter("adp_shared", TENANT_B, DEVICE_2);
    expect(registry.register(a).ok).toBe(true);
    expect(registry.register(b).ok).toBe(true);
    expect(registry.size()).toBe(2);
    expect(registry.get(TENANT_A, "adp_shared")).toBe(a);
    expect(registry.get(TENANT_B, "adp_shared")).toBe(b);
  });
});

describe("W020 D4: registry structural validation", () => {
  test("an adapter without invoke is refused with a ValidationError", () => {
    const registry = createAdapterRegistry();
    const broken = { ...adapter("adp_broken", TENANT_A, DEVICE_1), invoke: "not-a-function" };
    const result = registry.register(broken as unknown as EndpointAdapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
    expect(result.error.code).toBe(ERROR_CODES.adapterRegistrationInvalid);
    const failures = (result.error as unknown as { failures: readonly { path: string; reason: string }[] }).failures;
    expect(failures.some((f) => f.path === "/invoke" && f.reason === "required_function")).toBe(true);
  });

  test("an unknown platform is refused", () => {
    const registry = createAdapterRegistry();
    const broken = {
      ...adapter("adp_badplatform", TENANT_A, DEVICE_1),
      descriptor: { ...adapter("adp_badplatform", TENANT_A, DEVICE_1).descriptor, platform: "ios" },
    };
    const result = registry.register(broken as unknown as EndpointAdapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ERROR_CODES.adapterRegistrationInvalid);
    const failures = (result.error as unknown as { failures: readonly { path: string; reason: string }[] }).failures;
    expect(failures.some((f) => f.path === "/descriptor/platform" && f.reason === "unknown_platform")).toBe(true);
  });

  test("missing descriptor fields are collected (multiple failures surfaced)", () => {
    const registry = createAdapterRegistry();
    const broken = {
      descriptor: { adapterId: "", platform: "windows", tenantId: TENANT_A, deviceId: DEVICE_1, adapterVersion: "" },
      capabilities: adapter("x", TENANT_A, DEVICE_1).capabilities,
      invoke: () => ({ ok: true, status: "succeeded", evidence: [] }),
    } as unknown as EndpointAdapter;
    const result = registry.register(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const failures = (result.error as unknown as { failures: readonly { path: string; reason: string }[] }).failures;
    expect(failures.some((f) => f.path === "/descriptor/adapterId" && f.reason === "required")).toBe(true);
    expect(failures.some((f) => f.path === "/descriptor/adapterVersion" && f.reason === "required")).toBe(true);
  });
});

describe("W020 D4: registry tenant isolation", () => {
  test("a tenant-B lookup cannot observe a tenant-A registration (indistinguishable from unknown)", () => {
    const registry = createAdapterRegistry();
    const a = adapter("adp_a", TENANT_A, DEVICE_1);
    registry.register(a);
    expect(registry.get(TENANT_B, "adp_a")).toBeUndefined();
    expect(registry.forDevice(TENANT_B, DEVICE_1)).toBeUndefined();
    expect(registry.forPlatform(TENANT_B, "windows")).toEqual([]);
    expect(registry.list(TENANT_B)).toEqual([]);
    // Cross-tenant unregister is refused like an unknown id.
    const unregister = registry.unregister(TENANT_B, "adp_a");
    expect(unregister.ok).toBe(false);
    expect(registry.size()).toBe(1);
  });

  test("foreign lookups leak no information about the other tenant's count", () => {
    const registry = createAdapterRegistry();
    registry.register(adapter("adp_a1", TENANT_A, DEVICE_1));
    registry.register(adapter("adp_a2", TENANT_A, DEVICE_2));
    expect(registry.list(TENANT_B).length).toBe(0);
    expect(registry.list(TENANT_A).length).toBe(2);
  });
});

describe("W020 D4: unregister", () => {
  test("unregister removes the adapter from every index", () => {
    const registry = createAdapterRegistry();
    const a = adapter("adp_gone", TENANT_A, DEVICE_1);
    registry.register(a);
    expect(registry.unregister(TENANT_A, "adp_gone").ok).toBe(true);
    expect(registry.get(TENANT_A, "adp_gone")).toBeUndefined();
    expect(registry.forDevice(TENANT_A, DEVICE_1)).toBeUndefined();
    expect(registry.size()).toBe(0);
    // Re-registering the endpoint works after the removal.
    expect(registry.register(adapter("adp_new", TENANT_A, DEVICE_1)).ok).toBe(true);
  });

  test("unregister of an unknown id is refused with a DomainError", () => {
    const registry = createAdapterRegistry();
    const result = registry.unregister(TENANT_A, "adp_unknown");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
    expect(result.error.code).toBe(ERROR_CODES.adapterNotFound);
  });
});
