/**
 * W030 D4 tests — registry integration: family adapters register
 * through the W020 AdapterRegistry unchanged, capability-aware dispatch
 * resolves a family adapter by device descriptor, and composition
 * conformance holds (conflicts, tenant isolation, born-rejected
 * refusals, idempotent replay).
 */

import { test, expect } from "bun:test";
import { createCommandReceiptTracker } from "../src/commands";
import { createAdapterCommandDispatcher } from "../src/dispatch";
import { createAdapterRegistry } from "../src/registry";
import { createPrinterVendorModelDescriptor, MOBILE_FAMILY_CAPABILITIES, PRINTER_COPIER_FAMILY_CAPABILITIES } from "../src/families";
import { createInMemoryAndroidSeam, createInMemoryIosSeam } from "../src/seams-inmemory-mobile";
import { createInMemoryPrinterCopierSeam } from "../src/seams-inmemory-printer";
import { createMobileFamilyAdapter, createPrinterCopierFamilyAdapter } from "../src/family-adapters";
import { commandTypeForCapability } from "../src/dispatch";

const TENANT_A = "tnt_family_a" as never;
const TENANT_B = "tnt_family_b" as never;
const DEVICE_IOS = "dev_ios_1" as never;
const DEVICE_ANDROID = "dev_android_1" as never;
const DEVICE_PRINTER = "dev_printer_1" as never;
const DECLARED_AT = "2026-01-01T00:00:00Z";
const RECEIVED_AT = "2026-01-01T12:00:00Z";
const EXECUTED_AT = "2026-01-01T12:00:01Z";
const COMPLETED_AT = "2026-01-01T12:00:02Z";

const VENDOR_MODEL = createPrinterVendorModelDescriptor({
  vendorId: "ricoh",
  modelId: "im-c3000",
  connectorBoundaries: ["snmp", "vendor-api"],
  optionalCapabilities: ["reboot"],
  consumableMonitoring: true,
});

