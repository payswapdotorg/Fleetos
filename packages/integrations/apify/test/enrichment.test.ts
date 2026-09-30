/**
 * W100C — the Apify enrichment proposal model: determinism, provenance,
 * and the structural hard law.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  APIFY_PROPOSAL_STATUS,
  buildDiscoveryAttribution,
  normalizeVendorDiscoveryProposals,
} from "../src/index";
import type { ApifyRawDatasetItem } from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const FETCHED_AT = "2026-10-01T09:00:00Z";
const PROVENANCE = {
  provider: "apify" as const,
  runId: "run_abc",
  datasetId: "ds_xyz",
  fetchedAt: FETCHED_AT,
};

test("every proposal carries the literal PROPOSAL discriminator", () => {
  const proposals = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, [
    { name: "Nordwerk IT Service" },
  ]);
  expect(proposals.length).toBe(1);
  expect(proposals[0]!.proposalStatus).toBe("PROPOSAL");
  expect(APIFY_PROPOSAL_STATUS).toBe("PROPOSAL");
});

test("normalization is deterministic and name-sorted", () => {
  const items: ApifyRawDatasetItem[] = [
    { name: "Zeta Reparatur", region: "Berlin" },
    { name: "Alpha Technik", region: "Hamburg" },
  ];
  const a = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, items);
  const b = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, items);
  expect(a).toEqual(b);
  expect(a.map((p) => p.candidateName)).toEqual(["Alpha Technik", "Zeta Reparatur"]);
});

test("items without a usable name are dropped; duplicates keep the first", () => {
  const proposals = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, [
    { name: "  " },
    { region: "Berlin" },
    { name: "Dup Vendor", website: "https://first.example" },
    { name: "Dup Vendor", website: "https://second.example" },
  ]);
  expect(proposals.length).toBe(1);
  expect(proposals[0]!.candidateName).toBe("Dup Vendor");
  expect(proposals[0]!.website).toBe("https://first.example");
});

test("categories normalize to sorted-unique; text fields trim", () => {
  const proposals = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, [
    {
      name: "  Voll Service  ",
      categories: ["repair", "Laptops", "repair", "Printers"],
      region: "  Munich  ",
      phone: "+49 89 000",
      email: "info@voll.example",
      notes: "  24h turnaround  ",
    },
  ]);
  const proposal = proposals[0]!;
  expect(proposal.candidateName).toBe("Voll Service");
  expect(proposal.categories).toEqual(["Laptops", "Printers", "repair"]);
  expect(proposal.region).toBe("Munich");
  expect(proposal.phone).toBe("+49 89 000");
  expect(proposal.contactEmail).toBe("info@voll.example");
  expect(proposal.notes).toBe("24h turnaround");
});

test("every proposal carries the full provenance verbatim", () => {
  const proposals = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, [
    { name: "Provenance Probe" },
  ]);
  expect(proposals[0]!.provenance).toEqual(PROVENANCE);
  expect(proposals[0]!.tenantId).toBe(TENANT_A);
});

test("the attribution summary counts raw vs normalized honestly", () => {
  const items: ApifyRawDatasetItem[] = [
    { name: "A" },
    { name: "A" },
    { name: "B" },
    {},
  ];
  const proposals = normalizeVendorDiscoveryProposals(TENANT_A, PROVENANCE, items);
  const attribution = buildDiscoveryAttribution(PROVENANCE, items.length, proposals);
  expect(attribution.rawItemCount).toBe(4);
  expect(attribution.proposalCount).toBe(2);
  expect(attribution.provider).toBe("apify");
  expect(attribution.runId).toBe("run_abc");
  expect(attribution.datasetId).toBe("ds_xyz");
  expect(attribution.fetchedAt).toBe(FETCHED_AT);
});
