/**
 * W030 D3 tests — family adapter factories: construction envelope
 * validation (incl. the printer lock/locate/wipe construction refusal),
 * the exhaustive capability refusal matrices per family (negotiation
 * inside every method, seam never invoked on refusal), tenant mismatch,
 * and observe behavior over the family observation sources.
 */

import { test, expect } from "bun:test";
import { ALL_ADAPTER_CAPABILITIES, DESTRUCTIVE_CAPABILITIES, isSupported, type AdapterCapabilities } from "@fleetos/contracts";
import {
  createEndpointAdapter,
  type AdapterCommandContext,
  type AdapterCommandOutcome,
  type EndpointAdapterDescriptor,
} from "../src/adapter";
import { createPrinterVendorModelDescriptor, MOBILE_FAMILY_CAPABILITIES, PRINTER_COPIER_FAMILY_CAPABILITIES } from "../src/families";
import { createInMemoryAndroidSeam, createInMemoryIosSeam, createInMemoryIpadOsSeam } from "../src/seams-inmemory-mobile";
import { createInMemoryPrinterCopierSeam } from "../src/seams-inmemory-printer";
import {
  createMobileFamilyAdapter,
  createPrinterCopierFamilyAdapter,
  familyConformanceFor,
} from "../src/family-adapters";
import { mobileBatteryRecord, mobileComplianceRecord } from "../src/mobile-observations";

const TENANT = "tnt_family" as never;
const DEVICE = "dev_family" as never;
const CORRELATION = "cor_family" as never;
const DECLARED_AT = "2026-01-01T00:00:00Z";

function context(overrides: Partial<AdapterCommandContext> = {}): AdapterCommandContext {
  return {
    tenantId: TENANT,
    correlationId: CORRELATION,
    executedAt: "2026-01-01T12:00:00Z",
    policyGrant: true,
    policyCacheReady: true,
    ...overrides,
  };
}

