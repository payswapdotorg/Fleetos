/**
 * W100C apify adapter — the authority-boundary tests.
 *
 * The hard law (the work order, verbatim): "Apify output is
 * proposal/enrichment data ONLY — never authoritative inventory, price,
 * policy or fulfillment truth. The domain never treats Apify data as a
 * decision input without human-visible proposal status."
 *
 * This suite asserts:
 *   1. the package's PUBLIC SURFACE is exactly the discovery-enrichment
 *      allowlist (no store-mutation path for ANY FleetOS domain);
 *   2. no export name suggests a domain mutation or authoritative-write
 *      path;
 *   3. the proposal MODEL structurally cannot carry authoritative
 *      commerce truth (field allowlist + source scan of the interface);
 *   4. every proposal carries the human-visible PROPOSAL status;
 *   5. src/ imports ONLY @fleetos/contracts (no domain package, no
 *      provider SDK).
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as apify from "../src/index";

/**
 * The exhaustive value-export allowlist. Every name is classified:
 *   - PURE helper/derivation;
 *   - SEAM/constant (availability, environment, budget, transport);
 *   - the ADAPTER (the single discovery entry point);
 *   - module markers.
 * Anything NOT on this list fails the boundary by definition. Adding a
 * name here is a deliberate, reviewable authority-boundary change.
 */
const EXPECTED_EXPORTS = new Set([
  // availability.ts — the fail-visible states + the environment seam
  "APIFY_TOKEN_ENV_NAME",
  "createApifyTokenSource",
  "PROCESS_ENV_TOKEN_SOURCE",
  "APIFY_UNCONFIGURED",
  "apifyBudgetExhausted",
  "apifyUnreachable",
  // budget.ts — the usage/cost guard (SEAM + in-memory reference)
  "createInMemoryUsageLedger",
  // transport.ts — the injected transport seam (+ in-memory reference)
  "createInMemoryTransport",
  // enrichment.ts — the PROPOSAL-grade proposal model (PURE)
  "APIFY_PROPOSAL_STATUS",
  "normalizeVendorDiscoveryProposals",
  "buildDiscoveryAttribution",
  // adapter.ts — the single discovery entry point
  "createApifyEnrichmentAdapter",
  // index.ts — the module markers
  "MODULE_NAME",
  "MODULE_VERSION",
]);

test("the public value surface is EXACTLY the discovery-enrichment allowlist", () => {
  const exported = Object.keys(apify).sort();
  const expected = [...EXPECTED_EXPORTS].sort();
  expect(exported).toEqual(expected);
});

test("no export name suggests a domain mutation or authoritative-write path", () => {
  const forbiddenFragments = [
    "dispatch",
    "execute",
    "approve",
    "reject",
    "recordvendor",
    "createvendor",
    "issuequote",
    "acceptquote",
    "setprice",
    "setinventory",
    "createorder",
    "createworkorder",
    "persist",
    "save",
    "upsert",
  ];
  for (const name of Object.keys(apify)) {
    const lower = name.toLowerCase();
    for (const fragment of forbiddenFragments) {
      if (lower.includes(fragment)) {
        throw new Error(`authority boundary violated: export "${name}" matches "${fragment}"`);
      }
    }
  }
  expect(true).toBe(true);
});

test("the adapter object exposes ONLY the probe + the discovery entry + the status literal", () => {
  const adapter = apify.createApifyEnrichmentAdapter({
    tokenSource: apify.createApifyTokenSource(() => "token"),
    usageLedger: apify.createInMemoryUsageLedger(),
    transport: apify.createInMemoryTransport(),
  });
  expect(Object.keys(adapter).sort()).toEqual([
    "availability",
    "discoverVendorCandidates",
    "proposalStatus",
  ]);
});

test("the proposal MODEL structurally cannot carry authoritative commerce truth", () => {
  // The runtime field allowlist: every key a proposal can carry, by
  // construction. A new field is a deliberate, reviewable boundary
  // change that must extend this list.
  const proposalFieldAllowlist = new Set([
    "proposalStatus",
    "tenantId",
    "provenance",
    "candidateName",
    "region",
    "categories",
    "website",
    "phone",
    "contactEmail",
    "notes",
  ]);
  const proposals = apify.normalizeVendorDiscoveryProposals(
    "tnt_alpha000001" as never,
    { provider: "apify", runId: "r", datasetId: "d", fetchedAt: "2026-10-01T09:00:00Z" },
    [
      {
        name: "Boundary Probe",
        region: "Berlin",
        categories: ["repair"],
        website: "https://probe.example",
        phone: "+49 000",
        email: "p@example",
        notes: "n",
      },
    ],
  );
  expect(proposals.length).toBe(1);
  for (const key of Object.keys(proposals[0]!)) {
    if (!proposalFieldAllowlist.has(key)) {
      throw new Error(`authority boundary violated: proposal carries field "${key}"`);
    }
  }
  // The human-visible status is present on the record.
  expect(proposals[0]!.proposalStatus).toBe("PROPOSAL");

  // The SOURCE scan: the interface declaration itself contains no
  // authoritative-commerce field name (price/inventory/quantity/stock/
  // sla/warranty/fulfillment/policy).
  const enrichmentSource = readFileSync(join(import.meta.dir, "..", "src", "enrichment.ts"), "utf8");
  const interfaceBlock = enrichmentSource.slice(
    enrichmentSource.indexOf("export interface VendorDiscoveryProposal"),
    enrichmentSource.indexOf("export interface ApifyDiscoveryAttribution"),
  );
  const forbiddenFields = [
    "price",
    "inventory",
    "quantity",
    "stock",
    "sla",
    "warranty",
    "fulfillment",
    "leadTime",
    "availabilityRatio",
    "policy",
  ];
  for (const field of forbiddenFields) {
    const pattern = new RegExp(`\\b${field}\\b`, "i");
    if (pattern.test(interfaceBlock)) {
      throw new Error(
        `authority boundary violated: VendorDiscoveryProposal mentions "${field}"`,
      );
    }
  }
});

test("src/ imports ONLY @fleetos/contracts (no domain package, no provider SDK)", () => {
  const srcFiles = [
    "internal.ts",
    "availability.ts",
    "budget.ts",
    "transport.ts",
    "enrichment.ts",
    "adapter.ts",
    "index.ts",
    "index.test.ts",
  ];
  const allowed = new Set(["@fleetos/contracts", "@fleetos/contracts/testing"]);
  const violations: string[] = [];
  for (const file of srcFiles) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    const specs = [...text.matchAll(/from\s+["'](@fleetos\/[^"']+)["']/g)].map(
      (m) => m[1] as string,
    );
    for (const spec of specs) {
      if (!allowed.has(spec)) {
        violations.push(`${file} imports ${spec}`);
      }
    }
    // A provider SDK import (any bare specifier that is NOT a relative
    // import, a bun:test, or @fleetos/*) is a boundary violation.
    const allSpecs = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] as string);
    for (const spec of allSpecs) {
      if (spec.startsWith(".") || spec.startsWith("@fleetos/") || spec === "bun:test") continue;
      violations.push(`${file} imports non-relative dependency "${spec}"`);
    }
  }
  expect(violations).toEqual([]);
});

test("the package never re-exports a sibling domain package's surface", () => {
  const indexText = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
  expect(/export\s+\*\s+from\s+["']@fleetos\//.test(indexText)).toBe(false);
});
