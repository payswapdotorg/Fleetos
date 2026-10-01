/**
 * W100C web-commerce — the Apify vendor-discovery ENRICHMENT surface
 * tests: PROPOSAL-grade rows, attribution, the explicit
 * provider-unavailable states, and the REAL-adapter binding proof (the
 * W040 pattern — the real @fleetos/integration-apify results are
 * assignable to the facets and flow through the view builder).
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  VENDOR_DISCOVERY_VIEW_VERSION,
  buildVendorDiscoveryView,
} from "../src/index";
import {
  createApifyEnrichmentAdapter,
  createApifyTokenSource,
  createInMemoryTransport,
  createInMemoryUsageLedger,
} from "@fleetos/integration-apify";
import { TENANT_A, TENANT_B } from "./helpers";

const NOW = "2026-10-01T09:00:00Z";

function discoveredSource() {
  return {
    kind: "discovered" as const,
    proposals: [
      {
        proposalStatus: "PROPOSAL" as const,
        tenantId: TENANT_A,
        provenance: {
          provider: "apify" as const,
          runId: "run_w100c000001",
          datasetId: "ds_w100c0000001",
          fetchedAt: NOW,
        },
        candidateName: "Zeta Reparatur",
        region: "Berlin",
        categories: ["repair", "Laptops"],
        website: "https://zeta.example",
        phone: "+49 30 000",
        contactEmail: "info@zeta.example",
        notes: "24h turnaround",
      },
      {
        proposalStatus: "PROPOSAL" as const,
        tenantId: TENANT_A,
        provenance: {
          provider: "apify" as const,
          runId: "run_w100c000001",
          datasetId: "ds_w100c0000001",
          fetchedAt: NOW,
        },
        candidateName: "Alpha Technik",
        region: "Hamburg",
        categories: ["Printers"],
        website: null,
        phone: null,
        contactEmail: null,
        notes: null,
      },
    ],
    attribution: {
      provider: "apify" as const,
      runId: "run_w100c000001",
      datasetId: "ds_w100c0000001",
      fetchedAt: NOW,
      rawItemCount: 2,
      proposalCount: 2,
    },
  };
}

test("discovered proposals render as PROPOSAL-grade rows, name-sorted, attribution-carrying", () => {
  const result = buildVendorDiscoveryView(TENANT_A, discoveredSource());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const view = result.view;
  if (view.kind !== "discovered") throw new Error("expected discovered view");
  expect(view.viewVersion).toBe(VENDOR_DISCOVERY_VIEW_VERSION);
  expect(view.proposalCount).toBe(2);
  expect(view.rows.map((r) => r.candidateName)).toEqual(["Alpha Technik", "Zeta Reparatur"]);
  for (const row of view.rows) {
    expect(row.proposalStatus).toBe("PROPOSAL");
    expect(row.attributionLine).toContain("via apify · run run_w100c000001");
    expect(row.attributionLine).toContain(`fetched ${NOW}`);
  }
  expect(view.attributionLine).toContain("2 raw items → 2 proposals");
});

test("HARD LAW: a proposal WITHOUT the PROPOSAL status refuses the whole build", () => {
  const source = discoveredSource();
  const forged = {
    ...source,
    proposals: source.proposals.map((p) => ({ ...p, proposalStatus: "APPROVED" as never })),
  };
  const result = buildVendorDiscoveryView(TENANT_A, forged);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("web-commerce.discovery.proposal_status_required");
    expect(result.error.message).toContain("human-visible PROPOSAL status");
  }
});

test("a cross-tenant proposal refuses (tenant_mismatch, LOCK 17)", () => {
  const source = discoveredSource();
  const foreign = {
    ...source,
    proposals: source.proposals.map((p) => ({ ...p, tenantId: TENANT_B })),
  };
  const result = buildVendorDiscoveryView(TENANT_A, foreign);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("web-commerce.discovery.tenant_mismatch");
});

test("the unavailable states render fail-visibly with reason + escalation path", () => {
  for (const state of ["unconfigured", "budget_exhausted", "unreachable"] as const) {
    const result = buildVendorDiscoveryView(TENANT_A, {
      kind: "unavailable",
      unavailable: {
        state,
        reason: `apify_reason_${state}`,
        retryable: state !== "unconfigured",
      },
      escalationPath: `Escalate for ${state}.`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const view = result.view;
    if (view.kind !== "unavailable") throw new Error("expected unavailable view");
    expect(view.unavailable.state).toBe(state);
    expect(view.unavailable.reason).toBe(`apify_reason_${state}`);
    expect(view.unavailable.retryable).toBe(state !== "unconfigured");
    expect(view.unavailable.escalationPath).toBe(`Escalate for ${state}.`);
    expect(view.unavailable.headline.length).toBeGreaterThan(0);
  }
});

test("a missing escalation path falls back to a visible default (never blank)", () => {
  const result = buildVendorDiscoveryView(TENANT_A, {
    kind: "unavailable",
    unavailable: { state: "unreachable", reason: "apify_transport_unreachable", retryable: true },
    escalationPath: "",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const view = result.view;
  if (view.kind !== "unavailable") throw new Error("expected unavailable view");
  expect(view.unavailable.escalationPath).toContain("fleet administrator");
});

test("invalid sources refuse machine-stably (never throw)", () => {
  expect(buildVendorDiscoveryView(TENANT_A, null as never).ok).toBe(false);
  expect(buildVendorDiscoveryView(TENANT_A, {} as never).ok).toBe(false);
  const malformed = buildVendorDiscoveryView(TENANT_A, {
    kind: "unavailable",
    unavailable: null as never,
    escalationPath: "",
  });
  expect(malformed.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The REAL-adapter binding proof (the W040 pattern — test/ only)
// ---------------------------------------------------------------------------

test("BINDING: the REAL apify adapter's discovery result flows through the view builder", () => {
  const transport = createInMemoryTransport({
    responses: [
      {
        ok: true,
        runId: "run_real00000001",
        datasetId: "ds_real00000001",
        items: [
          { name: "Nordwerk IT Service", region: "Berlin", categories: ["repair", "Laptops"] },
          { name: "Nordwerk IT Service", website: "https://dup.example" },
          { name: "Akku Kolonial", region: "Munich", categories: ["Batteries"] },
          {},
        ],
      },
    ],
  });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: createApifyTokenSource(() => "token-not-inspected"),
    usageLedger: createInMemoryUsageLedger(),
    transport,
  });
  const discovery = adapter.discoverVendorCandidates({
    tenantId: TENANT_A,
    query: "laptop repair Berlin",
    now: NOW,
  });
  expect(discovery.ok).toBe(true);
  if (!discovery.ok) throw new Error(discovery.unavailable.reason);

  // The REAL result is assignable to the facet union (compile-time) and
  // flows through the builder (runtime).
  const source = { kind: "discovered", ...discovery } as const;
  const view = buildVendorDiscoveryView(TENANT_A, source);
  expect(view.ok).toBe(true);
  if (!view.ok) throw new Error(view.error.message);
  const v = view.view;
  if (v.kind !== "discovered") throw new Error("expected discovered view");
  // Dedupe + drop-nameless: 4 raw items -> 2 proposals, name-sorted.
  expect(v.rows.map((r) => r.candidateName)).toEqual(["Akku Kolonial", "Nordwerk IT Service"]);
  expect(v.attributionLine).toContain("4 raw items → 2 proposals");
});

test("BINDING: the REAL adapter's refusal states flow into the unavailable view", () => {
  // Unconfigured.
  const unconfigured = createApifyEnrichmentAdapter({
    tokenSource: createApifyTokenSource(() => undefined),
    usageLedger: createInMemoryUsageLedger(),
    transport: createInMemoryTransport(),
  });
  const refused = unconfigured.discoverVendorCandidates({
    tenantId: TENANT_A,
    query: "x",
    now: NOW,
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  const view = buildVendorDiscoveryView(TENANT_A, {
    kind: "unavailable",
    unavailable: refused.unavailable,
    escalationPath: refused.escalationPath,
  });
  expect(view.ok).toBe(true);
  if (!view.ok) throw new Error(view.error.message);
  const v = view.view;
  if (v.kind !== "unavailable") throw new Error("expected unavailable view");
  expect(v.unavailable.state).toBe("unconfigured");
  expect(v.unavailable.reason).toBe("apify_token_missing");
  expect(v.unavailable.escalationPath).toContain("APIFY_TOKEN");

  // Budget-exhausted.
  const spent = createApifyEnrichmentAdapter({
    tokenSource: createApifyTokenSource(() => "token"),
    usageLedger: createInMemoryUsageLedger({ initialCents: 0 }),
    transport: createInMemoryTransport(),
  });
  const budgetRefused = spent.discoverVendorCandidates({ tenantId: TENANT_A, query: "x", now: NOW });
  expect(budgetRefused.ok).toBe(false);
  if (budgetRefused.ok) throw new Error("expected refusal");
  const budgetView = buildVendorDiscoveryView(TENANT_A, {
    kind: "unavailable",
    unavailable: budgetRefused.unavailable,
    escalationPath: budgetRefused.escalationPath,
  });
  if (!budgetView.ok) throw new Error(budgetView.error.message);
  const bv = budgetView.view;
  if (bv.kind !== "unavailable") throw new Error("expected unavailable view");
  expect(bv.unavailable.state).toBe("budget_exhausted");
  expect(bv.unavailable.headline).toContain("budget exhausted");
});

test("PROVIDER NEUTRALITY: discovery views carry no credentials or provider handles", () => {
  const result = buildVendorDiscoveryView(TENANT_A, discoveredSource());
  if (!result.ok) throw new Error(result.error.message);
  const serialized = JSON.stringify(result.view).toLowerCase();
  for (const forbidden of ["token", "secret", "password", "apikey", "credential"]) {
    expect(serialized.includes(forbidden)).toBe(false);
  }
  // The view is tenant-scoped for the acting tenant only.
  if (result.view.kind === "discovered") {
    expect(result.view.tenantId).toBe(asTenantId("tnt_w060cbbbbbbbb1"));
  }
});
