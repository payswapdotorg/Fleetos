/**
 * W032 D1 tests — the Vendor domain model: versioned records,
 * deterministic content hashes, validation.
 */

import { describe, expect, test } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  VENDOR_MODEL_VERSION,
  VENDOR_SCHEMA_VERSION,
  buildVendor,
  reviseVendor,
} from "../src/vendor";
import {
  CORR,
  T0,
  T1,
  VND_1,
  createInput,
  reviseInput,
  stdCapability,
  stdInventory,
  stdTerms,
  vendor,
} from "./helpers";

const TENANT_A = asTenantId("tnt_testtenant000a");

describe("D1: vendor build (revision 1)", () => {
  test("builds a frozen, deterministic revision 1 with a content hash", () => {
    const v = vendor();
    expect(v.vendorId).toBe(VND_1);
    expect(v.revision).toBe(1);
    expect(v.schemaVersion).toBe(VENDOR_SCHEMA_VERSION);
    expect(v.modelVersion).toBe(VENDOR_MODEL_VERSION);
    expect(v.createdAt).toBe(T0);
    expect(v.contentHash.length).toBe(8);
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.capabilities)).toBe(true);
    expect(Object.isFrozen(v.inventory)).toBe(true);
    expect(Object.isFrozen(v.terms)).toBe(true);
    expect(Object.isFrozen(v.regions)).toBe(true);
  });

  test("the same inputs produce byte-identical vendors (deterministic)", () => {
    const a = vendor();
    const b = vendor();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("a derived vendor id is deterministic for the same (tenant, name)", () => {
    const a = vendor({ vendorId: undefined, name: "Acme Local" });
    const b = vendor({ vendorId: undefined, name: "Acme Local" });
    expect(a.vendorId).toBe(b.vendorId);
    expect(a.vendorId.startsWith("vnd_")).toBe(true);
  });

  test("a different name derives a different vendor id", () => {
    const a = vendor({ vendorId: undefined, name: "Acme Local" });
    const b = vendor({ vendorId: undefined, name: "Beta Local" });
    expect(a.vendorId).not.toBe(b.vendorId);
  });

  test("validation rejects invalid inputs with tagged ValidationError", () => {
    expect(buildVendor(TENANT_A, createInput({ name: "" })).ok).toBe(false);
    expect(buildVendor(TENANT_A, createInput({ description: "" })).ok).toBe(false);
    expect(buildVendor(TENANT_A, createInput({ at: "not-iso" })).ok).toBe(false);
    expect(buildVendor(TENANT_A, createInput({ correlationId: "" as never })).ok).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ terms: stdTerms({ quality: { score: 1.5 } }) })).ok,
    ).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ terms: stdTerms({ sla: { coverage: -0.1 } }) })).ok,
    ).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ terms: stdTerms({ warranty: { days: -1 } }) })).ok,
    ).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ inventory: [{ ...stdInventory(), availability: { ratio: 2 } }] })).ok,
    ).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ inventory: [{ ...stdInventory(), leadTime: { days: -1 } }] })).ok,
    ).toBe(false);
    expect(
      buildVendor(TENANT_A, createInput({ capabilities: [{ kind: "", id: "x" }] })).ok,
    ).toBe(false);
  });
});

describe("D1: vendor revision (append-only)", () => {
  test("reviseVendor appends revision+1 and never rewrites the prior", () => {
    const prior = vendor({ description: "rev1" });
    const next = reviseVendor(prior, reviseInput({ description: "rev2" }));
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.vendor.revision).toBe(2);
    expect(next.vendor.description).toBe("rev2");
    expect(next.vendor.vendorId).toBe(prior.vendorId);
    // Prior is unchanged.
    expect(prior.revision).toBe(1);
    expect(prior.description).toBe("rev1");
    // New content hash.
    expect(next.vendor.contentHash).not.toBe(prior.contentHash);
  });

  test("a revision with the same content produces the same hash as another revision with the same content", () => {
    const prior = vendor();
    const a = reviseVendor(prior, reviseInput({ description: "same" }));
    const b = reviseVendor(prior, reviseInput({ description: "same" }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.vendor.contentHash).toBe(b.vendor.contentHash);
  });

  test("revisions are frozen at construction", () => {
    const prior = vendor();
    const next = reviseVendor(prior, reviseInput());
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(Object.isFrozen(next.vendor)).toBe(true);
    expect(Object.isFrozen(next.vendor.capabilities)).toBe(true);
    expect(Object.isFrozen(next.vendor.inventory)).toBe(true);
    expect(Object.isFrozen(next.vendor.terms)).toBe(true);
  });

  test("revision validation rejects bad inputs", () => {
    const prior = vendor();
    expect(reviseVendor(prior, reviseInput({ name: "" })).ok).toBe(false);
    expect(reviseVendor(prior, reviseInput({ at: "not-iso" })).ok).toBe(false);
    expect(reviseVendor(prior, reviseInput({ terms: stdTerms({ quality: { score: -1 } }) })).ok).toBe(false);
  });
});

describe("D1: capability kinds (open union for forward compatibility)", () => {
  test("an unknown capability kind is accepted (forward compatibility)", () => {
    const v = vendor({
      capabilities: [
        stdCapability(),
        { kind: "future-capability" as never, id: "future.x" },
      ],
    });
    expect(v.capabilities.length).toBe(2);
    expect(v.capabilities[1]?.kind).toBe("future-capability");
  });
});
