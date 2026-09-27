/**
 * W032 D5 — Contract conformance: the vendors package against the
 * frozen @fleetos/contracts surface and the @fleetos/contracts/testing
 * fixture builders.
 *
 * Fixture builders consumed (deterministic, valid-by-construction):
 *   makeTenantId, makeTimestamp, makeCorrelationId, makeVendorId,
 *   FIXTURE_TIME_ANCHOR.
 * Frozen contracts helpers exercised: asVendorId, isValidTenantId,
 *   validateTenantRef, assertVersion, makeVersioned, toApiError,
 *   TenantScoped.
 */

import { describe, expect, test } from "bun:test";
import {
  asVendorId,
  assertVersion,
  isValidTenantId,
  makeVersioned,
  toApiError,
  validateTenantRef,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeCorrelationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { makeTenantContext } from "@fleetos/identity";
import {
  VENDOR_MODEL_VERSION,
  VENDOR_SCHEMA_VERSION,
  buildVendor,
  createInMemoryVendorAuditSink,
  createInMemoryVendorStore,
  createVendorService,
  reviseVendor,
} from "../src/index";
import type { Vendor } from "../src/index";
import {
  createInput,
  reviseInput,
  stdCapability,
  stdInventory,
} from "./helpers";

describe("conformance: fixture tenants + timestamps", () => {
  test("fixture tenant ids satisfy the frozen grammar and scope vendor contexts", () => {
    for (let seed = 0; seed < 10; seed++) {
      const tenantId = makeTenantId(seed);
      expect(isValidTenantId(tenantId)).toBe(true);
      expect(validateTenantRef(tenantId).ok).toBe(true);
      const ctx = makeTenantContext(tenantId, makeCorrelationId(seed));
      const store = createInMemoryVendorStore();
      const created = store.createVendor(
        ctx,
        createInput({ vendorId: asVendorId(`vnd_fixture_${String(seed)}`) }),
      );
      expect(created.ok).toBe(true);
      // The frozen envelope time anchor is a valid injected timestamp.
      const built = buildVendor(tenantId, {
        ...createInput(),
        at: makeTimestamp(seed),
        correlationId: makeCorrelationId(seed),
      });
      expect(built.ok).toBe(true);
      expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
      expect(makeTimestamp(seed).startsWith("2026-01-01T")).toBe(true);
      expect(makeTimestamp("conf")).toBe(makeTimestamp("conf"));
    }
  });

  test("fixture-derived vendor ids and revisions are deterministic", () => {
    const tenantId = makeTenantId("w032-vendors-conformance");
    const a = buildVendor(tenantId, createInput({ vendorId: undefined }));
    const b = buildVendor(tenantId, createInput({ vendorId: undefined }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.vendor.vendorId).toBe(b.vendor.vendorId);
    expect(a.vendor.contentHash).toBe(b.vendor.contentHash);
  });

  test("asVendorId produces branded vendor ids satisfying the frozen type", () => {
    const v = asVendorId("vnd_w032_vendor");
    expect(typeof v).toBe("string");
    expect(v.length > 0).toBe(true);
    // The branded type is structurally a string at runtime.
    const roundtrip: string = v;
    expect(roundtrip.length > 0).toBe(true);
  });
});

describe("conformance: versioning discipline (Versioned<T> + assertVersion)", () => {
  test("vendor records carry schema versions the consumer can assert", () => {
    const tenantId = makeTenantId("w032-vendor-versioning");
    const built = buildVendor(tenantId, {
      ...createInput(),
      correlationId: makeCorrelationId("w032-vendor-versioning"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.vendor.schemaVersion).toBe(VENDOR_SCHEMA_VERSION);
    expect(built.vendor.modelVersion).toBe(VENDOR_MODEL_VERSION);
    const versioned = makeVersioned(built.vendor, built.vendor.schemaVersion);
    expect(assertVersion(versioned, [1]).ok).toBe(true);
    expect(assertVersion(versioned, [2]).ok).toBe(false);
    expect(assertVersion(makeVersioned(built.vendor, 0), [0]).ok).toBe(false);
  });

  test("a revision carries the same schema version + a new content hash", () => {
    const tenantId = makeTenantId("w032-vendor-revision");
    const prior = buildVendor(tenantId, {
      ...createInput(),
      correlationId: makeCorrelationId("w032-vendor-revision"),
    });
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    const next = reviseVendor(prior.vendor, {
      ...reviseInput(),
      correlationId: makeCorrelationId("w032-vendor-revision-2"),
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.vendor.schemaVersion).toBe(VENDOR_SCHEMA_VERSION);
    expect(next.vendor.revision).toBe(2);
    expect(next.vendor.contentHash).not.toBe(prior.vendor.contentHash);
  });
});

describe("conformance: FleetError taxonomy + audit seam", () => {
  test("vendor errors translate through the frozen toApiError mapping", () => {
    const bad = buildVendor(makeTenantId("w032-vendor-errors"), createInput({ name: "" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(toApiError(bad.error).status).toBe(400);
  });

  test("the audited service works end to end with fixture-scoped contexts", () => {
    const tenantId = makeTenantId("w032-vendor-service");
    const sink = createInMemoryVendorAuditSink();
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });
    const created = service.createVendor(
      makeTenantContext(tenantId, makeCorrelationId("w032-vendor-service")),
      {
        ...createInput({ vendorId: asVendorId("vnd_fixture_service") }),
        at: makeTimestamp("w032-vendor-service"),
        correlationId: makeCorrelationId("w032-vendor-service"),
      },
    );
    expect(created.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.tenantId).toBe(tenantId);
    expect(sink.records[0]?.occurredAt).toBe(makeTimestamp("w032-vendor-service"));
  });
});

describe("conformance: capability kinds (open union, forward compatibility)", () => {
  test("the vendor accepts future capability kinds (forward compatibility)", () => {
    const tenantId = makeTenantId("w032-vendor-caps");
    const built = buildVendor(tenantId, {
      ...createInput(),
      capabilities: [
        stdCapability(),
        { kind: "future-capability" as never, id: "future.x" },
      ],
      correlationId: makeCorrelationId("w032-vendor-caps"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.vendor.capabilities.length).toBe(2);
  });

  test("an inventory signal with zero availability is accepted (boundary)", () => {
    const tenantId = makeTenantId("w032-vendor-inventory");
    const built = buildVendor(tenantId, {
      ...createInput(),
      inventory: [stdInventory(stdCapability(), 0, 0)],
      correlationId: makeCorrelationId("w032-vendor-inventory"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.vendor.inventory[0]?.availability.ratio).toBe(0);
  });

  test("the Vendor type extends TenantScoped (structural conformance)", () => {
    const tenantId = makeTenantId("w032-vendor-tenant-scoped");
    const built = buildVendor(tenantId, {
      ...createInput(),
      correlationId: makeCorrelationId("w032-vendor-tenant-scoped"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.vendor.tenantId).toBe(tenantId);
  });
});

// Re-export the type for the versioned-record test.
export type { Vendor };