function iosAdapter(tenantId: typeof TENANT_A) {
  return createMobileFamilyAdapter({
    descriptor: {
      adapterId: `ios-${tenantId as string}`,
      platform: "ios",
      tenantId,
      deviceId: DEVICE_IOS,
      adapterVersion: "0.1.0",
    },
    seams: createInMemoryIosSeam(),
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
}

function androidAdapter(tenantId: typeof TENANT_A) {
  return createMobileFamilyAdapter({
    descriptor: {
      adapterId: `android-${tenantId as string}`,
      platform: "android",
      tenantId,
      deviceId: DEVICE_ANDROID,
      adapterVersion: "0.1.0",
    },
    seams: createInMemoryAndroidSeam(),
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
}

function printerAdapter(tenantId: typeof TENANT_A) {
  return createPrinterCopierFamilyAdapter({
    descriptor: {
      adapterId: `printer-${tenantId as string}`,
      platform: "printer-copier",
      tenantId,
      deviceId: DEVICE_PRINTER,
      adapterVersion: "0.1.0",
    },
    seams: createInMemoryPrinterCopierSeam(),
    capabilities: { ...PRINTER_COPIER_FAMILY_CAPABILITIES, reboot: true },
    vendorModel: VENDOR_MODEL,
    declaredAt: DECLARED_AT,
  });
}

// ---------------------------------------------------------------------------
// Registration through the W020 registry (unchanged)
// ---------------------------------------------------------------------------

test("family-registry: family adapters register through the W020 AdapterRegistry unchanged", () => {
  const registry = createAdapterRegistry();
  const ios = iosAdapter(TENANT_A);
  const android = androidAdapter(TENANT_A);
  const printer = printerAdapter(TENANT_A);
  expect(registry.register(ios).ok).toBe(true);
  expect(registry.register(android).ok).toBe(true);
  expect(registry.register(printer).ok).toBe(true);
  expect(registry.size()).toBe(3);
  // Lookup by adapter id, by device, and by platform.
  expect(registry.get(TENANT_A, "ios-" + (TENANT_A as string))?.platform).toBe("ios");
  expect(registry.forDevice(TENANT_A, DEVICE_PRINTER)?.platform).toBe("printer-copier");
  expect(registry.forPlatform(TENANT_A, "android").length).toBe(1);
  expect(registry.forPlatform(TENANT_A, "printer-copier").length).toBe(1);
  expect(registry.list(TENANT_A).length).toBe(3);
});

test("family-registry: registration conflicts + one-adapter-per-endpoint hold for families", () => {
  const registry = createAdapterRegistry();
  expect(registry.register(iosAdapter(TENANT_A)).ok).toBe(true);
  // Same adapterId again: conflict.
  const duplicate = registry.register(iosAdapter(TENANT_A));
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.error.kind).toBe("ConflictError");
  // Same (tenant, device) with a different id: conflict.
  const sameDevice = createMobileFamilyAdapter({
    descriptor: {
      adapterId: "ios-other",
      platform: "ios",
      tenantId: TENANT_A,
      deviceId: DEVICE_IOS,
      adapterVersion: "0.1.0",
    },
    seams: createInMemoryIosSeam(),
    capabilities: { observe: true },
    declaredAt: DECLARED_AT,
  });
  const endpointConflict = registry.register(sameDevice);
  expect(endpointConflict.ok).toBe(false);
  // unregister then re-register works.
  expect(registry.unregister(TENANT_A, "ios-" + (TENANT_A as string)).ok).toBe(true);
  expect(registry.register(iosAdapter(TENANT_A)).ok).toBe(true);
});

test("family-registry: tenant isolation is structural — foreign family ids are unknown", () => {
  const registry = createAdapterRegistry();
  registry.register(iosAdapter(TENANT_A));
  registry.register(printerAdapter(TENANT_A));
  expect(registry.get(TENANT_B, "ios-" + (TENANT_A as string))).toBeUndefined();
  expect(registry.forDevice(TENANT_B, DEVICE_IOS)).toBeUndefined();
  expect(registry.list(TENANT_B).length).toBe(0);
  // Cross-tenant unregister is indistinguishable from unknown.
  expect(registry.unregister(TENANT_B, "ios-" + (TENANT_A as string)).ok).toBe(false);
  // Tenant B can register its own adapter with the SAME adapterId.
  expect(registry.register(iosAdapter(TENANT_B)).ok).toBe(true);
  expect(registry.forDevice(TENANT_B, DEVICE_IOS)?.descriptor.tenantId).toBe(TENANT_B);
});

// ---------------------------------------------------------------------------
// Capability-aware dispatch resolves family adapters by device descriptor
// ---------------------------------------------------------------------------

function dispatcherFor(registry: ReturnType<typeof createAdapterRegistry>) {
  return createAdapterCommandDispatcher({
    registry,
    tracker: createCommandReceiptTracker(),
  });
}

test("family-registry: dispatch resolves a family adapter by device descriptor (mobile lock)", () => {
  const registry = createAdapterRegistry();
  const seam = createInMemoryIosSeam();
  const adapter = createMobileFamilyAdapter({
    descriptor: {
      adapterId: "ios-d1",
      platform: "ios",
      tenantId: TENANT_A,
      deviceId: DEVICE_IOS,
      adapterVersion: "0.1.0",
    },
    seams: seam,
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
  registry.register(adapter);
  const dispatcher = dispatcherFor(registry);

  const command = {
    id: "cmd_w030_lock" as never,
    idempotencyKey: "idem_w030_lock" as never,
    issuedAt: RECEIVED_AT,
    tenantId: TENANT_A,
    correlationId: "cor_w030_lock" as never,
    type: commandTypeForCapability("lock"),
    payload: { action: "enable", message: "Lost", phoneNumber: "+15550001" },
  };
  const outcome = dispatcher.dispatch(command, {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE_IOS,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.status).toBe("succeeded");
  expect(outcome.result.status).toBe("succeeded");
  expect(seam.calls().some((call) => call.method === "runMdmCommand")).toBe(true);
});

test("family-registry: dispatch to a printer resolves the printer family adapter (limited enforce)", () => {
  const registry = createAdapterRegistry();
  const seam = createInMemoryPrinterCopierSeam();
  registry.register(
    createPrinterCopierFamilyAdapter({
      descriptor: {
        adapterId: "prn-d1",
        platform: "printer-copier",
        tenantId: TENANT_A,
        deviceId: DEVICE_PRINTER,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: { ...PRINTER_COPIER_FAMILY_CAPABILITIES, reboot: true },
      vendorModel: VENDOR_MODEL,
      declaredAt: DECLARED_AT,
    }),
  );
  const dispatcher = dispatcherFor(registry);
  const command = {
    id: "cmd_w030_clear" as never,
    idempotencyKey: "idem_w030_clear" as never,
    issuedAt: RECEIVED_AT,
    tenantId: TENANT_A,
    correlationId: "cor_w030_clear" as never,
    type: commandTypeForCapability("enforce"),
    payload: { action: "clear-queue" },
  };
  const outcome = dispatcher.dispatch(command, {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE_PRINTER,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(true);
  expect(seam.calls().some((call) => call.method === "runVendorCommand")).toBe(true);
});

test("family-registry: a wipe command against a printer is born-rejected (pre-negotiation)", () => {
  const registry = createAdapterRegistry();
  const seam = createInMemoryPrinterCopierSeam();
  registry.register(
    createPrinterCopierFamilyAdapter({
      descriptor: {
        adapterId: "prn-d2",
        platform: "printer-copier",
        tenantId: TENANT_A,
        deviceId: DEVICE_PRINTER,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: PRINTER_COPIER_FAMILY_CAPABILITIES,
      vendorModel: VENDOR_MODEL,
      declaredAt: DECLARED_AT,
    }),
  );
  const dispatcher = dispatcherFor(registry);
  const command = {
    id: "cmd_w030_wipe" as never,
    idempotencyKey: "idem_w030_wipe" as never,
    issuedAt: RECEIVED_AT,
    tenantId: TENANT_A,
    correlationId: "cor_w030_wipe" as never,
    type: commandTypeForCapability("wipe"),
    payload: { scope: "full" },
  };
  const outcome = dispatcher.dispatch(command, {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE_PRINTER,
    policyGrant: true, // Even WITH a grant: unsupported is refused.
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.status).toBe("rejected");
  expect(outcome.error.kind).toBe("AdapterError");
  expect(outcome.error.code).toBe("agent.capability.unsupported");
  // The seam was never invoked — never emulated.
  expect(seam.calls().length).toBe(0);
});

test("family-registry: mobile destructive dispatch without a grant is rejected with a PolicyError", () => {
  const registry = createAdapterRegistry();
  registry.register(iosAdapter(TENANT_A));
  const dispatcher = dispatcherFor(registry);
  const command = {
    id: "cmd_w030_wipe2" as never,
    idempotencyKey: "idem_w030_wipe2" as never,
    issuedAt: RECEIVED_AT,
    tenantId: TENANT_A,
    correlationId: "cor_w030_wipe2" as never,
    type: commandTypeForCapability("wipe"),
    payload: { scope: "enterprise" },
  };
  const outcome = dispatcher.dispatch(command, {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE_IOS,
    policyGrant: false,
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.status).toBe("rejected");
  expect(outcome.error.kind).toBe("PolicyError");
});

test("family-registry: idempotent replay returns the ORIGINAL result and never re-executes", () => {
  const registry = createAdapterRegistry();
  const seam = createInMemoryAndroidSeam();
  registry.register(
    createMobileFamilyAdapter({
      descriptor: {
        adapterId: "android-d1",
        platform: "android",
        tenantId: TENANT_A,
        deviceId: DEVICE_ANDROID,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: MOBILE_FAMILY_CAPABILITIES,
      declaredAt: DECLARED_AT,
    }),
  );
  const dispatcher = dispatcherFor(registry);
  const command = {
    id: "cmd_w030_replay" as never,
    idempotencyKey: "idem_w030_replay" as never,
    issuedAt: RECEIVED_AT,
    tenantId: TENANT_A,
    correlationId: "cor_w030_replay" as never,
    type: commandTypeForCapability("update"),
    payload: { notifyDevice: true },
  };
  const first = dispatcher.dispatch(command, {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE_ANDROID,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(first.ok).toBe(true);
  const executionCalls = seam.calls().filter((call) => call.method === "runEnterpriseCommand").length;
  expect(executionCalls).toBe(1);
  const replay = dispatcher.dispatch(command, {
    receivedAt: "2026-01-01T12:05:00Z",
    executedAt: "2026-01-01T12:05:01Z",
    completedAt: "2026-01-01T12:05:02Z",
    deviceId: DEVICE_ANDROID,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.replayed).toBe(true);
  // The ORIGINAL result is mirrored — the result id and status match.
  expect(replay.result.status).toBe("succeeded");
  expect(replay.result.commandId).toBe(first.ok ? first.result.commandId : undefined);
  // The seam executed exactly once.
  expect(seam.calls().filter((call) => call.method === "runEnterpriseCommand").length).toBe(1);
});

test("family-registry: mixed-family fleets resolve per device (composition conformance)", () => {
  const registry = createAdapterRegistry();
  registry.register(iosAdapter(TENANT_A));
  registry.register(androidAdapter(TENANT_A));
  registry.register(printerAdapter(TENANT_A));
  const dispatcher = dispatcherFor(registry);
  for (const [device, capability, payload, grant] of [
    [DEVICE_IOS, "locate", { accuracy: "fine" }, true],
    [DEVICE_ANDROID, "lock", { action: "enable", message: "m", phoneNumber: "+1" }, true],
    [DEVICE_PRINTER, "diagnose", { oids: ["1.3.6.1.2.1.1.1.0"] }, false],
  ] as const) {
    const command = {
      id: `cmd_mix_${capability}` as never,
      idempotencyKey: `idem_mix_${capability}` as never,
      issuedAt: RECEIVED_AT,
      tenantId: TENANT_A,
      correlationId: `cor_mix_${capability}` as never,
      type: commandTypeForCapability(capability),
      payload,
    };
    const outcome = dispatcher.dispatch(command, {
      receivedAt: RECEIVED_AT,
      executedAt: EXECUTED_AT,
      completedAt: COMPLETED_AT,
      deviceId: device,
      policyGrant: grant,
      policyCacheReady: true,
    });
    expect(outcome.ok).toBe(true);
  }
  // Cross-tenant dispatch against the same fleet: no adapter resolves.
  const foreign = dispatcher.dispatch(
    {
      id: "cmd_foreign" as never,
      idempotencyKey: "idem_foreign" as never,
      issuedAt: RECEIVED_AT,
      tenantId: TENANT_B,
      correlationId: "cor_foreign" as never,
      type: commandTypeForCapability("lock"),
      payload: { action: "enable", message: "m", phoneNumber: "+1" },
    },
    {
      receivedAt: RECEIVED_AT,
      executedAt: EXECUTED_AT,
      completedAt: COMPLETED_AT,
      deviceId: DEVICE_IOS,
      policyGrant: true,
      policyCacheReady: true,
    },
  );
  expect(foreign.ok).toBe(false);
  if (foreign.ok) return;
  expect(foreign.status).toBe("rejected");
});