function descriptor(
  platform: EndpointAdapterDescriptor["platform"],
  adapterId: string,
): EndpointAdapterDescriptor {
  return { adapterId, platform, tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" };
}

const VENDOR_MODEL = createPrinterVendorModelDescriptor({
  vendorId: "hp",
  modelId: "laserjet-m553",
  connectorBoundaries: ["snmp", "vendor-api"],
  optionalCapabilities: ["reboot", "update"],
  consumableMonitoring: true,
});

// ---------------------------------------------------------------------------
// Construction: the family envelope is a CONSTRUCTION-time contract
// ---------------------------------------------------------------------------

test("family-adapters: createMobileFamilyAdapter accepts the full envelope and subsets", () => {
  const full = createMobileFamilyAdapter({
    descriptor: descriptor("ios", "ios-1"),
    seams: createInMemoryIosSeam(),
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
  expect(full.capabilities.supported.length).toBe(9);
  const byod = createMobileFamilyAdapter({
    descriptor: descriptor("android", "android-1"),
    seams: createInMemoryAndroidSeam(),
    capabilities: { identify: true, observe: true, health: true, locate: true, update: true },
    declaredAt: DECLARED_AT,
  });
  expect(byod.capabilities.supported).toContain("locate");
  expect(byod.capabilities.supported).not.toContain("wipe");
});

test("family-adapters: createMobileFamilyAdapter refuses non-mobile platforms and mismatches", () => {
  expect(() =>
    createMobileFamilyAdapter({
      descriptor: descriptor("windows", "w"),
      seams: createInMemoryIosSeam() as never,
      capabilities: {},
      declaredAt: DECLARED_AT,
    }),
  ).toThrow("ios/ipados/android");
  expect(() =>
    createMobileFamilyAdapter({
      descriptor: descriptor("ios", "ios-2"),
      seams: createInMemoryAndroidSeam(),
      capabilities: {},
      declaredAt: DECLARED_AT,
    }),
  ).toThrow("does not match");
});

test("family-adapters: createMobileFamilyAdapter refuses capabilities outside the mobile envelope", () => {
  expect(() =>
    createMobileFamilyAdapter({
      descriptor: descriptor("ios", "ios-3"),
      seams: createInMemoryIosSeam(),
      capabilities: { observe: true, remediate: true, reboot: true },
      declaredAt: DECLARED_AT,
    }),
  ).toThrow("outside the mobile family envelope");
});

test("family-adapters: createPrinterCopierFamilyAdapter accepts base + backed vendor optionals", () => {
  const adapter = createPrinterCopierFamilyAdapter({
    descriptor: descriptor("printer-copier", "prn-1"),
    seams: createInMemoryPrinterCopierSeam(),
    capabilities: { ...PRINTER_COPIER_FAMILY_CAPABILITIES, reboot: true, update: true },
    vendorModel: VENDOR_MODEL,
    declaredAt: DECLARED_AT,
  });
  expect(adapter.capabilities.supported).toContain("reboot");
  expect(adapter.capabilities.supported).toContain("update");
  expect(adapter.platform).toBe("printer-copier");
});

test("family-adapters: createPrinterCopierFamilyAdapter REFUSES lock/locate/wipe at construction — never emulated", () => {
  for (const forbidden of ["lock", "locate", "wipe"] as const) {
    const capabilities: AdapterCapabilities = { observe: true, [forbidden]: true };
    expect(() =>
      createPrinterCopierFamilyAdapter({
        descriptor: descriptor("printer-copier", "prn-forbidden"),
        seams: createInMemoryPrinterCopierSeam(),
        capabilities,
        vendorModel: VENDOR_MODEL,
        declaredAt: DECLARED_AT,
      }),
    ).toThrow("FORBIDDEN capabilities refused at construction");
  }
});

test("family-adapters: createPrinterCopierFamilyAdapter refuses unbacked optionals and outside-envelope capabilities", () => {
  const snmpOnlyModel = createPrinterVendorModelDescriptor({
    vendorId: "lexmark",
    modelId: "mono",
    connectorBoundaries: ["snmp"],
    consumableMonitoring: false,
  });
  expect(() =>
    createPrinterCopierFamilyAdapter({
      descriptor: descriptor("printer-copier", "prn-2"),
      seams: createInMemoryPrinterCopierSeam(),
      capabilities: { observe: true, update: true },
      vendorModel: snmpOnlyModel,
      declaredAt: DECLARED_AT,
    }),
  ).toThrow("does not back");
  expect(() =>
    createPrinterCopierFamilyAdapter({
      descriptor: descriptor("printer-copier", "prn-3"),
      seams: createInMemoryPrinterCopierSeam(),
      capabilities: { remediate: true },
      vendorModel: snmpOnlyModel,
      declaredAt: DECLARED_AT,
    }),
  ).toThrow("outside the printer/copier family envelope");
  expect(() =>
    createPrinterCopierFamilyAdapter({
      descriptor: descriptor("ios", "prn-4"),
      seams: createInMemoryPrinterCopierSeam() as never,
      capabilities: {},
      vendorModel: VENDOR_MODEL,
      declaredAt: DECLARED_AT,
    }),
  ).toThrow('must be "printer-copier"');
});

test("family-adapters: familyConformanceFor resolves the family platform", () => {
  const ios = createMobileFamilyAdapter({
    descriptor: descriptor("ios", "ios-c"),
    seams: createInMemoryIosSeam(),
    capabilities: { observe: true },
    declaredAt: DECLARED_AT,
  });
  expect(familyConformanceFor(ios)).toEqual({ ok: true, familyId: "ios" });
  const printer = createPrinterCopierFamilyAdapter({
    descriptor: descriptor("printer-copier", "prn-c"),
    seams: createInMemoryPrinterCopierSeam(),
    capabilities: { observe: true },
    vendorModel: VENDOR_MODEL,
    declaredAt: DECLARED_AT,
  });
  expect(familyConformanceFor(printer)).toEqual({ ok: true, familyId: "printer-copier" });
  const desktop = createEndpointAdapter({
    descriptor: descriptor("windows", "win-c"),
    seams: { platform: "windows", commands: {} as never, observationSources: {} as never, capabilityProbe: {} as never },
    capabilities: { observe: true },
    declaredAt: DECLARED_AT,
  });
  expect(familyConformanceFor(desktop)).toEqual({ ok: false, reason: "not_a_family_platform" });
});

// ---------------------------------------------------------------------------
// The exhaustive refusal matrix — mobile family (W020 negotiation inside
// every family method; the seam is NEVER invoked on refusal)
// ---------------------------------------------------------------------------

test("family-adapters (ios): exhaustive 11-capability × declared/undeclared refusal matrix", () => {
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    // Declared: succeeds (destructive with grant + fresh cache).
    const declaredSeam = createInMemoryIosSeam();
    const declared = createMobileFamilyAdapter({
      descriptor: descriptor("ios", `ios-m-${capability}`),
      seams: declaredSeam,
      capabilities: MOBILE_FAMILY_CAPABILITIES,
      declaredAt: DECLARED_AT,
    });
    const outcome = declared.invoke({ capability, payload: payloadFor(capability) }, context());
    if (isSupported(capability, MOBILE_FAMILY_CAPABILITIES)) {
      expect(outcome.ok).toBe(true);
      // observe is passive: it polls the observation sources (the
      // "observations" surface), never the command channel.
      const expectedSurface = capability === "observe" ? "observations" : "commands";
      expect(declaredSeam.calls().some((call) => call.surface === expectedSurface)).toBe(true);
    } else {
      // remediate/reboot: outside the mobile envelope — refused even when
      // passed to invoke() directly, never reaching the seam.
      expectRefused(outcome);
      expect(declaredSeam.calls().length).toBe(0);
    }
    // Undeclared: refused, seam untouched (observe included — declared set is empty).
    const undeclaredSeam = createInMemoryIosSeam();
    const undeclared = createMobileFamilyAdapter({
      descriptor: descriptor("ios", `ios-u-${capability}`),
      seams: undeclaredSeam,
      capabilities: {},
      declaredAt: DECLARED_AT,
    });
    const refused = undeclared.invoke({ capability, payload: payloadFor(capability) }, context());
    expectRefused(refused);
    expect(undeclaredSeam.calls().length).toBe(0);
  }
});

test("family-adapters (printer-copier): exhaustive refusal matrix — lock/locate/wipe refused for every grant state", () => {
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    const seam = createInMemoryPrinterCopierSeam();
    const adapter = createPrinterCopierFamilyAdapter({
      descriptor: descriptor("printer-copier", `prn-m-${capability}`),
      seams: seam,
      capabilities: { ...PRINTER_COPIER_FAMILY_CAPABILITIES, reboot: true, update: true },
      vendorModel: VENDOR_MODEL,
      declaredAt: DECLARED_AT,
    });
    for (const grantState of [
      { policyGrant: false, policyCacheReady: true },
      { policyGrant: true, policyCacheReady: false },
      { policyGrant: true, policyCacheReady: true },
    ]) {
      const outcome = adapter.invoke(
        { capability, payload: printerPayloadFor(capability) },
        context(grantState),
      );
      const supported =
        isSupported(capability, PRINTER_COPIER_FAMILY_CAPABILITIES) ||
        capability === "reboot" ||
        capability === "update";
      if (!supported || (DESTRUCTIVE_CAPABILITIES.includes(capability) && !(grantState.policyGrant && grantState.policyCacheReady))) {
        expectRefused(outcome);
        // The seam is NEVER invoked on refusal — unsupported destructive
        // behavior may not be emulated.
        expect(seam.calls().filter((call) => call.surface === "commands").length).toBe(0);
      } else if (capability === "observe") {
        expect(outcome.ok).toBe(true);
      } else {
        expect(outcome.ok).toBe(true);
        expect(seam.calls().some((call) => call.surface === "commands")).toBe(true);
      }
    }
  }
});

test("family-adapters (android): the destructive grant matrix (lock as the exemplar)", () => {
  const matrix: readonly { grant: boolean; cache: boolean; ok: boolean }[] = [
    { grant: false, cache: true, ok: false },
    { grant: true, cache: false, ok: false },
    { grant: false, cache: false, ok: false },
    { grant: true, cache: true, ok: true },
  ];
  for (const entry of matrix) {
    const seam = createInMemoryAndroidSeam();
    const adapter = createMobileFamilyAdapter({
      descriptor: descriptor("android", `android-g-${entry.grant}-${entry.cache}`),
      seams: seam,
      capabilities: MOBILE_FAMILY_CAPABILITIES,
      declaredAt: DECLARED_AT,
    });
    const outcome = adapter.lock(context({ policyGrant: entry.grant, policyCacheReady: entry.cache }), {
      payload: { action: "enable", message: "m", phoneNumber: "+1" },
    });
    expect(outcome.ok).toBe(entry.ok);
    if (!entry.ok) {
      expect(seam.calls().length).toBe(0);
      if (!outcome.ok) {
        expect(outcome.error.kind).toBe("PolicyError");
      }
    }
  }
});

test("family-adapters (ipados): non-destructive capabilities need no grant", () => {
  const adapter = createMobileFamilyAdapter({
    descriptor: descriptor("ipados", "ipad-1"),
    seams: createInMemoryIpadOsSeam(),
    capabilities: { identify: true, observe: true, health: true, diagnose: true },
    declaredAt: DECLARED_AT,
  });
  for (const capability of ["identify", "health", "diagnose"] as const) {
    const outcome = adapter.invoke({ capability }, context({ policyGrant: false, policyCacheReady: false }));
    expect(outcome.ok).toBe(true);
  }
  const observe = adapter.observe(context({ policyGrant: false, policyCacheReady: false }));
  expect(observe.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Tenant isolation + malformed payloads + observe behavior
// ---------------------------------------------------------------------------

test("family-adapters: cross-tenant invocation is refused before any seam call", () => {
  const seam = createInMemoryIosSeam();
  const adapter = createMobileFamilyAdapter({
    descriptor: descriptor("ios", "ios-t"),
    seams: seam,
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
  const outcome = adapter.wipe(context({ tenantId: "tnt_other" as never }), { payload: { scope: "full" } });
  expectRefused(outcome);
  if (!outcome.ok) {
    expect(outcome.error.kind).toBe("AuthorizationError");
  }
  expect(seam.calls().length).toBe(0);
});

test("family-adapters: a malformed family payload fails (fail-closed) AFTER negotiation passes", () => {
  const seam = createInMemoryIosSeam();
  const adapter = createMobileFamilyAdapter({
    descriptor: descriptor("ios", "ios-bad"),
    seams: seam,
    capabilities: MOBILE_FAMILY_CAPABILITIES,
    declaredAt: DECLARED_AT,
  });
  const outcome = adapter.wipe(context(), { payload: { scope: "selective" } });
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    // The seam WAS reached (negotiation passed) and its normalized
    // execute() failed the malformed payload fail-closed.
    expect(outcome.status).toBe("failed");
    expect(outcome.error.kind).toBe("AdapterError");
  }
  expect(seam.calls().some((call) => call.method === "execute")).toBe(true);
});

test("family-adapters: observe polls the family observation sources and emits a valid batch", () => {
  const seam = createInMemoryAndroidSeam({
    batteryObservations: [mobileBatteryRecord("2026-01-01T11:00:00Z", { batteryLevelPercent: 55, chargingState: "charging" })],
    complianceObservations: [
      mobileComplianceRecord("2026-01-01T11:00:01Z", {
        complianceState: "compliant",
        lastEvaluatedAt: "2026-01-01T10:00:00Z",
        violations: [],
      }),
    ],
  });
  const adapter = createMobileFamilyAdapter({
    descriptor: descriptor("android", "android-obs"),
    seams: seam,
    capabilities: { observe: true },
    declaredAt: DECLARED_AT,
  });
  const outcome = adapter.observe(context());
  expect(outcome.ok).toBe(true);
  if (!outcome.ok || outcome.status !== "succeeded") return;
  expect(outcome.batch?.observations.length).toBe(2);
  expect(outcome.batch?.observations[0].kind).toBe("mobile.battery");
  // The observe operation never executed a platform command.
  expect(seam.calls().some((call) => call.surface === "commands")).toBe(false);
});

test("family-adapters: a BYOD mobile subset refuses the undeclared wipe", () => {
  const seam = createInMemoryAndroidSeam();
  const adapter = createMobileFamilyAdapter({
    descriptor: descriptor("android", "android-byod"),
    seams: seam,
    capabilities: { identify: true, observe: true, health: true, update: true, enforce: true },
    declaredAt: DECLARED_AT,
  });
  const outcome = adapter.wipe(context(), { payload: { scope: "enterprise" } });
  expectRefused(outcome);
  expect(seam.calls().length).toBe(0);
  if (!outcome.ok) {
    expect(outcome.error.kind).toBe("AdapterError");
    expect(outcome.error.code).toBe("agent.capability.unsupported");
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectRefused(outcome: AdapterCommandOutcome): void {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.status).toBe("rejected");
}

function payloadFor(capability: string): unknown {
  switch (capability) {
    case "enforce":
      return { action: "install", appIdentifier: "com.example.app" };
    case "update":
      return { notifyDevice: true };
    case "lock":
      return { action: "enable", message: "m", phoneNumber: "+15550000" };
    case "locate":
      return { accuracy: "coarse" };
    case "wipe":
      return { scope: "enterprise" };
    case "identify":
    case "diagnose":
    case "health":
      return undefined;
    default:
      return {};
  }
}

function printerPayloadFor(capability: string): unknown {
  switch (capability) {
    case "diagnose":
    case "identify":
    case "health":
      return { oids: ["1.3.6.1.2.1.1.1.0"] };
    case "enforce":
      return { action: "clear-queue" };
    case "reboot":
      return { action: "reboot" };
    case "update":
      return { action: "firmware-update", firmwareRef: "fw-1" };
    default:
      return {};
  }
}
